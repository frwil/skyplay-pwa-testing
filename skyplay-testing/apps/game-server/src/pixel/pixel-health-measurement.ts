import { writeFileSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";

// ── Health bar measurement utilities ────────────────────────────────
//
// Pure functions extracted from PixelMatchAnalyzer for readability.
// These have no class dependencies and operate solely on their inputs.

/**
 * Check if a pixel belongs to a health bar by saturation, not raw brightness.
 * Health bars are colored (yellow/green/red) — they have significant
 * channel variance. Gray/white UI text, timer digits, and dark background
 * all have low saturation. This is robust to shaders, gamma, and bloom.
 */
export function isHealthPixel(r: number, g: number, b: number): boolean {
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  return (maxC - minC) > 30   // has color saturation (not gray/white UI)
      && maxC > 120           // bright — SFA2 empty-bar bg is dark blue (max ~82-107)
      && !(b >= r && b >= g); // not blue-dominant — excludes the empty-bar blue even under flash tint
}

/**
 * Measure the health bar by finding the edge of the filled region.
 *
 * Scans columns from the outer edge inward, computing a continuous
 * "health score" per column. The threshold is RELATIVE to the maximum
 * score found across the whole region — this auto-calibrates to the
 * current Xvfb rendering (brightness, shader, etc.), so the same
 * geometric edge is detected regardless of session.
 *
 * SFA2 bars drain toward the screen edges asymmetrically, but since we
 * COUNT filled columns (not measure from a specific side), the result
 * is independent of drain direction.
 */
export function measureFilledColumns(
  frame: Buffer, frameWidth: number,
  startX: number, startY: number, regionW: number, regionH: number,
): number {
  // ── Pass 1: compute score per column and find the peak ──────
  const scores = new Float64Array(regionW);
  let maxScore = 0;
  for (let x = 0; x < regionW; x++) {
    let healthPixels = 0;
    for (let y = 0; y < regionH; y++) {
      const idx = ((startY + y) * frameWidth + (startX + x)) * 3;
      if (isHealthPixel(frame[idx]!, frame[idx + 1]!, frame[idx + 2]!)) {
        healthPixels++;
      }
    }
    scores[x] = healthPixels / regionH;
    if (scores[x] > maxScore) maxScore = scores[x];
  }

  // ── Pass 2: longest gap-tolerant run of filled columns ──────
  // The bar does NOT necessarily start at the region's edge: on SNES
  // the P1 bar is anchored at the region END (x≈154-310 inside the
  // 70-310 region), so scanning from x=0 and stopping at the first
  // gap returns 0. Instead we find the LONGEST run of passing
  // columns, tolerating gaps ≤ 2 columns (dividers/shading inside
  // the bar). Direction-independent and robust to leading empty
  // space.
  //
  // Threshold = max(45% of peak, absolute floor at 45% of rows).
  // The floor prevents the relative threshold from collapsing to
  // near-zero on menu screens (where a single bright pixel can
  // push maxScore just above the old 0.18 gate).
  const absFloor = 0.45; // require ≥45% of rows have health pixels
  const threshold = Math.max(maxScore * 0.45, absFloor);
  let best = 0;
  let run = 0;
  let gap = 0;
  for (let x = 0; x < regionW; x++) {
    if (scores[x]! >= threshold) {
      run += gap + 1; // absorb the tolerated gap into the run
      gap = 0;
      if (run > best) best = run;
    } else if (run > 0 && gap < 2) {
      gap++; // small gap inside the bar — keep the run alive
    } else {
      run = 0;
      gap = 0;
    }
  }
  return best;
}

/** Median-of-N rolling average — filters out hit-flash spikes. */
export function getSmoothedHealth(history: number[]): number {
  if (history.length === 0) return 0;
  const sorted = [...history].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Save the raw health-bar stripe as a PPM (and PNG if ImageMagick is available). */
export function saveDebugStripe(
  frame: Buffer, width: number, height: number,
  tag: string, p1Filled: number, p2Filled: number,
): void {
  try {
    const dir = "/recordings/calibration";
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const ppmPath = join(dir, `debug-stripe-${tag}.ppm`);
    const header = `P6\n${width} ${height}\n255\n`;
    writeFileSync(ppmPath, Buffer.concat([Buffer.from(header, "ascii"), frame]));
    console.log(`[pixel-analyzer] 🔬 Saved ${tag} stripe: ${ppmPath} (${width}x${height}, p1Filled=${p1Filled} p2Filled=${p2Filled})`);
    try { execSync(`convert "${ppmPath}" "${ppmPath.replace('.ppm', '.png')}"`, { stdio: "pipe", timeout: 5000 }); } catch { /* optional */ }
  } catch (e) {
    console.log(`[pixel-analyzer] 🔬 Failed to save ${tag} stripe: ${(e as Error).message}`);
  }
}
