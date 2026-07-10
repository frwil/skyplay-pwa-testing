// Find the KOF98 "perfect" indicator by cross-round signature.
// Args: four capture labels in round order: <combatR1> <combatR2> <combatR3> <final>
//   e.g. node /tmp/perfect-sig.mjs pk_0_0 pk_1_0 pk_2_0 pk_final_3_0
// Ground truth (user): P2 wins R1 PERFECT, R2 normal KO, R3 time-over.
//   -> P2 perfect counter reads [0,1,1,1]; P2 win counter [0,1,2,3]; P1 mirror stays [0,0,0,0].
// We report bytes matching perfect-counter signature, with the P1 mirror (addr-0x200) all-zero
// as a strong filter, plus a few near-miss signatures in case the flag is per-round not cumulative.
import { readFileSync } from "fs";
const labels = process.argv.slice(2, 6);
if (labels.length < 4) { console.error("usage: node perfect-sig.mjs <R1> <R2> <R3> <final>"); process.exit(1); }
const B = labels.map((l) => readFileSync(`/tmp/ram-${l}.bin`));
const N = Math.min(...B.map((b) => b.length));
const hx = (v) => v.toString(16).padStart(2, "0");
const seqAt = (i) => [B[0][i], B[1][i], B[2][i], B[3][i]];
const eq = (a, s) => a[0] === s[0] && a[1] === s[1] && a[2] === s[2] && a[3] === s[3];
const mirrorZero = (i) => i >= 0x200 && B.every((b) => b[i - 0x200] === 0);

const SIGS = {
  "PERFECT counter [0,1,1,1]": [0, 1, 1, 1],
  "per-round flag [0,1,0,0]": [0, 1, 0, 0],
  "latched-till-next [0,1,1,0]": [0, 1, 1, 0],
  "win counter [0,1,2,3] (ref)": [0, 1, 2, 3],
};
for (const [name, sig] of Object.entries(SIGS)) {
  const hits = [];
  for (let i = 0; i < N; i++) if (eq(seqAt(i), sig)) hits.push(i);
  const mirrored = hits.filter(mirrorZero);
  console.log(`\n## ${name}: ${hits.length} hits, ${mirrored.length} with P1-mirror(-0x200)=all-zero`);
  const show = (name.startsWith("PERFECT")) ? hits : mirrored.length ? mirrored : hits;
  for (const i of show.slice(0, 40)) {
    const m = i >= 0x200 ? `  mirror@0x${(i-0x200).toString(16)}=[${B.map(b=>hx(b[i-0x200])).join(",")}]` : "";
    const star = mirrorZero(i) ? " <== mirror-zero" : "";
    console.log(`  0x${i.toString(16).toUpperCase()}: [${seqAt(i).map(hx).join(",")}]${m}${star}`);
  }
}
// Reference: known clean-win counters 0xA856 (P1) / 0xA869 (P2) across the 4 captures.
console.log(`\n## reference counters across captures:`);
for (const [nm, a] of [["P1lost 0xA859", 0xA859], ["P2lost 0xA868", 0xA868], ["P1cleanWin 0xA856", 0xA856], ["P2cleanWin 0xA869", 0xA869]]) {
  console.log(`  ${nm}: [${B.map((b) => b[a]).join(",")}]`);
}
