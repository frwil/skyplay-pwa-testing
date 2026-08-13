/**
 * Pixel-based health + lives measurement for brawler/beat-em-up games.
 *
 * Pure measurement — no state machine. Takes raw RGB24 frames from the
 * ffmpeg x11grab capture stream, returns health % and lives counts.
 * The death/game-over state machine lives in GameRunner.processBrawlerFrame().
 *
 * References the old SFA2 pixel stack (deleted in 540e641, available at
 * 170d791:skyplay-testing/apps/game-server/src/pixel/) for isHealthPixel,
 * column-scan, and median smoothing patterns.
 */

import type { BrawlerPixelConfig } from "../game-config.js";
import sharp from "sharp";
import {
  MIN_COL_PIXELS_RATIO,
  HEALTH_MIN_SATURATION,
  HEALTH_MIN_BRIGHTNESS,
  HEALTH_SMOOTH_WINDOW,
} from "../config.js";

// ── Pixel classifiers ─────────────────────────────────────────────────

/**
 * Yellow/green health-bar pixel predicate.
 * Gray/white UI text, dark empty-bar background, and blue-toned pixels all fail.
 */
export function isHealthPixel(r: number, g: number, b: number): boolean {
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  return (
    maxC - minC > HEALTH_MIN_SATURATION && // has color saturation (not gray/white UI)
    maxC > HEALTH_MIN_BRIGHTNESS &&        // bright enough (not dark empty bar)
    !(b >= r && b >= g)                    // not blue-dominant (empty-bar blue tint)
  );
}

/**
 * Active health-bar fill pixel predicate — narrow yellow/orange range.
 * CPS1 brawler HUD backgrounds are warm brown (~102,68,34) which passes
 * isHealthPixel(). This stricter check only matches the bright yellow fill
 * (255,238,0) and avoids false bar-visible detection on inactive panels.
 */
export function isBarFillPixel(r: number, g: number, b: number): boolean {
  return (
    r > 180 &&
    g > 150 &&
    r + g > 380 &&   // strong yellow luminance
    b < 100 &&        // low blue = yellow, not brown
    b < r && b < g
  );
}

// ── Reading type ─────────────────────────────────────────────────────

export interface BrawlerPixelReadings {
  p1Health: number;   // 0-100 %
  p2Health: number;
  p3Health: number;
  p1Lives: number;    // 0-maxLives
  p2Lives: number;
  p3Lives: number;
  p1BarVisible: boolean;
  p2BarVisible: boolean;
  p3BarVisible: boolean;
  p1Score: number;    // -1 = unavailable (no score config or OCR failed)
  p1Rank: number | null;        // rank number under the score (1-99), null = no rank on screen
  p1RankSuffix: string | null;  // rank suffix letters (e.g. "TH"), null = no rank on screen
}

// ── Analyzer ─────────────────────────────────────────────────────────

export class BrawlerPixelAnalyzer {
  private config: BrawlerPixelConfig;
  private p1HealthHistory: number[] = [];
  private p2HealthHistory: number[] = [];
  private p3HealthHistory: number[] = [];

  // Visibility latch — once a bar is seen with sufficient density over
  // multiple consecutive frames, it stays "visible" until explicitly cleared.
  // Prevents the bar from disappearing at low health (when the yellow fill
  // is gone), which would skip death detection.
  private p1BarLatched = false;
  private p2BarLatched = false;
  private p3BarLatched = false;
  // Consecutive frames with density ≥ threshold — must reach 3 to latch.
  // Prevents one-frame artifacts (screen transitions, "INSERT COIN" text)
  // from falsely activating inactive player bars.
  private p1LatchStreak = 0;
  private p2LatchStreak = 0;
  private p3LatchStreak = 0;

  // Rank latch — the rank is not shown in room 1 (appears from the 2nd room).
  // Once read, keep the last value through transient absent frames and clear
  // only after RANK_ABSENT_CLEAR_FRAMES consecutive empty frames.
  private lastRank: number | null = null;
  private lastRankSuffix: string | null = null;
  private rankAbsentStreak = 0;
  // Dedupe unknown-glyph vectors so new glyphs (digits 2-9, S/N/D/R) are
  // logged once per session for later template extraction.
  private rankUnknownLogged = new Set<string>();

  constructor(config: BrawlerPixelConfig) {
    this.config = config;
    // Seed calibrated Dino digit templates from 6 confirmed debug frames
    // (1800, 4100, 4900, 7200, 9500, 10600) — calibrated 2026-08-12.
    // Pitch=18, digitW=10, right-aligned starting at x=337.
    // Digit 3 is the only one missing — will be auto-calibrated on first sight.
    if (config.score) {
      this.calibratedDigitRefs[0] = DINO_DIGIT_0;
      this.calibratedDigitRefs[1] = DINO_DIGIT_1;
      this.calibratedDigitRefs[2] = DINO_DIGIT_2;
      this.calibratedDigitRefs[4] = DINO_DIGIT_4;
      this.calibratedDigitRefs[5] = DINO_DIGIT_5;
      this.calibratedDigitRefs[6] = DINO_DIGIT_6;
      this.calibratedDigitRefs[7] = DINO_DIGIT_7;
      this.calibratedDigitRefs[8] = DINO_DIGIT_8;
      this.calibratedDigitRefs[9] = DINO_DIGIT_9;
    }
  }

  /**
   * Process a full upscaled RGB24 frame. Returns smoothed health % and
   * island-counted lives for both players.
   *
   * @param rgb      Raw RGB24 pixel data (frameWidth × frameHeight × 3 bytes).
   * @param frameWidth  Upscaled frame width in pixels (1152 for CPS1 at 3×).
   * @param _frameHeight Upscaled frame height (672 for CPS1 at 3×) — reserved.
   */
  processFrame(rgb: Buffer, frameWidth: number, _frameHeight: number): BrawlerPixelReadings {
    const { p1Bar, p2Bar, p3Bar, p1Lives, p2Lives, p3Lives, fillFrom } = this.config;

    // Save debug frames periodically regardless of OCR success.
    // Captures frames across the game at different score values for calibration.
    // Re-enabled 2026-08-12 for 5-7 digit score testing.
    this._debugPollCount = (this._debugPollCount || 0) + 1;
    if (this._debugPollCount % 6 === 0 && this._debugFrameCount < 120) {
      this._debugFrameCount++;
      this.saveDebugFrame(rgb, frameWidth).catch(() => {});
    }

    // ── Health bars ──
    const rawP1 = this.measureHealthBar(rgb, frameWidth, p1Bar, fillFrom?.p1 ?? "left");
    const rawP2 = this.measureHealthBar(rgb, frameWidth, p2Bar, fillFrom?.p2 ?? "left");
    const rawP3 = this.measureHealthBar(rgb, frameWidth, p3Bar, fillFrom?.p3 ?? "left");

    // Median-of-N smoothing (kills hit-flash / ghost-trail spikes)
    this.p1HealthHistory.push(rawP1);
    this.p2HealthHistory.push(rawP2);
    this.p3HealthHistory.push(rawP3);
    if (this.p1HealthHistory.length > HEALTH_SMOOTH_WINDOW) this.p1HealthHistory.shift();
    if (this.p2HealthHistory.length > HEALTH_SMOOTH_WINDOW) this.p2HealthHistory.shift();
    if (this.p3HealthHistory.length > HEALTH_SMOOTH_WINDOW) this.p3HealthHistory.shift();

    const smoothedP1 = median(this.p1HealthHistory);
    const smoothedP2 = median(this.p2HealthHistory);
    const smoothedP3 = median(this.p3HealthHistory);

    // ── Bar visibility (single/multi-player guard) with latch ──
    // Once a bar is seen WITH sufficient yellow-pixel density over 3
    // consecutive frames, it stays visible until explicitly cleared by
    // clearBarLatch(), preventing death-detection gaps at low health.
    // The 3-frame streak prevents one-frame artifacts (screen transitions,
    // "INSERT COIN" text, etc.) from falsely activating inactive player bars.
    const LATCH_STREAK_REQUIRED = 3;
    const LATCH_DENSITY = 0.05;

    if (this.hasBarFillDensity(rgb, frameWidth, p1Bar, LATCH_DENSITY)) {
      this.p1LatchStreak++;
      if (this.p1LatchStreak >= LATCH_STREAK_REQUIRED) this.p1BarLatched = true;
    } else {
      this.p1LatchStreak = 0;
    }
    if (this.hasBarFillDensity(rgb, frameWidth, p2Bar, LATCH_DENSITY)) {
      this.p2LatchStreak++;
      if (this.p2LatchStreak >= LATCH_STREAK_REQUIRED) this.p2BarLatched = true;
    } else {
      this.p2LatchStreak = 0;
    }
    if (this.hasBarFillDensity(rgb, frameWidth, p3Bar, LATCH_DENSITY)) {
      this.p3LatchStreak++;
      if (this.p3LatchStreak >= LATCH_STREAK_REQUIRED) this.p3BarLatched = true;
    } else {
      this.p3LatchStreak = 0;
    }
    const p1BarVisible = this.p1BarLatched;
    const p2BarVisible = this.p2BarLatched;
    const p3BarVisible = this.p3BarLatched;

    // ── Lives icons ──
    const minIconW = this.config.minIconWidth ?? 21;
    const iconGap = this.config.iconGap ?? 6;
    const maxLives = this.config.maxLives ?? 3;
    const rawLivesP1 = this.countLifeIcons(rgb, frameWidth, p1Lives, minIconW, iconGap);
    const rawLivesP2 = this.countLifeIcons(rgb, frameWidth, p2Lives, minIconW, iconGap);
    const rawLivesP3 = this.countLifeIcons(rgb, frameWidth, p3Lives, minIconW, iconGap);

    // ── Rank OCR (latch keeps the last rank through absent frames) ──
    const measuredRank = this.measureRank(rgb, frameWidth);
    if (measuredRank) {
      this.lastRank = measuredRank.rank;
      this.lastRankSuffix = measuredRank.suffix;
      this.rankAbsentStreak = 0;
    } else if (this.lastRank !== null) {
      this.rankAbsentStreak++;
      if (this.rankAbsentStreak >= RANK_ABSENT_CLEAR_FRAMES) {
        this.lastRank = null;
        this.lastRankSuffix = null;
        this.rankAbsentStreak = 0;
      }
    }

    return {
      p1Health: clamp(Math.round(smoothedP1), 0, 100),
      p2Health: clamp(Math.round(smoothedP2), 0, 100),
      p3Health: clamp(Math.round(smoothedP3), 0, 100),
      p1Lives: clamp(rawLivesP1, 0, maxLives),
      p2Lives: clamp(rawLivesP2, 0, maxLives),
      p3Lives: clamp(rawLivesP3, 0, maxLives),
      p1BarVisible,
      p2BarVisible,
      p3BarVisible,
      p1Score: this.measureScore(rgb, frameWidth),
      p1Rank: this.lastRank,
      p1RankSuffix: this.lastRankSuffix,
    };
  }

  // ── Health bar measurement ──────────────────────────────────────

  /**
   * Column-scan a health bar ROI. A column is "filled" if ≥ 33% of its
   * pixels pass isHealthPixel. Health % = filled columns / total columns.
   *
   * With 3× nearest-neighbor upscale, every 3 native-pixel columns are
   * identical — the column scan naturally handles this.
   */
  private measureHealthBar(
    rgb: Buffer,
    frameW: number,
    roi: { x: number; y: number; w: number; h: number },
    fillFrom: "left" | "right",
  ): number {
    let filled = 0;
    let total = 0;
    const minColFill = Math.ceil(roi.h * MIN_COL_PIXELS_RATIO);

    for (let col = roi.x; col < roi.x + roi.w; col++) {
      if (col < 0 || col >= frameW) continue;
      total++;
      let healthPx = 0;
      for (let row = roi.y; row < roi.y + roi.h; row++) {
        const offset = (row * frameW + col) * 3;
        if (isBarFillPixel(rgb[offset], rgb[offset + 1], rgb[offset + 2])) {
          healthPx++;
        }
      }
      if (healthPx >= minColFill) filled++;
    }

    return total > 0 ? (filled / total) * 100 : 0;
  }

  // ── Lives icon counting ─────────────────────────────────────────

  /**
   * Count life icons via island detection on the lives ROI.
   *
   * 1. Per-column count of colored (saturation-bearing) pixels.
   * 2. Column is an "icon column" if ≥ 40% of ROI height passes.
   * 3. Group icon columns into islands separated by gaps ≥ iconGap px.
   * 4. Each island wider than minIconW px counts as one life icon.
   *
   * Life icons are colored character portraits; white score digits and
   * dark gaps both fail the saturation test.
   */
  private countLifeIcons(
    rgb: Buffer,
    frameW: number,
    roi: { x: number; y: number; w: number; h: number },
    minIconW: number,
    iconGap: number,
  ): number {
    const minColFill = Math.ceil(roi.h * 0.4);
    const iconCols: boolean[] = [];

    for (let col = roi.x; col < roi.x + roi.w; col++) {
      if (col < 0 || col >= frameW) { iconCols.push(false); continue; }
      let saturated = 0;
      for (let row = roi.y; row < roi.y + roi.h; row++) {
        const offset = (row * frameW + col) * 3;
        const r = rgb[offset], g = rgb[offset + 1], b = rgb[offset + 2];
        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        // Relaxed predicate — icons need saturation but may be dimmer than health bars
        if (maxC - minC > 20 && maxC > 60) saturated++;
      }
      iconCols.push(saturated >= minColFill);
    }

    // Group into islands
    let islands = 0;
    let runStart = -1;
    for (let i = 0; i < iconCols.length; i++) {
      if (iconCols[i]) {
        if (runStart < 0) runStart = i;
      } else {
        if (runStart >= 0) {
          const runW = i - runStart;
          if (runW >= minIconW) islands++;
          runStart = -1;
        }
        // gap check — ignore short gaps (single-column dropouts)
        if (i + iconGap < iconCols.length) {
          let allGap = true;
          for (let g = 0; g < iconGap; g++) {
            if (iconCols[i + g]) { allGap = false; break; }
          }
          if (!allGap) {
            // Not a real gap — absorb into current run
            if (runStart < 0) { /* still in gap, start new run only after gap */ }
          }
        }
      }
    }
    // Last island
    if (runStart >= 0) {
      const runW = iconCols.length - runStart;
      if (runW >= minIconW) islands++;
    }

    return islands;
  }

  // ── Bar visibility ──────────────────────────────────────────────

  /** Check whether the bar ROI contains enough yellow fill pixels to
   *  consider the bar actively visible (not just a stray artifact).
   *  @param minDensity  0-1 fraction of ROI pixels that must be yellow. */
  private hasBarFillDensity(
    rgb: Buffer,
    frameW: number,
    roi: { x: number; y: number; w: number; h: number },
    minDensity: number,
  ): boolean {
    if (roi.w <= 0 || roi.h <= 0) return false;
    const minPixels = Math.ceil(roi.w * roi.h * minDensity);
    let yellowCount = 0;
    for (let row = roi.y; row < roi.y + roi.h; row += 2) {
      for (let col = roi.x; col < roi.x + roi.w; col += 2) {
        if (col < 0 || col >= frameW) continue;
        const offset = (row * frameW + col) * 3;
        if (isBarFillPixel(rgb[offset], rgb[offset + 1], rgb[offset + 2])) {
          yellowCount++;
          if (yellowCount >= minPixels) return true;
        }
      }
    }
    return false;
  }

  /** Quick check: does this ROI contain any health-bar fill pixels at all?
   *  Uses the strict yellow classifier with a near-zero threshold — even a
   *  single yellow pixel keeps the bar marked as visible, avoiding the edge
   *  case where very low health (~5-7%) makes the bar falsely disappear. */
  private isBarVisible(
    rgb: Buffer,
    frameW: number,
    roi: { x: number; y: number; w: number; h: number },
  ): boolean {
    // Check every pixel (no sample step) — we need to catch even a sliver of yellow
    for (let row = roi.y; row < roi.y + roi.h; row += 2) {
      for (let col = roi.x; col < roi.x + roi.w; col += 2) {
        if (col < 0 || col >= frameW) continue;
        const offset = (row * frameW + col) * 3;
        if (isBarFillPixel(rgb[offset], rgb[offset + 1], rgb[offset + 2])) {
          return true; // even one yellow pixel = bar is visible
        }
      }
    }
    return false;
  }

  /** Reset smoothing history and visibility latches (e.g. on new match). */
  reset(): void {
    this.p1HealthHistory = [];
    this.p2HealthHistory = [];
    this.p3HealthHistory = [];
    this.p1BarLatched = false;
    this.p2BarLatched = false;
    this.p3BarLatched = false;
    this.p1LatchStreak = 0;
    this.p2LatchStreak = 0;
    this.p3LatchStreak = 0;
    // Rank latch — a new match starts in room 1 where the rank is absent
    this.lastRank = null;
    this.lastRankSuffix = null;
    this.rankAbsentStreak = 0;
    this.resetCalibration();
  }

  /** Clear the visibility latch for a player after they respawn with full health.
   *  Called by game-runner when health rises above the respawn threshold. */
  clearBarLatch(player: 1 | 2 | 3): void {
    if (player === 1) { this.p1BarLatched = false; this.p1LatchStreak = 0; }
    else if (player === 2) { this.p2BarLatched = false; this.p2LatchStreak = 0; }
    else { this.p3BarLatched = false; this.p3LatchStreak = 0; }
  }

  // ── Score OCR ────────────────────────────────────────────────────

  /**
   * Recognize the P1 score from pixel data.
   *
   * Dino's score is right-aligned with leading zeros suppressed — a score
   * of 1500 shows as "1500" (4 digits), not "0001500". The OCR handles
   * this by scanning from the right edge of the configured region.
   *
   * Uses grid-based feature matching: each digit cell is divided into a
   * 5-column × 7-row grid (= 35 features). Reference templates are
   * bootstrapped from generic patterns, then auto-calibrated from actual
   * game frames as digits are read with high confidence.
   *
   * @returns Recognized score value, or -1 if no score config or OCR failed.
   */
  private measureScore(rgb: Buffer, frameW: number): number {
    const scoreCfg = this.config.score;
    if (!scoreCfg) return -1;

    const { x, y, digitW, digitH, count, gaps, pitch } = scoreCfg;
    if (digitW < 4 || digitH < 4 || count < 1) return -1;

    // Pitch = centre-à-centre entre digits. Par défaut = digitW (compatibilité arrière).
    const step = pitch ?? digitW;

    // Pre-compute cumulative gap offsets for each digit index.
    // gaps are { afterDigit, size } — the gap shifts all digits AFTER afterDigit.
    const gapOffsets = new Array<number>(count).fill(0);
    if (gaps) {
      for (const gap of gaps) {
        for (let d = gap.afterDigit + 1; d < count; d++) {
          gapOffsets[d] += gap.size;
        }
      }
    }

    // Use auto-calibrated refs if available, otherwise generic bootstrap refs
    const refs = this.getCalibratedRefs();

    // Right-aligned scan: start from the rightmost digit position and
    // skip leading spaces (blank/empty digit cells).
    // Dino displays "1500" not "0001500", so we must detect the actual
    // number of visible digits.
    const digResults: { digit: number; dist: number; blank: boolean }[] = [];

    for (let d = 0; d < count; d++) {
      const dx = x + d * step + gapOffsets[d];
      const vec = this.extractDigitVector(rgb, frameW, dx, y, digitW, digitH);
      if (!vec) return -1; // digit region out of bounds

      // Detect blank/empty digit cell (leading space or trailing background).
      // Uses two criteria:
      // 1. ≤10/35 bits filled = too sparse to be a digit
      // 2. <3/7 rows with ≥2 bits = no vertical structure (random noise).
      //    Ink detection produces ~0 bits on any background, so 3 rows of
      //    structure is enough for thin digits (a skinny "7" has 3-5).
      const filledBits = vec.reduce((a, b) => a + b, 0);
      let rowsWithContent = 0;
      for (let r = 0; r < 7; r++) {
        const rowBits = vec.slice(r * 5, (r + 1) * 5).reduce((a, b) => a + b, 0);
        if (rowBits >= 2) rowsWithContent++;
      }
      const isBlank = filledBits <= 10 || rowsWithContent < 3;

      // Solid-fill guard: if ALL cells are filled (35/35) it's a solid-color
      // bar (title screen, transition), not a digit. Digits max at 34 (5/8/9).
      if (filledBits >= 35) return -1;

      // Debug: log first OCR reads to diagnose misclassification
      if (!this.ocrDebugDone && !isBlank) {
        const result = this.classifyDigitWithDist(vec, refs);
        console.log(
          `[brawler-pixel] 🔍 OCR d=${d} x=${dx} bits=${filledBits} rows=${rowsWithContent} ` +
          `→ ${result.digit} (dist=${result.dist})`
        );
        // One-time RGB dump of first digit cell for diagnostics
        if (d === 0 && !this._rgbDumpDone) {
          this._rgbDumpDone = true;
          this.dumpDigitCell(rgb, frameW, x, y, digitW, digitH);
        }
      }

      if (isBlank) {
        digResults.push({ digit: -1, dist: 0, blank: true });
        continue;
      }

      const result = this.classifyDigitWithDist(vec, refs);
      let digit = result.digit;
      // 8/9 disambiguation: at the 5×7 grid the bold Dino font renders 8 and
      // 9 as IDENTICAL vectors (the 10px window cuts the right side of the
      // ~14px glyph; both waist rows collapse to the same pattern). Only the
      // bottom-left leg differs: the 8's bottom bar extends 2px left of the
      // glyph's OWN top-left edge; the 9's is flush. Verified 2026-08-12:
      // 8 in 62800/800/1800 = leg 6/6, 9 in 12900/4900 = 0/6, and the 9 in
      // 9500 renders 1px left of the cell anchor — so the leg zone MUST be
      // anchored on the detected top-left edge (tx), not the cell origin.
      if (digit === 8 || digit === 9) {
        // Find the glyph's top-left ink column in the top 3 rows
        let tx = -1;
        for (let px = dx - 3; px < dx + 14 && tx < 0; px++) {
          for (let py = y; py < y + 3 && tx < 0; py++) {
            if (this.isInkPixel(rgb, frameW, px, py)) tx = px;
          }
        }
        if (tx < 0) tx = dx;
        const legInk = this.inkCountInRect(rgb, frameW, tx - 2, y + 12, 2, 3);
        digit = legInk >= 3 ? 8 : 9;
      }
      // Distance threshold: reject if too far from any reference.
      // With 8/10 calibrated Dino templates seeded, use tight threshold.
      const calCount = this.calibratedDigitRefs.filter(v => v !== null).length;
      const maxMismatch = calCount >= 8 ? 7 : 12;
      if (digit < 0 || result.dist > maxMismatch) return -1; // unrecognized
      digResults.push({ digit, dist: result.dist, blank: false });
    }

    // Mark debug done after first successful score > 0
    if (!this.ocrDebugDone && digResults.some(d => !d.blank)) {
      this.ocrDebugDone = true;
    }

    // Build score value, skipping leading blank cells
    let score = 0;
    let foundSignificant = false;
    for (const dr of digResults) {
      if (!dr.blank) foundSignificant = true;
      if (foundSignificant) {
        if (dr.blank) {
          // A blank in the middle of significant digits = treat as 0
          // (shouldn't happen with Dino but handle gracefully)
        } else {
          score = score * 10 + dr.digit;
        }
      }
    }

    // If all cells were blank, score is 0
    if (!foundSignificant) return 0;

    // Auto-calibrate: save vectors for digits matched with moderate+ confidence.
    // Dino's bold font has higher baseline distances than generic templates.
    const highConf = digResults.filter(d => !d.blank && d.dist <= 5);
    if (highConf.length >= 3 && score > 0) {
      this.autoCalibrate(rgb, frameW, x, y, digitW, digitH, count, gapOffsets, pitch);
    }

    return score;
  }

  // ── Rank OCR ────────────────────────────────────────────────────

  /**
   * Recognize the P1 rank ("#TH" under the score, e.g. "10TH").
   *
   * The rank uses a slightly narrower variant of the score font and is NOT
   * displayed in room 1 (appears after beating the first enemies), so an
   * empty zone is normal: returns null and the caller's latch keeps the
   * last value through transient absent frames.
   *
   * Steps:
   * 1. Presence check — ink in the mid/bottom rows of the zone (the top 3
   *    rows can catch score bottoms); reject solid transition slabs.
   * 2. 4-connectivity segmentation of ink pixels (min glyph 3×8).
   * 3. Per-glyph adaptive 5×7 vector over its own bbox.
   * 4. Hamming classification vs RankGlyphRefs (≤ RANK_MATCH_DIST).
   * 5. Strict parse: 1-2 digits followed by exactly 2 letters.
   *
   * Unknown glyphs (digits 2-9, letters S/N/D/R) are logged once per
   * session with their vector for later template extraction.
   */
  private measureRank(
    rgb: Buffer, frameW: number,
  ): { rank: number; suffix: string } | null {
    const zone = this.config.rank;
    if (!zone) return null;
    if (zone.x < 0 || zone.y < 0 || zone.x + zone.w > frameW) return null;

    // Presence check on rows y+3..y+h-1 — the score's bottom bars can reach
    // y≈23 while the zone starts at y=24, so the top 3 rows are excluded.
    // RANK_MAX_INK rejects screen-transition solid slabs (~2400 ink vs
    // ~550 for a real "10TH").
    const ink = this.inkCountInRect(rgb, frameW, zone.x, zone.y + 3, zone.w, zone.h - 3);
    if (ink < RANK_MIN_INK || ink > RANK_MAX_INK) return null;

    // ── Segmentation: 4-connectivity BFS over the zone ──
    const seen = new Uint8Array(zone.w * zone.h);
    const idx = (px: number, py: number) => (py - zone.y) * zone.w + (px - zone.x);
    const comps: { x0: number; y0: number; x1: number; y1: number }[] = [];

    for (let py = zone.y; py < zone.y + zone.h; py++) {
      for (let px = zone.x; px < zone.x + zone.w; px++) {
        const i = idx(px, py);
        if (seen[i]) continue;
        if (!this.isInkPixel(rgb, frameW, px, py)) continue;
        const stack: [number, number][] = [[px, py]];
        seen[i] = 1;
        let minX = px, maxX = px, minY = py, maxY = py;
        while (stack.length > 0) {
          const [cx, cy] = stack.pop()!;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < zone.x || nx >= zone.x + zone.w || ny < zone.y || ny >= zone.y + zone.h) continue;
            const ni = idx(nx, ny);
            if (seen[ni]) continue;
            seen[ni] = 1;
            if (this.isInkPixel(rgb, frameW, nx, ny)) {
              stack.push([nx, ny]);
              if (nx < minX) minX = nx;
              if (nx > maxX) maxX = nx;
              if (ny < minY) minY = ny;
              if (ny > maxY) maxY = ny;
            }
          }
        }
        const w = maxX - minX + 1, h = maxY - minY + 1;
        if (w >= 3 && h >= 8) comps.push({ x0: minX, y0: minY, x1: maxX, y1: maxY });
      }
    }
    comps.sort((a, b) => a.x0 - b.x0);

    // A rank is 3-4 glyphs (1-2 digits + "TH"). Merged or partial reads fail
    // gracefully — the caller's latch keeps the previous value.
    if (comps.length < 3 || comps.length > 4) return null;

    // ── Classify each glyph left→right ──
    let digits = 0;
    let letters = 0;
    let rank = 0;
    let suffix = "";

    for (const c of comps) {
      // Reject glyphs wider than any known rank glyph (merged glyphs)
      if (c.x1 - c.x0 + 1 > 22) return null;
      const vec = this.extractGlyphVector(rgb, frameW, c.x0, c.y0, c.x1, c.y1);
      // Solid-block guard: an all-1s vector is a transition slab, not a glyph
      if (vec.reduce((a, b) => a + b, 0) >= vec.length) return null;

      let best: { kind: "digit" | "letter"; value: number | string; dist: number } | null = null;
      for (const ref of RankGlyphRefs) {
        if (ref.vec.length !== vec.length) continue;
        let dist = 0;
        for (let i = 0; i < vec.length; i++) {
          if (vec[i] !== ref.vec[i]) dist++;
        }
        if (!best || dist < best.dist) {
          best = { kind: ref.kind, value: ref.value, dist };
        }
      }

      if (!best || best.dist > RANK_MATCH_DIST) {
        // Unknown glyph — log once per session for later template extraction
        const key = vec.join("");
        if (!this.rankUnknownLogged.has(key)) {
          this.rankUnknownLogged.add(key);
          console.log(
            `[brawler-pixel] 🧩 Unknown rank glyph (w=${c.x1 - c.x0 + 1} h=${c.y1 - c.y0 + 1}) ` +
            `vec=${key} — add template to RankGlyphRefs`
          );
        }
        return null;
      }

      if (best.kind === "digit") {
        if (letters > 0) return null; // digits must come before the letters
        if (digits >= 2) return null; // max 2 digits ("#TH")
        rank = rank * 10 + (best.value as number);
        digits++;
      } else {
        letters++;
        suffix += best.value as string;
      }
    }

    // Strict shape: at least 1 digit, exactly 2 letters
    if (digits < 1 || letters !== 2) return null;
    return { rank, suffix };
  }

  /**
   * Extract a 35-element binary vector from a glyph's own bounding box.
   * Adaptive 5×7 grid with floor cell boundaries (mirrors the Python
   * extraction that produced the verified templates); each element = 1 if
   * >50% of its pixels are ink.
   */
  private extractGlyphVector(
    rgb: Buffer, frameW: number,
    x0: number, y0: number, x1: number, y1: number,
  ): number[] {
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const GRID_COLS = 5;
    const GRID_ROWS = 7;
    const vector: number[] = [];
    for (let gr = 0; gr < GRID_ROWS; gr++) {
      for (let gc = 0; gc < GRID_COLS; gc++) {
        let cnt = 0;
        let tot = 0;
        const gsx = x0 + Math.floor((gc * w) / GRID_COLS);
        const gsy = y0 + Math.floor((gr * h) / GRID_ROWS);
        const gex = x0 + Math.floor(((gc + 1) * w) / GRID_COLS);
        const gey = y0 + Math.floor(((gr + 1) * h) / GRID_ROWS);
        for (let py = gsy; py < gey; py++) {
          for (let px = gsx; px < gex; px++) {
            if (this.isInkPixel(rgb, frameW, px, py)) cnt++;
            tot++;
          }
        }
        vector.push(tot > 0 && cnt / tot > 0.5 ? 1 : 0);
      }
    }
    return vector;
  }

  /** Save the full RGB frame as PNG for offline calibration. */
  private async saveDebugFrame(rgb: Buffer, frameW: number): Promise<void> {
    try {
      const fs = await import("fs");
      const dir = `/app/debug`;
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const frameH = Math.floor(rgb.length / (frameW * 3));
      const png = await sharp(rgb, { raw: { width: frameW, height: frameH, channels: 3 } })
        .png()
        .toBuffer();
      const fpath = `${dir}/score-frame-${Date.now()}.png`;
      fs.writeFileSync(fpath, png);
      console.log(`[brawler-pixel] 📸 Debug frame saved: ${fpath} (${frameW}×${frameH})`);
    } catch (e: any) {
      console.log(`[brawler-pixel] ⚠️ Failed to save debug frame: ${e.message}`);
      this._debugFrameSaved = false; // retry next time
    }
  }

  /**
   * Get the best available reference vectors: auto-calibrated if we have
   * enough digits, generic bootstrap refs otherwise.
   */
  private getCalibratedRefs(): number[][] {
    // Always merge calibrated refs with generic fallbacks.
    // Even 1 calibrated digit improves accuracy for that digit.
    return this.calibratedDigitRefs.map((cal, i) => cal ?? ScoreDigitRefs[i]);
  }

  /**
   * Auto-calibrated digit reference vectors.
   * Index = digit (0-9), value = 35-bit vector, null = not yet calibrated.
   * Built incrementally as digits are read with high confidence.
   */
  private calibratedDigitRefs: (number[] | null)[] = Array(10).fill(null);

  /**
   * Attempt to auto-calibrate digit templates from the current frame.
   * For each digit position, if the classified digit matches with very
   * low distance (≤4), use its vector as the calibrated template for
   * that digit value.
   */
  private autoCalibrate(
    rgb: Buffer, frameW: number,
    startX: number, y: number, digitW: number, digitH: number, count: number,
    gapOffsets: number[], pitch?: number,
  ): void {
    const step = pitch ?? digitW;
    const refs = this.getCalibratedRefs();
    for (let d = 0; d < count; d++) {
      const dx = startX + d * step + (gapOffsets[d] || 0);
      const vec = this.extractDigitVector(rgb, frameW, dx, y, digitW, digitH);
      if (!vec || vec.length === 0) continue;

      // Skip blank cells
      const filledBits = vec.reduce((a, b) => a + b, 0);
      if (filledBits <= 3) continue;

      const result = this.classifyDigitWithDist(vec, refs);
      // Tight threshold now that we have 8/10 calibrated templates seeded.
      // Distance ≤ 5 for calibrated matches, ≤ 9 to capture new digits (3, 6).
      const calCount = this.calibratedDigitRefs.filter(v => v !== null).length;
      const maxCalDist = calCount >= 8 ? 5 : 9;
      if (result.digit >= 0 && result.dist <= maxCalDist) {
        // Save this vector as the calibrated template
        this.calibratedDigitRefs[result.digit] = vec;
      }
    }

    const calCount = this.calibratedDigitRefs.filter(v => v !== null).length;
    if (calCount >= 6 && !this.calibLogged) {
      console.log(
        `[brawler-pixel] 🎯 Score digit auto-calibration: ${calCount}/10 digits calibrated`
      );
      this.calibLogged = true;
    }
  }

  private calibLogged = false;
  private ocrDebugDone = false;
  private _lastAvgLum = 0;
  private _lastThr = 0;
  private _rgbDumpDone = false;
  private _debugFrameSaved = false;
  private _debugPollCount = 0;
  private _debugFrameCount = 0;

  /**
   * Extract a 35-element binary feature vector from a digit cell.
   * Grid: 5 columns × 7 rows. Each element = 1 if >40% bright in that cell.
   * Uses a lower white threshold (140) for Dino's medium-bright score digits.
   */
  private extractDigitVector(
    rgb: Buffer, frameW: number,
    cellX: number, cellY: number, cellW: number, cellH: number,
  ): number[] | null {
    if (cellX < 0 || cellX + cellW > frameW) return null;

    // Ink detection: the score digits are drawn with navy outlines (0,0,85),
    // dark-blue midtones (51,136,204 / 0,119,221) and light-cyan fill
    // (204,255,255). The background is NOT a fixed panel — the HUD text sits
    // directly on the game screen (sky blue (153,187,238) or dark ground
    // (68,34,17)), so background-relative deviation fails. Ink matching is
    // background-agnostic (verified 2026-08-12 on 8 user-confirmed frames:
    // 62000 / 62400 / 62800 / 10700 / 17100 / 14700 / 16500 / 12900).
    this._lastAvgLum = 0;
    this._lastThr = 0;

    const GRID_COLS = 5;
    const GRID_ROWS = 7;
    const cellColW = Math.max(1, Math.floor(cellW / GRID_COLS));
    const cellRowH = Math.max(1, Math.floor(cellH / GRID_ROWS));

    const vector: number[] = [];
    for (let gr = 0; gr < GRID_ROWS; gr++) {
      for (let gc = 0; gc < GRID_COLS; gc++) {
        let deviant = 0;
        let total = 0;
        const gsx = cellX + gc * cellColW;
        const gsy = cellY + gr * cellRowH;
        const gex = Math.min(gsx + cellColW, cellX + cellW);
        const gey = Math.min(gsy + cellRowH, cellY + cellH);

        for (let py = gsy; py < gey; py++) {
          for (let px = gsx; px < gex; px++) {
            const off = (py * frameW + px) * 3;
            const r = rgb[off], g = rgb[off + 1], b = rgb[off + 2];
            // Ink check (background-agnostic):
            //  - navy outline: (0,0,85)
            //  - dark-blue midtone: (51,136,204), (0,119,221)
            //  - light-cyan fill: (204,255,255)
            const isInk =
              (r < 55 && g < 55 && b >= 40 && b <= 150) ||
              (g > 195 && b > 215) ||
              (r < 80 && g > 100 && g < 160 && b > 170);
            if (isInk) deviant++;
            total++;
          }
        }
        // >50% of sub-cell pixels must be ink
        vector.push(total > 0 && deviant / total > 0.5 ? 1 : 0);
      }
    }
    return vector;
  }

  /**
   * Classify a feature vector by finding the best-matching reference digit.
   * Uses Hamming distance (number of differing bits).
   * @returns digit (0-9) and distance, or -1 if no match below threshold.
   */
  private classifyDigitWithDist(
    vector: number[], refs: number[][],
  ): { digit: number; dist: number } {
    let bestDigit = -1;
    let bestDist = Infinity;

    for (let d = 0; d < 10; d++) {
      const ref = refs[d];
      if (ref.length !== vector.length) continue;
      let dist = 0;
      for (let i = 0; i < vector.length; i++) {
        if (vector[i] !== ref[i]) dist++;
      }
      if (dist < bestDist) {
        bestDist = dist;
        bestDigit = d;
      }
    }

    return { digit: bestDigit, dist: bestDist };
  }

  /**
   * Background-agnostic ink test for a single pixel: navy outline (0,0,85),
   * dark-blue midtone (51,136,204 / 0,119,221), light-cyan fill (204,255,255),
   * AND pure white (255,255,255 — passes the g>195 && b>215 clause).
   *
   * All Dino HUD elements EXCEPT the score are drawn in white (user-confirmed
   * 2026-08-13): rank, character names, lives counters, opponent names. The
   * white clause makes this single predicate work for both the score (blue
   * gradient) and every other HUD text element. Sky blue background
   * (153,187,238) and dark ground (68,34,17) both fail, so white detection
   * is background-safe.
   */
  private isInkPixel(rgb: Buffer, frameW: number, px: number, py: number): boolean {
    if (px < 0 || px >= frameW) return false;
    const off = (py * frameW + px) * 3;
    const r = rgb[off], g = rgb[off + 1], b = rgb[off + 2];
    return (
      (r < 55 && g < 55 && b >= 40 && b <= 150) ||
      (g > 195 && b > 215) ||
      (r < 80 && g > 100 && g < 160 && b > 170)
    );
  }

  /**
   * Count ink pixels in a rectangle, using the same background-agnostic ink
   * criteria as extractDigitVector (navy outline / dark-blue midtone /
   * light-cyan fill). Used for the 8/9 bottom-left-leg disambiguation.
   */
  private inkCountInRect(
    rgb: Buffer, frameW: number,
    rx: number, ry: number, rw: number, rh: number,
  ): number {
    let count = 0;
    for (let py = ry; py < ry + rh; py++) {
      for (let px = rx; px < rx + rw; px++) {
        if (this.isInkPixel(rgb, frameW, px, py)) count++;
      }
    }
    return count;
  }

  /**
   * Classify a feature vector and return just the digit.
   * @returns 0-9 on success, -1 if no match below threshold.
   */
  private classifyDigit(vector: number[], refs: number[][]): number {
    const result = this.classifyDigitWithDist(vector, refs);
    const calCount = this.calibratedDigitRefs.filter(v => v !== null).length;
    const maxMismatch = calCount >= 8 ? 7 : 12;
    return result.dist <= maxMismatch ? result.digit : -1;
  }

  /** One-time RGB dump of a digit cell for diagnostics. */
  private dumpDigitCell(
    rgb: Buffer, frameW: number,
    cellX: number, cellY: number, cellW: number, cellH: number,
  ): void {
    console.log(`[brawler-pixel] 📸 RGB dump of digit cell at (${cellX},${cellY}) ${cellW}×${cellH}:`);
    for (let py = cellY; py < cellY + cellH; py++) {
      const row: string[] = [];
      for (let px = cellX; px < cellX + cellW; px++) {
        const off = (py * frameW + px) * 3;
        const r = rgb[off], g = rgb[off + 1], b = rgb[off + 2];
        const lum = ((r + g + b) / 3).toFixed(0);
        const sat = (Math.max(r, g, b) - Math.min(r, g, b)).toFixed(0);
        row.push(`(${r.toString().padStart(3)},${g.toString().padStart(3)},${b.toString().padStart(3)})`);
      }
      console.log(`[brawler-pixel] 📸   row${py - cellY}: ${row.join(' ')}`);
    }
  }

  /** Reset calibrated digit templates (for new game session). */
  resetCalibration(): void {
    this.calibratedDigitRefs = Array(10).fill(null);
    this.calibLogged = false;
    this.ocrDebugDone = false;
    this._rgbDumpDone = false;
    this._debugFrameSaved = false;
    this._debugPollCount = 0;
    this._debugFrameCount = 0;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ── Digit reference vectors (5×7 grid → 35-bit patterns) ────────────────
//
// These are generic reference patterns for a monospaced pixel font digit set.
// Each vector is 35 elements (5 cols × 7 rows, row-major).
// Index = row*5 + col.
//
// ── Dino (Cadillacs and Dinosaurs) bootstrap digit templates ───────────
// Consensus vectors (2026-08-12) from 5 user-confirmed frames:
// 62000, 62400, 62800, 10700, 17100 (debug-frames/2026-08-12-continuous).
// Computed with the background-agnostic ink detection: the score is drawn
// directly on the game screen (sky blue or dark ground) — no fixed HUD panel.
// Cells k=2..6, right-aligned at x≈419, pitch=18, digitW=10, frame 1152×672.
// Grid: 5×7 = 35 bits, row-major.
// Digit 3 has no fresh sample — old vector kept, auto-calibration corrects
// it on first sight. 8 and 9 are pixel-identical at the 5×7 grid (the 10px
// window cuts the ~14px glyph's right side); measureScore disambiguates them
// via the 8's bottom-left leg (ink at x0-2..x0-1, rows 12-14).
const DINO_DIGIT_0 = [0,1,1,1,1, 1,1,1,1,1, 1,1,1,1,1, 1,1,0,0,0, 1,1,0,0,0, 1,1,0,0,0, 1,1,0,0,0];
const DINO_DIGIT_1 = [0,0,1,1,1, 0,1,1,1,1, 0,1,1,1,1, 1,1,1,1,1, 1,1,1,1,1, 1,1,1,1,1, 0,0,1,1,1];
const DINO_DIGIT_2 = [0,1,1,1,1, 0,1,1,1,1, 1,1,1,1,1, 1,1,0,0,0, 0,0,0,0,1, 0,0,0,1,1, 0,0,1,1,1];
const DINO_DIGIT_4 = [0,0,0,0,1, 0,0,0,1,1, 0,0,0,1,1, 0,1,1,1,1, 0,1,1,1,1, 1,1,1,1,1, 1,1,0,0,1];
const DINO_DIGIT_5 = [1,1,1,1,1, 1,1,1,1,1, 1,1,1,1,1, 1,1,1,0,0, 1,1,1,1,0, 1,1,1,1,1, 1,1,1,1,1];
const DINO_DIGIT_6 = [0,1,1,1,1, 1,1,1,1,1, 1,1,1,1,1, 1,1,1,0,0, 1,1,1,0,0, 1,1,1,1,1, 1,1,1,1,1];
const DINO_DIGIT_7 = [1,1,1,1,1, 1,1,1,1,1, 1,1,1,1,1, 0,0,0,0,0, 0,0,0,0,1, 0,0,0,0,1, 0,0,0,0,1];
const DINO_DIGIT_8 = [1,1,1,1,1, 1,1,1,1,1, 1,1,1,1,1, 1,1,0,0,0, 1,1,1,0,1, 1,1,1,1,1, 1,1,1,1,1];
const DINO_DIGIT_9 = [1,1,1,1,1, 1,1,1,1,1, 1,1,1,1,1, 1,1,0,0,0, 1,1,1,0,1, 1,1,1,1,1, 1,1,1,1,1];

// ── Dino rank glyph templates ("#TH" under the score) ─────────────────
// Extracted 2026-08-13 from 12 consecutive frames of one session (score
// 10500→17100, rank "10TH") — pixel-identical across all frames. The rank
// row sits at y=24..44 (upscaled), right-aligned under the score at
// x=354..423, glyphs 10-16px wide × 21px tall. Adaptive 5×7 vectors are
// extracted over each glyph's own bbox (extractGlyphVector), so the varying
// glyph widths (10px "1", 16px "0", 14px letters) normalize away.
// The rank glyphs are WHITE (like all HUD elements except the score) — the
// isInkPixel white clause (g>195 && b>215) catches them, confirmed against
// 12 frames. The rank font is a slightly narrower variant of the score
// font — the rank "0" is a SQUARE rectangle while the score "0" is rounded
// with a bulge — so rank digits use their own reference set. The rank is
// not displayed in room 1 (appears after beating the first enemies):
// measureRank returns null when the zone is empty. Only 1/0/T/H sampled so
// far; unknown glyphs (digits 2-9, letters S/N/D/R) are logged at runtime
// for later extraction.
const RANK_REF_1 = [0,0,0,1,1, 0,0,1,1,1, 1,1,1,1,1, 0,0,0,1,1, 0,0,0,1,1, 0,0,0,1,1, 0,0,0,1,1];
const RANK_REF_0 = [0,1,1,1,0, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 0,1,1,1,0];
const RANK_REF_T = [1,1,1,1,1, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0];
const RANK_REF_H = [1,1,0,0,1, 1,1,0,0,1, 1,1,0,0,1, 1,1,1,1,1, 1,1,0,0,1, 1,1,0,0,1, 1,1,0,0,1];

/** Rank glyph references — digits and letters share one table. */
const RankGlyphRefs: { key: string; kind: "digit" | "letter"; value: number | string; vec: number[] }[] = [
  { key: "1", kind: "digit", value: 1, vec: RANK_REF_1 },
  { key: "0", kind: "digit", value: 0, vec: RANK_REF_0 },
  { key: "T", kind: "letter", value: "T", vec: RANK_REF_T },
  { key: "H", kind: "letter", value: "H", vec: RANK_REF_H },
];

// Rank zone detection constants (upscaled pixels).
// RANK_MIN_INK: ink in the mid/bottom rows of the rank zone (y+3..) —
//   the score's bottom bars can reach y≈23 while the zone starts at y=24,
//   so the top 3 rows are excluded from presence detection.
// RANK_MAX_INK: screen-transition solid slabs produce ~2400 ink; a real
//   rank ("10TH" → "99TH") never exceeds ~600.
// RANK_MATCH_DIST: max Hamming distance to accept a glyph classification
//   (bbox jitter ±1px costs 1-3 bits; real glyphs sit at 0-2).
const RANK_MIN_INK = 20;
const RANK_MAX_INK = 900;
const RANK_MATCH_DIST = 5;
const RANK_ABSENT_CLEAR_FRAMES = 3;

// Dino's CPS1 font is a bold gradient (navy outline + light-cyan fill) drawn
// directly on the game screen — no fixed HUD panel behind the score. The 3×
// nearest-neighbor upscale means each native pixel becomes a 3×3 block, so
// the 5×7 grid sampling is robust against pixel-boundary misalignment.
//
// These references are used as initial defaults. On first successful read,
// the actual measured vectors are auto-calibrated (cached in scoreDigitRefs).

const ScoreDigitRefs: number[][] = [
  // 0
  [1,1,1,1,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,1,1,1,1],
  // 1
  [0,0,1,0,0, 0,1,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 1,1,1,1,1],
  // 2
  [1,1,1,1,1, 0,0,0,0,1, 0,0,0,0,1, 1,1,1,1,1, 1,0,0,0,0, 1,0,0,0,0, 1,1,1,1,1],
  // 3
  [1,1,1,1,1, 0,0,0,0,1, 0,0,0,0,1, 1,1,1,1,1, 0,0,0,0,1, 0,0,0,0,1, 1,1,1,1,1],
  // 4
  [1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,1,1,1,1, 0,0,0,0,1, 0,0,0,0,1, 0,0,0,0,1],
  // 5
  [1,1,1,1,1, 1,0,0,0,0, 1,0,0,0,0, 1,1,1,1,1, 0,0,0,0,1, 0,0,0,0,1, 1,1,1,1,1],
  // 6
  [1,1,1,1,1, 1,0,0,0,0, 1,0,0,0,0, 1,1,1,1,1, 1,0,0,0,1, 1,0,0,0,1, 1,1,1,1,1],
  // 7
  [1,1,1,1,1, 0,0,0,0,1, 0,0,0,1,0, 0,0,1,0,0, 0,1,0,0,0, 1,0,0,0,0, 1,0,0,0,0],
  // 8
  [1,1,1,1,1, 1,0,0,0,1, 1,0,0,0,1, 1,1,1,1,1, 1,0,0,0,1, 1,0,0,0,1, 1,1,1,1,1],
  // 9
  [1,1,1,1,1, 1,0,0,0,1, 1,0,0,0,1, 1,1,1,1,1, 0,0,0,0,1, 0,0,0,0,1, 0,0,0,0,1],
];
