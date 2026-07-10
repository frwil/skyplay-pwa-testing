// Locate the pick-order storage by searching for the KNOWN order as a byte triple.
// P2 Run-1 order (A): Yuri(08) Kyo(00) Benimaru(01)  -> [08,00,01]
// P2 Run-2 order (B): Benimaru(01) Yuri(08) Kyo(00)  -> [01,08,00]
// A byte-triple at (i, i+k, i+2k) that holds A-order in every A capture AND B-order in
// every B capture is the pick-order buffer. Control (order1c) must match the A-order too.
import { readFileSync } from "fs";
const load = (l) => readFileSync(`/tmp/ram-${l}.bin`);
const A = ["order1a", "order1b"].map(load);
const B = ["order2a", "order2b"].map(load);
const C = ["order1ca", "order1cb"].map(load);       // same-order control
const ORDER_A = [0x08, 0x00, 0x01];
const ORDER_B = [0x01, 0x08, 0x00];
const N = Math.min(...[...A, ...B, ...C].map((b) => b.length));
const allEq = (group, i, v) => group.every((buf) => buf[i] === v);
const tripleEq = (group, i, k, ord) => allEq(group, i, ord[0]) && allEq(group, i + k, ord[1]) && allEq(group, i + 2 * k, ord[2]);
const hx = (v) => v.toString(16).padStart(2, "0");

console.log("# scanning for pick-order triple (A=[08,00,01], B=[01,08,00]) strides 1..8");
let hits = [];
for (let k = 1; k <= 8; k++) {
  for (let i = 0; i + 2 * k < N; i++) {
    if (tripleEq(A, i, k, ORDER_A) && tripleEq(B, i, k, ORDER_B)) {
      const ctrlMatch = tripleEq(C, i, k, ORDER_A); // control should look like order A
      hits.push({ i, k, ctrlMatch });
    }
  }
}
console.log(`# triple hits: ${hits.length}`);
for (const h of hits) {
  console.log(`  base=0x${h.i.toString(16).toUpperCase()} stride=${h.k} ctrlMatchesA=${h.ctrlMatch}  ` +
    `A=[${hx(A[0][h.i])},${hx(A[0][h.i + h.k])},${hx(A[0][h.i + 2 * h.k])}] ` +
    `B=[${hx(B[0][h.i])},${hx(B[0][h.i + h.k])},${hx(B[0][h.i + 2 * h.k])}] ` +
    `C=[${hx(C[0][h.i])},${hx(C[0][h.i + h.k])},${hx(C[0][h.i + 2 * h.k])}]`);
}
// Also: reverse relationship — maybe order stored high->low or as indices. Show plain
// scan for A-order only (any location holding 08,00,01 stable in A) to eyeball structure.
console.log(`\n# (context) stride-1 locations holding A-order [08,00,01] stable across A:`);
let ctx = [];
for (let i = 0; i + 2 < N; i++) if (tripleEq(A, i, 1, ORDER_A)) ctx.push(i);
console.log(`  count=${ctx.length}: ${ctx.slice(0, 40).map((x) => "0x" + x.toString(16)).join(" ")}`);
