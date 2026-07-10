// Isolate the KOF98 selection-order encoding by controlled RAM diff.
// Method: same P1 team, two different pick orders. Bytes that are STABLE within an
// order (equal across 2 captures of that order) but CHANGE between orders, and whose
// value is a valid char ID (0x00-0x25), are candidates for the pick-order storage.
//
// Usage (inside container, after snapshots exist in /tmp):
//   node /tmp/diff-order.mjs orderA1 orderA2 orderB [orderB2]
// where each arg is the <label> of a /tmp/ram-<label>.bin file.
import { readFileSync } from "fs";

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error("usage: node diff-order.mjs <orderA1> <orderA2> <orderB> [orderB2]");
  process.exit(1);
}
const load = (l) => readFileSync(`/tmp/ram-${l}.bin`);
const [a1, a2, b] = [load(args[0]), load(args[1]), load(args[2])];
const b2 = args[3] ? load(args[3]) : null;
const N = Math.min(a1.length, a2.length, b.length, b2 ? b2.length : Infinity);
const isCharId = (v) => v <= 0x25; // valid KOF98 roster ID range
const hx = (v) => v.toString(16).padStart(2, "0");

// Stable set within order A: bytes unchanged across the two A captures.
// If a second B capture is given, also require B stable across its two captures.
let stable = 0, changed = 0, candidates = [];
for (let i = 0; i < N; i++) {
  const stableA = a1[i] === a2[i];
  if (!stableA) continue;
  stable++;
  const bVal = b[i];
  if (b2 && b2[i] !== bVal) continue; // B not stable here → volatile, skip
  if (bVal === a1[i]) continue;       // unchanged between orders → not order-related
  changed++;
  candidates.push({ addr: i, A: a1[i], B: bVal, both: isCharId(a1[i]) && isCharId(bVal) });
}

console.log(`# stable-in-A bytes: ${stable}  |  changed A→B (stable): ${changed}`);
const charLike = candidates.filter((c) => c.both);
console.log(`\n## candidates whose BOTH values are char IDs (0x00-0x25) — most likely pick-order:`);
for (const c of charLike) {
  console.log(`  0x${c.addr.toString(16).toUpperCase()}: A=${hx(c.A)} B=${hx(c.B)}`);
}
console.log(`\n## all stable A→B changes (${changed}) — first 120:`);
for (const c of candidates.slice(0, 120)) {
  const flag = c.both ? " <-- charID" : "";
  console.log(`  0x${c.addr.toString(16).toUpperCase()}: A=${hx(c.A)} B=${hx(c.B)}${flag}`);
}
// Roster region sanity: dump 0xA84E..0xA862 for all captures.
const dump = (buf, base, n) => { let s = ""; for (let i = 0; i < n; i++) s += hx(buf[base + i]) + " "; return s.trim(); };
console.log(`\n## roster region 0xA84E..0xA862 (should be SAME across orders if set-order is canonical):`);
console.log(`  A1: ${dump(a1, 0xA84E, 0x16)}`);
console.log(`  A2: ${dump(a2, 0xA84E, 0x16)}`);
console.log(`  B : ${dump(b, 0xA84E, 0x16)}`);
