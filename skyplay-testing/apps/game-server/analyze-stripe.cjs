// Quick analysis of raw stripe to verify bar colors
const fs = require('fs');
const stripe = fs.readFileSync('C:\\Users\\MOUTEN\\AppData\\Local\\Temp\\claude\\D--Skyplay\\fe0c28ab-9f93-4001-b982-00633cd3a689\\stripe.raw');

// If we need to extract from docker
const raw = fs.readFileSync('/tmp/stripe_raw.rgb24');
const W = 768, H = 52;

function pixel(x, y) {
  const off = (y * W + x) * 3;
  return { r: raw[off], g: raw[off+1], b: raw[off+2] };
}

function isHealthPixel(r, g, b) {
  // From pixel-match-analyzer: saturation > 30, brightness > 120, not blue-dominant
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
  const bright = (r + g + b) / 3;
  return sat > 0.12 && bright > 120 && b < Math.max(r, g) * 0.85;
}

// Scan bar rows (y=24 to 51, which is screen y=134-161)
const barStart = 24, barEnd = 51;
let stats = [];

for (let row = barStart; row <= barEnd; row++) {
  // P1 region: x=44-348
  let p1Filled = 0, p1Total = 0;
  let p1Colors = [];
  for (let x = 44; x < 348; x++) {
    const {r, g, b} = pixel(x, row);
    if (isHealthPixel(r, g, b)) {
      p1Filled++;
      if (p1Colors.length < 5) p1Colors.push(`(${r},${g},${b})`);
    }
    p1Total++;
  }

  // P2 region: x=420-724
  let p2Filled = 0, p2Total = 0;
  let p2Colors = [];
  for (let x = 420; x < 724; x++) {
    const {r, g, b} = pixel(x, row);
    if (isHealthPixel(r, g, b)) {
      p2Filled++;
      if (p2Colors.length < 5) p2Colors.push(`(${r},${g},${b})`);
    }
    p2Total++;
  }
  stats.push({row, p1Filled, p1Total, p1Colors, p2Filled, p2Total, p2Colors});
}

// Print top 5 and summary
console.log('=== BAR ROW ANALYSIS (rows 24-51) ===');
stats.forEach(s => {
  console.log(`row ${s.row}: P1 filled=${s.p1Filled}/${s.p1Total} [${(s.p1Filled/s.p1Total*100).toFixed(0)}%] colors:${JSON.stringify(s.p1Colors)} | P2 filled=${s.p2Filled}/${s.p2Total} [${(s.p2Filled/s.p2Total*100).toFixed(0)}%] colors:${JSON.stringify(s.p2Colors)}`);
});

// Also check rows 0-23 (score region) to compare
console.log('\n=== SCORE ROWS (0-23) for reference ===');
for (let row = 0; row < 24; row++) {
  let p1Filled = 0;
  for (let x = 44; x < 348; x++) {
    const {r, g, b} = pixel(x, row);
    if (isHealthPixel(r, g, b)) p1Filled++;
  }
  let p2Filled = 0;
  for (let x = 420; x < 724; x++) {
    const {r, g, b} = pixel(x, row);
    if (isHealthPixel(r, g, b)) p2Filled++;
  }
  console.log(`row ${row}: P1=${p1Filled}/304 P2=${p2Filled}/304`);
}

console.log('\n=== SAMPLE RAW PIXELS from P1 bar center (row 37, x=100..105) ===');
for (let x = 100; x < 105; x++) {
  for (let row = 30; row < 40; row++) {
    const {r, g, b} = pixel(x, row);
    const isHealth = isHealthPixel(r, g, b) ? '✓' : '✗';
    console.log(`  (${x},${row}) rgb(${r},${g},${b}) ${isHealth}`);
  }
}
