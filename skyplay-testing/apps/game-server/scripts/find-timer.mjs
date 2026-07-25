/**
 * SFA2 Timer Scanner — Delta-N methodology.
 *
 * Strategy: scan full 8KB WRAM, wait N seconds, scan again.
 * Find addresses where value decreased by exactly N (non-BCD) or
 * close to N (BCD with boundary crossings).
 *
 * Also handles BCD encoding: 0x99→0x98 (delta 1), but 0x10→0x09 (delta 7).
 *
 * Usage: cat scripts/find-timer.mjs | docker exec -i game-server-game-server-1 sh -c "cat > /tmp/find-timer.mjs && node /tmp/find-timer.mjs"
 */

import { createSocket } from "dgram";
import { Buffer } from "buffer";

const HOST = "127.0.0.1";
const PORT = 55355;
const SLEEP_SEC = 3; // wait 3 seconds between snapshots
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

async function readChunk(sock, addr, size) {
  try {
    const r = await udpCmd(sock, `READ_CORE_RAM ${addr.toString(16)} ${size}`);
    const parts = r.split(" ");
    const data = parts.slice(2).join("");
    const bytes = new Map();
    for (let i = 0; i < data.length; i += 2) {
      const b = parseInt(data.substring(i, i + 2), 16);
      if (!isNaN(b)) bytes.set(addr + i / 2, b);
    }
    return bytes;
  } catch { return new Map(); }
}

async function dumpRegion(sock, start, end) {
  const all = new Map();
  for (let addr = start; addr < end; addr += 256) {
    const size = Math.min(256, end - addr);
    const chunk = await readChunk(sock, addr, size);
    for (const [a, v] of chunk) all.set(a, v);
    process.stderr.write(`\r   ${((addr-start)/(end-start)*100).toFixed(0)}%`);
  }
  process.stderr.write("\r   100%\n");
  return all;
}

function isBcdLike(val) {
  // Check if the hex value looks like a 2-digit BCD number (0x00-0x99, both nibbles 0-9)
  return (val <= 0x99) && ((val >> 4) <= 9) && ((val & 0xF) <= 9);
}

function bcdToDec(val) {
  return ((val >> 4) * 10) + (val & 0xF);
}

function decDeltaBcd(oldVal, newVal) {
  // Calculate the difference in decimal if values are BCD-encoded
  if (!isBcdLike(oldVal) || !isBcdLike(newVal)) return null;
  return bcdToDec(oldVal) - bcdToDec(newVal);
}

async function main() {
  const sock = createSocket("udp4");

  try {
    const status = await udpCmd(sock, "GET_STATUS");
    console.log("📡 " + status);
    if (!status.includes("PLAYING")) {
      console.log("❌ Game not running. Start a match first.");
      sock.close(); return;
    }
  } catch {
    console.log("❌ No RetroArch");
    sock.close(); return;
  }

  console.log(`\n⏱️  SFA2 Timer Scanner — Delta-${SLEEP_SEC}s methodology`);
  console.log("   Scanning for values that decrease by ~N in N seconds\n");

  // Phase 1: Snapshot
  console.log("📸 Snapshot 1: scanning 0x0000-0x2000 (first 8KB)...");
  const snap1 = await dumpRegion(sock, 0x0000, 0x2000);

  // Also scan the health-adjacent area and the suspected timer zones
  console.log("📸 Snapshot 1b: scanning 0x1500-0x1E00 (health/timer zone)...");
  const snap1b = await dumpRegion(sock, 0x0600, 0x0700);
  const snap1c = await dumpRegion(sock, 0x1600, 0x1900);

  // Merge all snapshots
  for (const [a, v] of snap1b) snap1.set(a, v);
  for (const [a, v] of snap1c) snap1.set(a, v);

  console.log(`   ${snap1.size} bytes captured\n`);

  // Phase 2: Wait
  console.log(`⏳ Waiting ${SLEEP_SEC} seconds (don't touch anything)...`);
  for (let i = SLEEP_SEC; i > 0; i--) {
    process.stdout.write(`   ${i}...`);
    await sleep(1000);
  }
  console.log(" GO!\n");

  // Phase 3: Second snapshot (same regions)
  console.log("📸 Snapshot 2: rescanning...");
  const snap2 = await dumpRegion(sock, 0x0000, 0x2000);
  const snap2b = await dumpRegion(sock, 0x0600, 0x0700);
  const snap2c = await dumpRegion(sock, 0x1600, 0x1900);
  for (const [a, v] of snap2b) snap2.set(a, v);
  for (const [a, v] of snap2c) snap2.set(a, v);

  // Phase 4: Diff analysis
  console.log("\n🔍 Analyzing diffs...\n");

  const exact3 = [];     // delta exactly 3
  const bcd3 = [];       // BCD delta of 3
  const bcdNear = [];    // BCD delta 2-4 (boundary crossing)
  const near3 = [];      // raw delta 2-4

  for (const [addr, v1] of snap1) {
    const v2 = snap2.get(addr);
    if (v2 === undefined) continue;
    if (v1 === v2) continue; // skip unchanged

    const rawDelta = v1 - v2;

    // Skip values that are clearly not timer (too high or too low)
    if (v1 > 0xA0) continue; // > 160 decimal, not a timer
    if (v1 < 2) continue;    // too low to be a timer

    // Exact delta = SLEEP_SEC (non-BCD simple timer)
    if (rawDelta === SLEEP_SEC && v1 <= 99) {
      exact3.push({ addr, old: v1, new: v2, delta: rawDelta });
    }

    // Raw delta near SLEEP_SEC
    if (rawDelta >= 2 && rawDelta <= 4 && v1 <= 99) {
      near3.push({ addr, old: v1, new: v2, delta: rawDelta });
    }

    // BCD-aware
    const bcdD = decDeltaBcd(v1, v2);
    if (bcdD !== null) {
      if (bcdD === SLEEP_SEC) {
        bcd3.push({ addr, old: v1, new: v2, oldDec: bcdToDec(v1), newDec: bcdToDec(v2) });
      } else if (bcdD >= 2 && bcdD <= 4) {
        bcdNear.push({ addr, old: v1, new: v2, oldDec: bcdToDec(v1), newDec: bcdToDec(v2) });
      }
    }
  }

  // ── Report ──
  console.log("=".repeat(65));
  console.log("📊 RESULTS");
  console.log("=".repeat(65));

  if (exact3.length > 0) {
    console.log(`\n✅ EXACT DELTA = ${SLEEP_SEC} (non-BCD simple timer, ${exact3.length} candidates):`);
    for (const c of exact3.sort((a,b) => a.addr - b.addr)) {
      console.log(`   0x${c.addr.toString(16).padStart(4).toUpperCase()}: ${c.old} → ${c.new} (Δ-${c.delta})`);
    }
  } else {
    console.log(`\n❌ No exact delta=${SLEEP_SEC} candidates found.`);
  }

  if (bcd3.length > 0) {
    console.log(`\n✅ BCD DELTA = ${SLEEP_SEC} (BCD-encoded timer, ${bcd3.length} candidates):`);
    for (const c of bcd3.sort((a,b) => a.addr - b.addr)) {
      console.log(`   0x${c.addr.toString(16).padStart(4).toUpperCase()}: 0x${c.old.toString(16)}=${c.oldDec} → 0x${c.new.toString(16)}=${c.newDec}`);
    }
  }

  if (bcdNear.length > 0) {
    console.log(`\n⚠️  BCD DELTA near ${SLEEP_SEC} (boundary crossing, ${bcdNear.length} candidates):`);
    for (const c of bcdNear.sort((a,b) => a.addr - b.addr)) {
      console.log(`   0x${c.addr.toString(16).padStart(4).toUpperCase()}: 0x${c.old.toString(16)}=${c.oldDec} → 0x${c.new.toString(16)}=${c.newDec}`);
    }
  }

  if (exact3.length === 0 && bcd3.length === 0 && bcdNear.length === 0) {
    console.log("\n⚠️  No clear timer candidates. Broader search:");
    console.log(`   Raw delta 2-4 (non-timer-filtered): ${near3.length} addresses`);
    if (near3.length <= 20) {
      for (const c of near3) {
        console.log(`   0x${c.addr.toString(16).padStart(4).toUpperCase()}: ${c.old} → ${c.new} (Δ-${c.delta})`);
      }
    }
  }

  // ── Priority zones check ──
  console.log("\n\n📍 PRIORITY ZONES CHECK:");
  const priorities = [
    { addr: 0x18E0, label: "US standard timer" },
    { addr: 0x0214, label: "SF2/Alpha audio timer mirror" },
    { addr: 0x06A0, label: "health-like shift zone" },
  ];
  for (const p of priorities) {
    const v1 = snap1.get(p.addr);
    const v2 = snap2.get(p.addr);
    if (v1 !== undefined) {
      const delta = v1 - v2;
      const tag = delta === SLEEP_SEC ? " ⭐⭐⭐ TIMER!" : delta !== 0 ? ` (Δ-${delta})` : " (unchanged)";
      console.log(`   0x${p.addr.toString(16).padStart(4).toUpperCase()} (${p.label}): ${v1} → ${v2}${tag}`);
    } else {
      console.log(`   0x${p.addr.toString(16).padStart(4).toUpperCase()} (${p.label}): not in scan range`);
    }
  }

  // ── Also check area near health addresses ──
  console.log("\n📍 HEALTH-ADJACENT ZONE (0x1D30-0x1D50):");
  for (let addr = 0x1D30; addr <= 0x1D50; addr++) {
    const v1 = snap1.get(addr);
    const v2 = snap2.get(addr);
    if (v1 !== undefined && v1 !== v2) {
      console.log(`   0x${addr.toString(16).padStart(4).toUpperCase()}: ${v1} → ${v2} (Δ${v1 > v2 ? '-' : '+'}${Math.abs(v1 - v2)})`);
    }
  }

  // ── All changed addresses in timer range (0-99) ──
  console.log("\n📍 ALL CHANGED BYTES IN 0-99 RANGE:");
  const rangeChanges = [];
  for (const [addr, v1] of snap1) {
    if (v1 < 0 || v1 > 99) continue;
    const v2 = snap2.get(addr);
    if (v2 !== undefined && v1 !== v2) {
      rangeChanges.push({ addr, old: v1, new: v2, delta: v1 - v2 });
    }
  }
  rangeChanges.sort((a, b) => b.delta - a.delta); // biggest decreases first
  for (const c of rangeChanges.slice(0, 30)) {
    const direction = c.delta > 0 ? "↓" : "↑";
    console.log(`   0x${c.addr.toString(16).padStart(4).toUpperCase()}: ${c.old} → ${c.new} (${direction}${Math.abs(c.delta)})`);
  }
  if (rangeChanges.length > 30) console.log(`   ... and ${rangeChanges.length - 30} more`);

  sock.close();
  console.log("\n✅ Scan complete.");
}

main().catch(console.error);
