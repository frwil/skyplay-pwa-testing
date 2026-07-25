// analyze-samples.mjs — Check portrait-samples.json for corruption
// Usage: node analyze-samples.mjs

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const samplesPath = join(__dirname, "recordings", "calibration", "portrait-samples.json");
const data = JSON.parse(readFileSync(samplesPath, "utf-8"));

const CORRUPTION_THRESHOLD = 5; // rows with non-zero bits minimum

const perChar = {};
let totalCorrupted = 0;
let totalSamples = 0;

for (const s of data.samples) {
  totalSamples++;
  const nonZeroRows = s.bits.filter(b => b !== 0).length;
  const corrupted = nonZeroRows < CORRUPTION_THRESHOLD;

  if (!perChar[s.charName]) {
    perChar[s.charName] = { total: 0, corrupted: 0, good: 0, samples: [] };
  }
  perChar[s.charName].total++;
  if (corrupted) {
    perChar[s.charName].corrupted++;
    totalCorrupted++;
  } else {
    perChar[s.charName].good++;
  }
  perChar[s.charName].samples.push({ idx: perChar[s.charName].total, nonZeroRows, corrupted });
}

console.log(`=== Portrait Sample Corruption Analysis ===`);
console.log(`Total samples: ${totalSamples} | Corrupted: ${totalCorrupted} | Good: ${totalSamples - totalCorrupted}`);
console.log(`Corruption rate: ${((totalCorrupted / totalSamples) * 100).toFixed(1)}%\n`);

console.log(`Per-character breakdown:`);
console.log(`Char               Total  Good  Corrupt  Rate`);
console.log(`─`.repeat(55));

for (const [name, stats] of Object.entries(perChar)) {
  const rate = ((stats.corrupted / stats.total) * 100).toFixed(0);
  const flag = stats.corrupted > 0 ? " ⚠️" : " ✅";
  console.log(`${name.padEnd(18)} ${String(stats.total).padStart(3)}   ${String(stats.good).padStart(3)}   ${String(stats.corrupted).padStart(5)}   ${rate.padStart(3)}%${flag}`);
}

console.log(`\n=== Recommendations ===`);
if (totalCorrupted > 0) {
  console.log(`⚠️  ${totalCorrupted}/${totalSamples} samples corrupted (Xvfb display issue).`);
  console.log(`   Delete portrait-samples.json and re-collect with clean Xvfb display.`);
  console.log(`   Ensure: docker exec game-server-game-server-1 sh -c "pkill -9 retroarch" before each test.`);
}

const charsBelow3 = Object.entries(perChar).filter(([, s]) => s.good < 3);
if (charsBelow3.length > 0) {
  console.log(`\nChars with <3 good samples (need at least 3 for usable template):`);
  for (const [name, s] of charsBelow3) {
    console.log(`  ${name}: ${s.good} good, ${s.corrupted} corrupted`);
  }
}
