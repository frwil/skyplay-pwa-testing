/**
 * Focused SFA2 SNES health + timer finder.
 * Instead of scanning 8KB, this polls only the most promising candidate
 * regions discovered in the full scan, at higher frequency (100ms).
 *
 * Candidates from full scan:
 *   0x1D3F - jumps 0→96 at combat start, stays 96 (P1 health?)
 *   0x1D40 - same pattern (P2 health or max-health constant)
 *   0x0302 - starts 96, then 112,120,112... (changes actively)
 *   0x030A - 112,110,114,120... (changes actively)
 *   0x0314 - 22→16→8 (decreasing!)
 *   0x00DA - 72→50→49→50... (oscillates, possible timer)
 *
 * Also checks wider ranges: 0x1D30-0x1D50 and 0x300-0x320
 *
 * Key insight: SFA2 health max = 96 (SNES), timer starts at 99.
 * We look for values that:
 *   a) Start at ~96 and only decrease (health)
 *   b) Count down monotonically 99→0 (timer)
 *   c) Jump from 0 to a value when combat starts
 *
 * Usage: docker cp ... game-server-game-server-1:/tmp/
 *        docker exec game-server-game-server-1 node /tmp/scan-sfa2-focused.mjs 90
 */

import { createSocket } from "dgram";
import { Buffer } from "buffer";

const HOST = "127.0.0.1";
const PORT = 55355;

// Promising address ranges from full scan
const RANGES = [
  { start: 0x00300, end: 0x00320, label: "combat-vars-300" },
  { start: 0x000D0, end: 0x000E0, label: "oscillator-DA" },
  { start: 0x01D30, end: 0x01D50, label: "health-candidate-1D3F" },
  { start: 0x01870, end: 0x01880, label: "stable-96-1871" },
  { start: 0x018D0, end: 0x018E0, label: "stable-96-18D1" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readRam(sock, addr, size) {
  return new Promise((resolve, reject) => {
    const cmd = Buffer.from(`READ_CORE_RAM ${addr.toString(16)} ${size}\n`);
    const timer = setTimeout(() => {
      sock.removeAllListeners("message");
      reject(new Error(`Timeout at 0x${addr.toString(16)}`));
    }, 3000);

    const handler = (msg) => {
      const text = msg.toString();
      if (!text.startsWith("READ_CORE_RAM")) return;
      const parts = text.split(" ");
      if (parts.length < 3) return;
      const respAddr = parseInt(parts[1], 16);
      if (respAddr !== addr) return;
      clearTimeout(timer);
      sock.removeListener("message", handler);
      const hex = parts.slice(2).join("");
      resolve(hex);
    };
    sock.on("message", handler);
    sock.send(cmd, PORT, HOST);
  });
}

function parseHex(hex) {
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16));
  }
  return bytes;
}

async function readRange(sock, start, end) {
  const size = end - start;
  try {
    const hex = await readRam(sock, start, size);
    return parseHex(hex);
  } catch (e) {
    return null;
  }
}

function fmtAddr(a) {
  return "0x" + a.toString(16).padStart(4).toUpperCase();
}

async function main() {
  const duration = parseInt(process.argv[2]) || 90;
  const sock = createSocket("udp4");

  console.log("🎯 SFA2 Focused Health/Timer Scanner");
  console.log(`   Polling ${RANGES.length} ranges every 100ms for ${duration}s`);
  console.log("   Make sure a match is IN COMBAT (past FIGHT!).\n");

  // Flatten all addresses we care about
  const allAddrs = [];
  for (const r of RANGES) {
    for (let a = r.start; a < r.end; a++) {
      allAddrs.push(a);
    }
  }
  console.log(`   Total addresses tracked: ${allAddrs.length}\n`);

  // Initial snapshot
  console.log("📸 Initial snapshot...");
  const initialValues = new Map();
  for (const r of RANGES) {
    const bytes = await readRange(sock, r.start, r.end);
    if (bytes) {
      for (let i = 0; i < bytes.length; i++) {
        initialValues.set(r.start + i, bytes[i]);
      }
    }
  }
  console.log(`   Got ${initialValues.size} bytes.\n`);

  // Initialize history: each address → array of values over time
  const history = new Map();
  for (const [addr, val] of initialValues) {
    history.set(addr, [val]);
  }

  // Polling loop at 100ms
  const t0 = Date.now();
  const deadline = t0 + duration * 1000;
  let poll = 0;

  console.log(`🔄 Polling every 100ms for ${duration}s...\n`);

  while (Date.now() < deadline) {
    await sleep(100);
    poll++;

    for (const r of RANGES) {
      const bytes = await readRange(sock, r.start, r.end);
      if (bytes) {
        for (let i = 0; i < bytes.length; i++) {
          const addr = r.start + i;
          const arr = history.get(addr);
          if (arr) {
            arr.push(bytes[i]);
          }
        }
      }
    }

    if (poll % 10 === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      process.stdout.write(`\r   Poll #${poll} (${elapsed}s)`);
    }
  }
  console.log();

  // ── Analysis ──────────────────────────────────────────────

  console.log("\n" + "=".repeat(70));
  console.log("📊 ANALYSIS");
  console.log("=".repeat(70));

  // Categorize each address by its behavior
  const categories = {
    startedAt96: [],    // Initial value = 96, later changes
    staysAt96: [],      // Always 96
    jumpsTo96: [],      // Started != 96, jumped to 96 and stayed
    decreasesOnly: [],  // Only decreases (potential health)
    countsDown: [],     // Steady countdown (potential timer)
    increasesOnly: [],  // Only increases (potential damage counter)
    oscillator: [],     // Goes up and down
  };

  for (const [addr, vals] of history) {
    const first = vals[0];
    const uniq = new Set(vals);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const changes = uniq.size;

    if (changes <= 1) continue; // skip static

    // Direction analysis
    let ups = 0, downs = 0;
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] > vals[i - 1]) ups++;
      else if (vals[i] < vals[i - 1]) downs++;
    }

    const totalMoves = ups + downs;
    const upRatio = totalMoves > 0 ? ups / totalMoves : 0;

    if (first === 96 && changes > 1) categories.startedAt96.push({ addr, vals, min, max, changes, upRatio, upRatio });
    else if (min === 96 && max === 96) categories.staysAt96.push({ addr, vals });
    else if (first < 50 && min === first && max >= 90) categories.jumpsTo96.push({ addr, vals, first, max });

    if (downs > 0 && ups === 0 && totalMoves > 2) categories.decreasesOnly.push({ addr, vals, min, max, changes });
    if (ups > 0 && downs === 0 && totalMoves > 2) categories.increasesOnly.push({ addr, vals, min, max, changes });
    if (ups > 2 && downs > 2 && upRatio > 0.3 && upRatio < 0.7) categories.oscillator.push({ addr, vals, min, max, changes });

    // Check for countdown pattern (consecutive -1 steps)
    let countdownSteps = 0;
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] === vals[i - 1] - 1) countdownSteps++;
    }
    if (countdownSteps > 10 && vals[0] <= 99 && vals[0] >= 30) {
      categories.countsDown.push({ addr, vals, min, max, countdownSteps });
    }
  }

  // ── Report ─────────────────────────────────────────────────

  console.log(`\n🏥 JUMPED TO 96 AT COMBAT START (likely health):`);
  if (categories.jumpsTo96.length === 0) console.log("   (none found)");
  for (const c of categories.jumpsTo96) {
    const valsStr = c.vals.filter((_, i) => i % 20 === 0 || i === c.vals.length - 1).join(",");
    console.log(`   $7E:${fmtAddr(c.addr)}  jumped ${c.first}→${c.max}  vals=[${valsStr}]  (${c.vals.length} polls)`);
  }

  console.log(`\n🏥 STARTED AT 96, THEN CHANGED (active health/damage):`);
  if (categories.startedAt96.length === 0) console.log("   (none found)");
  for (const c of categories.startedAt96) {
    const valsStr = c.vals.filter((_, i) => i % 20 === 0 || i === c.vals.length - 1).join(",");
    console.log(`   $7E:${fmtAddr(c.addr)}  ${c.min}..${c.max}  vals=[${valsStr}]  (${c.vals.length} polls)`);
  }

  console.log(`\n🏥 ALWAYS 96 (max health constant?):`);
  if (categories.staysAt96.length === 0) console.log("   (none found)");
  for (const c of categories.staysAt96.slice(0, 5)) {
    console.log(`   $7E:${fmtAddr(c.addr)}  constant 96  (${c.vals.length} polls)`);
  }
  if (categories.staysAt96.length > 5) console.log(`   ... and ${categories.staysAt96.length - 5} more`);

  console.log(`\n⏱️  COUNTDOWN PATTERN (timer candidates):`);
  if (categories.countsDown.length === 0) console.log("   (none found)");
  for (const c of categories.countsDown) {
    const valsStr = c.vals.join(",");
    console.log(`   $7E:${fmtAddr(c.addr)}  ${c.min}..${c.max}  countdown=${c.countdownSteps}  vals=[${valsStr}]`);
  }

  console.log(`\n📉 DECREASES ONLY (health?):`);
  if (categories.decreasesOnly.length === 0) console.log("   (none found)");
  for (const c of categories.decreasesOnly.slice(0, 10)) {
    const valsStr = c.vals.filter((_, i) => i % 20 === 0 || i === c.vals.length - 1).join(",");
    console.log(`   $7E:${fmtAddr(c.addr)}  ${c.min}..${c.max}  vals=[${valsStr}]`);
  }
  if (categories.decreasesOnly.length > 10) console.log(`   ... and ${categories.decreasesOnly.length - 10} more`);

  console.log(`\n📈 INCREASES ONLY (damage counter?):`);
  if (categories.increasesOnly.length === 0) console.log("   (none found)");
  for (const c of categories.increasesOnly.slice(0, 10)) {
    const valsStr = c.vals.filter((_, i) => i % 20 === 0 || i === c.vals.length - 1).join(",");
    console.log(`   $7E:${fmtAddr(c.addr)}  ${c.min}..${c.max}  vals=[${valsStr}]`);
  }
  if (categories.increasesOnly.length > 10) console.log(`   ... and ${categories.increasesOnly.length - 10} more`);

  console.log(`\n🔄 OSCILLATORS (super meter / animation?):`);
  if (categories.oscillator.length === 0) console.log("   (none found)");
  for (const c of categories.oscillator.slice(0, 10)) {
    const valsStr = c.vals.filter((_, i) => i % 20 === 0 || i === c.vals.length - 1).join(",");
    console.log(`   $7E:${fmtAddr(c.addr)}  ${c.min}..${c.max}  vals=[${valsStr}]`);
  }
  if (categories.oscillator.length > 10) console.log(`   ... and ${categories.oscillator.length - 10} more`);

  // ── 16-bit candidates ──────────────────────────────────────
  console.log(`\n🔢 16-BIT CANDIDATES (adjacent byte pairs):`);
  // Look for 16-bit values where both bytes change together
  const pairCandidates = [];
  for (const [addr, vals] of history) {
    const nextVals = history.get(addr + 1);
    if (!nextVals || vals.length < 3) continue;
    // Check if both change together
    let correlated = 0;
    for (let i = 1; i < vals.length; i++) {
      if ((vals[i] !== vals[i-1]) && (nextVals[i] !== nextVals[i-1])) {
        correlated++;
      }
    }
    if (correlated > 3) {
      const val16 = vals.map((v, i) => (v << 8) | (nextVals[i] || 0));
      const min16 = Math.min(...val16);
      const max16 = Math.max(...val16);
      pairCandidates.push({ addr, vals: val16, min16, max16, correlated });
    }
  }
  pairCandidates.sort((a, b) => b.correlated - a.correlated);
  for (const p of pairCandidates.slice(0, 15)) {
    const valsStr = p.vals.filter((_, i) => i % 30 === 0 || i === p.vals.length - 1).join(",");
    console.log(`   $7E:${fmtAddr(p.addr)} (16-bit)  ${p.min16}..${p.max16}  corr=${p.correlated}  vals=[${valsStr}]`);
  }

  sock.close();
  console.log("\n✅ Done.");
}

main().catch(console.error);
