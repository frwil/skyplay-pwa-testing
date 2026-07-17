import { DIGIT_TEMPLATE_W, DIGIT_TEMPLATE_H, type PixelGameConfig } from "./pixel-game-config.js";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";

/**
 * Per-frame timer digit recognizer with temporal validation.
 *
 * Extracts two 7-segment-style digits from a health-bar stripe via template
 * matching (Hamming distance), validates that consecutive readings obey
 * timer semantics (only decreases by 1, resets to 99), and handles the
 * end-of-round blinking-00 edge case where digits alternate between
 * readable and unreadable.
 */
export class TimerDetector {
  private lastTimerValue = -1;
  private timerStableFrames = 0;
  private blinkGraceFrames = 0;
  /** Pending downward-jump / 99-reset value awaiting 2-frame confirmation. */
  private pendingValue = -1;
  private pendingCount = 0;
  private readonly timerConfig: PixelGameConfig["timer"];
  /** Number of consecutive unreadable frames after seeing "01" to decide it's "00". */
  private readonly BLINK_GRACE = 3;
  /** Frame counter for periodic debug logging. */
  private debugFrameCount = 0;
  /** Dump raw digit bitmaps every N read attempts. */
  private readonly DEBUG_DUMP_INTERVAL = 10;
  /** One-shot PPM dump flag — saves stripe + digit regions on first frame. */
  private debugPpmSaved = false;
  /** Set of "L-7", "R-3" keys already saved as templates — one sample per digit per position. */
  private savedDigits = new Set<string>();
  /** Path to the template output directory. */
  private readonly TEMPLATE_DIR = "/recordings/templates";
  /** Counter for calibration PNG captures (cap-0000.png, cap-0001.png, ...). */
  private captureCounter = 0;
  /** Set of timer values already captured — avoids duplicates. */
  private capturedValues = new Set<number>();
  /**
   * Per-game captured digit templates.
   * [0] = left side (tens), [1] = right side (ones).
   * Each is array of 10: index = digit value (0-9), value = 12-row bitmap or null.
   * Populated during match via countdown semantics and used in preference to hardcoded templates.
   */
  private capturedDigits: (number[] | null)[][] = [
    Array(10).fill(null),
    Array(10).fill(null),
  ];

  constructor(timerConfig: PixelGameConfig["timer"]) {
    this.timerConfig = timerConfig;
  }

  getLastValue(): number {
    return this.lastTimerValue;
  }

  reset(): void {
    this.lastTimerValue = -1;
    this.timerStableFrames = 0;
    this.blinkGraceFrames = 0;
    this.pendingValue = -1;
    this.pendingCount = 0;
    this.savedDigits.clear();
    // NOTE: capturedDigits is NOT cleared here — it survives round transitions.
    // Only resetCalibration() (called at match start) clears it.
  }

  /** Clear per-game captured templates. Called at the start of a new match. */
  resetCalibration(): void {
    this.capturedDigits = [Array(10).fill(null), Array(10).fill(null)];
    this.capturedValues.clear();
    this.captureCounter = 0;
  }

  /** Capture a digit bitmap with a known ground-truth label (from countdown). */
  private captureDigit(side: 0 | 1, digitValue: number, bits: number[]): void {
    if (digitValue < 0 || digitValue > 9) return;
    if (this.capturedDigits[side]![digitValue] !== null) return; // already captured
    this.capturedDigits[side]![digitValue] = [...bits];
  }

  /**
   * Read the timer from a raw RGB24 frame of the health bar stripe.
   * Returns 0-99 on a validated reading, or -1 if unrecognizable / unstable.
   *
   * Uses bounding-box extraction within search windows (one per digit)
   * because SFA2 digits have variable widths (1 is ~16px, 7 is ~24px).
   * Fixed-geometry downsampling fails when a narrow digit is drowned in
   * black pixels.
   */
  readFromFrame(frame: Buffer, width: number, height: number): number {
    const t = this.timerConfig;
    if (!t) return -1;

    const searchW = t.digitW;
    const leftStart = t.leftDigitX;
    const rightStart = t.rightDigitX;

    const minRatio = t.minBrightRatio;

    // ── One-time PPM dump ──
    if (!this.debugPpmSaved) {
      this.debugPpmSaved = true;
      this.saveDigitPpm(frame, width, height, leftStart, 0, searchW, height, "timer-debug-left.ppm");
      this.saveDigitPpm(frame, width, height, rightStart, 0, searchW, height, "timer-debug-right.ppm");
      this.saveFullStripePpm(frame, width, height, "timer-debug-stripe.ppm");
    }

    // Extract digit bitmaps via bounding-box within each search window
    const leftBits = this.extractDigitBits(frame, width, height, leftStart, leftStart + searchW);
    const rightBits = this.extractDigitBits(frame, width, height, rightStart, rightStart + searchW);

    if (!leftBits || !rightBits) {
      return this.handleBlinking00(-1);
    }

    const left = this.matchDigit(leftBits, t.digits, 0);
    const right = this.matchDigit(rightBits, t.digits, 1);
    const rawValue = left * 10 + right;

    // ── Debug: periodic dump ──
    this.debugFrameCount++;
    if (this.debugFrameCount % this.DEBUG_DUMP_INTERVAL === 1) {
      const leftDists = this.allDigitDistances(leftBits);
      const rightDists = this.allDigitDistances(rightBits);
      console.log(
        `[timer-debug] frame=${this.debugFrameCount} raw=${left}/${right} → ${rawValue} ` +
        `lastTimer=${this.lastTimerValue} stableFrames=${this.timerStableFrames}`
      );
      console.log(`[timer-debug]   left bitmap:  0b${leftBits.map(b => b.toString(2).padStart(8, "0")).join(",0b")}`);
      console.log(`[timer-debug]   left distances: [${leftDists.join(",")}] → ${left}`);
      console.log(`[timer-debug]   right bitmap: 0b${rightBits.map(b => b.toString(2).padStart(8, "0")).join(",0b")}`);
      console.log(`[timer-debug]   right distances:[${rightDists.join(",")}] → ${right}`);
      this.dumpDigitAscii("left", leftBits);
      this.dumpDigitAscii("right", rightBits);
    }

    if (rawValue < 0 || rawValue > 99) {
      return this.handleBlinking00(-1);
    }

    const result = this.validateTemporal(rawValue, frame, width, leftBits, rightBits);

    // ── Template collection ──
    if (result >= 0) {
      const tens = Math.floor(result / 10);
      const ones = result % 10;
      this.saveTemplateSample(frame, width, leftStart, 0, searchW, height, "L", tens);
      this.saveTemplateSample(frame, width, rightStart, 0, searchW, height, "R", ones);
    }

    return result;
  }

  // ── Private helpers ────────────────────────────────────────────────

  /**
   * Handle the blinking-00 edge case: when the timer transitions from 01 to
   * unreadable at round end (digits flicker), count consecutive unreadable
   * frames. After BLINK_GRACE frames, treat it as confirmed 00.
   */
  private handleBlinking00(rawValue: number): number {
    // Only activate blink detection when we were just at 01 or 00
    if (this.lastTimerValue === 1 || this.lastTimerValue === 0) {
      this.blinkGraceFrames++;
      if (this.blinkGraceFrames >= this.BLINK_GRACE) {
        // Confirmed: timer hit 00 and is now blinking/unreadable
        if (this.lastTimerValue !== 0) {
          this.lastTimerValue = 0;
          this.timerStableFrames = 0;
          this.blinkGraceFrames = 0;
        }
        return 0;
      }
      return -1; // still waiting for confirmation
    }
    this.blinkGraceFrames = 0;
    return -1;
  }

  /**
   * Validate a new timer reading against temporal constraints.
   * Timer only decreases by 1 (or resets to 99 for new round).
   * Returns the validated value or -1 if rejected.
   */
  private validateTemporal(rawValue: number, frame?: Buffer, frameWidth?: number, leftBits?: number[], rightBits?: number[]): number {
    if (rawValue === this.lastTimerValue) {
      this.timerStableFrames++;
      this.blinkGraceFrames = 0;
      return this.lastTimerValue; // already reported
    }

    // New value — validate temporal constraints.
    const last = this.lastTimerValue;
    const isFirstReading = last < 0;
    const isMinusOne = rawValue === last - 1;
    const isJumpDown = rawValue < last;
    const isRoundReset = rawValue === 99 && last >= 0;

    if (isFirstReading || isMinusOne) {
      this.blinkGraceFrames = 0;
      this.pendingValue = -1;
      this.pendingCount = 0;
      this.lastTimerValue = rawValue;
      // Dynamic calibration: capture digits with ground-truth labels from countdown
      if (leftBits && rightBits) {
        const tens = Math.floor(rawValue / 10);
        const ones = rawValue % 10;
        this.captureDigit(0, tens, leftBits);
        this.captureDigit(1, ones, rightBits);
      }
      if (isFirstReading) {
        console.log(`[pixel-analyzer] ⏱️ Timer: ${rawValue} (first reading)`);
      }
      // Capture PNG for manual calibration
      if (frame && frameWidth !== undefined && !this.capturedValues.has(rawValue)) {
        this.capturedValues.add(rawValue);
        this.saveTimerPng(frame, frameWidth, rawValue, leftBits, rightBits);
      }
      return rawValue;
    }

    if (isJumpDown || isRoundReset) {
      this.blinkGraceFrames = 0;
      if (this.pendingValue === rawValue) {
        this.pendingCount++;
        if (this.pendingCount >= 2) {
          this.pendingValue = -1;
          this.pendingCount = 0;
          this.lastTimerValue = rawValue;
          // Dynamic calibration: capture digits from confirmed jump/reset
          if (leftBits && rightBits) {
            const tens = Math.floor(rawValue / 10);
            const ones = rawValue % 10;
            this.captureDigit(0, tens, leftBits);
            this.captureDigit(1, ones, rightBits);
          }
          if (isRoundReset) {
            console.log(`[pixel-analyzer] ⏱️ Timer: ${rawValue} (new round reset, was ${last})`);
          } else {
            console.log(`[pixel-analyzer] ⏱️ Timer: ${rawValue} (jump down from ${last}, confirmed)`);
          }
          // Capture PNG for manual calibration
          if (frame && frameWidth !== undefined && !this.capturedValues.has(rawValue)) {
            this.capturedValues.add(rawValue);
            this.saveTimerPng(frame, frameWidth, rawValue, leftBits, rightBits);
          }
          return rawValue;
        }
      } else {
        this.pendingValue = rawValue;
        this.pendingCount = 1;
      }
      return last >= 0 ? last : -1;
    }

    // Increase that isn't a 99 reset — visual artifact, ignore
    this.pendingValue = -1;
    this.pendingCount = 0;
    this.blinkGraceFrames = 0;
    return last >= 0 ? last : -1;
  }

  /**
   * Save the timer digit region as a PNG for manual calibration.
   * The user identifies the true timer value from the image.
   */
  private saveTimerPng(frame: Buffer, frameWidth: number, rawValue: number, leftBits?: number[], rightBits?: number[]): void {
    try {
      const t = this.timerConfig;
      if (!t) return;
      const dir = "/recordings/calibration";
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      const num = String(this.captureCounter).padStart(4, "0");
      this.captureCounter++;
      const ppmPath = join(dir, `cap-${num}-read${rawValue}.ppm`);
      const pngPath = join(dir, `cap-${num}-read${rawValue}.png`);

      // Capture the full timer region (both digits)
      const x = t.leftDigitX;
      const w = t.rightDigitX + t.digitW - t.leftDigitX;
      const h = t.digitH;
      const y = t.digitYOffset ?? 0;

      const header = `P6\n${w} ${h}\n255\n`;
      const headerBuf = Buffer.from(header, "ascii");
      const pixels = Buffer.alloc(w * h * 3);
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          const srcIdx = ((y + row) * frameWidth + (x + col)) * 3;
          const dstIdx = (row * w + col) * 3;
          pixels[dstIdx] = frame[srcIdx] ?? 0;
          pixels[dstIdx + 1] = frame[srcIdx + 1] ?? 0;
          pixels[dstIdx + 2] = frame[srcIdx + 2] ?? 0;
        }
      }
      writeFileSync(ppmPath, Buffer.concat([headerBuf, pixels]));

      // Convert to PNG
      try {
        execSync(`magick convert "${ppmPath}" "${pngPath}"`, { stdio: "pipe", timeout: 5000 });
      } catch {
        execSync(`convert "${ppmPath}" "${pngPath}"`, { stdio: "pipe", timeout: 5000 });
      }
      // Save metadata JSON with extracted bitmaps for calibration
      if (leftBits && rightBits) {
        const metaPath = join(dir, `cap-${num}-read${rawValue}.json`);
        writeFileSync(metaPath, JSON.stringify({
          capture: `cap-${num}`,
          systemRead: rawValue,
          leftBits,
          leftHex: leftBits.map((b: number) => "0x" + b.toString(16).padStart(2, "0")),
          rightBits,
          rightHex: rightBits.map((b: number) => "0x" + b.toString(16).padStart(2, "0")),
        }, null, 2));
      }
      console.log(`[timer-calibrate] 📷 ${pngPath} (system read: ${rawValue})`);
    } catch (err) {
      console.warn(`[timer-calibrate] Failed to save timer PNG:`, err);
    }
  }

  /**
   * Save a single digit bitmap as a JSON template file for later calibration.
   * Skips if we already have a sample for this digit at this position.
   */
  private saveTemplateSample(
    frame: Buffer, frameWidth: number,
    x: number, y: number, w: number, h: number,
    position: "L" | "R", digitValue: number,
  ): void {
    const key = `${position}-${digitValue}`;
    if (this.savedDigits.has(key)) return;
    this.savedDigits.add(key);

    try {
      const bits = this.recognizeDigitDebug(frame, frameWidth, x, y, w, h);
      const dir = this.TEMPLATE_DIR;
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const path = join(dir, `digit-${key}.json`);
      writeFileSync(path, JSON.stringify({
        position,
        value: digitValue,
        bits,
        bitsHex: bits.map((b: number) => "0x" + b.toString(16).padStart(2, "0")),
        capturedAt: new Date().toISOString(),
      }, null, 2));
      console.log(`[timer-calibrate] 📸 Saved template sample: ${key} → ${path}`);
    } catch (err) {
      console.warn(`[timer-calibrate] Failed to save template ${key}:`, err);
    }
  }

  /**
   * Recognize a single timer digit from a cropped region of the frame.
   * Downsamples the region to DIGIT_TEMPLATE_W×DIGIT_TEMPLATE_H,
   * binarizes via threshold, then compares against each template via
   * Hamming distance (XOR popcount). Returns the best-match digit 0-9.
   */
  /**
   * Extract a digit bitmap from a horizontal search window within the stripe.
   * Finds the bounding box of pixels above the binarization threshold,
   * then downsamples that bbox to TW×TH bits. Returns null if no digit found.
   */
  private extractDigitBits(
    frame: Buffer, frameWidth: number, frameHeight: number,
    xStart: number, xEnd: number,
  ): number[] | null {
    const threshold = this.timerConfig!.binarizeThreshold ?? 160;

    // Find bounding box of bright pixels within the search window
    let minX = Infinity, maxX = -1, minY = Infinity, maxY = -1;
    for (let y = 0; y < frameHeight; y++) {
      for (let x = xStart; x < xEnd && x < frameWidth; x++) {
        const idx = (y * frameWidth + x) * 3;
        const r = frame[idx] ?? 0, g = frame[idx + 1] ?? 0, b = frame[idx + 2] ?? 0;
        if ((r + g + b) / 3 > threshold) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < 0 || (maxX - minX) < 5 || (maxY - minY) < 10) return null;

    const bbW = maxX - minX + 1;
    const bbH = maxY - minY + 1;
    const cellW = bbW / DIGIT_TEMPLATE_W;
    const cellH = bbH / DIGIT_TEMPLATE_H;
    const bits: number[] = [];

    for (let tr = 0; tr < DIGIT_TEMPLATE_H; tr++) {
      let rowBits = 0;
      for (let tc = 0; tc < DIGIT_TEMPLATE_W; tc++) {
        let sum = 0, count = 0;
        const sx = Math.round(minX + tc * cellW);
        const sy = Math.round(minY + tr * cellH);
        const ex = Math.round(minX + (tc + 1) * cellW);
        const ey = Math.round(minY + (tr + 1) * cellH);
        for (let py = sy; py < ey && py <= maxY; py++) {
          for (let px = sx; px < ex && px <= maxX; px++) {
            const idx = (py * frameWidth + px) * 3;
            sum += (frame[idx] ?? 0) + (frame[idx + 1] ?? 0) + (frame[idx + 2] ?? 0);
            count += 3;
          }
        }
        if (count > 0 && sum / count > threshold * 0.75) rowBits |= (1 << (7 - tc));
      }
      bits.push(rowBits);
    }
    return bits;
  }

  /**
   * Match a binarized digit bitmap against templates via Hamming distance.
   * Returns the best-match digit 0-9.
   */
  /**
   * Match a binarized digit bitmap against templates via Hamming distance.
   * Prefers per-game captured templates over hardcoded ones.
   * @param side 0 = left (tens), 1 = right (ones)
   */
  private matchDigit(bits: number[], templates: number[][], side: 0 | 1): number {
    let bestDigit = 0;
    let bestDist = Infinity;
    const captured = this.capturedDigits[side]!;
    for (let d = 0; d < 10; d++) {
      // Prefer captured (per-game) template, fall back to hardcoded
      const tmpl = captured[d] ?? templates[d];
      if (!tmpl) continue;
      let dist = 0;
      for (let r = 0; r < DIGIT_TEMPLATE_H; r++) {
        const xor = (bits[r] ?? 0) ^ (tmpl[r] ?? 0);
        let v = xor;
        while (v) { dist++; v &= v - 1; }
      }
      if (dist < bestDist) { bestDist = dist; bestDigit = d; }
    }
    return bestDigit;
  }

  /**
   * Recognize a single timer digit from a search window within the frame.
   * Uses bounding-box extraction + template matching.
   * (x, y, w, h) defines the search window within the stripe.
   */
  private recognizeDigit(
    frame: Buffer, frameWidth: number,
    x: number, y: number, w: number, h: number,
    templates: number[][],
  ): number {
    const bits = this.extractDigitBits(frame, frameWidth, h, x, x + w);
    if (!bits) return 0;
    return this.matchDigit(bits, templates, 0);
  }

  /**
   * Debug variant: extract raw 8×12 bitmap via bounding box.
   * (x, y, w, h) defines the search window.
   */
  private recognizeDigitDebug(
    frame: Buffer, frameWidth: number,
    x: number, y: number, w: number, h: number,
  ): number[] {
    return this.extractDigitBits(frame, frameWidth, h, x, x + w) ?? Array(DIGIT_TEMPLATE_H).fill(0);
  }

  /** Compute Hamming distances from a raw bitmap to all 10 digit templates. */
  private allDigitDistances(bits: number[]): number[] {
    const t = this.timerConfig;
    if (!t) return [];
    return Array.from({ length: 10 }, (_, d) => {
      const tmpl = t.digits[d];
      if (!tmpl) return Infinity;
      let dist = 0;
      for (let r = 0; r < DIGIT_TEMPLATE_H; r++) {
        const xor = (bits[r] ?? 0) ^ (tmpl[r] ?? 0);
        let v = xor;
        while (v) { dist++; v &= v - 1; }
      }
      return dist;
    });
  }

  /** ASCII dump of a digit bitmap for visual inspection in logs. */
  private dumpDigitAscii(label: string, bits: number[]): void {
    const lines: string[] = [];
    for (let r = 0; r < bits.length; r++) {
      let line = "";
      for (let c = 7; c >= 0; c--) {
        line += (bits[r]! & (1 << c)) ? "██" : "  ";
      }
      lines.push(`[timer-debug]   ${label} row${String(r).padStart(2,"0")}: |${line}|`);
    }
    console.log(lines.join("\n"));
  }

  /** Save a digit sub-region as a PPM (P6 binary) file for visual inspection. */
  private saveDigitPpm(
    frame: Buffer, frameW: number, _frameH: number,
    x: number, y: number, w: number, h: number,
    filename: string,
  ): void {
    try {
      const dir = "/recordings";
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const path = join(dir, filename);
      // P6 header: "P6\nW H\n255\n" + raw RGB bytes
      const header = `P6\n${w} ${h}\n255\n`;
      const headerBuf = Buffer.from(header, "ascii");
      const pixels = Buffer.alloc(w * h * 3);
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          const srcIdx = ((y + row) * frameW + (x + col)) * 3;
          const dstIdx = (row * w + col) * 3;
          pixels[dstIdx] = frame[srcIdx] ?? 0;
          pixels[dstIdx + 1] = frame[srcIdx + 1] ?? 0;
          pixels[dstIdx + 2] = frame[srcIdx + 2] ?? 0;
        }
      }
      writeFileSync(path, Buffer.concat([headerBuf, pixels]));
      console.log(`[timer-debug] saved ${filename} (${w}×${h}) to ${path}`);
      this.convertPpmToPng(path);
    } catch (err) {
      console.warn(`[timer-debug] failed to save ${filename}:`, err);
    }
  }

  /** Save the full health-bar stripe as a PPM for visual inspection. */
  private saveFullStripePpm(
    frame: Buffer, width: number, height: number, filename: string,
  ): void {
    try {
      const dir = "/recordings";
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const path = join(dir, filename);
      const header = `P6\n${width} ${height}\n255\n`;
      const headerBuf = Buffer.from(header, "ascii");
      writeFileSync(path, Buffer.concat([headerBuf, frame]));
      console.log(`[timer-debug] saved ${filename} (${width}×${height}) to ${path}`);
      this.convertPpmToPng(path);
    } catch (err) {
      console.warn(`[timer-debug] failed to save ${filename}:`, err);
    }
  }

  /** Convert a PPM file to PNG using ImageMagick for easy visual inspection. */
  private convertPpmToPng(ppmPath: string): void {
    try {
      const pngPath = ppmPath.replace(/\.ppm$/i, ".png");
      // Try ImageMagick 7 CLI first, fall back to v6
      try {
        execSync(`magick convert "${ppmPath}" "${pngPath}"`, { stdio: "pipe", timeout: 5000 });
      } catch {
        execSync(`convert "${ppmPath}" "${pngPath}"`, { stdio: "pipe", timeout: 5000 });
      }
      if (existsSync(pngPath)) {
        console.log(`[timer-debug] converted to ${pngPath}`);
      }
    } catch (err) {
      // Non-fatal: PPM is still saved, user can convert manually
      console.warn(`[timer-debug] ImageMagick conversion failed (PPM saved):`, String(err));
    }
  }
}
