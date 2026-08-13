/**
 * Cadillacs and Dinosaurs — Targeted Address Verification (FBNeo Cheats)
 * =====================================================================
 * Reads addresses from the official FBNeo cheat file (dino.ini) and verifies
 * them against live gameplay. Also determines whether FBNeo maps CPS1 work RAM
 * at absolute addresses (0xFF0000+) or relative (0x0000+).
 *
 * Usage:
 *   docker cp apps/game-server/scripts/verify-dino-cheats.mjs game-server-game-server-1:/tmp/
 *   docker exec game-server-game-server-1 node /tmp/verify-dino-cheats.mjs [duration_s]
 */

import { createSocket } from "dgram";

const HOST = "127.0.0.1";
const PORT = 55355;
const POLL_MS = 1000; // 1s polling — gentle, just verifying
const DURATION_S = parseInt(process.argv[2]) || 120;

// ── Addresses from dino.ini (FBNeo official cheats) ─────────────────────────
// These are absolute 68000 addresses (0xFFxxxx).
// We'll try both absolute and relative (minus 0xFF0000) to determine mapping.

const CHEAT_ADDRESSES = {
  // Player 1
  health_p1:      { abs: 0xFFB2E1, rel: 0xB2E1, desc: "Health P1 (cheat: Infinite Energy)", expectedRange: [0, 255] },
  lives_p1:       { abs: 0xFFB317, rel: 0xB317, desc: "Lives P1 (cheat: Infinite Lives)",      expectedRange: [0, 9] },
  charId_p1_a:    { abs: 0xFFB277, rel: 0xB277, desc: "Char ID P1 (cheat: Select Char P1 a)",  expectedRange: [0, 3] },
  charId_p1_b:    { abs: 0xFF863A, rel: 0x863A, desc: "Char ID P1 (cheat: Select Char P1 b)",  expectedRange: [0, 3] },
  invuln_p1:      { abs: 0xFFB274, rel: 0xB274, desc: "Invincibility flag P1",                 expectedRange: [0, 255] },

  // Player 2
  health_p2:      { abs: 0xFFB461, rel: 0xB461, desc: "Health P2 (cheat: Infinite Energy)",    expectedRange: [0, 255] },
  lives_p2:       { abs: 0xFFB497, rel: 0xB497, desc: "Lives P2 (cheat: Infinite Lives)",      expectedRange: [0, 9] },
  charId_p2_a:    { abs: 0xFFB3F7, rel: 0xB3F7, desc: "Char ID P2 (cheat: Select Char P2 a)",  expectedRange: [0, 3] },
  charId_p2_b:    { abs: 0xFF8646, rel: 0x8646, desc: "Char ID P2 (cheat: Select Char P2 b)",  expectedRange: [0, 3] },

  // System
  timer:          { abs: 0xFF84E9, rel: 0x84E9, desc: "Timer (cheat: Infinite Time)",          expectedRange: [0, 255] },
  stage:          { abs: 0xFF84D9, rel: 0x84D9, desc: "Stage/Episode (cheat: Select Episode)", expectedRange: [0, 7] },
  charSelectTime: { abs: 0xFF8635, rel: 0x8635, desc: "Char Select Timer",                     expectedRange: [0, 255] },

  // Enemy health (bosses) — for reference
  boss_hogg_1:    { abs: 0xFFD3E0, rel: 0xD3E0, desc: "Boss Hogg HP byte 0",                  expectedRange: [0, 255] },
  boss_hogg_2:    { abs: 0xFFD3E1, rel: 0xD3E1, desc: "Boss Hogg HP byte 1",                  expectedRange: [0, 255] },
};

// ── Character ID mapping (from cheat file) ──────────────────────────────────
// 0xFFB277 (P1): 0x00=Jack, 0x02=Hannah, 0x01=Mustapha, 0x03=Mess
// 0xFF863A (P1): 0x00=Jack, 0x01=Hannah, 0x02=Mustapha, 0x03=Mess
const CHAR_NAMES = { 0x00: "Jack", 0x01: "Mustapha", 0x02: "Hannah", 0x03: "Mess" };
// Note: 0xFFB277 has non-standard ordering (Hannah=2, Mustapha=1)
//       0xFF863A has standard ordering (Hannah=1, Mustapha=2)

// ── Utility ──────────────────────────────────────────────────────────────────

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

function hexToInt(hex) {
  if (!hex || hex === "-1") return null;
  return parseInt(hex, 16);
}

function hexToBytes(hex) {
  if (!hex || hex === "-1") return null;
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16));
  }
  return bytes;
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log("=".repeat(72));
console.log("Cadillacs & Dinosaurs — FBNeo Cheat Address Verification");
console.log("=".repeat(72));
console.log(`Duration: ${DURATION_S}s | Poll interval: ${POLL_MS}ms`);
console.log("");

const sock = createSocket("udp4");
sock.bind(PORT + 100); // bind to different port to avoid conflicts

const startTime = Date.now();
const history = {}; // key → { samples: [{absVal, relVal}], ... }

// Initialize history
for (const key of Object.keys(CHEAT_ADDRESSES)) {
  history[key] = { abs: [], rel: [] };
}

let sampleCount = 0;

try {
  while ((Date.now() - startTime) / 1000 < DURATION_S) {
    sampleCount++;
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    for (const [key, addr] of Object.entries(CHEAT_ADDRESSES)) {
      // Read both absolute and relative addresses
      const [absHex, relHex] = await Promise.all([
        readRam(sock, addr.abs, 1),
        readRam(sock, addr.rel, 1),
      ]);

      const absVal = hexToInt(absHex);
      const relVal = hexToInt(relHex);

      history[key].abs.push({ t: elapsed, val: absVal });
      history[key].rel.push({ t: elapsed, val: relVal });
    }

    // Progress
    if (sampleCount % 5 === 0) {
      process.stdout.write(`\rSample ${sampleCount} (${elapsed}s/${DURATION_S}s)...`);
    }

    await sleep(POLL_MS);
  }

  console.log(`\nDone. ${sampleCount} samples collected.\n`);

  // ── Analysis ───────────────────────────────────────────────────────────────

  // First: determine address mapping (absolute vs relative)
  console.log("─── Address Mapping Detection ───");
  console.log("We need to determine if FBNeo uses absolute (0xFFxxxx) or relative (0xxxx) addressing.");
  console.log("The correct mapping will show values in the expected range, the wrong one will show -1 or garbage.");
  console.log("");

  // Check lives as a reliable indicator — should be 0-3 during gameplay
  const livesKey = "lives_p1";
  const absLivesValues = history[livesKey].abs.map(s => s.val).filter(v => v !== null);
  const relLivesValues = history[livesKey].rel.map(s => s.val).filter(v => v !== null);

  console.log(`Lives P1 (should be 0-3 during gameplay):`);
  console.log(`  Absolute (0xFFB317): values=${JSON.stringify(absLivesValues.slice(0, 20))} unique=${[...new Set(absLivesValues)]}`);
  console.log(`  Relative (0xB317):   values=${JSON.stringify(relLivesValues.slice(0, 20))} unique=${[...new Set(relLivesValues)]}`);

  // Check health
  const healthKey = "health_p1";
  const absHealthValues = history[healthKey].abs.map(s => s.val).filter(v => v !== null);
  const relHealthValues = history[healthKey].rel.map(s => s.val).filter(v => v !== null);

  console.log(`\nHealth P1 (should be 0-144 during gameplay):`);
  console.log(`  Absolute (0xFFB2E1): values=${JSON.stringify(absHealthValues.slice(0, 20))} unique=${[...new Set(absHealthValues)]}`);
  console.log(`  Relative (0xB2E1):   values=${JSON.stringify(relHealthValues.slice(0, 20))} unique=${[...new Set(relHealthValues)]}`);

  // Determine which mapping works
  const absWorks = absLivesValues.some(v => v >= 0 && v <= 5);
  const relWorks = relLivesValues.some(v => v >= 0 && v <= 5);

  let mappingMode = null;
  if (absWorks && !relWorks) mappingMode = "absolute";
  else if (relWorks && !absWorks) mappingMode = "relative";
  else if (absWorks && relWorks) mappingMode = "both_work";
  else mappingMode = "neither";

  console.log(`\n→ Mapping detection: ${mappingMode}`);
  console.log(`  Absolute works: ${absWorks}, Relative works: ${relWorks}`);

  // Use the working mapping for detailed report
  const useRel = mappingMode === "relative" || mappingMode === "both_work";

  console.log(`\n─── Detailed Report (using ${useRel ? "relative (0x" : "absolute (0xFF"} addressing) ───\n`);

  for (const [key, addr] of Object.entries(CHEAT_ADDRESSES)) {
    const samples = useRel ? history[key].rel : history[key].abs;
    const values = samples.map(s => s.val).filter(v => v !== null);
    if (values.length === 0) {
      console.log(`⚠ ${key}: No valid readings at ${useRel ? "0x" + addr.rel.toString(16) : "0xFF" + addr.abs.toString(16)}`);
      continue;
    }

    const unique = [...new Set(values)].sort((a, b) => a - b);
    const first = values[0];
    const last = values[values.length - 1];
    const changed = first !== last;
    const inRange = unique.every(v => v >= addr.expectedRange[0] && v <= addr.expectedRange[1]);

    const rangeIcon = inRange ? "✅" : "⚠️";
    const changeIcon = changed ? "📊" : "🔒";
    const addrHex = useRel ? "0x" + addr.rel.toString(16).padStart(4, "0") : "0x" + addr.abs.toString(16).padStart(6, "0");

    let charInfo = "";
    if (key.startsWith("charId")) {
      const names = unique.map(v => CHAR_NAMES[v] || `0x${v.toString(16)}`).join(", ");
      charInfo = ` → ${names}`;
    }

    console.log(`${rangeIcon} ${changeIcon} ${addrHex} | ${addr.desc}: first=${first} last=${last} unique=${JSON.stringify(unique)}${charInfo}`);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n─── Summary ───`);
  console.log(`Address mapping: ${mappingMode}`);
  console.log(`Samples: ${sampleCount}`);
  console.log(`Working addresses:`);

  for (const [key, addr] of Object.entries(CHEAT_ADDRESSES)) {
    const samples = useRel ? history[key].rel : history[key].abs;
    const values = samples.map(s => s.val).filter(v => v !== null);
    if (values.length > 0) {
      const unique = [...new Set(values)];
      const addrHex = useRel ? "0x" + addr.rel.toString(16).padStart(4, "0") : "0x" + addr.abs.toString(16).padStart(6, "0");
      console.log(`  ${key}: ${addrHex} → ${JSON.stringify(unique)}`);
    }
  }

} finally {
  sock.close();
  console.log("\nDone.");
}
