import {
  PORTRAIT_TEMPLATE_W,
  PORTRAIT_TEMPLATE_H,
  type PortraitConfig,
} from "./pixel-game-config.js";

// ── Public types ──────────────────────────────────────────────────────

/** Per-cell recognition result after template matching. */
export interface PortraitCellResult {
  /** Matched character ID (0x00-0x11 for SFA2), or -1 if unrecognized. */
  charId: number;
  /** Display name of the matched character, or "?" if unrecognized. */
  charName: string;
  /** Hamming-distance confidence (0-1). >0.65 = reliable. */
  confidence: number;
  /** Margin vs 2nd-best match (0-1). >0.08 = unambiguous. */
  margin: number;
  /** Whether this cell's result is reliable enough to use for diagnostics. */
  isReliable: boolean;
  /** Best-match distance (raw XOR popcount). */
  bestDist: number;
  /** 2nd-best distance (raw XOR popcount). */
  secondDist: number;
}

/** Full grid analysis result — 2D array matching the character grid layout. */
export interface PortraitGridResult {
  /** Per-cell results, indexed as [row][col]. Null if capture/analysis failed entirely. */
  cells: (PortraitCellResult | null)[][];
  /** Total frames captured and analyzed. */
  framesAnalyzed: number;
  /** How many cells had a majority-vote winner across frames. */
  cellsResolved: number;
}

// ── PortraitDetector ──────────────────────────────────────────────────

/**
 * Template-matching portrait recognizer for character select screens.
 *
 * Captures the full portrait grid as raw RGB24 frames, downsamples each cell
 * to PORTRAIT_TEMPLATE_W×PORTRAIT_TEMPLATE_H bits via luminance-weighted
 * dynamic thresholding, then compares against per-character templates using
 * Hamming distance (XOR popcount).
 *
 * Multi-frame majority vote across N frames (typically 5) increases robustness
 * against compression artifacts and intermittent visual noise.
 */
export class PortraitDetector {
  private readonly config: PortraitConfig;

  constructor(config: PortraitConfig) {
    this.config = config;
  }

  // ── Public API ────────────────────────────────────────────────────

  /**
   * Analyze a single RGB24 frame of the portrait grid region.
   * Returns per-cell results for the full grid.
   *
   * @param frame   Raw RGB24 buffer (gridW × gridH × 3 bytes).
   * @param gridW   Full width of the captured grid region in pixels.
   * @param gridH   Full height of the captured grid region in pixels.
   */
  analyzeGrid(frame: Buffer, gridW: number, gridH: number): PortraitCellResult[][] {
    const { cols, rows, templates, minConfidence, minMargin } = this.config;
    const cellW = gridW / cols;
    const cellH = gridH / rows;
    const results: PortraitCellResult[][] = [];

    for (let row = 0; row < rows; row++) {
      const rowResults: PortraitCellResult[] = [];
      for (let col = 0; col < cols; col++) {
        const cx = Math.round(col * cellW);
        const cy = Math.round(row * cellH);
        const cw = Math.round((col + 1) * cellW) - cx;
        const ch = Math.round((row + 1) * cellH) - cy;

        rowResults.push(
          this.recognizeCell(frame, gridW, cx, cy, cw, ch, templates, minConfidence, minMargin),
        );
      }
      results.push(rowResults);
    }

    return results;
  }

  /**
   * Run analysis across multiple frames and return a majority-vote result.
   * Each cell's final charId is the mode across all frames; confidence is
   * the fraction of frames that agreed.
   *
   * @param frames   Array of raw RGB24 frame buffers (all same dimensions).
   * @param gridW    Full width of the captured grid region in pixels.
   * @param gridH    Full height of the captured grid region in pixels.
   */
  processFrames(
    frames: Buffer[],
    gridW: number,
    gridH: number,
  ): PortraitGridResult {
    const { rows, cols } = this.config;

    if (frames.length === 0) {
      return { cells: [], framesAnalyzed: 0, cellsResolved: 0 };
    }

    // Analyze every frame independently
    const allResults: PortraitCellResult[][][] = [];
    for (const frame of frames) {
      allResults.push(this.analyzeGrid(frame, gridW, gridH));
    }

    // Majority vote per cell
    const cells: (PortraitCellResult | null)[][] = [];
    let cellsResolved = 0;

    for (let row = 0; row < rows; row++) {
      const rowCells: (PortraitCellResult | null)[] = [];
      for (let col = 0; col < cols; col++) {
        const votes = new Map<number, { count: number; bestResult: PortraitCellResult }>();

        for (const frameResults of allResults) {
          const cell = frameResults[row]?.[col];
          if (!cell || cell.charId < 0) continue;
          const entry = votes.get(cell.charId);
          if (entry) {
            entry.count++;
            if (cell.confidence > entry.bestResult.confidence) {
              entry.bestResult = cell;
            }
          } else {
            votes.set(cell.charId, { count: 1, bestResult: cell });
          }
        }

        // Pick the majority winner
        let bestCharId = -1;
        let bestCount = 0;
        let bestResult: PortraitCellResult | null = null;
        for (const [charId, { count, bestResult: br }] of votes) {
          if (count > bestCount) {
            bestCount = count;
            bestCharId = charId;
            bestResult = br;
          }
        }

        if (bestResult && bestCount > 0) {
          // Confidence = fraction of frames that agreed.
          // Also require that the best per-frame match had a non-zero margin
          // (i.e. templates actually distinguished it from the second-best).
          // This gates against all-zero seed templates producing 100% agreement.
          const voteConfidence = bestCount / frames.length;
          const bestMargin = bestResult.margin;
          rowCells.push({
            ...bestResult,
            confidence: voteConfidence,
            isReliable:
              voteConfidence >= this.config.minConfidence &&
              bestMargin >= this.config.minMargin,
          });
          cellsResolved++;
        } else {
          rowCells.push(null);
        }
      }
      cells.push(rowCells);
    }

    return { cells, framesAnalyzed: frames.length, cellsResolved };
  }

  // ── Private: single-cell recognition ───────────────────────────────

  /**
   * Recognize a single cell from a cropped region of the frame.
   *
   * Algorithm (adapted from TimerDetector.recognizeDigit):
   *   1. Sample brightness with stride 3 → determine threshold (median + offset).
   *      Uses luminance weighting: L = 0.2126·R + 0.7152·G + 0.0722·B
   *   2. Downsample the cell region to PORTRAIT_TEMPLATE_W×PORTRAIT_TEMPLATE_H
   *      via cell averaging + binarization.
   *   3. XOR popcount against every character template.
   *   4. Confidence = 1 - bestDist/totalBits, margin = (secondDist - bestDist)/totalBits.
   */
  private recognizeCell(
    frame: Buffer,
    frameWidth: number,
    cx: number,
    cy: number,
    cw: number,
    ch: number,
    templates: number[][],
    minConfidence: number,
    minMargin: number,
  ): PortraitCellResult {
    const totalBits = PORTRAIT_TEMPLATE_W * PORTRAIT_TEMPLATE_H;

    // Step 1: sample brightness for dynamic threshold
    const samples: number[] = [];
    for (let row = 0; row < ch; row += 3) {
      for (let col = 0; col < cw; col += 3) {
        const idx = ((cy + row) * frameWidth + (cx + col)) * 3;
        const r = frame[idx] ?? 0;
        const g = frame[idx + 1] ?? 0;
        const b = frame[idx + 2] ?? 0;
        // Luminance weighting (ITU-R BT.709)
        samples.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
      }
    }

    if (samples.length === 0) {
      return emptyResult(totalBits);
    }

    samples.sort((a, b) => a - b);
    // Threshold = median at 60% + offset (upper ~40% are "lit")
    const threshold = samples[Math.floor(samples.length * 0.6)] + 20;

    // Step 2: downsample to template size + binarize
    const bits: number[] = [];
    const cellW = cw / PORTRAIT_TEMPLATE_W;
    const cellH = ch / PORTRAIT_TEMPLATE_H;

    for (let tr = 0; tr < PORTRAIT_TEMPLATE_H; tr++) {
      let rowBits = 0;
      for (let tc = 0; tc < PORTRAIT_TEMPLATE_W; tc++) {
        let sum = 0;
        let count = 0;
        const sx = Math.round(cx + tc * cellW);
        const sy = Math.round(cy + tr * cellH);
        const ex = Math.round(cx + (tc + 1) * cellW);
        const ey = Math.round(cy + (tr + 1) * cellH);

        for (let py = sy; py < ey && py < cy + ch; py++) {
          for (let px = sx; px < ex && px < cx + cw; px++) {
            const idx = (py * frameWidth + px) * 3;
            const r = frame[idx] ?? 0;
            const g = frame[idx + 1] ?? 0;
            const b = frame[idx + 2] ?? 0;
            sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
            count++;
          }
        }
        const avg = count > 0 ? sum / count : 0;
        // MSB=left: bit 0 is the rightmost column
        if (avg > threshold) rowBits |= (1 << (PORTRAIT_TEMPLATE_W - 1 - tc));
      }
      bits.push(rowBits);
    }

    // Step 3: Hamming distance against each template
    let bestCharId = -1;
    let bestDist = Infinity;
    let secondDist = Infinity;
    let templatesCompared = 0;

    for (let i = 0; i < templates.length; i++) {
      const tmpl = templates[i];
      if (!tmpl || tmpl.length === 0) continue;
      templatesCompared++;
      let dist = 0;
      for (let r = 0; r < PORTRAIT_TEMPLATE_H; r++) {
        const xor = (bits[r] ?? 0) ^ (tmpl[r] ?? 0);
        // popcount via Kernighan's algorithm
        let v = xor;
        while (v) {
          dist++;
          v &= v - 1;
        }
      }
      if (dist < bestDist) {
        secondDist = bestDist;
        bestDist = dist;
        bestCharId = i;
      } else if (dist < secondDist) {
        secondDist = dist;
      }
    }

    const confidence = bestDist < Infinity ? (1 - bestDist / totalBits) : 0;
    const margin = bestDist < Infinity && secondDist < Infinity ? (secondDist - bestDist) / totalBits : 0;

    // Reject when no templates were compared or when all compared templates
    // produce the same distance (margin=0 means no template is distinguishable).
    // This prevents false positives from all-zero seed templates.
    const isReliable =
      templatesCompared > 0 &&
      bestCharId >= 0 &&
      margin > 0 &&
      confidence >= minConfidence &&
      margin >= minMargin;

    // Look up character name from the config template list
    const charName = isReliable
      ? (this.config.charNames?.[bestCharId] ?? `0x${bestCharId.toString(16).padStart(2, "0")}`)
      : "?";

    return {
      charId: isReliable ? bestCharId : -1,
      charName,
      confidence,
      margin,
      isReliable,
      bestDist: bestDist < Infinity ? bestDist : totalBits,
      secondDist: secondDist < Infinity ? secondDist : totalBits,
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

function emptyResult(totalBits: number): PortraitCellResult {
  return {
    charId: -1,
    charName: "?",
    confidence: 0,
    margin: 0,
    isReliable: false,
    bestDist: totalBits,
    secondDist: totalBits,
  };
}
