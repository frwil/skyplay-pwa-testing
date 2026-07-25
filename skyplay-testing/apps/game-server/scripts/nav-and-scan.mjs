/**
 * Navigate SFA2 from attract mode → combat, then verify health addresses.
 *
 * SFA2 menu flow:
 *   1. Attract mode → START → Title screen
 *   2. Title → START → Main menu ("ARCADE" highlighted by default)
 *   3. Main menu → START → Character select (P1 picks first)
 *   4. Char select → P1 picks Ryu (A btn), P2 picks Ken (CPU auto-picks)
 *   5. VS screen → auto-advances (~5s)
 *   6. "ROUND 1 FIGHT!" → COMBAT!
 *
 * During combat: poll candidates at 100ms, inject alternating attacks,
 * track which addresses decrease.
 *
 * Usage: docker exec game-server-game-server-1 node /tmp/nav-and-scan.mjs
 */

import { createSocket } from "dgram";
import { Buffer } from "buffer";

const HOST = "127.0.0.1";
const PORT = 55355;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── UDP helpers ──

function udpCmd(sock, cmd) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout: " + cmd)), 2000);
    const h = (m) => {
      const txt = m.toString();
      if (!txt.startsWith(cmd.split(" ")[0])) return;
      clearTimeout(t);
      sock.removeListener("message", h);
      resolve(txt);
    };
    sock.on("message", h);
    sock.send(Buffer.from(cmd + "\n"), PORT, HOST);
  });
}

function press(sock, player, btn, dur = 80) {
  sock.send(Buffer.from(`INPUT ${player} ${btn} 1\n`), PORT, HOST);
  setTimeout(() => {
    sock.send(Buffer.from(`INPUT ${player} ${btn} 0\n`), PORT, HOST);
  }, dur);
}

async function pressWait(sock, player, btn, dur = 80, after = 400) {
  press(sock, player, btn, dur);
  await sleep(after);
}

async function readByte(sock, addr) {
  try {
    const r = await udpCmd(sock, "READ_CORE_RAM " + addr.toString(16) + " 1");
    const parts = r.split(" ");
    return parseInt(parts[2], 16);
  } catch { return null; }
}

async function readBytes(sock, addrs) {
  const out = {};
  for (const a of addrs) {
    const v = await readByte(sock, a);
    if (v !== null) out[a] = v;
    await sleep(5);
  }
  return out;
}

// ── Attack injection ──

function startAttacks(sock) {
  console.log("   🥊 Attack injection active");
  let phase = 0; // 0=P1→P2, 1=P2→P1
  let count = 0;
  const interval = setInterval(() => {
    const p = phase === 0 ? 0 : 1;
    // Forward + light punch (B=0) or medium kick (X=9)
    const atk = count % 2 === 0 ? 0 : 9;
    sock.send(Buffer.from(`INPUT ${p} 7 1\n`), PORT, HOST); // Right
    sock.send(Buffer.from(`INPUT ${p} ${atk} 1\n`), PORT, HOST); // Attack
    setTimeout(() => {
      sock.send(Buffer.from(`INPUT ${p} 7 0\n`), PORT, HOST);
      sock.send(Buffer.from(`INPUT ${p} ${atk} 0\n`), PORT, HOST);
    }, 80);
    count++;
    if (count % 15 === 0) phase = 1 - phase;
  }, 250);
  return interval;
}

// ── Address candidates ──

const BASE_CANDIDATES = [
  0x00EB, // the ONLY byte = 96 in 4KB
  0x073E, 0x09BE, // USA PAR health addresses
  0x015E, 0x0132, // near-96 values
  // Neighbors for 16-bit context
  0x00EA, 0x00EC, 0x015D, 0x015F,
  0x073D, 0x073F, 0x09BD, 0x09BF,
  // Extra search area: direct page
  0x00E0, 0x00E1, 0x00E2, 0x00E3, 0x00E4, 0x00E5, 0x00E6, 0x00E7,
  0x00E8, 0x00E9, 0x00ED, 0x00EE, 0x00EF, 0x00F0,
  // Around 0x150-0x160
  0x0150, 0x0158, 0x0160,
  // Common GameShark health areas for SNES fighters
  0x0700, 0x0701, 0x0702, 0x0703,
  0x0900, 0x0901, 0x0902, 0x0903,
];

async function scanAll96(sock, limit = 0x1000) {
  const hits = [];
  for (let base = 0; base < limit; base += 32) {
    try {
      const r = await udpCmd(sock, "READ_CORE_RAM " + base.toString(16) + " 32");
      const parts = r.split(" ");
      const data = parts.slice(2).join("");
      for (let i = 0; i < data.length; i += 2) {
        const b = parseInt(data.substring(i, i + 2), 16);
        if (b === 96) hits.push(base + i / 2);
      }
    } catch {}
    if (base % 256 === 0) process.stdout.write(".");
  }
  return hits;
}

// ── Main ──

async function main() {
  const sock = createSocket("udp4");

  console.log("🎮 SFA2 Health Address Discovery");
  console.log("=".repeat(60));

  // Step 1: Check status
  try {
    const s = await udpCmd(sock, "GET_STATUS");
    console.log("📡 " + s);
  } catch {
    console.log("❌ RetroArch not responding");
    sock.close();
    return;
  }

  // Step 2: Navigate through menus to reach combat
  console.log("\n🧭 Navigating to combat...");

  // Skip attract mode → press START repeatedly
  for (let i = 0; i < 3; i++) {
    await pressWait(sock, 0, 3, 150, 1500); // START
  }

  // At title screen → START
  await pressWait(sock, 0, 3, 150, 2500);

  // At main menu → should be on "ARCADE" → START to select
  await pressWait(sock, 0, 3, 150, 3000);

  // Character select: P1 picks Ryu (cursor starts top-left = Ryu) → press A to confirm
  await pressWait(sock, 0, 8, 150, 2000); // A to confirm P1 = Ryu

  // Wait for VS screen + auto-advance
  console.log("   ⏳ Waiting for VS screen + combat (~10s)...");
  await sleep(10000);

  // Step 3: Scan for combat indicators
  console.log("\n🔍 Checking combat state...");

  // Check if 0x073E and 0x09BE are now non-zero (USA health addresses)
  const p1usa = await readByte(sock, 0x073E);
  const p2usa = await readByte(sock, 0x09BE);
  const eb = await readByte(sock, 0x00EB);

  console.log("   0x073E (USA P1) = " + p1usa);
  console.log("   0x09BE (USA P2) = " + p2usa);
  console.log("   0x00EB (our find) = " + eb);

  // Scan ALL bytes = 96 again
  console.log("\n🔍 Scanning for bytes = 96...");
  const hits96 = await scanAll96(sock);
  console.log("\n   Found " + hits96.length + " bytes = 96");
  if (hits96.length <= 30) {
    console.log("   " + hits96.map((a) => "0x" + a.toString(16).toUpperCase()).join(", "));
  }

  // Step 4: If in combat, run the health decrease tracker
  // Build candidate list from ALL hits96 + their neighbors
  const candidateSet = new Set(BASE_CANDIDATES);
  for (const a of hits96) {
    candidateSet.add(a);
    for (let d = -2; d <= 2; d++) candidateSet.add(a + d);
  }
  const allAddrs = [...candidateSet].filter((a) => a >= 0 && a < 0x1000).sort((a, b) => a - b);

  console.log("\n📊 Polling " + allAddrs.length + " addresses for 60s...");

  // Start attacks
  const atkInterval = startAttacks(sock);

  // Initialize
  const prevVals = {};
  const init = await readBytes(sock, allAddrs);
  for (const [a, v] of Object.entries(init)) prevVals[a] = v;

  const decreases = new Map();
  const increases = new Map();
  let pollCount = 0;
  const t0 = Date.now();
  const deadline = t0 + 60000;

  while (Date.now() < deadline) {
    await sleep(100);
    pollCount++;
    const curr = await readBytes(sock, allAddrs);

    for (const addr of allAddrs) {
      const p = prevVals[addr];
      const c = curr[addr];
      if (p !== undefined && c !== undefined && p !== c) {
        if (c < p) decreases.set(addr, (decreases.get(addr) || 0) + 1);
        if (c > p) increases.set(addr, (increases.get(addr) || 0) + 1);
        prevVals[addr] = c;
      }
    }

    if (pollCount % 30 === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      process.stdout.write("\r   T+" + elapsed + "s #" + pollCount + " | " + decreases.size + "↓ " + increases.size + "↑");
    }
  }

  clearInterval(atkInterval);
  console.log("");

  // ── Report ──
  console.log("\n" + "=".repeat(60));
  console.log("📊 RESULTS: " + pollCount + " polls over 60s");
  console.log("=".repeat(60));

  console.log("\n🔻 DECREASING addresses (potential health):");
  const dec = [...decreases.entries()].sort((a, b) => b[1] - a[1]);
  for (const [a, c] of dec.slice(0, 20)) {
    console.log("   $7E:" + a.toString(16).padStart(4).toUpperCase() + " — " + c + " decreases");
  }

  // Show addresses that decreased at a steady rate (like health draining from attacks)
  console.log("\n🎯 Health candidates (decreased at least 10 times):");
  const solid = dec.filter(([, c]) => c >= 10);
  for (const [a, c] of solid) {
    const hex = a.toString(16).padStart(4).toUpperCase();
    // Read final value
    const final = prevVals[a];
    const initial = init[a];
    console.log("   $7E:" + hex + "  " + initial + " → " + final + "  (" + c + "↓)");
  }

  if (solid.length === 0) {
    console.log("   (none — may not have reached combat)");
    console.log("\n💡 Tip: check if navigation worked. Current bytes = 96:");
    const current96 = await scanAll96(sock, 0x1000);
    console.log("   " + current96.map((a) => "0x" + a.toString(16).toUpperCase()).join(", "));
  }

  sock.close();
  console.log("\n✅ Done.");
}

main().catch(console.error);
