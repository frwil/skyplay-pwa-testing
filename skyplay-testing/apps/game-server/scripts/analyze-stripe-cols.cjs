// Analyze a raw 768x48 RGB24 stripe capture: per-column health-pixel counts.
// Usage: node scripts/analyze-stripe-cols.cjs recordings/stripe-r2-early.rgb
const fs = require("fs");

const W = 768, H = 48, BAR_ROWS = 24;
const file = process.argv[2];
const buf = fs.readFileSync(file);

function isHealthPixel(r, g, b) {
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  return (maxC - minC) > 30 && maxC > 120 && !(b >= r && b >= g);
}

function colCount(x) {
  let n = 0;
  for (let y = 0; y < BAR_ROWS; y++) {
    const i = (y * W + x) * 3;
    if (isHealthPixel(buf[i], buf[i + 1], buf[i + 2])) n++;
  }
  return n;
}

const MIN_COL = Math.ceil(BAR_ROWS * 0.33); // 8

for (const [name, x0, x1] of [["P1", 70, 310], ["P2", 450, 768]]) {
  let filled = 0, first = -1, last = -1;
  const segments = [];
  let segStart = -1;
  for (let x = x0; x < x1; x++) {
    const pass = colCount(x) >= MIN_COL;
    if (pass) {
      filled++;
      if (first < 0) first = x;
      last = x;
      if (segStart < 0) segStart = x;
    } else if (segStart >= 0) {
      segments.push([segStart, x - 1]);
      segStart = -1;
    }
  }
  if (segStart >= 0) segments.push([segStart, x1 - 1]);
  console.log(`${name}: filled=${filled}/${x1 - x0} span=[${first}..${last}] (${last - first + 1} wide)`);
  console.log(`  segments: ${segments.map(([a, b]) => `${a}-${b}(${b - a + 1})`).join(" ")}`);
  // Row profile across the passing span — which rows hold the bar
  if (first >= 0) {
    const rowHits = new Array(BAR_ROWS).fill(0);
    for (let x = first; x <= last; x++) {
      for (let y = 0; y < BAR_ROWS; y++) {
        const i = (y * W + x) * 3;
        if (isHealthPixel(buf[i], buf[i + 1], buf[i + 2])) rowHits[y]++;
      }
    }
    console.log(`  row profile: ${rowHits.map((n, y) => `${y}:${n}`).join(" ")}`);
  }
}
