import * as fs from "fs";
import * as path from "path";
import {
  PORTRAIT_TEMPLATE_W,
  PORTRAIT_TEMPLATE_H,
  type PortraitConfig,
} from "./pixel-game-config.js";

// ── Public types ──────────────────────────────────────────────────────

/** One binarized cell sample, labeled by ground-truth character ID. */
export interface CalibratorSample {
  /** Binarized template bits (PORTRAIT_TEMPLATE_H rows, MSB=left per row). */
  bits: number[];
  /** Ground truth character ID from cursor tracking (0x00-0x11 for SFA2). */
  charId: number;
  /** Display name for logging. */
  charName: string;
}

/** Per-character calibration summary. */
export interface CalibrationReport {
  /** Total samples collected across all characters. */
  totalSamples: number;
  /** Per-character sample counts. */
  perChar: Record<string, { charId: number; samples: number; accuracy: number }>;
  /** Overall cross-validation accuracy (0-1). */
  overallAccuracy: number;
  /** How many characters have fewer than the recommended minimum samples (10). */
  lowSampleChars: string[];
}

// ── Persisted format (JSON on disk) ───────────────────────────────────

interface PersistedSamples {
  version: 1;
  game: string;
  configHash: string;
  samples: Array<{ charId: number; charName: string; bits: number[] }>;
}

// ── TemplateCalibrator ────────────────────────────────────────────────

/**
 * Self-calibrating template collector for portrait detection.
 *
 * During character select, cursor tracking tells us which character is at each
 * grid position. The calibrator captures raw pixel data for each cell, binarizes
 * it into PORTRAIT_TEMPLATE_W×PORTRAIT_TEMPLATE_H bits, and labels it with the
 * ground-truth character ID.
 *
 * After collecting enough samples (10+ per character), generateTemplates()
 * produces consensus templates via bit-majority voting (>60% threshold).
 * validate() then cross-validates every sample against the consensus to verify
 * >95% accuracy before the templates are committed to pixel-game-config.ts.
 */
export class TemplateCalibrator {
  private readonly config: PortraitConfig;
  /** Per-character-ID sample arrays. charId → samples[]. */
  private readonly byChar = new Map<number, CalibratorSample[]>();
  /** Total samples collected. */
  private totalSamples = 0;

  constructor(config: PortraitConfig) {
    this.config = config;
  }

  // ── Sample collection ──────────────────────────────────────────────

  /**
   * Collect one binarized cell sample labeled by ground truth.
   * Call this for each cell position that has a known character ID.
   *
   * @param frame    Raw RGB24 buffer of the full portrait grid region.
   * @param gridW    Total width of the grid region in pixels.
   * @param gridH    Total height of the grid region in pixels.
   * @param charMap  Array of {row, col, charId, charName} for cells with
   *                 known ground truth (from cursor tracking).
   */
  collectFromFrame(
    frame: Buffer,
    gridW: number,
    gridH: number,
    charMap: Array<{
      row: number;
      col: number;
      charId: number;
      charName: string;
    }>,
  ): void {
    const { cols, rows } = this.config;
    const cellW = gridW / cols;
    const cellH = gridH / rows;

    for (const { row, col, charId, charName } of charMap) {
      if (charId < 0) continue; // Unselected slot — skip
      if (row < 0 || row >= rows || col < 0 || col >= cols) continue;

      const cx = Math.round(col * cellW);
      const cy = Math.round(row * cellH);
      const cw = Math.round((col + 1) * cellW) - cx;
      const ch = Math.round((row + 1) * cellH) - cy;

      const bits = this.extractCellBits(frame, gridW, cx, cy, cw, ch);

      const sample: CalibratorSample = { bits, charId, charName };
      const list = this.byChar.get(charId);
      if (list) {
        list.push(sample);
      } else {
        this.byChar.set(charId, [sample]);
      }
      this.totalSamples++;
    }
  }

  /** How many samples have been collected for a given character. */
  getSampleCount(charId: number): number {
    return this.byChar.get(charId)?.length ?? 0;
  }

  /** Total samples across all characters. */
  getTotalSamples(): number {
    return this.totalSamples;
  }

  /** All character IDs that have at least one sample. */
  getSampledCharIds(): number[] {
    return [...this.byChar.keys()].sort((a, b) => a - b);
  }

  /** Sample counts per character, as a human-readable summary. */
  sampleCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [charId, samples] of this.byChar) {
      const name =
        this.config.charNames[charId] ??
        `0x${charId.toString(16).padStart(2, "0")}`;
      counts[name] = samples.length;
    }
    return counts;
  }

  // ── Template generation ────────────────────────────────────────────

  /**
   * Generate consensus templates via bit-majority voting.
   *
   * For each bit position in the PORTRAIT_TEMPLATE_W×PORTRAIT_TEMPLATE_H
   * bitmap, if more than `consensusThreshold` fraction of samples have that
   * bit set to 1, the consensus template gets a 1; otherwise 0.
   *
   * @param consensusThreshold  Fraction of samples that must agree (default 0.6).
   * @returns Array of 18 templates (one per character ID 0x00-0x11).
   *          Characters with zero samples get an all-zeros template.
   */
  generateTemplates(consensusThreshold = 0.6): number[][] {
    const templates: number[][] = [];

    for (let charId = 0; charId < this.config.charNames.length; charId++) {
      const samples = this.byChar.get(charId);
      if (!samples || samples.length === 0) {
        // No samples for this character — output zero template
        templates.push(Array(PORTRAIT_TEMPLATE_H).fill(0));
        continue;
      }

      const n = samples.length;
      const template: number[] = [];

      for (let tr = 0; tr < PORTRAIT_TEMPLATE_H; tr++) {
        let rowBits = 0;
        for (let tc = 0; tc < PORTRAIT_TEMPLATE_W; tc++) {
          // Count how many samples have this bit set
          let ones = 0;
          for (const sample of samples) {
            const row = sample.bits[tr] ?? 0;
            if (row & (1 << (PORTRAIT_TEMPLATE_W - 1 - tc))) {
              ones++;
            }
          }
          // Majority: bit is 1 if >consensusThreshold of samples agree
          if (ones / n > consensusThreshold) {
            rowBits |= 1 << (PORTRAIT_TEMPLATE_W - 1 - tc);
          }
        }
        template.push(rowBits);
      }
      templates.push(template);
    }

    return templates;
  }

  // ── Cross-validation ────────────────────────────────────────────────

  /**
   * Cross-validate all collected samples against the given templates.
   *
   * For each sample, compute the Hamming distance against every template.
   * If the closest template matches the sample's ground-truth charId, it's
   * a correct classification.
   *
   * @param templates  Consensus templates to validate against (from generateTemplates()).
   * @returns Per-character accuracy report.
   */
  validate(templates: number[][]): CalibrationReport {
    let totalCorrect = 0;
    let totalTested = 0;
    const perChar: CalibrationReport["perChar"] = {};
    const lowSampleChars: string[] = [];
    const MIN_SAMPLES = 10;

    for (const [charId, samples] of this.byChar) {
      let correct = 0;
      for (const sample of samples) {
        const predicted = this.classify(sample.bits, templates);
        if (predicted === charId) correct++;
        totalTested++;
      }
      totalCorrect += correct;
      const accuracy = samples.length > 0 ? correct / samples.length : 0;
      const name =
        this.config.charNames[charId] ??
        `0x${charId.toString(16).padStart(2, "0")}`;
      perChar[name] = { charId, samples: samples.length, accuracy };
      if (samples.length < MIN_SAMPLES) {
        lowSampleChars.push(name);
      }
    }

    return {
      totalSamples: totalTested,
      perChar,
      overallAccuracy: totalTested > 0 ? totalCorrect / totalTested : 0,
      lowSampleChars,
    };
  }

  // ── Persistence ─────────────────────────────────────────────────────

  /**
   * Save collected samples to a JSON file for later analysis.
   * The file is human-readable and can be committed to the repo as
   * calibration ground truth.
   */
  save(filePath: string, gameLabel: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const data: PersistedSamples = {
      version: 1,
      game: gameLabel,
      configHash: `${this.config.cols}x${this.config.rows}_${this.config.cellW}x${this.config.cellH}`,
      samples: [],
    };

    for (const [charId, samples] of this.byChar) {
      for (const s of samples) {
        data.samples.push({
          charId: s.charId,
          charName: s.charName,
          bits: s.bits,
        });
      }
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    console.log(
      `[calibrator] Saved ${data.samples.length} samples (${this.byChar.size} chars) → ${filePath}`,
    );
  }

  /**
   * Load previously saved samples from disk.
   * Appends to any already-collected in-memory samples.
   */
  load(filePath: string): void {
    if (!fs.existsSync(filePath)) {
      console.warn(`[calibrator] File not found: ${filePath}`);
      return;
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as PersistedSamples;

    if (data.version !== 1) {
      console.warn(`[calibrator] Unknown sample version: ${data.version}`);
      return;
    }

    let loaded = 0;
    for (const entry of data.samples) {
      const sample: CalibratorSample = {
        bits: entry.bits,
        charId: entry.charId,
        charName: entry.charName,
      };
      const list = this.byChar.get(entry.charId);
      if (list) {
        list.push(sample);
      } else {
        this.byChar.set(entry.charId, [sample]);
      }
      this.totalSamples++;
      loaded++;
    }

    console.log(
      `[calibrator] Loaded ${loaded} samples (${this.byChar.size} chars) from ${filePath}`,
    );
  }

  // ── Export ──────────────────────────────────────────────────────────

  /**
   * Export consensus templates as copy-paste-ready TypeScript code.
   * Use this to update pixel-game-config.ts after calibration.
   */
  exportTemplates(consensusThreshold = 0.6): string {
    const templates = this.generateTemplates(consensusThreshold);
    const lines: string[] = [];

    lines.push("// Auto-generated by TemplateCalibrator — copy into pixel-game-config.ts");
    lines.push(`// ${this.totalSamples} total samples across ${this.byChar.size} characters`);
    lines.push("templates: [");

    for (let i = 0; i < templates.length; i++) {
      const name = this.config.charNames[i] ?? `0x${i.toString(16).padStart(2, "0")}`;
      const tmpl = templates[i];
      if (!tmpl || tmpl.length === 0) {
        lines.push(`  /* ${name} (0x${i.toString(16).padStart(2, "0")}) — NO SAMPLES */`);
        lines.push(`  Array(${PORTRAIT_TEMPLATE_H}).fill(0),`);
        continue;
      }

      const sampleCount = this.byChar.get(i)?.length ?? 0;
      lines.push(
        `  /* ${name} (0x${i.toString(16).padStart(2, "0")}) — ${sampleCount} samples */`,
      );

      // Format each row as a binary literal: 0b00111100...
      const rowStrs = tmpl.map(
        (row) =>
          `0b${row.toString(2).padStart(PORTRAIT_TEMPLATE_W, "0")}`,
      );

      // Group rows for readability — 6 rows per line
      const grouped: string[] = [];
      for (let r = 0; r < rowStrs.length; r += 6) {
        grouped.push(`[${rowStrs.slice(r, r + 6).join(", ")}]`);
      }

      if (grouped.length === 1) {
        // Single group (≤6 rows) — compact form
        lines.push(`  ${grouped[0]},`);
      } else {
        // Multi-group — one per line with continuation
        lines.push(`  [`);
        for (const g of grouped) {
          lines.push(`    ...${g},`);
        }
        lines.push(`  ],`);
      }
    }

    lines.push("],");
    return lines.join("\n");
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /**
   * Extract binarized template bits from a single cell region.
   * Uses the same luminance-weighted dynamic thresholding as
   * PortraitDetector.recognizeCell() — shared algorithm, different consumer.
   */
  private extractCellBits(
    frame: Buffer,
    frameWidth: number,
    cx: number,
    cy: number,
    cw: number,
    ch: number,
  ): number[] {
    // Step 1: sample brightness for dynamic threshold
    const samples: number[] = [];
    for (let row = 0; row < ch; row += 3) {
      for (let col = 0; col < cw; col += 3) {
        const idx = ((cy + row) * frameWidth + (cx + col)) * 3;
        const r = frame[idx] ?? 0;
        const g = frame[idx + 1] ?? 0;
        const b = frame[idx + 2] ?? 0;
        samples.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
      }
    }

    // Fallback: if region is too small for sampling, use mid-range threshold
    const threshold =
      samples.length > 0
        ? samples.sort((a, b) => a - b)[Math.floor(samples.length * 0.6)] + 20
        : 128;

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
        if (avg > threshold) {
          rowBits |= 1 << (PORTRAIT_TEMPLATE_W - 1 - tc);
        }
      }
      bits.push(rowBits);
    }

    return bits;
  }

  /**
   * Classify a single binarized cell against templates using Hamming distance.
   * Returns the closest-matching character ID.
   */
  private classify(bits: number[], templates: number[][]): number {
    let bestCharId = -1;
    let bestDist = Infinity;

    for (let i = 0; i < templates.length; i++) {
      const tmpl = templates[i];
      if (!tmpl || tmpl.length === 0) continue;
      let dist = 0;
      for (let r = 0; r < PORTRAIT_TEMPLATE_H; r++) {
        const xor = (bits[r] ?? 0) ^ (tmpl[r] ?? 0);
        let v = xor;
        while (v) {
          dist++;
          v &= v - 1;
        }
      }
      if (dist < bestDist) {
        bestDist = dist;
        bestCharId = i;
      }
    }

    return bestCharId;
  }
}
