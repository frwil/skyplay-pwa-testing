// calibrate-score.cjs — Auto-calibrate score digit positions & templates
// Uses sharp (pure Node.js) — no ImageMagick dependency.
//
// Usage:
//   node calibrate-score.cjs analyze <frame.png>     — scan top area for bright clusters
//   node calibrate-score.cjs detail <frame.png> <x> <y> <w> <h>  — detailed pixel dump
//   node calibrate-score.cjs search <frame.png>      — brute-force search for score digits
//   node calibrate-score.cjs calibrate <frame.png> <knownScore>  — auto-calibrate templates
//   node calibrate-score.cjs ocr <frame.png> <x> <y> <dw> <dh> <digits> — try OCR
//
// Frame is 1152×672 RGB (CPS1 at 3× upscale from 384×224).

const sharp = require('sharp');
const fs = require('fs');

// ── Helpers ────────────────────────────────────────────────────────────

function getPixel(data, w, x, y) {
  if (x < 0 || x >= w || y < 0) return null;
  const off = (y * w + x) * 3;
  return { r: data[off], g: data[off + 1], b: data[off + 2] };
}

function isBright(p, threshold = 400) {
  return (p.r + p.g + p.b) > threshold;
}

function isWhite(p) {
  return p.r > 180 && p.g > 180 && p.b > 180;
}

async function loadFrame(path) {
  const img = sharp(path);
  const meta = await img.metadata();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  console.log(`Frame: ${info.width}×${info.height}, ${info.channels} channels, ${data.length} bytes`);
  return { data, w: info.width, h: info.height };
}

// ── 5×7 grid digit vector extraction ──────────────────────────────────

function extractDigitVector(data, w, cellX, cellY, cellW, cellH, brightThreshold = 140) {
  if (cellX < 0 || cellX + cellW > w) return null;

  const GRID_COLS = 5;
  const GRID_ROWS = 7;
  const cellColW = Math.max(1, Math.floor(cellW / GRID_COLS));
  const cellRowH = Math.max(1, Math.floor(cellH / GRID_ROWS));
  const minDensity = 0.35;

  const vector = [];
  for (let gr = 0; gr < GRID_ROWS; gr++) {
    for (let gc = 0; gc < GRID_COLS; gc++) {
      let bright = 0;
      let total = 0;
      const sx = cellX + gc * cellColW;
      const sy = cellY + gr * cellRowH;
      const ex = Math.min(sx + cellColW, cellX + cellW);
      const ey = Math.min(sy + cellRowH, cellY + cellH);

      for (let py = sy; py < ey; py++) {
        for (let px = sx; px < ex; px++) {
          const p = getPixel(data, w, px, py);
          if (!p) continue;
          if (p.r > brightThreshold && p.g > brightThreshold && p.b > brightThreshold) bright++;
          total++;
        }
      }
      vector.push(total > 0 && bright / total > minDensity ? 1 : 0);
    }
  }
  return vector;
}

function hammingDistance(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

function classifyDigit(vector, refs) {
  let bestDigit = -1;
  let bestDist = Infinity;
  for (let d = 0; d < refs.length; d++) {
    if (refs[d].length !== vector.length) continue;
    const dist = hammingDistance(vector, refs[d]);
    if (dist < bestDist) { bestDist = dist; bestDigit = d; }
  }
  return { digit: bestDigit, dist: bestDist };
}

// Generic reference vectors (used as fallback)
const GENERIC_REFS = [
  [1,1,1,1,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,1,1,1,1], // 0
  [0,0,1,0,0, 0,1,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 1,1,1,1,1], // 1
  [1,1,1,1,1, 0,0,0,0,1, 0,0,0,0,1, 1,1,1,1,1, 1,0,0,0,0, 1,0,0,0,0, 1,1,1,1,1], // 2
  [1,1,1,1,1, 0,0,0,0,1, 0,0,0,0,1, 1,1,1,1,1, 0,0,0,0,1, 0,0,0,0,1, 1,1,1,1,1], // 3
  [1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,1,1,1,1, 0,0,0,0,1, 0,0,0,0,1, 0,0,0,0,1], // 4
  [1,1,1,1,1, 1,0,0,0,0, 1,0,0,0,0, 1,1,1,1,1, 0,0,0,0,1, 0,0,0,0,1, 1,1,1,1,1], // 5
  [1,1,1,1,1, 1,0,0,0,0, 1,0,0,0,0, 1,1,1,1,1, 1,0,0,0,1, 1,0,0,0,1, 1,1,1,1,1], // 6
  [1,1,1,1,1, 0,0,0,0,1, 0,0,0,1,0, 0,0,1,0,0, 0,1,0,0,0, 1,0,0,0,0, 1,0,0,0,0], // 7
  [1,1,1,1,1, 1,0,0,0,1, 1,0,0,0,1, 1,1,1,1,1, 1,0,0,0,1, 1,0,0,0,1, 1,1,1,1,1], // 8
  [1,1,1,1,1, 1,0,0,0,1, 1,0,0,0,1, 1,1,1,1,1, 0,0,0,0,1, 0,0,0,0,1, 0,0,0,0,1], // 9
];

// ── Commands ───────────────────────────────────────────────────────────

// analyze: scan top area for bright clusters
async function analyze(path) {
  const { data, w } = await loadFrame(path);

  console.log('\n=== Bright clusters at y=0-30 (threshold 300) ===');
  for (let y = 0; y < 30; y++) {
    const runs = [];
    let runStart = -1;
    for (let x = 0; x < w; x++) {
      const p = getPixel(data, w, x, y);
      if (p && isBright(p, 300)) {
        if (runStart < 0) runStart = x;
      } else {
        if (runStart >= 0) {
          if (x - runStart >= 3) runs.push({ x: runStart, w: x - runStart });
          runStart = -1;
        }
      }
    }
    if (runStart >= 0 && w - runStart >= 3) runs.push({ x: runStart, w: w - runStart });
    if (runs.length > 0) {
      console.log(`y=${y}: ${runs.map(r => `[${r.x}-${r.x + r.w}](${r.w}px)`).join(' ')}`);
    }
  }

  console.log('\n=== White clusters at y=0-30 (r,g,b > 180) ===');
  for (let y = 0; y < 30; y++) {
    const runs = [];
    let runStart = -1;
    for (let x = 0; x < w; x++) {
      const p = getPixel(data, w, x, y);
      if (p && isWhite(p)) {
        if (runStart < 0) runStart = x;
      } else {
        if (runStart >= 0) {
          if (x - runStart >= 3) runs.push({ x: runStart, w: x - runStart });
          runStart = -1;
        }
      }
    }
    if (runStart >= 0 && w - runStart >= 3) runs.push({ x: runStart, w: w - runStart });
    if (runs.length > 0) {
      console.log(`y=${y}: ${runs.map(r => `[${r.x}-${r.x + r.w}](${r.w}px)`).join(' ')}`);
    }
  }
}

// detail: dump pixel data for a specific region
async function detail(path, rx, ry, rw, rh) {
  const { data, w } = await loadFrame(path);

  console.log(`Region: x=${rx}, y=${ry}, w=${rw}, h=${rh}`);
  for (let y = ry; y < ry + rh; y++) {
    let row = '';
    for (let x = rx; x < rx + rw; x++) {
      const p = getPixel(data, w, x, y);
      if (!p) { row += '?'; continue; }
      const sum = p.r + p.g + p.b;
      if (p.r > 220 && p.g > 220 && p.b > 220) row += '█';
      else if (p.r > 180 && p.g > 180 && p.b > 180) row += '▓';
      else if (p.r > 140 && p.g > 140 && p.b > 140) row += '▒';
      else if (sum > 600) row += '◆';
      else if (sum > 450) row += '◇';
      else if (sum > 300) row += '·';
      else if (sum > 150) row += '·';
      else row += ' ';
    }
    console.log(`y=${y.toString().padStart(2)}: ${row}`);
  }

  // Position markers
  let markers = '    ';
  for (let x = rx; x < rx + rw; x++) {
    if (x % 10 === 0) markers += '|';
    else if (x % 5 === 0) markers += ':';
    else markers += ' ';
  }
  console.log(markers);
  console.log('    | every 10px, : every 5px');
}

// search: brute-force scan for digit positions that produce a valid-looking score
async function search(path) {
  const { data, w } = await loadFrame(path);

  console.log('Brute-force search for score digit positions...');
  console.log('Scanning: x=100-500, y=0-15, dW=6-12, dH=10-18, count=4 (right-aligned, no leading zeros)');
  console.log('Using generic refs + lower brightness threshold (140)');

  let best = null;
  let bestTotal = Infinity;

  for (let y = 0; y <= 15; y++) {
    for (let x = 100; x <= 500; x++) {
      for (let dW = 6; dW <= 12; dW++) {
        for (let dH = 10; dH <= 18; dH++) {
          if (x + 4 * dW > w) continue;

          let score = 0;
          let totalDist = 0;
          let ok = true;

          for (let d = 0; d < 4; d++) {
            const vec = extractDigitVector(data, w, x + d * dW, y, dW, dH, 140);
            if (!vec) { ok = false; break; }

            const result = classifyDigit(vec, GENERIC_REFS);
            if (result.dist > 13) { ok = false; break; }

            score = score * 10 + result.digit;
            totalDist += result.dist;
          }

          if (ok && score >= 100 && totalDist < bestTotal) {
            bestTotal = totalDist;
            best = { x, y, dW, dH, score, totalDist };
          }
        }
      }
    }
  }

  if (best) {
    console.log(`\nBest match: score=${best.score} dist=${best.totalDist} at x=${best.x} y=${best.y} dW=${best.dW} dH=${best.dH}`);
    // Show digit breakdown
    console.log('\nDigit vectors:');
    for (let d = 0; d < 4; d++) {
      const vec = extractDigitVector(data, w, best.x + d * best.dW, best.y, best.dW, best.dH, 140);
      const result = classifyDigit(vec, GENERIC_REFS);
      console.log(`  Digit ${d} (x=${best.x + d * best.dW}): ${result.digit} dist=${result.dist}`);
      // Show vector as rows
      for (let r = 0; r < 7; r++) {
        console.log(`    ${vec.slice(r * 5, (r + 1) * 5).map(v => v ? '█' : ' ').join('')}`);
      }
    }
  } else {
    console.log('No match found — generic refs may not match Dino font.');
    console.log('Try: node calibrate-score.cjs calibrate <frame.png> <knownScore>');
  }
}

// calibrate: given a frame with a known score, auto-calibrate digit templates
async function calibrate(path, knownScore) {
  const { data, w } = await loadFrame(path);
  const digits = String(knownScore);
  console.log(`Auto-calibrating for known score: ${knownScore} (${digits.length} digits)`);

  // For each digit in the known score, we need to find where it appears in the frame.
  // Strategy: scan x positions and digit sizes. For each candidate position,
  // extract vectors for all N digits. Compare each vector against GENERIC_REFS.
  // If the majority of digits match the known score pattern, we've found the right position.

  let bestMatch = null;
  let bestAgreement = 0;

  for (let y = 0; y <= 15; y++) {
    for (let x = 100; x <= 500; x++) {
      for (let dW = 6; dW <= 12; dW++) {
        for (let dH = 10; dH <= 18; dH++) {
          if (x + digits.length * dW > w) continue;

          const vecs = [];
          const classes = [];
          let ok = true;

          for (let d = 0; d < digits.length; d++) {
            const vec = extractDigitVector(data, w, x + d * dW, y, dW, dH, 140);
            if (!vec) { ok = false; break; }
            vecs.push(vec);
            const result = classifyDigit(vec, GENERIC_REFS);
            classes.push(result);
          }

          if (!ok) continue;

          // Count how many digits match the known score
          let agreement = 0;
          let totalDist = 0;
          for (let d = 0; d < digits.length; d++) {
            if (classes[d].digit === parseInt(digits[d])) agreement++;
            totalDist += classes[d].dist;
          }

          if (agreement > bestAgreement || (agreement === bestAgreement && totalDist < (bestMatch?.totalDist ?? Infinity))) {
            bestAgreement = agreement;
            bestMatch = { x, y, dW, dH, vecs, classes, totalDist, agreement };
          }
        }
      }
    }
  }

  if (!bestMatch || bestMatch.agreement < 2) {
    console.log('Could not find score digits matching known score.');
    console.log('Generic refs may not match Dino font at all.');
    console.log('Best agreement: ' + (bestMatch?.agreement ?? 0) + '/' + digits.length);

    // Fallback: just show all candidate digit-like regions
    console.log('\nAll digit-like regions found (any structure):');
    await findAllDigitRegions(data, w);
    return;
  }

  console.log(`\nFound match at x=${bestMatch.x} y=${bestMatch.y} dW=${bestMatch.dW} dH=${bestMatch.dH}`);
  console.log(`Agreement: ${bestMatch.agreement}/${digits.length}, totalDist: ${bestMatch.totalDist}`);

  // Build calibrated reference vectors from the actual extracted vectors
  console.log('\n=== Calibrated digit vectors (extracted from frame) ===');
  const calRefs = {};
  for (let d = 0; d < digits.length; d++) {
    const digit = parseInt(digits[d]);
    calRefs[digit] = bestMatch.vecs[d];
    console.log(`Digit ${digit} (x=${bestMatch.x + d * bestMatch.dW}):`);
    for (let r = 0; r < 7; r++) {
      console.log(`  ${bestMatch.vecs[d].slice(r * 5, (r + 1) * 5).map(v => v ? '█' : ' ').join('')}  [${bestMatch.vecs[d].slice(r * 5, (r + 1) * 5).join(',')}]`);
    }
  }

  // Output TypeScript config
  console.log('\n=== TypeScript configuration ===');
  console.log('// Add to BRAWLER_PIXEL_CONFIGS["dino.zip"].score:');
  console.log(`score: { x: ${bestMatch.x}, y: ${bestMatch.y}, digitW: ${bestMatch.dW}, digitH: ${bestMatch.dH}, count: ${digits.length} },`);

  // IMPORTANT: note about right-alignment
  console.log('\n⚠️  IMPORTANT: Dino score is right-aligned with leading zeros suppressed.');
  console.log(`   Count ${digits.length} is correct for score ${knownScore}, but other scores may have`);
  console.log('   different digit counts. Consider using a larger count + detecting leading spaces.');
}

// findAllDigitRegions: scan for regions containing structured pixel patterns
async function findAllDigitRegions(data, w) {
  console.log('\nScanning for structured character regions at top of screen...');

  // Look for vertical columns of consistent brightness patterns
  // A "character column" has white-ish pixels consistently across rows 3-17
  for (let y = 0; y <= 10; y++) {
    const rows = [];
    for (let row = y; row < y + 5 && row < 30; row++) {
      let s = '';
      for (let x = 300; x < 500; x++) {
        const p = getPixel(data, w, x, row);
        if (!p) s += '?';
        else if (p.r > 180 && p.g > 180 && p.b > 180) s += '█';
        else if (p.r > 140 && p.g > 140 && p.b > 140) s += '▒';
        else s += ' ';
      }
      rows.push(`y=${row}: ${s}`);
    }
    if (rows.some(r => r.includes('█'))) {
      console.log(`\nAt y=${y}:`);
      rows.forEach(r => console.log(r));
    }
  }
}

// ocr: try OCR on a specific region with given digit count
async function ocr(path, rx, ry, dW, dH, numDigits) {
  const { data, w } = await loadFrame(path);

  console.log(`\n=== OCR: ${numDigits} digits, each ${dW}×${dH} starting at (${rx},${ry}) ===`);

  let score = 0;
  for (let d = 0; d < numDigits; d++) {
    const dx = rx + d * dW;
    const vec = extractDigitVector(data, w, dx, ry, dW, dH, 140);

    console.log(`\nDigit ${d} (x=${dx}-${dx + dW - 1}, y=${ry}-${ry + dH - 1}):`);
    if (!vec) { console.log('  OUT OF BOUNDS'); score = -1; break; }

    for (let r = 0; r < 7; r++) {
      const row = vec.slice(r * 5, (r + 1) * 5);
      console.log(`  ${row.map(v => v ? '█' : ' ').join('')}`);
    }

    const result = classifyDigit(vec, GENERIC_REFS);
    console.log(`  → classified as ${result.digit} (dist=${result.dist})`);
    if (result.dist > 10) console.log(`  ⚠️  High distance — classification may be wrong`);
    score = score * 10 + result.digit;
  }

  console.log(`\nOCR result: ${score}`);
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  const cmd = process.argv[2];
  const args = process.argv.slice(3);

  try {
    if (cmd === 'analyze') {
      await analyze(args[0]);
    } else if (cmd === 'detail') {
      const [path, x, y, w, h] = args.map((v, i) => i === 0 ? v : parseInt(v));
      if (!path || isNaN(x)) { console.log('Usage: node calibrate-score.cjs detail <frame.png> <x> <y> <w> <h>'); return; }
      await detail(path, x, y, w, h);
    } else if (cmd === 'search') {
      await search(args[0]);
    } else if (cmd === 'calibrate') {
      const [path, scoreStr] = args;
      const score = parseInt(scoreStr);
      if (!path || isNaN(score)) { console.log('Usage: node calibrate-score.cjs calibrate <frame.png> <knownScore>'); return; }
      await calibrate(path, score);
    } else if (cmd === 'ocr') {
      const [path, x, y, dW, dH, digits] = args.map((v, i) => i === 0 ? v : parseInt(v));
      if (!path || isNaN(x)) { console.log('Usage: node calibrate-score.cjs ocr <frame.png> <x> <y> <dW> <dH> <digits>'); return; }
      await ocr(path, x, y, dW, dH, digits);
    } else {
      console.log('calibrate-score.cjs — Score digit calibration for brawler games');
      console.log('');
      console.log('  node calibrate-score.cjs analyze <frame.png>');
      console.log('  node calibrate-score.cjs detail <frame.png> <x> <y> <w> <h>');
      console.log('  node calibrate-score.cjs search <frame.png>');
      console.log('  node calibrate-score.cjs calibrate <frame.png> <knownScore>');
      console.log('  node calibrate-score.cjs ocr <frame.png> <x> <y> <dW> <dH> <digits>');
    }
  } catch (err) {
    console.error('Error:', err.message);
    if (err.message.includes('sharp')) {
      console.error('Make sure sharp is installed: npm install sharp');
    }
  }
}

main();
