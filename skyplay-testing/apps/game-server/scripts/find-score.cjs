// find-score.cjs — Targeted score-address discovery for CPS1 brawler (Dino)
// Approach: BCD search across extended memory range + differential re-scan.
//
// Usage:
//   node find-score.cjs search <score_value>  → scan RAM for BCD-encoded score
//   node find-score.cjs diff <old_score> <new_score>  → re-scan & diff

const dgram = require('dgram');
const readline = require('readline');

const RA_HOST = '127.0.0.1';
const RA_PORT = 55355;
const CHUNK_SIZE = 2048;

// Scan regions (CPS1 FBNeo memory map)
const REGIONS = [
  { name: 'Work RAM',    start: 0x000000, end: 0x00FFFF },  // 64KB
  { name: 'Upper RAM',   start: 0x010000, end: 0x01FFFF },  // potential mirror/extra
  { name: 'Ext RAM 1',   start: 0x800000, end: 0x80FFFF },  // often used by CPS1
  { name: 'Ext RAM 2',   start: 0xFF0000, end: 0xFFFFFF },  // often used by CPS1
];

function readRam(addr, size) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const cmd = Buffer.from(`READ_CORE_RAM ${addr.toString(16)} ${size}\n`);
    let buf = '';
    const t = setTimeout(() => { try { sock.close(); } catch {} resolve(null); }, 3000);
    sock.on('message', (m) => {
      buf += m.toString();
      const parts = buf.trim().split(/\s+/);
      if ((parts[0] === 'READ_CORE_RAM' || parts[0] === 'READ_CORE_MEMORY') &&
          parseInt(parts[1], 16) === addr) {
        clearTimeout(t);
        try { sock.close(); } catch {}
        resolve(parts.slice(2).join(''));
      }
    });
    sock.send(cmd, RA_PORT, RA_HOST);
  });
}

// Parse hex string to bytes: byte[i] = hex[2*i..2*i+2]
function hexToBytes(hex) {
  const bytes = [];
  for (let i = 0; i < hex.length - 1; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16));
  }
  return bytes;
}

// Interpret N bytes as BCD value (most-significant byte first in memory)
// E.g. bytes [0x00, 0x01, 0x50] = 150
function bytesToBcd(bytes) {
  let val = 0;
  for (const b of bytes) {
    if ((b >> 4) > 9 || (b & 0xF) > 9) return -1; // not BCD
    val = val * 100 + ((b >> 4) * 10) + (b & 0xF);
  }
  return val;
}

// Interpret N bytes as big-endian integer
function bytesToInt(bytes) {
  let val = 0;
  for (const b of bytes) val = (val << 8) | b;
  return val;
}

// Search for a value across regions
async function searchValue(target, numBytes) {
  console.log(`\n🔍 Searching for score=${target} (${numBytes} byte${numBytes>1?'s':''}) across ${REGIONS.length} regions...`);
  const hits = [];

  for (const region of REGIONS) {
    const size = region.end - region.start + 1;
    const chunks = Math.ceil(size / CHUNK_SIZE);

    for (let c = 0; c < chunks; c++) {
      const addr = region.start + c * CHUNK_SIZE;
      const chunkSize = Math.min(CHUNK_SIZE, region.end - addr + 1);
      const hex = await readRam(addr, chunkSize);

      if (!hex) {
        if (c === 0) console.log(`  ⚠️  ${region.name} (0x${region.start.toString(16)}): no response`);
        break;
      }

      const bytes = hexToBytes(hex);

      // Scan for BCD match (numBytes consecutive BCD bytes matching target)
      for (let i = 0; i <= bytes.length - numBytes; i++) {
        const slice = bytes.slice(i, i + numBytes);
        const bcd = bytesToBcd(slice);
        if (bcd === target) {
          hits.push({
            addr: addr + i,
            addrHex: '0x' + (addr + i).toString(16).padStart(6, '0'),
            region: region.name,
            encoding: 'bcd',
            bytes: slice.map(b => b.toString(16).padStart(2, '0')).join(' '),
            value: bcd,
          });
        }
        // Also try plain big-endian integer
        const intVal = bytesToInt(slice);
        if (intVal === target && numBytes > 1) {
          hits.push({
            addr: addr + i,
            addrHex: '0x' + (addr + i).toString(16).padStart(6, '0'),
            region: region.name,
            encoding: 'int',
            bytes: slice.map(b => b.toString(16).padStart(2, '0')).join(' '),
            value: intVal,
          });
        }
      }

      if (c % 16 === 0) {
        process.stdout.write(`\r  ${region.name}: ${c}/${chunks} chunks (${hits.length} hits so far)`);
      }
    }
    console.log(`\r  ${region.name}: done — ${hits.length} total hits`);
    if (hits.length === 0) break; // try next region
  }

  return hits;
}

// Differential search: find BYTES that changed from oldVal to newVal
async function diffSearch(oldVal, newVal, numBytes) {
  console.log(`\n🔍 Diff search: ${oldVal} → ${newVal} (${numBytes} byte${numBytes>1?'s':''})`);

  const oldHits = await searchValue(oldVal, numBytes);
  console.log(`\n📋 Old hits: ${oldHits.length}`);

  if (oldHits.length === 0) {
    console.log('❌ Old value not found in any region. Try a different encoding size.');
    console.log('   Common arcade score formats:');
    console.log('   2 bytes = 0-9999 (BCD: 0x0000-0x9999)');
    console.log('   3 bytes = 0-999999 (BCD: 0x000000-0x999999)');
    console.log('   4 bytes = 0-99999999 (BCD: 0x00000000-0x99999999)');
    return [];
  }

  const newHits = await searchValue(newVal, numBytes);
  console.log(`📋 New hits: ${newHits.length}`);

  // Find addresses that were in oldHits but CHANGED to newVal
  const oldAddrSet = new Set(oldHits.map(h => h.addr));
  const newAddrSet = new Set(newHits.map(h => h.addr));

  // Addresses that had oldVal and now have newVal
  const changed = newHits.filter(h => oldAddrSet.has(h.addr));
  // Addresses that had oldVal but don't have newVal (might have changed to something else)
  const disappeared = oldHits.filter(h => !newAddrSet.has(h.addr));

  console.log(`\n🎯 Addresses that changed from ${oldVal} → ${newVal}: ${changed.length}`);
  for (const h of changed.slice(0, 30)) {
    console.log(`  ${h.addrHex.padEnd(10)} [${h.region.padEnd(12)}] ${h.encoding.padEnd(5)} bytes=${h.bytes}`);
  }

  if (changed.length === 0 && disappeared.length > 0) {
    console.log(`\n⚠️  ${disappeared.length} addresses had ${oldVal} but no longer do.`);
    console.log('   The score may have changed by more than expected, or encoding differs.');
    console.log('   First few disappeared:');
    for (const h of disappeared.slice(0, 10)) {
      console.log(`  ${h.addrHex.padEnd(10)} [${h.region.padEnd(12)}] ${h.encoding.padEnd(5)}`);
    }
  }

  return changed;
}

// Quick search: scan a specific address repeatedly
async function monitorAddr(addr, count) {
  console.log(`\n👁️  Monitoring 0x${addr.toString(16)} for ${count} polls...`);
  for (let i = 0; i < count; i++) {
    const hex = await readRam(addr, 8);
    if (hex) {
      const bytes = hexToBytes(hex);
      const vals = [];
      for (let b = 0; b < bytes.length; b += 2) {
        const w = (bytes[b] << 8) | bytes[b + 1];
        const bcd = bytesToBcd(bytes.slice(b, Math.min(b + 4, bytes.length)));
        vals.push(`0x${w.toString(16).padStart(4, '0')}(${w})${bcd >= 0 ? ' BCD:' + bcd : ''}`);
      }
      console.log(`  #${i}: ${vals.join(' | ')}`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === 'search') {
    const score = parseInt(args[1]);
    if (isNaN(score)) { console.log('Usage: node find-score.cjs search <score_value>'); return; }
    const numBytes = parseInt(args[2]) || 3; // default 3-byte BCD (up to 999999)

    const hits = await searchValue(score, numBytes);
    console.log(`\n✅ Found ${hits.length} matches for score=${score}:`);
    for (const h of hits.slice(0, 50)) {
      console.log(`  ${h.addrHex.padEnd(10)} [${h.region.padEnd(12)}] ${h.encoding.padEnd(5)} bytes=${h.bytes}`);
    }
    if (hits.length > 50) console.log(`  ... and ${hits.length - 50} more`);
  }
  else if (cmd === 'diff') {
    const oldVal = parseInt(args[1]);
    const newVal = parseInt(args[2]);
    if (isNaN(oldVal) || isNaN(newVal)) {
      console.log('Usage: node find-score.cjs diff <old_score> <new_score> [numBytes=3]');
      return;
    }
    const numBytes = parseInt(args[3]) || 3;
    await diffSearch(oldVal, newVal, numBytes);
  }
  else if (cmd === 'watch') {
    const addr = parseInt(args[1]);
    if (isNaN(addr)) { console.log('Usage: node find-score.cjs watch <addr_hex> [count=10]'); return; }
    const count = parseInt(args[2]) || 10;
    await monitorAddr(addr, count);
  }
  else {
    console.log('find-score.cjs — Dino score RAM discovery');
    console.log('');
    console.log('Phase 1: Find current score in RAM');
    console.log('  node find-score.cjs search <score_value> [numBytes=3]');
    console.log('');
    console.log('Phase 2: After score changes, diff old vs new');
    console.log('  node find-score.cjs diff <old_score> <new_score> [numBytes=3]');
    console.log('');
    console.log('Phase 3: Verify by watching a candidate address');
    console.log('  node find-score.cjs watch <addr_hex> [count=10]');
    console.log('');
    console.log('Example workflow:');
    console.log('  1. Play game, check score (e.g. 350)');
    console.log('  2. node find-score.cjs search 350');
    console.log('  3. Kill an enemy, score changes (e.g. 500)');
    console.log('  4. node find-score.cjs diff 350 500');
    console.log('  5. Pick the best candidate, verify with watch');
  }
}

main().catch(console.error);
