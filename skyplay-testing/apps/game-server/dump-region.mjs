// Dump a raw region across all captures to read the structure by eye.
import { readFileSync } from "fs";
const load = (l) => { try { return readFileSync(`/tmp/ram-${l}.bin`); } catch { return null; } };
const labels = ["order1a", "order1b", "order1ca", "order1cb", "order2a", "order2b"];
const bufs = labels.map(load);
const base = parseInt(process.argv[2] || "17c0", 16);
const len = parseInt(process.argv[3] || "30", 16);
const hx = (v) => v === undefined ? "??" : v.toString(16).padStart(2, "0");
// address ruler
let ruler = "        ";
for (let i = 0; i < len; i++) ruler += (base + i).toString(16).slice(-2) + " ";
console.log(ruler.trimEnd());
labels.forEach((l, idx) => {
  const b = bufs[idx];
  if (!b) { console.log(`${l.padEnd(8)}: (missing)`); return; }
  let row = "";
  for (let i = 0; i < len; i++) row += hx(b[base + i]) + " ";
  console.log(`${l.padEnd(8)}: ${row.trimEnd()}`);
});
