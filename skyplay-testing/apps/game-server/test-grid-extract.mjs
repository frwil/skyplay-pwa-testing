// Test extraction of portrait cells with adjusted grid parameters
// Extracts each cell as PPM and reports content stats
import { readFileSync, writeFileSync } from "fs";

const PPM_PATH = "recordings/char-select-full.ppm";
const FULL_W = 1920;
const FULL_H = 1440;

// Test params
const GRID_X = 30;
const GRID_Y = 230;  // shifted down 10px to start where content actually begins
const COLS = 9;
const ROWS = 2;
const CELL_W = 58;   // narrowed from 80
const CELL_H = 110;

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
  return { pixels: raw.subarray(hdrEnd), header: raw.subarray(0, hdrEnd).toString() };
}

const { pixels } = parsePPM(PPM_PATH);

function getPixel(x, y) {
  const off = (y * FULL_W + x) * 3;
  return { r: pixels[off], g: pixels[off + 1], b: pixels[off + 2] };
}

function isGreenish(r, g, b) {
  return g > 60 && g > r * 1.5 && g > b * 2;
}

function isDark(r, g, b) {
  return (r + g + b) / 3 < 40;
}

// Create output dir
import { mkdirSync } from "fs";
mkdirSync("recordings/portrait-debug/test-grid", { recursive: true });

console.log(`Grid: ${GRID_X},${GRID_Y} cells=${CELL_W}x${CELL_H} cols=${COLS} rows=${ROWS}`);
console.log(`Grid span: x=${GRID_X}-${GRID_X + COLS * CELL_W}, y=${GRID_Y}-${GRID_Y + ROWS * CELL_H}`);
console.log("");

for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    const cx = GRID_X + col * CELL_W;
    const cy = GRID_Y + row * CELL_H;
    const charIdx = row * COLS + col;
    const charName = CHAR_NAMES[charIdx] || "?";

    // Compute stats
    let totalR = 0, totalG = 0, totalB = 0;
    let nonGreen = 0, dark = 0, total = 0;

    for (let dy = 0; dy < CELL_H; dy++) {
      for (let dx = 0; dx < CELL_W; dx++) {
        const p = getPixel(cx + dx, cy + dy);
        totalR += p.r; totalG += p.g; totalB += p.b;
        total++;
        if (isDark(p.r, p.g, p.b)) dark++;
        else if (!isGreenish(p.r, p.g, p.b)) nonGreen++;
      }
    }

    const meanR = (totalR / total).toFixed(1);
    const meanG = (totalG / total).toFixed(1);
    const meanB = (totalB / total).toFixed(1);
    const contentPct = ((nonGreen / total) * 100).toFixed(1);
    const darkPct = ((dark / total) * 100).toFixed(1);
    const hasContent = nonGreen > total * 0.03 ? "✅" : "❌";

    // Extract cell as PPM
    const ppmData = Buffer.alloc(CELL_W * CELL_H * 3);
    for (let dy = 0; dy < CELL_H; dy++) {
      for (let dx = 0; dx < CELL_W; dx++) {
        const srcOff = ((cy + dy) * FULL_W + (cx + dx)) * 3;
        const dstOff = (dy * CELL_W + dx) * 3;
        ppmData[dstOff] = pixels[srcOff];
        ppmData[dstOff + 1] = pixels[srcOff + 1];
        ppmData[dstOff + 2] = pixels[srcOff + 2];
      }
    }
    const header = `P6\n${CELL_W} ${CELL_H}\n255\n`;
    const outPath = `recordings/portrait-debug/test-grid/cell-r${row}c${col}.ppm`;
    writeFileSync(outPath, Buffer.concat([Buffer.from(header), ppmData]));

    // Sample center pixel
    const cp = getPixel(cx + Math.floor(CELL_W/2), cy + Math.floor(CELL_H/2));

    console.log(`r${row}c${col} ${charName.padEnd(10)} mean=(${meanR.padStart(5)},${meanG.padStart(5)},${meanB.padStart(5)}) content=${contentPct.padStart(5)}% dark=${darkPct.padStart(5)}% center=(${String(cp.r).padStart(3)},${String(cp.g).padStart(3)},${String(cp.b).padStart(3)}) ${hasContent}`);
  }
}

// Also extract a full grid area PNG for visual check using ImageMagick
import { spawnSync } from "child_process";
const gridW = COLS * CELL_W;
const gridH = ROWS * CELL_H;
spawnSync("convert", [
  "recordings/char-select-full.ppm",
  "-crop", `${gridW}x${gridH}+${GRID_X}+${GRID_Y}`,
  "recordings/portrait-debug/test-grid/grid-full.png",
], { stdio: "inherit" });
console.log("\nExtracted grid-full.png");
