import { DIGIT_TEMPLATE_W, DIGIT_TEMPLATE_H, type PixelGameConfig } from "./pixel-game-config.js";

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
  private readonly timerConfig: PixelGameConfig["timer"];
  private readonly TIMER_STABLE_REQUIRED = 3;
  /** Number of consecutive unreadable frames after seeing "01" to decide it's "00". */
  private readonly BLINK_GRACE = 3;

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
  }

  /**
   * Read the timer from a raw RGB24 frame of the health bar stripe.
   * Returns 0-99 on a validated reading, or -1 if unrecognizable / unstable.
   */
  readFromFrame(frame: Buffer, width: number, height: number): number {
    const t = this.timerConfig;
    if (!t) return -1;

    const DIGIT_W = t.digitW;
    const DIGIT_H = t.digitH;
    const leftX = t.leftDigitX;
    const rightX = t.rightDigitX;
    const y = Math.max(0, Math.floor((height - DIGIT_H) / 2)); // center vertically in stripe
    const minRatio = t.minBrightRatio;

    // Basic guard: check if the region has enough bright pixels
    const checkBright = (cx: number): boolean => {
      let bright = 0, total = 0;
      for (let row = 0; row < DIGIT_H && (y + row) < height; row++) {
        for (let col = 0; col < DIGIT_W && (cx + col) < width; col++) {
          const idx = ((y + row) * width + (cx + col)) * 3;
          const r = frame[idx] ?? 0, g = frame[idx + 1] ?? 0, b = frame[idx + 2] ?? 0;
          if ((r + g + b) / 3 > 80) bright++;
          total++;
        }
      }
      return total > 0 && bright / total > minRatio;
    };

    if (!checkBright(leftX) || !checkBright(rightX)) {
      // Both digits unreadable — maybe blinking 00 at round end?
      return this.handleBlinking00(-1);
    }

    const left = this.recognizeDigit(frame, width, leftX, y, DIGIT_W, DIGIT_H, t.digits);
    const right = this.recognizeDigit(frame, width, rightX, y, DIGIT_W, DIGIT_H, t.digits);
    const rawValue = left * 10 + right;

    if (rawValue < 0 || rawValue > 99) {
      return this.handleBlinking00(-1);
    }

    return this.validateTemporal(rawValue);
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
  private validateTemporal(rawValue: number): number {
    if (rawValue === this.lastTimerValue) {
      this.timerStableFrames++;
      this.blinkGraceFrames = 0;
      return this.lastTimerValue; // already reported
    }

    // New value — validate temporal constraints
    const isValidDecrease = rawValue === this.lastTimerValue - 1 && this.lastTimerValue >= 0;
    const isNewRoundReset = rawValue === 99 && this.lastTimerValue >= 0;

    if (isValidDecrease || isNewRoundReset || this.lastTimerValue < 0) {
      this.timerStableFrames++;
      this.blinkGraceFrames = 0;
      if (this.timerStableFrames >= this.TIMER_STABLE_REQUIRED) {
        this.lastTimerValue = rawValue;
        this.timerStableFrames = 0;
        return rawValue;
      }
      return this.lastTimerValue >= 0 ? this.lastTimerValue : -1;
    } else {
      // Invalid transition — ignore (blinking, visual artifact)
      this.timerStableFrames = 0;
      this.blinkGraceFrames = 0;
      return this.lastTimerValue >= 0 ? this.lastTimerValue : -1;
    }
  }

  /**
   * Recognize a single timer digit from a cropped region of the frame.
   * Downsamples the region to DIGIT_TEMPLATE_W×DIGIT_TEMPLATE_H,
   * binarizes via threshold, then compares against each template via
   * Hamming distance (XOR popcount). Returns the best-match digit 0-9.
   */
  private recognizeDigit(
    frame: Buffer, frameWidth: number,
    x: number, y: number, w: number, h: number,
    templates: number[][],
  ): number {
    // Step 1: determine brightness threshold (median of the region)
    const samples: number[] = [];
    for (let row = 0; row < h; row += 4) {
      for (let col = 0; col < w; col += 4) {
        const idx = ((y + row) * frameWidth + (x + col)) * 3;
        const r = frame[idx] ?? 0, g = frame[idx + 1] ?? 0, b = frame[idx + 2] ?? 0;
        samples.push((r + g + b) / 3);
      }
    }
    samples.sort((a, b) => a - b);
    const threshold = samples[Math.floor(samples.length * 0.6)] + 20; // upper 40% are "lit"

    // Step 2: downsample to template size
    const cellW = w / DIGIT_TEMPLATE_W;
    const cellH = h / DIGIT_TEMPLATE_H;
    const bits: number[] = [];
    for (let tr = 0; tr < DIGIT_TEMPLATE_H; tr++) {
      let rowBits = 0;
      for (let tc = 0; tc < DIGIT_TEMPLATE_W; tc++) {
        // Average brightness of this cell
        let sum = 0, count = 0;
        const sx = Math.round(x + tc * cellW);
        const sy = Math.round(y + tr * cellH);
        const ex = Math.round(x + (tc + 1) * cellW);
        const ey = Math.round(y + (tr + 1) * cellH);
        for (let py = sy; py < ey && py < y + h; py++) {
          for (let px = sx; px < ex && px < x + w; px++) {
            const idx = (py * frameWidth + px) * 3;
            sum += (frame[idx] ?? 0) + (frame[idx + 1] ?? 0) + (frame[idx + 2] ?? 0);
            count += 3;
          }
        }
        const avg = count > 0 ? sum / count : 0;
        if (avg > threshold) rowBits |= (1 << (7 - tc));
      }
      bits.push(rowBits);
    }

    // Step 3: Hamming distance against each template
    let bestDigit = 0;
    let bestDist = Infinity;
    for (let d = 0; d < 10; d++) {
      const tmpl = templates[d];
      if (!tmpl) continue;
      let dist = 0;
      for (let r = 0; r < DIGIT_TEMPLATE_H; r++) {
        const xor = (bits[r] ?? 0) ^ (tmpl[r] ?? 0);
        // popcount
        let v = xor;
        while (v) { dist++; v &= v - 1; }
      }
      if (dist < bestDist) { bestDist = dist; bestDigit = d; }
    }
    return bestDigit;
  }
}
