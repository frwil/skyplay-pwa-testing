// Isolate the perfect counter by intersecting two matches with the PERFECT at different rounds.
// Match C (pkC_*): P2 sweep, PERFECT at R1  -> counter deltas [+1, 0, 0]
// Match R2 (pk_*): P2 sweep, PERFECT at R2  -> counter deltas [0, +1, 0]
// The true perfect counter ticks +1 exactly on the perfect round in BOTH. Reset-independent
// (uses deltas). Reports addresses matching both patterns; char-block position noted.
import { readFileSync } from "fs";
const load = (l) => readFileSync(`/tmp/ram-${l}.bin`);
const C = ["pkC_0_0", "pkC_1_0", "pkC_2_0", "pkC_final"].map(load);
const R = ["pk_0_0", "pk_1_0", "pk_2_0", "pk_final_3_0"].map(load);
const N = Math.min(...[...C, ...R].map((b) => b.length));
const hx = (v) => v.toString(16).padStart(2, "0");
const dC = (i) => [C[1][i] - C[0][i], C[2][i] - C[1][i], C[3][i] - C[2][i]];
const dR = (i) => [R[1][i] - R[0][i], R[2][i] - R[1][i], R[3][i] - R[2][i]];
const eq = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

// Strict: exactly +1 on the perfect round, 0 otherwise, in BOTH matches.
const strict = [];
// Looser: increments (>=1) on perfect round, no change on the normal rounds, in both.
const loose = [];
for (let i = 0; i < N; i++) {
  const c = dC(i), r = dR(i);
  if (eq(c, [1, 0, 0]) && eq(r, [0, 1, 0])) strict.push(i);
  if (c[0] >= 1 && c[1] === 0 && c[2] === 0 && r[0] === 0 && r[1] >= 1 && r[2] === 0) loose.push(i);
}
console.log(`# STRICT (delta +1 on perfect round only, both matches): ${strict.length}`);
for (const i of strict) console.log(`  0x${i.toString(16).toUpperCase()}: C=[${C.map(b=>hx(b[i])).join(",")}] R=[${R.map(b=>hx(b[i])).join(",")}]`);
console.log(`\n# LOOSE (increments on perfect round, flat on normals): ${loose.length}`);
for (const i of loose.slice(0, 60)) console.log(`  0x${i.toString(16).toUpperCase()}: C=[${C.map(b=>hx(b[i])).join(",")}] R=[${R.map(b=>hx(b[i])).join(",")}]`);
// Reference counters to confirm both matches' round structure.
console.log(`\n# reference (P1lost 0xA859 / P2win 0xA869) — both should be [0,1,2,3]:`);
console.log(`  C 0xA859=[${C.map(b=>b[0xA859]).join(",")}] 0xA869=[${C.map(b=>b[0xA869]).join(",")}]`);
console.log(`  R 0xA859=[${R.map(b=>b[0xA859]).join(",")}] 0xA869=[${R.map(b=>b[0xA869]).join(",")}]`);
