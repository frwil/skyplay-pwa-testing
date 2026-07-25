// Analyze portrait grid boundaries in char-select-full.ppm
// Scans the grid area to find where actual portrait content lives.
import { readFileSync, writeFileSync } from "fs";

const PPM_PATH = "recordings/char-select-full.ppm";
const FULL_W = 1920;
const FULL_H = 1440;

// Current grid config
const GRID_X = 30;
const GRID_Y = 220;
const GRID_COLS = 9;
const GRID_ROWS = 2;
const CELL_W = 80;
const CELL_H = 110;

function parsePPM(filepath) {
  const raw = readFileSync(filepath);
  let hdrEnd = 0, newlines = 0;
  for (let i = 0; i < Math.min(raw.length, 200); i++) {
    if (raw[i] === 0x0A) { newlines++; if (newlines >= 3) { hdrEnd = i + 1; break; } }
  }
  return raw.subarray(hdrEnd);
}

function getPixel(pixels, x, y) {
  const off = (y * FULL_W + x) * 3;
  return { r: pixels[off], g: pixels[off + 1], b: pixels[off + 2] };
}

function isGreenish(r, g, b) {
  // Green grass background: G dominates, low R and B
  return g > 60 && g > r * 1.5 && g > b * 2;
}

function isDark(r, g, b) {
  return (r + g + b) / 3 < 40;
}

// Load pixels
console.log("Loading PPM...");
const pixels = parsePPM(PPM_PATH);
console.log(`Loaded ${pixels.length} bytes (${FULL_W}x${FULL_H})`);

// ============================================
// 1. Horizontal scan: find portrait content boundaries
// ============================================
console.log("\n=== Horizontal scan (column by column) ===");
console.log("Scanning grid area: x=" + GRID_X + " to " + (GRID_X + GRID_COLS * CELL_W) + ", y=" + GRID_Y + " to " + (GRID_Y + GRID_ROWS * CELL_H));
console.log("");

// For each column in the grid, count non-green, non-black pixels
for (let col = 0; col < GRID_COLS * CELL_W; col += 4) {
  const x = GRID_X + col;
  let nonBg = 0, total = 0, dark = 0;
  for (let y = GRID_Y; y < GRID_Y + GRID_ROWS * CELL_H; y++) {
    const p = getPixel(pixels, x, y);
    total++;
    if (isDark(p.r, p.g, p.b)) dark++;
    else if (!isGreenish(p.r, p.g, p.b)) nonBg++;
  }
  const pct = ((nonBg / total) * 100).toFixed(1);
  const cellIdx = Math.floor(col / CELL_W);
  const cellLabel = cellIdx < GRID_COLS ? `[col ${cellIdx}]` : "[past grid]";
  const bar = "#".repeat(Math.round(nonBg / 5));
  console.log(`x=${String(x).padStart(4)} col${String(col).padStart(3)} ${cellLabel} non-green: ${String(nonBg).padStart(4)}/${total} (${String(pct).padStart(5)}%) dark:${String(dark).padStart(3)} ${bar}`);
}

// ============================================
// 2. Per-cell analysis: mean brightness and content ratio
// ============================================
console.log("\n=== Per-cell analysis ===");
for (let row = 0; row < GRID_ROWS; row++) {
  for (let col = 0; col < GRID_COLS; col++) {
    const cx = GRID_X + col * CELL_W;
    const cy = GRID_Y + row * CELL_H;
    let totalR = 0, totalG = 0, totalB = 0;
    let nonGreen = 0, dark = 0, total = 0;
    for (let dy = 0; dy < CELL_H; dy++) {
      for (let dx = 0; dx < CELL_W; dx++) {
        const p = getPixel(pixels, cx + dx, cy + dy);
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
    console.log(`r${row}c${col} mean=(${meanR},${meanG},${meanB}) content=${contentPct}% dark=${darkPct}% ${hasContent}`);
  }
}

// ============================================
// 3. Vertical scan: find where portrait rows start/end
// ============================================
console.log("\n=== Vertical scan (row by row) ===");
for (let rowY = GRID_Y - 30; rowY < GRID_Y + GRID_ROWS * CELL_H + 30; rowY += 2) {
  let nonGreen = 0, total = 0;
  for (let x = GRID_X; x < GRID_X + GRID_COLS * CELL_W; x++) {
    const p = getPixel(pixels, x, rowY);
    total++;
    if (!isGreenish(p.r, p.g, p.b) && !isDark(p.r, p.g, p.b)) nonGreen++;
  }
  const bar = "#".repeat(Math.round(nonGreen / 20));
  console.log(`y=${String(rowY).padStart(4)} non-green: ${String(nonGreen).padStart(4)}/${total} ${bar}`);
}

// ============================================
// 4. Find actual portrait grid: search for content clusters
// ============================================
console.log("\n=== Content density per 20px horizontal slice ===");
for (let sliceStart = GRID_X; sliceStart < GRID_X + GRID_COLS * CELL_W + 100; sliceStart += 20) {
  let nonGreen = 0, total = 0;
  for (let y = GRID_Y; y < GRID_Y + GRID_ROWS * CELL_H; y++) {
    for (let x = sliceStart; x < Math.min(sliceStart + 20, GRID_X + GRID_COLS * CELL_W + 100); x++) {
      const p = getPixel(pixels, x, y);
      total++;
      if (!isGreenish(p.r, p.g, p.b) && !isDark(p.r, p.g, p.b)) nonGreen++;
    }
  }
  const pct = ((nonGreen / Math.max(1, total)) * 100).toFixed(1);
  const bar = "#".repeat(Math.round(nonGreen / 50));
  console.log(`x=${String(sliceStart).padStart(4)}-${String(sliceStart + 19).padStart(4)} content=${String(pct).padStart(5)}% ${bar}`);
}

// ============================================
// 5. Spot-check: sample actual pixel colors at grid cell centers
// ============================================
console.log("\n=== Cell center samples ===");
for (let row = 0; row < GRID_ROWS; row++) {
  for (let col = 0; col < GRID_COLS; col++) {
    const cx = GRID_X + col * CELL_W + CELL_W / 2;
    const cy = GRID_Y + row * CELL_H + CELL_H / 2;
    const p = getPixel(pixels, cx, cy);
    const isG = isGreenish(p.r, p.g, p.b);
    console.log(`r${row}c${col} center(${cx},${cy}): (${p.r},${p.g},${p.b}) ${isG ? "🟢 GREEN" : "🟠 SKIN/CONTENT"}`);
  }
}

// ============================================
// 6. Enlarged search: scan wider area to find where portraits actually are
// ============================================
console.log("\n=== Wider search (x=10 to 900, y=180 to 480) ===");
console.log("Looking for portrait content boundaries...");

// Find left edge: first x where non-green > 5% consistently
let leftEdge = -1;
for (let x = 10; x < 900; x += 2) {
  let nonGreen = 0, total = 0;
  for (let y = 200; y < 460; y++) {
    const p = getPixel(pixels, x, y);
    total++;
    if (!isGreenish(p.r, p.g, p.b) && !isDark(p.r, p.g, p.b)) nonGreen++;
  }
  if (nonGreen / total > 0.05 && leftEdge < 0) {
    leftEdge = x;
    console.log(`Left edge found at x=${x} (${(nonGreen/total*100).toFixed(1)}% non-green)`);
    break;
  }
}

// Find right edge: last x where non-green > 5%
let rightEdge = -1;
for (let x = 900; x >= 10; x -= 2) {
  let nonGreen = 0, total = 0;
  for (let y = 200; y < 460; y++) {
    const p = getPixel(pixels, x, y);
    total++;
    if (!isGreenish(p.r, p.g, p.b) && !isDark(p.r, p.g, p.b)) nonGreen++;
  }
  if (nonGreen / total > 0.05 && rightEdge < 0) {
    rightEdge = x;
    console.log(`Right edge found at x=${x} (${(nonGreen/total*100).toFixed(1)}% non-green)`);
    break;
  }
}

// Find top edge
let topEdge = -1;
for (let y = 180; y < 480; y += 2) {
  let nonGreen = 0, total = 0;
  for (let x = leftEdge > 0 ? leftEdge : 10; x < (rightEdge > 0 ? rightEdge : 900); x++) {
    const p = getPixel(pixels, x, y);
    total++;
    if (!isGreenish(p.r, p.g, p.b) && !isDark(p.r, p.g, p.b)) nonGreen++;
  }
  if (nonGreen / total > 0.05 && topEdge < 0) {
    topEdge = y;
    console.log(`Top edge found at y=${y} (${(nonGreen/total*100).toFixed(1)}% non-green)`);
    break;
  }
}

// Find bottom edge
let bottomEdge = -1;
for (let y = 480; y >= 180; y -= 2) {
  let nonGreen = 0, total = 0;
  for (let x = leftEdge > 0 ? leftEdge : 10; x < (rightEdge > 0 ? rightEdge : 900); x++) {
    const p = getPixel(pixels, x, y);
    total++;
    if (!isGreenish(p.r, p.g, p.b) && !isDark(p.r, p.g, p.b)) nonGreen++;
  }
  if (nonGreen / total > 0.05 && bottomEdge < 0) {
    bottomEdge = y;
    console.log(`Bottom edge found at y=${y} (${(nonGreen/total*100).toFixed(1)}% non-green)`);
    break;
  }
}

if (leftEdge > 0 && rightEdge > 0) {
  const portraitW = rightEdge - leftEdge + 1;
  console.log(`\nPortrait area width: ${portraitW}px (x: ${leftEdge}-${rightEdge})`);
  console.log(`If 9 portraits across: ${(portraitW / 9).toFixed(1)}px each`);
  console.log(`If 18 portraits (9x2): cell width = ${(portraitW / 9).toFixed(1)}px`);
}

if (topEdge > 0 && bottomEdge > 0) {
  const portraitH = bottomEdge - topEdge + 1;
  console.log(`Portrait area height: ${portraitH}px (y: ${topEdge}-${bottomEdge})`);
  console.log(`If 2 rows: ${(portraitH / 2).toFixed(1)}px each`);
}
