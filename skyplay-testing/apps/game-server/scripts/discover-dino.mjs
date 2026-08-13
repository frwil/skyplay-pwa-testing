/**
 * Cadillacs and Dinosaurs (CPS1 / FBNeo) RAM Discovery Script
 * ============================================================
 * Discovers health, lives, score, level, character IDs, and game-over flag
 * for Cadillacs and Dinosaurs (Capcom CPS1, 1993).
 *
 * ROM: dino.zip (FBNeo standard name)
 *
 * CPS1 memory layout:
 *   - Work RAM: 64KB mapped by FBNeo at 0x000000-0x00FFFF
 *   - CPU: Motorola 68000 → big-endian for multi-byte values
 *   - Single-byte values (health, lives) are endian-agnostic
 *
 * What we need to discover:
 *   | Data             | Priority | Notes                                        |
 *   |------------------|----------|----------------------------------------------|
 *   | Health P1, P2    | Critical | 1 byte, likely 0-0x60 or 0-0xB0 range       |
 *   | Lives P1, P2     | Critical | 1 byte, starts at 2-3, decrements on death   |
 *   | Score P1, P2     | High     | 3 bytes BCD (big-endian), only increases     |
 *   | Level/Stage      | High     | 1 byte, increments at level transitions      |
 *   | Game Over flag   | Critical | 1 byte, appears when all lives + continues   |
 *   | Character ID P1  | Medium   | 1 byte, 0x00-0x03, stable during play        |
 *   | Character ID P2  | Medium   | 1 byte, 0x00-0x03, stable during play        |
 *
 * Characters: Jack Tenrec=0x00, Hannah Dundee=0x01, Mustapha Cairo=0x02,
 *             Mess O'Bradovich=0x03
 *
 * Run: docker cp + docker exec during a live dino game.
 *
 * Usage:
 *   docker cp apps/game-server/scripts/discover-dino.mjs game-server-game-server-1:/tmp/
 *   docker exec game-server-game-server-1 node /tmp/discover-dino.mjs [duration_seconds]
 */

import { createSocket } from "dgram";

const HOST = "127.0.0.1";
const PORT = 55355;
const POLL_MS = 400;
const DURATION_S = parseInt(process.argv[2]) || 180;

// ── CPS1 Work RAM range ──────────────────────────────────────────────────
// FBNeo maps CPS1 work RAM at 0x000000-0x00FFFF (64KB)
const SCAN_RANGE = { start: 0x0000, end: 0x10000 };

// ── Utility ──────────────────────────────────────────────────────────────

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
    // Progress indicator for full scan
    const pct = Math.round(((addr - start) / (end - start)) * 100);
    process.stdout.write(`\r   Scanning... ${pct}% (0x${addr.toString(16)} / 0x${end.toString(16)})`);
  }
  process.stdout.write("\r\x1b[K"); // clear line
  return data;
}

// Motorola 68000 big-endian helpers
function readBE16(snap, addr) {
  const hi = snap.get(addr);
  const lo = snap.get(addr + 1);
  if (hi === undefined || lo === undefined) return null;
  return (hi << 8) | lo;
}

function readBE24(snap, addr) {
  const b0 = snap.get(addr);
  const b1 = snap.get(addr + 1);
  const b2 = snap.get(addr + 2);
  if (b0 === undefined || b1 === undefined || b2 === undefined) return null;
  return (b0 << 16) | (b1 << 8) | b2;
}

function readBE24BCD(snap, addr) {
  const b0 = snap.get(addr);
  const b1 = snap.get(addr + 1);
  const b2 = snap.get(addr + 2);
  if (b0 === undefined || b1 === undefined || b2 === undefined) return null;
  // BCD: each nibble is a decimal digit
  const d5 = (b0 >> 4) & 0xF;
  const d4 = b0 & 0xF;
  const d3 = (b1 >> 4) & 0xF;
  const d2 = b1 & 0xF;
  const d1 = (b2 >> 4) & 0xF;
  const d0 = b2 & 0xF;
  // Validate BCD (each nibble 0-9)
  if ([d5, d4, d3, d2, d1, d0].some(d => d > 9)) return null;
  return d5 * 100000 + d4 * 10000 + d3 * 1000 + d2 * 100 + d1 * 10 + d0;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const sock = createSocket("udp4");

  console.log("🔍 Cadillacs and Dinosaurs (CPS1) RAM Discovery");
  console.log(`   ROM: dino.zip`);
  console.log(`   CPS1 Work RAM: 0x${SCAN_RANGE.start.toString(16)}-0x${(SCAN_RANGE.end - 1).toString(16)} (64KB)`);
  console.log(`   Polling every ${POLL_MS}ms for ${DURATION_S}s`);
  console.log("   ⚠️  Start the game and enter a level (past char select + intro)\n");

  // Quick pre-check: can we read from RetroArch?
  const testHex = await readRam(sock, 0x0000, 1);
  if (!testHex) {
    console.error("❌ Cannot reach RetroArch UDP. Is dino.zip loaded?");
    sock.close();
    process.exit(1);
  }
  console.log("✅ RetroArch UDP reachable. Starting initial full-RAM scan...\n");

  // ── Phase 1: Initial full scan of the entire 64KB CPS1 work RAM ────────
  const snap0 = await readFullSnapshot(sock, SCAN_RANGE.start, SCAN_RANGE.end);
  console.log(`   Got ${snap0.size} bytes\n`);

  // Quick check: are we in-game? Look for non-zero data density
  let nonZeroCount = 0;
  for (const [, v] of snap0) { if (v !== 0) nonZeroCount++; }
  const density = (nonZeroCount / snap0.size * 100).toFixed(1);
  console.log(`   RAM density: ${nonZeroCount}/${snap0.size} non-zero bytes (${density}%)`);
  if (nonZeroCount < 100) {
    console.warn("⚠️  Very low non-zero count — is the game past the title screen?");
  }
  console.log();

  // ── Phase 1b: Find "hot" regions (> 10% non-zero in a 256-byte window) ─
  const hotRegions = [];
  for (let addr = SCAN_RANGE.start; addr < SCAN_RANGE.end; addr += 256) {
    let nonZero = 0, total = 0;
    for (let i = 0; i < 256 && addr + i < SCAN_RANGE.end; i++) {
      const v = snap0.get(addr + i);
      if (v !== undefined) { total++; if (v !== 0) nonZero++; }
    }
    if (total > 0 && nonZero / total > 0.1) {
      hotRegions.push({ addr: addr, end: Math.min(addr + 256, SCAN_RANGE.end), density: (nonZero / total * 100).toFixed(1) });
    }
  }
  console.log(`🌡️  Hot regions (>10% non-zero): ${hotRegions.length}`);
  // Merge adjacent hot regions
  const merged = [];
  for (const r of hotRegions) {
    if (merged.length > 0 && r.addr <= merged[merged.length - 1].end) {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, r.end);
    } else {
      merged.push({ ...r });
    }
  }
  for (const r of merged) {
    console.log(`   0x${r.addr.toString(16).padStart(5, "0")}-0x${(r.end - 1).toString(16).padStart(5, "0")} (density ~${r.density}%)`);
  }
  console.log("\n📸 Initial snapshot complete. Starting continuous polling...\n");

  // ── Phase 2: Continuous polling of the most promising regions ──────────
  // Focus on merged hot regions + full scan at lower frequency
  const history = []; // Array<Map<addr, value>>
  history.push(snap0);

  const t0 = Date.now();
  const deadline = t0 + DURATION_S * 1000;
  let pollCount = 0;
  let fullScanInterval = 5; // full scan every 5 polls

  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    pollCount++;

    // Alternate between full scan and hot-region-only scans
    const doFullScan = pollCount % fullScanInterval === 0;
    let snap;
    if (doFullScan) {
      snap = await readFullSnapshot(sock, SCAN_RANGE.start, SCAN_RANGE.end);
    } else {
      // Quick scan of merged hot regions only
      snap = new Map();
      for (const r of merged) {
        const chunk = await readChunk(sock, r.addr, r.end - r.addr);
        if (chunk) {
          for (let i = 0; i < chunk.length; i++) {
            snap.set(r.addr + i, chunk[i]);
          }
        }
      }
    }

    if (snap.size > 0) {
      history.push(snap);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      process.stdout.write(`\r   Poll #${pollCount} (${elapsed}s) — ${snap.size} bytes   `);
    }
  }
  console.log("\n");

  sock.close();

  // ── Phase 3: Analysis ─────────────────────────────────────────────────

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
  // Remove sparse addresses (present in <50% of snapshots)
  for (const [addr, vals] of addrHistory) {
    if (vals.length < history.length * 0.3) addrHistory.delete(addr);
  }

  console.log(`   ${addrHistory.size} addresses tracked across ${history.length} snapshots\n`);

  // ── Health candidates ──────────────────────────────────────────────────
  // Health: decreases during combat, likely 0-0x60 (SFA2) or 0-0xB0 (SF2)
  console.log("🏥 Health candidates (decrease during combat, 0-0xB0 range):");
  const healthCandidates = [];
  for (const [addr, vals] of addrHistory) {
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min;
    const COUNT = vals.length;
    if (min >= 0 && max <= 200 && range >= 15) {
      let decreasingSteps = 0;
      let significantDrops = 0;
      for (let i = 1; i < COUNT; i++) {
        if (vals[i] <= vals[i - 1]) decreasingSteps++;
        if (vals[i - 1] - vals[i] >= 5) significantDrops++;
      }
      const decRatio = decreasingSteps / (COUNT - 1);
      if (decRatio >= 0.5 && significantDrops >= 2) {
        const sampled = vals.filter((_, i) =>
          i % Math.max(1, Math.floor(COUNT / 15)) === 0 || i === COUNT - 1
        );
        healthCandidates.push({ addr, min, max, range, decRatio, significantDrops, sampled });
      }
    }
  }
  healthCandidates.sort((a, b) => b.range - a.range);

  if (healthCandidates.length > 0) {
    for (const c of healthCandidates.slice(0, 15)) {
      console.log(`   0x${c.addr.toString(16).padStart(4, "0")}  range=${c.min}-${c.max}  drops=${c.significantDrops}  decRatio=${(c.decRatio * 100).toFixed(0)}%  vals=[${c.sampled.join(",")}]`);
    }
  } else {
    console.log("   No strong health candidates. Showing any decreasing values:");
    for (const [addr, vals] of addrHistory) {
      const min = Math.min(...vals), max = Math.max(...vals);
      if (max > min && max - min >= 8 && max <= 255 && vals.length >= 5) {
        let dec = 0;
        for (let i = 1; i < vals.length; i++) if (vals[i] < vals[i - 1]) dec++;
        if (dec >= 3) {
          console.log(`   0x${addr.toString(16).padStart(4, "0")} range=${min}-${max} decreases=${dec}/${vals.length - 1}`);
        }
      }
    }
  }
  console.log();

  // ── Lives candidates ───────────────────────────────────────────────────
  // Lives: starts at 2-3, decrements by 1 on death, goes to 0
  console.log("💚 Lives candidates (2-3 → 0, decrements by 1):");
  const livesCandidates = [];
  for (const [addr, vals] of addrHistory) {
    const min = Math.min(...vals), max = Math.max(...vals);
    const COUNT = vals.length;
    if (min <= 1 && max >= 2 && max <= 5 && COUNT >= 5) {
      // Check for single-step decrements
      let singleStepDecs = 0;
      for (let i = 1; i < COUNT; i++) {
        const diff = vals[i - 1] - vals[i];
        if (diff === 1) singleStepDecs++;
      }
      const uniq = new Set(vals);
      const sampled = vals.filter((_, i) =>
        i % Math.max(1, Math.floor(COUNT / 20)) === 0 || i === COUNT - 1
      );
      livesCandidates.push({ addr, min, max, singleStepDecs, uniqVals: [...uniq].sort(), sampled });
    }
  }
  livesCandidates.sort((a, b) => b.singleStepDecs - a.singleStepDecs);

  if (livesCandidates.length > 0) {
    for (const c of livesCandidates.slice(0, 10)) {
      console.log(`   0x${c.addr.toString(16).padStart(4, "0")}  range=${c.min}-${c.max}  stepDecs=${c.singleStepDecs}  uniqueVals=[${c.uniqVals.join(",")}]  vals=[${c.sampled.join(",")}]`);
    }
  } else {
    console.log("   No lives candidates found (need deaths to occur during scan)");
  }
  console.log();

  // ── Score candidates (BCD, 3-byte big-endian, only increases) ──────────
  console.log("💰 Score candidates (3-byte BE BCD, monotonically increasing):");
  const scoreCandidates = [];
  for (let addr = SCAN_RANGE.start; addr < SCAN_RANGE.end - 2; addr++) {
    if (!addrHistory.has(addr) || !addrHistory.has(addr + 1) || !addrHistory.has(addr + 2)) continue;
    const valsA = addrHistory.get(addr), valsB = addrHistory.get(addr + 1), valsC = addrHistory.get(addr + 2);
    const COUNT = Math.min(valsA.length, valsB.length, valsC.length);
    if (COUNT < 5) continue;

    // Read as 24-bit BE BCD at each snapshot
    let bcdOk = 0;
    let increasing = 0;
    let prev = -1;
    for (let i = 0; i < COUNT; i++) {
      const b0 = valsA[i], b1 = valsB[i], b2 = valsC[i];
      const d5 = (b0 >> 4) & 0xF, d4 = b0 & 0xF;
      const d3 = (b1 >> 4) & 0xF, d2 = b1 & 0xF;
      const d1 = (b2 >> 4) & 0xF, d0 = b2 & 0xF;
      if ([d5, d4, d3, d2, d1, d0].every(d => d <= 9)) {
        bcdOk++;
        const val = d5 * 100000 + d4 * 10000 + d3 * 1000 + d2 * 100 + d1 * 10 + d0;
        if (prev >= 0 && val >= prev) increasing++;
        prev = val;
      } else {
        prev = -1;
      }
    }
    const bcdRatio = bcdOk / COUNT;
    const incRatio = bcdOk > 1 ? increasing / (bcdOk - 1) : 0;
    if (bcdRatio >= 0.7 && incRatio >= 0.6) {
      // Reconstruct samples
      const samples = [];
      const step = Math.max(1, Math.floor(COUNT / 10));
      for (let i = 0; i < COUNT; i += step) {
        const b0 = valsA[i], b1 = valsB[i], b2 = valsC[i];
        samples.push(((b0 >> 4) & 0xF) * 100000 + (b0 & 0xF) * 10000 + ((b1 >> 4) & 0xF) * 1000 + (b1 & 0xF) * 100 + ((b2 >> 4) & 0xF) * 10 + (b2 & 0xF));
      }
      scoreCandidates.push({ addr, bcdRatio, incRatio, samples });
    }
  }
  scoreCandidates.sort((a, b) => (b.bcdRatio * b.incRatio) - (a.bcdRatio * a.incRatio));

  if (scoreCandidates.length > 0) {
    for (const c of scoreCandidates.slice(0, 10)) {
      console.log(`   0x${c.addr.toString(16).padStart(4, "0")}  BCD=${(c.bcdRatio * 100).toFixed(0)}%  incRatio=${(c.incRatio * 100).toFixed(0)}%  samples=[${c.samples.join("→")}]`);
    }
  } else {
    console.log("   No BCD score candidates found (need kills/score to accumulate during scan)");
  }
  console.log();

  // ── Level/stage candidates ─────────────────────────────────────────────
  console.log("🗺️  Level/stage candidates (incrementing, 0-10 range, stable within level):");
  const levelCandidates = [];
  for (const [addr, vals] of addrHistory) {
    const min = Math.min(...vals), max = Math.max(...vals);
    const COUNT = vals.length;
    if (min >= 0 && max >= 1 && max <= 10 && max > min) {
      // Check stability (long runs of same value, then a jump)
      let stableRuns = 0;
      let jumps = 0;
      let runLen = 1;
      for (let i = 1; i < COUNT; i++) {
        if (vals[i] === vals[i - 1]) {
          runLen++;
        } else {
          if (runLen >= 5) stableRuns++;
          if (vals[i] > vals[i - 1] && vals[i] - vals[i - 1] === 1) jumps++;
          runLen = 1;
        }
      }
      if (runLen >= 5) stableRuns++;
      if (stableRuns >= 0 && jumps >= 1) {
        const uniq = [...new Set(vals)].sort();
        levelCandidates.push({ addr, min, max, stableRuns, jumps, uniqVals: uniq });
      }
    }
  }
  levelCandidates.sort((a, b) => b.stableRuns - a.stableRuns);

  if (levelCandidates.length > 0) {
    for (const c of levelCandidates.slice(0, 10)) {
      console.log(`   0x${c.addr.toString(16).padStart(4, "0")}  ${c.min}→${c.max}  stableRuns=${c.stableRuns}  jumps=${c.jumps}  uniqueVals=[${c.uniqVals.join(",")}]`);
    }
  } else {
    console.log("   No level candidates found (need level transitions during scan)");
  }
  console.log();

  // ── Game Over flag candidates ──────────────────────────────────────────
  // Game Over: appears (0→1 or similar) at end of game, stays on
  console.log("💀 Game Over flag candidates (appears late, persists):");
  const gameOverCandidates = [];
  for (const [addr, vals] of addrHistory) {
    const min = Math.min(...vals), max = Math.max(...vals);
    const COUNT = vals.length;
    if (min === 0 && max >= 1 && max <= 3) {
      // Does it stay at the high value once reached?
      let reachedHigh = false;
      let stayedHigh = 0;
      for (let i = COUNT - 1; i >= 0; i--) {
        if (vals[i] === max) { reachedHigh = true; stayedHigh++; }
        else if (reachedHigh) break;
      }
      // Only appears in the last portion of snapshots
      const firstMaxIdx = vals.indexOf(max);
      const appearsLate = firstMaxIdx > COUNT * 0.5;
      if (reachedHigh && stayedHigh >= 3 && appearsLate) {
        gameOverCandidates.push({ addr, min, max, stayedHigh, firstMaxIdx, firstMaxPct: (firstMaxIdx / COUNT * 100).toFixed(0) });
      }
    }
  }
  gameOverCandidates.sort((a, b) => b.stayedHigh - a.stayedHigh);

  if (gameOverCandidates.length > 0) {
    for (const c of gameOverCandidates.slice(0, 10)) {
      console.log(`   0x${c.addr.toString(16).padStart(4, "0")}  ${c.min}→${c.max}  persisted=${c.stayedHigh}samples  appearedAt=${c.firstMaxPct}%`);
    }
  } else {
    console.log("   No game-over candidates found (need game over to occur during scan)");
  }
  console.log();

  // ── Character ID candidates ────────────────────────────────────────────
  console.log("👤 Character ID candidates (stable, 0x00-0x03 range):");
  const charCandidates = [];
  for (const [addr, vals] of addrHistory) {
    const uniq = new Set(vals);
    const max = Math.max(...vals);
    if (uniq.size <= 2 && max <= 0x03 && max >= 0x00 && vals.length >= 3) {
      charCandidates.push({ addr, uniq: [...uniq].map(v => "0x" + v.toString(16)), stable: uniq.size === 1 });
    }
  }
  // Also look for 0x00-0x03 with some noise (character select screen)
  for (const [addr, vals] of addrHistory) {
    const uniq = new Set(vals);
    const max = Math.max(...vals);
    if (uniq.size >= 2 && uniq.size <= 4 && max <= 0x03 && vals.length >= 3 &&
        !charCandidates.some(c => c.addr === addr)) {
      charCandidates.push({ addr, uniq: [...uniq].map(v => "0x" + v.toString(16)), stable: false });
    }
  }
  for (const c of charCandidates.slice(0, 15)) {
    console.log(`   0x${c.addr.toString(16).padStart(4, "0")}  vals=[${c.uniq.join(", ")}]  ${c.stable ? "✅ stable" : "⚠️ changing (char select?)"}`);
  }
  if (charCandidates.length === 0) {
    console.log("   No character ID candidates in 0x00-0x03 range found.");
  }
  console.log();

  // ── Adjacent-pair analysis: find P1/P2 pairs ──────────────────────────
  // In many arcade games, P2 values are at a fixed offset from P1 (e.g. +2, +0x100, +0x200)
  console.log("🔗 P1/P2 offset analysis (looking for mirrored pairs):");
  console.log("   Checking offsets +1, +2, +4, +0x100, +0x200 for correlated health behaviors...");

  const healthSorted = healthCandidates.slice(0, 30).map(c => c.addr);
  const OFFSETS_TO_TEST = [1, 2, 4, 8, 0x80, 0x100, 0x180, 0x200, 0x300, 0x400];

  const pairedCandidates = [];
  for (const addr of healthSorted) {
    for (const offset of OFFSETS_TO_TEST) {
      const addr2 = addr + offset;
      if (addr2 >= SCAN_RANGE.end) continue;
      if (!addrHistory.has(addr2)) continue;
      const vals1 = addrHistory.get(addr);
      const vals2 = addrHistory.get(addr2);
      // Check correlation: do both decrease in similar patterns?
      let corr = 0;
      const n = Math.min(vals1.length, vals2.length);
      for (let i = 1; i < n; i++) {
        const d1 = vals1[i - 1] - vals1[i];
        const d2 = vals2[i - 1] - vals2[i];
        if (d1 > 0 && d2 > 0) corr++; // both decreased
      }
      const max1 = Math.max(...vals1), max2 = Math.max(...vals2);
      const rangeMatch = Math.abs(max1 - max2) <= 10;
      if (corr >= 3 && rangeMatch) {
        pairedCandidates.push({
          p1Addr: addr, p2Addr: addr2, offset,
          corr,
          max1, max2,
          p1Range: `${Math.min(...vals1)}-${Math.max(...vals1)}`,
          p2Range: `${Math.min(...vals2)}-${Math.max(...vals2)}`,
        });
      }
    }
  }
  pairedCandidates.sort((a, b) => b.corr - a.corr);

  if (pairedCandidates.length > 0) {
    for (const p of pairedCandidates.slice(0, 15)) {
      console.log(`   P1=0x${p.p1Addr.toString(16).padStart(4, "0")} P2=0x${p.p2Addr.toString(16).padStart(4, "0")}  offset=+0x${p.offset.toString(16)}  corr=${p.corr}  maxVals=${p.max1}/${p.max2}  ranges=[${p.p1Range}]/[${p.p2Range}]`);
    }
  } else {
    console.log("   No strongly correlated P1/P2 pairs found. Try with more combat data.");
  }
  console.log();

  // ── Region dumps: key hot regions in the last snapshot ─────────────────
  console.log("═══════════════════════════════════════════════════════");
  console.log("🔬 HOT REGION HEX DUMPS (latest snapshot)");
  console.log("═══════════════════════════════════════════════════════\n");

  const lastSnap = history[history.length - 1];

  for (const r of merged.slice(0, 8)) {
    const label = `Region 0x${r.addr.toString(16).padStart(5, "0")}-0x${(r.end - 1).toString(16).padStart(5, "0")}`;
    console.log(`${label}:`);
    for (let addr = r.addr; addr < r.end; addr += 16) {
      const vals = [];
      for (let i = 0; i < 16; i++) {
        const v = lastSnap.get(addr + i);
        vals.push(v !== undefined ? v.toString(16).padStart(2, "0") : "??");
      }
      console.log(`   ${addr.toString(16).padStart(5, "0")}: ${vals.join(" ")}`);
    }
    console.log();
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════════════");
  console.log("📋 DISCOVERY SUMMARY");
  console.log("═══════════════════════════════════════════════════════\n");

  console.log(`🏥  Top health candidates:       ${healthCandidates.slice(0, 5).map(c => "0x" + c.addr.toString(16)).join(", ") || "none"}`);
  console.log(`💚 Top lives candidates:         ${livesCandidates.slice(0, 5).map(c => "0x" + c.addr.toString(16)).join(", ") || "none"}`);
  console.log(`💰 Top score candidates:         ${scoreCandidates.slice(0, 5).map(c => "0x" + c.addr.toString(16)).join(", ") || "none"}`);
  console.log(`🗺️  Top level candidates:         ${levelCandidates.slice(0, 5).map(c => "0x" + c.addr.toString(16)).join(", ") || "none"}`);
  console.log(`💀 Top game-over candidates:     ${gameOverCandidates.slice(0, 5).map(c => "0x" + c.addr.toString(16)).join(", ") || "none"}`);
  console.log(`👤 Top char ID candidates:       ${charCandidates.slice(0, 5).map(c => "0x" + c.addr.toString(16)).join(", ") || "none"}`);
  console.log(`🔗 Top paired (P1+P2) addresses: ${pairedCandidates.slice(0, 3).map(p => `0x${p.p1Addr.toString(16)}+0x${p.p2Addr.toString(16)}`).join(", ") || "none"}`);
  console.log();

  console.log("✅ Discovery complete.");
  console.log("\n📋 Next steps:");
  console.log("   1. Review the candidates above — look for health that matches your observations");
  console.log("   2. Run a SECOND scan with different conditions (different character, lose lives intentionally)");
  console.log("   3. Cross-reference: addresses that show the same behavior in both runs are confirmed");
  console.log("   4. For P1/P2 differentiation: in a 2P game, have P1 take damage while P2 avoids it,");
  console.log("      then look for addresses where only ONE changes");
  console.log("   5. Wire confirmed addresses into game-config.ts + game-runner.ts");
  console.log("\n   ── Quick re-run with targeted region ──");
  if (healthCandidates.length > 0) {
    const best = healthCandidates[0];
    console.log(`   To validate 0x${best.addr.toString(16)} as health: watch it in isolation`);
    console.log(`     docker exec game-server-game-server-1 node -e "`);
    console.log(`       const dgram=require('dgram');const s=dgram.createSocket('udp4');`);
    console.log(`       setInterval(()=>{s.send('READ_CORE_RAM ${best.addr.toString(16)} 2\\n',55355,'127.0.0.1')},500);`);
    console.log(`       s.on('message',m=>{const p=m.toString().trim().split(/\\s+/);`);
    console.log(`       if(p[0]==='READ_CORE_RAM')console.log(new Date().toISOString(),'HP1='+parseInt(p[2],16),'HP2='+parseInt(p[3]||'0',16))});"`);
  }
}

main().catch(console.error);
