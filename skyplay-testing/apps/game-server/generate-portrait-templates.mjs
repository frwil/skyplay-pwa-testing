// Generate portrait templates from 24×24 PPM cell files
// Usage: node generate-portrait-templates.mjs
import { readFileSync } from "fs";
import { join } from "path";

const PORTRAIT_W = 24;
const PORTRAIT_H = 24;
const THRESHOLD = 128;
const COLS = 9;
const ROWS = 2;

const CHAR_NAMES = [
  "Ryu", "Ken", "Chun-Li", "Adon", "Guy", "Akuma", "Charlie", "Sodom", "Rose",
  "Birdie", "Sagat", "M.Bison", "Dan", "Dhalsim", "Gen", "Sakura", "Rolento", "Zangief",
];

function parsePPM(filepath) {
  const raw = readFileSync(filepath);
  let hdrEnd = 0, newlines = 0;
  for (let i = 0; i < Math.min(raw.length, 200); i++) {
    if (raw[i] === 0x0A) { newlines++; if (newlines >= 3) { hdrEnd = i + 1; break; } }
  }
  if (hdrEnd === 0) throw new Error(`Invalid PPM: ${filepath}`);
  const pixels = raw.subarray(hdrEnd);
  const gray = new Uint8Array(PORTRAIT_W * PORTRAIT_H);
  for (let i = 0; i < PORTRAIT_W * PORTRAIT_H; i++) {
    const r = pixels[i * 3], g = pixels[i * 3 + 1], b = pixels[i * 3 + 2];
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return gray;
}

function grayToTemplate(gray) {
  const rows = [];
  for (let y = 0; y < PORTRAIT_H; y++) {
    let rowVal = 0;
    for (let x = 0; x < PORTRAIT_W; x++) {
      if (gray[y * PORTRAIT_W + x] < THRESHOLD) rowVal |= (1 << (PORTRAIT_W - 1 - x));
    }
    rows.push(rowVal);
  }
  return rows;
}

const dir = process.argv[2] || "/recordings/portrait-debug";

console.log("// Auto-generated SFA2 portrait templates (threshold=" + THRESHOLD + ")");
console.log("");
const allTemplates = [];
for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    const filepath = join(dir, `cell-r${row}c${col}.ppm`);
    const charIdx = row * COLS + col;
    const charName = CHAR_NAMES[charIdx] || `?`;
    try {
      const gray = parsePPM(filepath);
      const t = grayToTemplate(gray);
      allTemplates.push(t);
      const bits = t.reduce((s, r) => s + r.toString(2).replace(/0/g, "").length, 0);
      console.log(`// ${charName} (${row},${col}) — ${bits}/${PORTRAIT_W * PORTRAIT_H} dark pixels`);
    } catch (e) {
      console.log(`// ${charName} (${row},${col}) — ERROR: ${e.message}`);
      allTemplates.push(Array(PORTRAIT_H).fill(0));
    }
  }
}
console.log("");
console.log("templates: [");
for (let i = 0; i < allTemplates.length; i++) {
  const t = allTemplates[i];
  const rows = t.map((r, j) => {
    const bin = r.toString(2).padStart(PORTRAIT_W, "0");
    return `0b${bin}${j < t.length - 1 ? "," : ""}`;
  });
  console.log(`  // ${CHAR_NAMES[i]}`);
  console.log(`  [${rows.join("")}],`);
}
console.log("],");
