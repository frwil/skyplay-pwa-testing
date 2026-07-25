// Extract individual cells from portrait-capture-live.ppm using the new grid params
import { readFileSync, writeFileSync, mkdirSync } from "fs";

const PPM_PATH = "recordings/portrait-debug/portrait-capture-live.ppm";
const OUT_DIR = "recordings/portrait-debug/live-cells";

const CELL_W = 58;
const CELL_H = 110;
const COLS = 9;
const ROWS = 2;
const GRID_W = CELL_W * COLS; // 522
const GRID_H = CELL_H * ROWS; // 220

const raw = readFileSync(PPM_PATH);
let hdrEnd = 0, newlines = 0;
for (let i = 0; i < Math.min(raw.length, 200); i++) {
  if (raw[i] === 0x0A) { newlines++; if (newlines >= 3) { hdrEnd = i + 1; break; } }
}
const pixels = raw.subarray(hdrEnd);

mkdirSync(OUT_DIR, { recursive: true });

for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    const cx = col * CELL_W;
    const cy = row * CELL_H;
    const cellData = Buffer.alloc(CELL_W * CELL_H * 3);
    for (let dy = 0; dy < CELL_H; dy++) {
      for (let dx = 0; dx < CELL_W; dx++) {
        const srcOff = ((cy + dy) * GRID_W + (cx + dx)) * 3;
        const dstOff = (dy * CELL_W + dx) * 3;
        cellData[dstOff] = pixels[srcOff];
        cellData[dstOff + 1] = pixels[srcOff + 1];
        cellData[dstOff + 2] = pixels[srcOff + 2];
      }
    }
    const header = `P6\n${CELL_W} ${CELL_H}\n255\n`;
    writeFileSync(`${OUT_DIR}/cell-r${row}c${col}.ppm`, Buffer.concat([Buffer.from(header), cellData]));
  }
}
console.log(`Extracted ${ROWS * COLS} cells to ${OUT_DIR}/`);
