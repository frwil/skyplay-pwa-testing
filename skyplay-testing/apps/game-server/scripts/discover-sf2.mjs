/**
 * SF2 (Street Fighter 2) SNES RAM Discovery Script
 * =================================================
 * Discovers health, timer, character IDs, and round counters for SF2 on SNES.
 *
 * ROM: "Street Fighter 5 (Hack).smc" — a hack, RAM layout may differ from vanilla SF2.
 *
 * Starting points (PAR codes for SF2 Turbo USA):
 *   P1 health:  $7E:0530  → offset 0x0530
 *   P2 health:  $7E:0730  → offset 0x0730 (+0x200, standard SF2 P2 offset)
 *   P1 max E:   $7E:0636  → offset 0x0636
 *   Timer:      $7E:18F3  → offset 0x18F3
 *   P1 hyper:   $7E:0517  → offset 0x0517
 *
 * Run: docker cp + docker exec during a live SF2 match.
 *
 * Usage:
 *   docker cp apps/game-server/scripts/discover-sf2.mjs game-server-game-server-1:/tmp/
 *   docker exec game-server-game-server-1 node /tmp/discover-sf2.mjs [duration_seconds]
 */

import { createSocket } from "dgram";

const HOST = "127.0.0.1";
const PORT = 55355;
const POLL_MS = 400;
const DURATION_S = parseInt(process.argv[2]) || 120;

// ── SNES WRAM scan range ──────────────────────────────────────────────
// Full SNES WRAM = 128KB ($7E:0000 - $7F:FFFF, offsets 0x00000-0x1FFFF)
// First 8KB ($7E:0000-$7E:1FFF) contains most game variables.
// We also scan the suspected health/timer regions more broadly.
const SCAN_RANGE = { start: 0x0000, end: 0x2000 };

// ── Suspected addresses (from PAR / game-profiles.ts) ─────────────────
const SUSPECTED = {
  p1Health:    0x0530,  // PAR: 7E0530xx
  p2Health:    0x0730,  // PAR: 7E0730xx (P1+0x200)
  p1MaxEnergy: 0x0636,  // PAR: 7E0636xx (176 = full)
  timer:       0x18F3,  // PAR: 7E18F3xx (99 = full)
  p1Hyper:     0x0517,  // PAR: 7E0517xx
  p2Hyper:     0x0717,  // PAR: 7E0717xx
};

// Additional neighborhoods to scan for chars + round counters
const EXTRA_SCAN = [
  { start: 0x0500, end: 0x0800, label: "Player state region (0x0500-0x0800)" },
  { start: 0x18E0, end: 0x1A00, label: "Timer/round region (0x18E0-0x1A00)" },
  { start: 0x0000, end: 0x0200, label: "Low WRAM (mirrors, round counters)" },
  { start: 0x0600, end: 0x0800, label: "P2 mirror region" },
];

// ── Utility ───────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readRam(sock, addr, size) {
  return new Promise((resolve) => {
    const cmd = Buffer.from(`READ_CORE_RAM ${addr.toString(16)} ${size}\n`);
    let buf = "";
    const timer = setTimeout(() => { sock.removeAllListeners("message"); resolve(null); }, 2000);

    const handler = (msg) => {
      buf += msg.toString();
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length < 3) continue;
        if (parts[0] !== "READ_CORE_RAM") continue;
        const rspAddr = parseInt(parts[1], 16);
        if (rspAddr !== addr) continue;
        const hex = parts.slice(2).join("");
        clearTimeout(timer);
        sock.removeListener("message", handler);
        resolve(hex === "-1" ? null : hex);
        return;
      }
    };
    sock.on("message", handler);
    sock.send(cmd, PORT, HOST);
  });
}

async function readChunk(sock, addr, size) {
  try {
    const hex = await readRam(sock, addr, size);
    if (!hex) return null;
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
      bytes.push(parseInt(hex.substring(i, i + 2), 16));
    }
    return bytes;
  } catch { return null; }
}

async function readFullSnapshot(sock, start, end) {
  const data = new Map();
  for (let addr = start; addr < end; addr += 256) {
    const size = Math.min(256, end - addr);
    const chunk = await readChunk(sock, addr, size);
    if (chunk) {
      for (let i = 0; i < chunk.length; i++) {
        data.set(addr + i, chunk[i]);
      }
    }
  }
  return data;
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const sock = createSocket("udp4");

  console.log("🔍 SF2 SNES RAM Discovery");
  console.log(`   ROM: Street Fighter 5 (Hack).smc`);
  console.log(`   Scanning WRAM 0x${SCAN_RANGE.start.toString(16)}-0x${SCAN_RANGE.end.toString(16)} every ${POLL_MS}ms for ${DURATION_S}s`);
  console.log("   ⚠️  Make sure a SF2 match is IN PROGRESS\n");

  // Quick pre-check
  const test = await readRam(sock, 0x0530, 1);
  if (!test) {
    console.error("❌ Cannot reach RetroArch UDP. Is a game loaded?");
    sock.close();
    process.exit(1);
  }
  console.log("✅ RetroArch UDP reachable\n");

  // ── Phase 1: Initial full scan ──────────────────────────────────────
  console.log("📸 Initial full WRAM snapshot (0x0000-0x2000)...");
  const snap0 = await readFullSnapshot(sock, SCAN_RANGE.start, SCAN_RANGE.end);
  console.log(`   Got ${snap0.size} bytes\n`);

  // Show suspected addresses
  console.log("📋 Suspected addresses (from PAR codes):");
  for (const [label, addr] of Object.entries(SUSPECTED)) {
    const v = snap0.get(addr);
    console.log(`   ${label.padEnd(14)} $7E:${addr.toString(16).padStart(4,"0").toUpperCase()} = ${v !== undefined ? v + " (0x" + v.toString(16) + ")" : "NOT READABLE"}`);
  }
  console.log();

  // ── Phase 2: Continuous polling ─────────────────────────────────────
  console.log(`🔄 Polling every ${POLL_MS}ms for ${DURATION_S}s...`);
  const history = []; // Array<Map<addr, value>>
  history.push(snap0);

  const t0 = Date.now();
  const deadline = t0 + DURATION_S * 1000;
  let pollCount = 0;

  // For speed, only read the most promising regions during polling
  const POLL_REGIONS = [
    { start: 0x0500, end: 0x0800 },  // health + char area
    { start: 0x18E0, end: 0x1900 },  // timer area
  ];

  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    pollCount++;
    const snap = await readFullSnapshot(sock, SCAN_RANGE.start, SCAN_RANGE.end);
    if (snap.size > 0) {
      history.push(snap);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);

      // Live display of suspected values
      const p1hp = snap.get(SUSPECTED.p1Health);
      const p2hp = snap.get(SUSPECTED.p2Health);
      const tm = snap.get(SUSPECTED.timer);
      process.stdout.write(`\r   Poll #${pollCount} (${elapsed}s) — HP1=${p1hp ?? "?"} HP2=${p2hp ?? "?"} Timer=${tm ?? "?"}   `);
    }
  }
  console.log("\n");

  sock.close();

  // ── Phase 3: Analysis ───────────────────────────────────────────────

  console.log("═══════════════════════════════════════════════════════");
  console.log("📊 ANALYSIS");
  console.log("═══════════════════════════════════════════════════════\n");

  // Build per-address value histories
  const addrHistory = new Map(); // addr → { values: [], changes: N }
  for (const snap of history) {
    for (const [addr, val] of snap) {
      if (!addrHistory.has(addr)) addrHistory.set(addr, []);
      addrHistory.get(addr).push(val);
    }
  }
  // Remove addresses that never appeared
  for (const [addr, vals] of addrHistory) {
    if (vals.length < history.length * 0.5) addrHistory.delete(addr);
  }

  // ── Health candidates ───────────────────────────────────────────────
  // Health: decreases during combat, stays between 0 and some max (48-176 for SF2)
  console.log("🏥 Health candidates (decrease during combat, 0-176 range):");
  const healthCandidates = [];
  for (const [addr, vals] of addrHistory) {
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min;
    if (min >= 0 && max <= 200 && range >= 10 && vals.length >= 3) {
      // Check if values are monotonically decreasing-ish
      let decreasingSteps = 0;
      for (let i = 1; i < vals.length; i++) {
        if (vals[i] <= vals[i-1]) decreasingSteps++;
      }
      const decRatio = decreasingSteps / (vals.length - 1);
      if (decRatio >= 0.6) {
        healthCandidates.push({
          addr, min, max, range, decRatio,
          vals: vals.filter((_, i) => i % Math.max(1, Math.floor(vals.length / 15)) === 0 || i === vals.length - 1),
        });
      }
    }
  }
  healthCandidates.sort((a, b) => b.range - a.range);

  if (healthCandidates.length > 0) {
    for (const c of healthCandidates.slice(0, 10)) {
      console.log(`   $7E:${c.addr.toString(16).padStart(4,"0")}  range=${c.min}-${c.max}  decRatio=${(c.decRatio*100).toFixed(0)}%  vals=[${c.vals.join(",")}]`);
    }
  } else {
    console.log("   No strong health candidates found. Showing all decreasing values:");
    for (const [addr, vals] of addrHistory) {
      const min = Math.min(...vals), max = Math.max(...vals);
      if (max > min && max <= 255) {
        let dec = 0;
        for (let i = 1; i < vals.length; i++) if (vals[i] < vals[i-1]) dec++;
        if (dec >= 2) console.log(`   $7E:${addr.toString(16).padStart(4,"0")} range=${min}-${max} decreases=${dec}/${vals.length-1}`);
      }
    }
  }
  console.log();

  // ── Timer candidates ────────────────────────────────────────────────
  console.log("⏱️  Timer candidates (99-0 countdown range):");
  const timerCandidates = [];
  for (const [addr, vals] of addrHistory) {
    const min = Math.min(...vals), max = Math.max(...vals);
    if (min >= 0 && max <= 99 && max > min && max - min >= 20) {
      let dec = 0;
      for (let i = 1; i < vals.length; i++) if (vals[i] <= vals[i-1]) dec++;
      const decRatio = dec / (vals.length - 1);
      if (decRatio >= 0.5) {
        timerCandidates.push({ addr, min, max, decRatio, vals: vals.filter((_, i) => i % 2 === 0).slice(0, 20) });
      }
    }
  }
  timerCandidates.sort((a, b) => (b.max - b.min) - (a.max - a.min));

  if (timerCandidates.length > 0) {
    for (const c of timerCandidates.slice(0, 10)) {
      console.log(`   $7E:${c.addr.toString(16).padStart(4,"0")}  range=${c.min}-${c.max}  decRatio=${(c.decRatio*100).toFixed(0)}%  vals=[${c.vals.join(",")}]`);
    }
  } else {
    console.log("   No timer candidates in 0-99 range found.");
  }
  console.log();

  // ── Character ID candidates (stable values, low range) ─────────────
  console.log("👤 Character ID candidates (stable, 0x00-0x20 range):");
  const charCandidates = [];
  for (const [addr, vals] of addrHistory) {
    const uniq = new Set(vals);
    const max = Math.max(...vals);
    if (uniq.size <= 3 && max <= 0x20 && max >= 0x00 && vals.length >= 3) {
      // Should be mostly stable
      const stable = uniq.size <= 2;
      charCandidates.push({ addr, uniq: [...uniq], stable });
    }
  }
  for (const c of charCandidates.slice(0, 15)) {
    console.log(`   $7E:${c.addr.toString(16).padStart(4,"0")}  vals=[${c.uniq.map(v=>"0x"+v.toString(16)).join(", ")}]  ${c.stable ? "✅ stable" : "⚠️ changing"}`);
  }
  console.log();

  // ── Round counter candidates (0→1→2 incrementing) ──────────────────
  console.log("🏆 Round counter candidates (0→1→2 increments):");
  const roundCandidates = [];
  for (const [addr, vals] of addrHistory) {
    const min = Math.min(...vals), max = Math.max(...vals);
    if (min >= 0 && max <= 2 && max > min) {
      let increments = 0;
      for (let i = 1; i < vals.length; i++) {
        if (vals[i] > vals[i-1] && vals[i] - vals[i-1] <= 1) increments++;
      }
      if (increments >= 1) {
        roundCandidates.push({ addr, min, max, increments, vals: vals.filter((_, i) => i % 2 === 0).slice(0, 30) });
      }
    }
  }
  if (roundCandidates.length > 0) {
    for (const c of roundCandidates) {
      console.log(`   $7E:${c.addr.toString(16).padStart(4,"0")}  ${c.min}→${c.max}  increments=${c.increments}  vals=[${c.vals.join(",")}]`);
    }
  } else {
    console.log("   No round counter candidates found (need a round to end during scan)");
  }
  console.log();

  // ── Suspected address verification ──────────────────────────────────
  console.log("🎯 Suspected address verification:");
  for (const [label, addr] of Object.entries(SUSPECTED)) {
    const vals = addrHistory.get(addr) || [];
    const uniq = new Set(vals);
    console.log(`   ${label.padEnd(14)} $7E:${addr.toString(16).padStart(4,"0")} — ${vals.length} polls, ${uniq.size} unique values: [${[...uniq].slice(0,10).join(", ")}]`);
  }
  console.log();

  // ── Extra region dumps ──────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════════════");
  console.log("🔬 REGION DUMPS (latest snapshot)");
  console.log("═══════════════════════════════════════════════════════\n");

  const lastSnap = history[history.length - 1];

  for (const region of [
    { start: 0x0500, end: 0x0560, label: "P1 health neighborhood (0x0500-0x0560)" },
    { start: 0x0700, end: 0x0760, label: "P2 health neighborhood (0x0700-0x0760)" },
    { start: 0x18E0, end: 0x1940, label: "Timer/round region (0x18E0-0x1940)" },
    { start: 0x0000, end: 0x0040, label: "Low WRAM mirrors (0x0000-0x0040)" },
  ]) {
    console.log(`${region.label}:`);
    for (let addr = region.start; addr < region.end; addr += 16) {
      const vals = [];
      for (let i = 0; i < 16; i++) {
        const v = lastSnap.get(addr + i);
        vals.push(v !== undefined ? v.toString(16).padStart(2,"0") : "??");
      }
      console.log(`   $7E:${addr.toString(16).padStart(4,"0")}: ${vals.join(" ")}`);
    }
    console.log();
  }

  console.log("✅ Discovery complete.");
  console.log("\n📋 Next steps:");
  console.log("   1. Identify the correct health addresses from the candidates above");
  console.log("   2. Identify timer address (likely $7E:18F3 if matches PAR)");
  console.log("   3. Identify P1/P2 char IDs (stable low values near health region)");
  console.log("   4. Identify round counters (0→1→2 pattern in 0x0000-0x0200 or 0x18E0+)");
  console.log("   5. Wire confirmed addresses into game-runner.ts + game-config.ts");
}

main().catch(console.error);
