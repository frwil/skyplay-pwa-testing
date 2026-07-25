// Quick PPM stripe analyzer — run with: node analyze-stripe.mjs
import { readFileSync } from 'fs';

const ppm = readFileSync('recordings/calibration/debug-stripe-combat.ppm');
// Parse PPM header
let offset = 0;
const lines = [];
while (lines.length < 3) {
  const nl = ppm.indexOf(10, offset);
  const line = ppm.slice(offset, nl).toString().trim();
  offset = nl + 1;
  if (line && !line.startsWith('#')) lines.push(line);
}
const [fmt, dims, maxVal] = lines;
const [width, height] = dims.split(' ').map(Number);
const raw = ppm.slice(offset);

console.log(`Stripe: ${width}x${height}, fmt=${fmt}, max=${maxVal}`);

const p1_start = 44, p1_end = 348;
const p2_start = 420, p2_end = 724;

function isHealth(r, g, b) {
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  return (maxC - minC) > 30 && maxC > 120 && !(b >= r && b >= g);
}

function getPixel(x, y) {
  const idx = (y * width + x) * 3;
  return [raw[idx], raw[idx+1], raw[idx+2]];
}

// ── Full Y-range scan: find where each bar lives ──
for (const [label, startX, endX] of [['P1', p1_start, p1_end], ['P2', p2_start, p2_end]]) {
  const regionW = endX - startX;
  console.log(`\n=== ${label}: region ${startX}-${endX} (${regionW}px) — FULL Y SCAN ===`);

  // Per-row health pixel count across the bar region
  console.log(`  Health pixels per row (across full ${regionW}px bar region):`);
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < regionW; x++) {
      const [r, g, b] = getPixel(startX + x, y);
      if (isHealth(r, g, b)) count++;
    }
    if (count > 0) {
      const bar = '█'.repeat(Math.min(60, Math.floor(count / (regionW / 60))));
      console.log(`    y=${String(y).padStart(2)}: ${String(count).padStart(4)} health pixels ${bar}`);
    }
  }

  // Also show total filled columns for the configured bar rows (barRowStart=24, barRowH=28)
  const barStartY = 24, barRows = 28;
  console.log(`\n  Configured bar rows (y=${barStartY}-${barStartY+barRows-1}):`);
  for (let y = barStartY; y < barStartY + barRows; y++) {
    let count = 0;
    for (let x = 0; x < regionW; x++) {
      const [r, g, b] = getPixel(startX + x, y);
      if (isHealth(r, g, b)) count++;
    }
    const bar = '█'.repeat(Math.min(60, Math.floor(count / (regionW / 60))));
    console.log(`    y=${String(y).padStart(2)}: ${String(count).padStart(4)} health pixels ${bar}`);
  }
}
