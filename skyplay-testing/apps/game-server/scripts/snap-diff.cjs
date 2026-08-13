// snap-diff.cjs — Quick snapshot + diff for score discovery
const dgram = require('dgram');
const fs = require('fs');
const CHUNK = 512;

async function readRam(addr, size) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const cmd = Buffer.from('READ_CORE_RAM ' + addr.toString(16) + ' ' + size + '\n');
    let buf = '';
    let resolved = false;
    const t = setTimeout(() => { if (!resolved) { resolved = true; try { sock.close(); } catch {} resolve(null); } }, 2000);
    sock.on('message', (m) => {
      buf += m.toString();
      if (!resolved && buf.includes('READ_CORE_RAM')) {
        resolved = true; clearTimeout(t);
        try { sock.close(); } catch {}
        const parts = buf.trim().split(/\s+/);
        resolve(parts.slice(2).join(''));
      }
    });
    sock.send(cmd, 55355, '127.0.0.1');
  });
}

async function snapshot(label) {
  console.log('Snapshot ' + label + '...');
  let hex = '';
  for (let addr = 0; addr < 0x10000; addr += CHUNK) {
    const sz = Math.min(CHUNK, 0x10000 - addr);
    const h = await readRam(addr, sz);
    if (!h) { console.log('FAIL at 0x' + addr.toString(16)); break; }
    hex += h;
    if (addr % 4096 === 0) process.stderr.write('\r  ' + (addr/CHUNK) + '/128');
  }
  process.stderr.write('\r  ' + label + ': ' + hex.length/2 + ' bytes\n');
  return hex;
}

function diff(oldHex, newHex, oldScore, newScore) {
  const changes = [];
  for (let i = 0; i < Math.min(oldHex.length, newHex.length); i += 2) {
    const oldByte = parseInt(oldHex.substring(i, i+2), 16);
    const newByte = parseInt(newHex.substring(i, i+2), 16);
    if (oldByte !== newByte) changes.push({ addr: i/2, old: oldByte, new: newByte });
  }
  return changes;
}

function findScoreCandidates(changes, oldScore, newScore) {
  // Build 16-bit word changes
  const wordChanges = new Map();
  for (const c of changes) {
    const wordAddr = c.addr & ~1;
    if (!wordChanges.has(wordAddr)) wordChanges.set(wordAddr, { old: [0,0], new: [0,0], byteChanges: [] });
    const wc = wordChanges.get(wordAddr);
    wc.byteChanges.push(c);
    if (c.addr === wordAddr) { wc.old[0] = c.old; wc.new[0] = c.new; }
    else { wc.old[1] = c.old; wc.new[1] = c.new; }
  }

  console.log('\n=== SCORE SEARCH: ' + oldScore + ' → ' + newScore + ' ===');
  console.log('Total changed words: ' + wordChanges.size);
  console.log('Total changed bytes: ' + changes.length);

  // Try various interpretations
  const SCORE_DIV = 100; // scores often stored /100
  const oldDiv = oldScore / SCORE_DIV;
  const newDiv = newScore / SCORE_DIV;

  console.log('\nLooking for score/100: ' + oldDiv + ' → ' + newDiv);

  const candidates = [];

  for (const [wAddr, wc] of wordChanges) {
    const oldWord = (wc.old[0] << 8) | wc.old[1];
    const newWord = (wc.new[0] << 8) | wc.new[1];

    // Check 16-bit BE integer match
    if (oldWord === oldScore && newWord === newScore) candidates.push({ addr: wAddr, type: '16-bit BE exact', oldWord, newWord });
    if (oldWord === oldDiv && newWord === newDiv) candidates.push({ addr: wAddr, type: '16-bit BE /100', oldWord, newWord });

    // Check 16-bit LE integer match
    const oldLE = ((wc.old[1] << 8) | wc.old[0]) >>> 0;
    const newLE = ((wc.new[1] << 8) | wc.new[0]) >>> 0;
    if (oldLE === oldScore && newLE === newScore) candidates.push({ addr: wAddr, type: '16-bit LE exact', oldWord: oldLE, newWord: newLE });
    if (oldLE === oldDiv && newLE === newDiv) candidates.push({ addr: wAddr, type: '16-bit LE /100', oldWord: oldLE, newWord: newLE });
  }

  // Also check 3-byte and 4-byte values for changed byte sequences
  // Group consecutive changed bytes
  const byteAddrSet = new Set(changes.map(c => c.addr));
  const groups = [];
  let currentGroup = null;
  for (let addr = 0; addr < 0x10000; addr++) {
    if (byteAddrSet.has(addr)) {
      if (!currentGroup) currentGroup = { start: addr, bytes: [] };
      currentGroup.bytes.push(changes.find(c => c.addr === addr));
      currentGroup.end = addr;
    } else {
      if (currentGroup) { groups.push(currentGroup); currentGroup = null; }
    }
  }
  if (currentGroup) groups.push(currentGroup);

  console.log('\nConsecutive byte-change groups: ' + groups.length);
  for (const g of groups) {
    const len = g.end - g.start + 1;
    if (len >= 2 && len <= 6) {
      // Build old and new values
      let oldVal = 0, newVal = 0;
      for (const bc of g.bytes) {
        oldVal = (oldVal << 8) | bc.old;
        newVal = (newVal << 8) | bc.new;
      }
      const match = (oldVal === oldScore && newVal === newScore) || (oldVal === oldDiv && newVal === newDiv);
      const marker = match ? ' ★★★ SCORE CANDIDATE ★★★' : '';
      console.log('  0x' + g.start.toString(16).padStart(4,'0') + '-' + g.end.toString(16).padStart(4,'0') + ' (' + len + 'B): ' +
        g.bytes.map(b => b.old.toString(16).padStart(2,'0')+'→'+b.new.toString(16).padStart(2,'0')).join(' ') +
        ' | val: ' + oldVal + '→' + newVal + marker);
    }
  }

  if (candidates.length > 0) {
    console.log('\n★★★ SCORE CANDIDATES:');
    for (const c of candidates) {
      console.log('  0x' + c.addr.toString(16).padStart(4,'0') + ': ' + c.type + ' ' + c.oldWord + '→' + c.newWord);
    }
  }

  return { changes, wordChanges, groups };
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'snap') {
    const label = process.argv[3] || 'A';
    const hex = await snapshot(label);
    fs.writeFileSync('/tmp/snap_' + label + '.hex', hex);
    console.log('Saved to /tmp/snap_' + label + '.hex');
  }
  else if (cmd === 'diff') {
    const oldScore = parseInt(process.argv[3]);
    const newScore = parseInt(process.argv[4]);
    if (isNaN(oldScore) || isNaN(newScore)) { console.log('Usage: node snap-diff.cjs diff <oldScore> <newScore>'); return; }
    const oldHex = fs.readFileSync('/tmp/snap_A.hex', 'utf8').trim();
    const newHex = fs.readFileSync('/tmp/snap_B.hex', 'utf8').trim();
    const changes = diff(oldHex, newHex, oldScore, newScore);
    findScoreCandidates(changes, oldScore, newScore);
  }
  else {
    console.log('Usage:');
    console.log('  node snap-diff.cjs snap A   — take snapshot A');
    console.log('  node snap-diff.cjs snap B   — take snapshot B');
    console.log('  node snap-diff.cjs diff <oldScore> <newScore>');
  }
}
main().catch(console.error);
