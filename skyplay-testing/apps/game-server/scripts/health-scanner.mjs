/**
 * SFA2 Health Address Scanner
 *
 * Strategy:
 *   1. Continuously poll the direct page (0x00-0xFF) + key areas at 200ms
 *   2. Detect combat start: multiple bytes jump to 96
 *   3. Once combat detected, switch to 100ms polling of all candidates
 *   4. Track every increase/decrease per address
 *   5. Report the best health/timer candidates
 *
 * Usage: docker exec game-server-game-server-1 node /tmp/health-scanner.mjs [duration_sec]
 *   (default: runs until Ctrl+C or 300s)
 */

import { createSocket } from "dgram";
import { Buffer } from "buffer";

const HOST = "127.0.0.1";
const PORT = 55355;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── UDP helpers ──

function udpCmd(sock, cmd) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), 2000);
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

async function readChunk(sock, addr, size) {
  try {
    const r = await udpCmd(sock, "READ_CORE_RAM " + addr.toString(16) + " " + size);
    const parts = r.split(" ");
    const data = parts.slice(2).join("");
    const bytes = new Map();
    for (let i = 0; i < data.length; i += 2) {
      const b = parseInt(data.substring(i, i + 2), 16);
      if (!isNaN(b)) bytes.set(addr + i / 2, b);
    }
    return bytes;
  } catch {
    return new Map();
  }
}

async function dumpRange(sock, start, size) {
  const all = new Map();
  for (let a = start; a < start + size; a += 64) {
    const chunk = await readChunk(sock, a, Math.min(64, start + size - a));
    for (const [k, v] of chunk) all.set(k, v);
  }
  return all;
}

// ── Main ──

async function main() {
  const maxDuration = parseInt(process.argv[2]) || 300;
  const sock = createSocket("udp4");

  console.log("=" .repeat(60));
  console.log("🎮 SFA2 Health Address Scanner");
  console.log("=" .repeat(60));

  // Phase 0: Wait for RetroArch to boot (game-server starts it on WebSocket connect)
  console.log("\n⏳ Phase 0: Waiting for RetroArch to boot...");
  console.log("   (start a match from the browser)");

  let retroarchReady = false;
  for (let i = 0; i < 120; i++) {
    try {
      const status = await udpCmd(sock, "GET_STATUS");
      console.log("📡 " + status);
      retroarchReady = true;
      break;
    } catch {
      if (i % 5 === 0) process.stdout.write("\r   waiting... (" + (i * 2) + "s)");
      await sleep(2000);
    }
  }

  if (!retroarchReady) {
    console.log("\n❌ RetroArch did not appear within 240s");
    sock.close();
    return;
  }

  const t0 = Date.now();
  const deadline = t0 + maxDuration * 1000;

  // Phase 1: Monitor for combat start
  // We watch the direct page (0x00-0xFF) at 200ms
  // Combat is detected when 3+ bytes jump into 85-100 range simultaneously
  console.log("\n👀 Phase 1: Waiting for combat start...");
  console.log("   (launch a match from the browser now)");

  let prevDP = await dumpRange(sock, 0x0000, 0x0100); // direct page
  let combatDetected = false;
  let combatTime = null;
  let pollCount = 0;

  // Phase 1: slow polling until combat
  while (!combatDetected && Date.now() < deadline) {
    await sleep(200);
    pollCount++;
    const curr = await dumpRange(sock, 0x0000, 0x0100);

    // Look for sudden jumps into 85-100 range
    const jumps = [];
    for (const [addr, val] of curr) {
      const prev = prevDP.get(addr);
      if (prev !== undefined && prev !== val) {
        const inRange = val >= 85 && val <= 100;
        const bigJump = Math.abs(val - prev) > 30;
        if (inRange && bigJump) {
          jumps.push({ addr, prev, val });
        }
      }
    }

    if (jumps.length >= 3) {
      combatDetected = true;
      combatTime = Date.now();
      console.log("\n⚡ COMBAT DETECTED! T+" + ((combatTime - t0) / 1000).toFixed(1) + "s");
      console.log("   Jumps into 85-100 range:");
      for (const j of jumps) {
        console.log("   $7E:" + j.addr.toString(16).padStart(4).toUpperCase() +
          "  " + j.prev + " → " + j.val);
      }
    }

    prevDP = curr;

    if (pollCount % 25 === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      process.stdout.write("\r   T+" + elapsed + "s — waiting...");
    }
  }

  if (!combatDetected) {
    console.log("\n⚠️  Combat not detected within " + maxDuration + "s");
    sock.close();
    return;
  }

  // Phase 2: Combat active — scan broadly for ALL addresses that = 96
  console.log("\n🔍 Phase 2: Finding all bytes = 96...");

  const hits96Set = new Set();
  // Scan first 8KB in 128-byte chunks
  for (let base = 0; base < 0x2000; base += 128) {
    const chunk = await readChunk(sock, base, 128);
    for (const [addr, val] of chunk) {
      if (val === 96) hits96Set.add(addr);
    }
    if (base % 1024 === 0) process.stdout.write(".");
  }
  const hits96 = [...hits96Set].sort((a, b) => a - b);
  console.log("\n   Found " + hits96.length + " addresses = 96");
  console.log("   " + hits96.map((a) => "0x" + a.toString(16).toUpperCase()).join(", "));

  // Build candidate list: all hits96 + neighbors (±4 for 16-bit context) + direct page
  const candidateSet = new Set(hits96);
  for (const a of hits96) {
    for (let d = -4; d <= 4; d++) candidateSet.add(a + d);
  }
  // Also add direct page 0x00-0xFF (game state variables)
  for (let a = 0; a < 0x100; a++) candidateSet.add(a);
  // And USA PAR addresses
  candidateSet.add(0x073E);
  candidateSet.add(0x09BE);

  const allAddrs = [...candidateSet]
    .filter((a) => a >= 0 && a < 0x2000)
    .sort((a, b) => a - b);

  console.log("\n📊 Phase 3: Polling " + allAddrs.length + " addresses at 100ms");

  // Initialize tracking
  const history = []; // {addr, val}[] — full time series for top candidates
  const decreases = new Map(); // addr → count
  const increases = new Map();
  const valueRange = new Map(); // addr → {min, max}
  let prevVals = {};

  const init = await dumpRange(sock, 0, 0x2000);
  for (const addr of allAddrs) {
    const v = init.get(addr);
    if (v !== undefined) {
      prevVals[addr] = v;
      valueRange.set(addr, { min: v, max: v });
    }
  }

  const combatDeadline = Math.min(deadline, Date.now() + 90000); // scan max 90s of combat

  while (Date.now() < combatDeadline) {
    await sleep(100);
    pollCount++;
    const elapsed = ((Date.now() - combatTime) / 1000).toFixed(1);

    // Fast poll: read in 4 parallel-ish batches
    const curr = new Map();
    const batchSize = Math.ceil(allAddrs.length / 4);
    const batches = [
      allAddrs.slice(0, batchSize),
      allAddrs.slice(batchSize, batchSize * 2),
      allAddrs.slice(batchSize * 2, batchSize * 3),
      allAddrs.slice(batchSize * 3),
    ];

    for (const batch of batches) {
      if (batch.length === 0) continue;
      // Read contiguous chunks where possible
      for (let i = 0; i < batch.length; i++) {
        const addr = batch[i];
        const chunk = await readChunk(sock, addr, 1);
        for (const [a, v] of chunk) curr.set(a, v);
        if (i < batch.length - 1) await sleep(2); // micro-gap
      }
    }

    // Track changes
    const changes = [];
    for (const addr of allAddrs) {
      const prev = prevVals[addr];
      const cur = curr.get(addr);
      if (prev !== undefined && cur !== undefined && prev !== cur) {
        changes.push({ addr, prev, cur, delta: cur - prev });
        if (cur < prev) decreases.set(addr, (decreases.get(addr) || 0) + 1);
        if (cur > prev) increases.set(addr, (increases.get(addr) || 0) + 1);
        const range = valueRange.get(addr);
        if (range) {
          if (cur < range.min) range.min = cur;
          if (cur > range.max) range.max = cur;
        }
        prevVals[addr] = cur;
      }
    }

    // Log significant changes
    if (changes.length > 0 && changes.length <= 15) {
      const summary = changes
        .map((c) => "0x" + c.addr.toString(16) + ":" + c.prev + "→" + c.cur)
        .join(" ");
      console.log("   [" + elapsed + "s] " + summary);
    } else if (changes.length > 15) {
      console.log("   [" + elapsed + "s] " + changes.length + " changes");
    }

    // Every 100 polls, show top decreasing
    if (pollCount % 100 === 0) {
      const top = [...decreases.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
      console.log("\n   ── Top 8 decreasing (T+" + elapsed + "s) ──");
      for (const [a, c] of top) {
        const range = valueRange.get(a);
        const cur = prevVals[a];
        console.log("   $7E:" + a.toString(16).padStart(4).toUpperCase() +
          "  range=" + (range ? range.min + "-" + range.max : "?") +
          "  cur=" + cur + "  ↓" + c);
      }
      console.log("");
    }
  }

  // ── FINAL REPORT ──
  console.log("\n" + "=".repeat(60));
  console.log("📊 FINAL REPORT (" + pollCount + " polls)");
  console.log("=".repeat(60));

  // Candidate scoring:
  // - Health should start at ~96 and decrease in chunks
  // - Timer should count down steadily

  console.log("\n🔻 TOP DECREASING ADDRESSES (health candidates):");
  const allDec = [...decreases.entries()]
    .sort((a, b) => b[1] - a[1])
    .filter(([, c]) => c >= 3);

  for (const [addr, count] of allDec.slice(0, 25)) {
    const range = valueRange.get(addr);
    const cur = prevVals[addr];
    const hex = addr.toString(16).padStart(4).toUpperCase();

    // Score: high decreases + value in health-like range (40-100) + range ≥ 10
    let score = "";
    if (range && range.max >= 80 && range.min <= 70 && count >= 5) score = " ⭐ HEALTH";
    if (count > pollCount * 0.3 && count >= 10) score += " ⏱️ TIMER?";

    console.log("   $7E:" + hex +
      "  range=" + (range ? range.min + "→" + range.max : "?") +
      "  now=" + cur +
      "  ↓" + count + score);
  }

  // Show addresses that stayed stable in 80-100 range (not health — constants)
  console.log("\n📍 ADDRESSES CURRENTLY = 96:");
  const final96 = [];
  for (const [addr, val] of Object.entries(prevVals)) {
    if (val === 96) final96.push(parseInt(addr));
  }
  console.log("   " + final96.map((a) => "0x" + a.toString(16).toUpperCase()).join(", "));

  sock.close();
  console.log("\n✅ Done.");
}

main().catch(console.error);
