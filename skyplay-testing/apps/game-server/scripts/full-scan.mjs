/**
 * FULL 128KB WRAM Scanner — KO Test Methodology
 *
 * Phase 1: Baseline dump of entire 128KB WRAM
 * Phase 2: Real-time monitoring of health-range addresses
 * Phase 3: On KO/damage signal, re-dump and diff
 *
 * Strategy:
 *   - First pass: dump all 128KB, find ALL bytes in 48-100 range
 *   - Also look for PAIRS of bytes with same value (potential 16-bit health)
 *   - Monitor the top candidates at high speed
 *   - On KO: find which addresses went to 0
 *
 * Usage: cat scripts/full-scan.mjs | docker exec -i game-server-game-server-1 sh -c "cat > /tmp/full-scan.mjs && node /tmp/full-scan.mjs"
 */

import { createSocket } from "dgram";
import { Buffer } from "buffer";

const HOST = "127.0.0.1";
const PORT = 55355;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function udpCmd(sock, cmd) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), 2000);
    const h = (m) => {
      const txt = m.toString();
      if (!txt.startsWith(cmd.split(" ")[0])) return;
      clearTimeout(t); sock.removeListener("message", h);
      resolve(txt);
    };
    sock.on("message", h);
    sock.send(Buffer.from(cmd + "\n"), PORT, HOST);
  });
}

/**
 * Read a chunk of WRAM via UDP.
 * snes9x libretro uses offset-based addressing: 0x00000-0x1FFFF for 128KB WRAM.
 * We pass hex addresses WITHOUT the 0x prefix.
 */
async function readChunk(sock, addr, size) {
  try {
    const r = await udpCmd(sock, `READ_CORE_RAM ${addr.toString(16)} ${size}`);
    const parts = r.split(" ");
    const data = parts.slice(2).join("");
    const bytes = [];
    for (let i = 0; i < data.length; i += 2) {
      const b = parseInt(data.substring(i, i + 2), 16);
      if (!isNaN(b)) bytes.push(b);
    }
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Full 128KB dump. Returns Map<addr, value>.
 * Reads 256-byte chunks = 512 reads total.
 */
async function fullDump(sock, progress = true) {
  const all = new Map();
  const CHUNK = 256;
  const TOTAL = 0x20000; // 128KB
  let done = 0;

  for (let addr = 0; addr < TOTAL; addr += CHUNK) {
    const bytes = await readChunk(sock, addr, CHUNK);
    if (bytes) {
      for (let i = 0; i < bytes.length; i++) {
        all.set(addr + i, bytes[i]);
      }
    }
    done++;
    if (progress && done % 64 === 0) {
      process.stderr.write(`\r   ${((addr / TOTAL) * 100).toFixed(0)}% `);
    }
  }
  if (progress) process.stderr.write("\r   100% done\n");
  return all;
}

/**
 * Find addresses that look like health values (48-100).
 * Also finds pairs of adjacent bytes with the SAME value (potential 16-bit health).
 */
function findHealthCandidates(dump) {
  const inRange = [];      // single bytes in 48-100
  const identicalPairs = []; // pairs of adjacent bytes with same value in 48-100

  for (const [addr, val] of dump) {
    if (val >= 48 && val <= 100) {
      inRange.push({ addr, val });
    }
  }

  // Find adjacent identical values in health range
  const seen = new Set();
  for (const { addr, val } of inRange) {
    if (seen.has(addr)) continue;
    const next = dump.get(addr + 1);
    if (next === val) {
      // Both bytes have the same value — potential 16-bit health
      identicalPairs.push({ addr, val, next });
      seen.add(addr);
      seen.add(addr + 1);
    }
  }

  // Also find pairs where both bytes are in health range (not necessarily equal)
  const healthPairs = [];
  for (const { addr, val } of inRange) {
    if (seen.has(addr)) continue;
    const next = dump.get(addr + 1);
    if (next !== undefined && next >= 48 && next <= 100) {
      healthPairs.push({ addr, val, next });
      seen.add(addr);
      seen.add(addr + 1);
    }
  }

  return { inRange, identicalPairs, healthPairs };
}

/**
 * Find bytes that are candidates for being health based on:
 * - Value in 40-100 range (wider to catch partial damage)
 * - NOT in the first 256 bytes (likely system/stack area)
 */
function findBroadCandidates(dump) {
  const candidates = [];
  for (const [addr, val] of dump) {
    if (val >= 40 && val <= 100 && addr > 0xFF) {
      candidates.push({ addr, val });
    }
  }
  return candidates;
}

async function main() {
  const sock = createSocket("udp4");
  let status;
  try {
    status = await udpCmd(sock, "GET_STATUS");
    console.log("📡 " + status);
  } catch {
    console.log("❌ RetroArch not responding");
    sock.close();
    return;
  }

  const t0 = Date.now();

  // ============================================================
  // PHASE 1: Full 128KB baseline dump
  // ============================================================
  console.log("\n📸 PHASE 1: Full 128KB WRAM baseline dump...");
  console.log("   (512 x 256-byte reads, ~60-90 seconds)");

  const baseline = await fullDump(sock);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`   ${baseline.size} bytes captured in ${elapsed}s`);

  // ============================================================
  // PHASE 2: Analyze candidates
  // ============================================================
  console.log("\n🔍 PHASE 2: Finding health candidates...");

  const { inRange, identicalPairs, healthPairs } = findHealthCandidates(baseline);

  console.log(`   Bytes in health range (48-100): ${inRange.length}`);
  console.log(`   Identical adjacent pairs: ${identicalPairs.length}`);
  console.log(`   Adjacent health-range pairs: ${healthPairs.length}`);

  // Show top candidates — bytes at exactly 96 (max health)
  const at96 = inRange.filter(h => h.val === 96);
  console.log(`\n📍 Bytes = 96 (max health): ${at96.length}`);
  for (const h of at96.slice(0, 30)) {
    const nearby = [];
    for (let i = -4; i <= 4; i++) {
      const v = baseline.get(h.addr + i);
      if (v !== undefined) nearby.push(`[+${i}]=${v}`);
    }
    console.log(`   0x${h.addr.toString(16).padStart(5).toUpperCase()}: ${h.val}  |  ${nearby.join(" ")}`);
  }
  if (at96.length > 30) console.log(`   ... and ${at96.length - 30} more`);

  // Show identical pairs (potential 16-bit health)
  if (identicalPairs.length > 0) {
    console.log(`\n🔗 IDENTICAL ADJACENT PAIRS in health range (potential 16-bit):`);
    for (const p of identicalPairs.slice(0, 30)) {
      const addrStr = "0x" + p.addr.toString(16).padStart(5).toUpperCase();
      console.log(`   ${addrStr}-${(p.addr+1).toString(16).padStart(5).toUpperCase()}: ${p.val} ${p.next}`);
    }
  }

  // Show health pairs (adjacent, both in range, not necessarily equal)
  if (healthPairs.length > 0) {
    console.log(`\n🔗 ADJACENT HEALTH-RANGE PAIRS:`);
    for (const p of healthPairs.slice(0, 30)) {
      const addrStr = "0x" + p.addr.toString(16).padStart(5).toUpperCase();
      console.log(`   ${addrStr}: ${p.val} | +1: ${p.next}`);
    }
  }

  // ============================================================
  // PHASE 3: Quick scan — find ALL addresses outside known false-positive zones
  // ============================================================
  console.log("\n📍 ALL bytes in 40-100 range (broad, excluding 0x00-0xFF):");
  const broad = findBroadCandidates(baseline);
  console.log(`   Total: ${broad.length} bytes`);

  // Group by value to see distribution
  const byValue = new Map();
  for (const c of broad) {
    const v = c.val;
    if (!byValue.has(v)) byValue.set(v, []);
    byValue.get(v).push(c.addr);
  }

  // Show most common values (potential health-related)
  const sorted = [...byValue.entries()].sort((a, b) => b[1].length - a[1].length);
  console.log("\n📊 Value frequency (potential patterns):");
  for (const [val, addrs] of sorted.slice(0, 20)) {
    const addrList = addrs.slice(0, 5).map(a => "0x" + a.toString(16).padStart(5)).join(", ");
    const more = addrs.length > 5 ? ` (+${addrs.length - 5} more)` : "";
    console.log(`   val=${val}: ${addrs.length}x  [${addrList}${more}]`);
  }

  // ============================================================
  // PHASE 4: High-speed monitoring of top candidates
  // ============================================================
  console.log("\n⏱️  PHASE 4: Real-time monitoring...");
  console.log("   Watching all candidates at 96 for decreases.");
  console.log("   The user will signal when damage/KO occurs.\n");

  // Monitor all addresses that are currently at 96 (max health)
  const monitorSet = new Set(at96.map(h => h.addr));
  console.log(`   Monitoring ${monitorSet.size} addresses (all at 96)`);

  // Also monitor addresses at nearby values (88-95) — might be partially damaged
  for (const { addr, val } of inRange) {
    if (val >= 85 && val <= 95) monitorSet.add(addr);
  }
  console.log(`   + ${monitorSet.size - at96.length} addresses at 85-95 range`);
  console.log(`   Total monitoring: ${monitorSet.size} addresses\n`);

  // Fast poll loop: read 128 bytes at a time covering the monitored addresses
  // We'll read larger chunks to cover multiple candidates per read
  let prev = baseline;
  const damageLog = [];
  const deadline = Date.now() + 300000; // 5 min
  let poll = 0;

  // Group monitored addresses into contiguous ranges for efficient reading
  const sortedAddrs = [...monitorSet].sort((a, b) => a - b);
  const ranges = [];
  let rangeStart = sortedAddrs[0], rangeEnd = sortedAddrs[0];
  for (let i = 1; i < sortedAddrs.length; i++) {
    if (sortedAddrs[i] - rangeEnd <= 16) {
      rangeEnd = sortedAddrs[i];
    } else {
      ranges.push({ start: rangeStart, end: rangeEnd });
      rangeStart = sortedAddrs[i];
      rangeEnd = sortedAddrs[i];
    }
  }
  ranges.push({ start: rangeStart, end: rangeEnd });
  console.log(`   ${ranges.length} contiguous ranges to read\n`);

  while (Date.now() < deadline) {
    poll++;
    const pollStart = Date.now();

    // Read each range
    const curr = new Map();
    for (const range of ranges) {
      const addr = range.start;
      const size = Math.min(range.end - range.start + 1, 128);
      const bytes = await readChunk(sock, addr, size);
      if (bytes) {
        for (let i = 0; i < bytes.length; i++) {
          curr.set(addr + i, bytes[i]);
        }
      }
    }

    const pollTime = Date.now() - pollStart;

    // Check for decreases in monitored addresses
    const changes = [];
    for (const addr of monitorSet) {
      const pv = prev.get(addr);
      const cv = curr.get(addr);
      if (pv !== undefined && cv !== undefined && cv < pv) {
        const diff = pv - cv;
        changes.push({ addr, prev: pv, curr: cv, diff });
      }
    }

    if (changes.length > 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`\n🔻 DECREASES at T+${elapsed}s (poll #${poll}, ${pollTime}ms):`);
      for (const c of changes) {
        console.log(`   $7E:${c.addr.toString(16).padStart(5).toUpperCase()}  ${c.prev} → ${c.curr}  (Δ-${c.diff})`);

        // Check if adjacent byte also changed
        const adjPrev = prev.get(c.addr + 1);
        const adjCurr = curr.get(c.addr + 1);
        if (adjPrev !== undefined && adjCurr !== undefined) {
          console.log(`     +1 byte: ${adjPrev} → ${adjCurr}`);
        }
      }
    }

    // Report every 50 polls
    if (poll % 50 === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      process.stderr.write(`\r   T+${elapsed}s #${poll} | ${pollTime}ms/poll | watching ${monitorSet.size} addrs`);
    }

    prev = curr;
    await sleep(50); // ~20 polls/sec
  }

  sock.close();
  console.log("\n\n✅ Done.");
}

main().catch(console.error);
