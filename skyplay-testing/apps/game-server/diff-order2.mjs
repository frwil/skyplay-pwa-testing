// Stronger selection-order isolation using multi-capture stable sets.
// Group A = all captures of order-1 (within-match + cross-match same order).
// Group B = all captures of order-2 (different order, same team).
// Candidate = byte STABLE across every A capture AND STABLE across every B capture,
//             but A-value != B-value. char-ID-valued candidates ranked first.
//
// Usage (inside container):
//   node /tmp/diff-order2.mjs order1a,order1b,order1ca,order1cb order2a,order2b
import { readFileSync } from "fs";
const [aList, bList] = process.argv.slice(2);
if (!aList || !bList) { console.error("usage: node diff-order2.mjs <a1,a2,...> <b1,b2,...>"); process.exit(1); }
const load = (l) => readFileSync(`/tmp/ram-${l}.bin`);
const A = aList.split(",").map(load);
const B = bList.split(",").map(load);
const N = Math.min(...[...A, ...B].map((b) => b.length));
const hx = (v) => v.toString(16).padStart(2, "0");
const stableVal = (group, i) => { const v = group[0][i]; for (let k = 1; k < group.length; k++) if (group[k][i] !== v) return -1; return v; };

let candidates = [];
for (let i = 0; i < N; i++) {
  const va = stableVal(A, i); if (va < 0) continue;
  const vb = stableVal(B, i); if (vb < 0) continue;
  if (va === vb) continue;
  candidates.push({ addr: i, a: va, b: vb, charLike: va <= 0x25 && vb <= 0x25 });
}
const charLike = candidates.filter((c) => c.charLike);
console.log(`# A=[${aList}]  B=[${bList}]`);
console.log(`# stable-both & changed: ${candidates.length}  (char-ID-valued: ${charLike.length})`);
console.log(`\n## char-ID-valued candidates (0x00-0x25) — most likely pick-order:`);
for (const c of charLike) console.log(`  0x${c.addr.toString(16).toUpperCase()}: A=${hx(c.a)} B=${hx(c.b)}`);
console.log(`\n## ALL stable-both changes (${candidates.length}) — first 200:`);
for (const c of candidates.slice(0, 200)) console.log(`  0x${c.addr.toString(16).toUpperCase()}: A=${hx(c.a)} B=${hx(c.b)}${c.charLike ? " <-- charID" : ""}`);
// Sanity dumps of known regions across one A and one B.
const dump = (buf, base, n) => { let s = ""; for (let i = 0; i < n; i++) s += hx(buf[base + i]) + " "; return s.trim(); };
console.log(`\n## region 0xA84E..0xA866 (roster/order area):`);
console.log(`  A(${aList.split(",")[0]}): ${dump(A[0], 0xA84E, 0x1a)}`);
console.log(`  B(${bList.split(",")[0]}): ${dump(B[0], 0xA84E, 0x1a)}`);
