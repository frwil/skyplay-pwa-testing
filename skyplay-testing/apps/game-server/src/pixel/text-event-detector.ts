import { EventEmitter } from "events";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
import { type TextEventConfig } from "./pixel-game-config.js";

/**
 * Brightness-spike text overlay detector for center-screen crop frames.
 *
 * During normal combat the center screen is mostly dark stage background +
 * moving characters. When a text overlay appears (KO, ROUND 1, PERFECT,
 * DRAW GAME, TIME OVER, FIGHT!, FINAL ROUND), the white/yellow text
 * creates a sudden spike in the bright-pixel count.
 *
 * This detector measures the bright-pixel ratio in each frame and fires
 * events when the ratio crosses above/below the configured threshold.
 * The state machine (PixelMatchAnalyzer) interprets the event based on
 * its current phase — this detector is intentionally "dumb" and just
 * reports brightness changes.
 */

export interface TextOverlayEvent {
  /** Peak bright-pixel ratio observed during this event (0-1). */
  peakRatio: number;
  /** Number of consecutive frames above threshold before firing. */
  confirmFrames: number;
}

export class TextEventDetector extends EventEmitter {
  private config: TextEventConfig;
  private brightFrames = 0;
  private darkFrames = 0;
  private cooldownRemaining = 0;
  private overlayActive = false;
  private peakRatio = 0;
  private totalFrames = 0;

  constructor(config: TextEventConfig) {
    super();
    this.config = config;
  }

  /** Process a raw RGB24 frame of the text crop region. */
  processFrame(frame: Buffer, width: number, height: number): void {
    this.totalFrames++;

    if (this.cooldownRemaining > 0) {
      this.cooldownRemaining--;
      return;
    }

    const brightPixels = this.countBrightPixels(frame, width, height);
    const totalPixels = width * height;
    const ratio = brightPixels / totalPixels;

    if (ratio >= this.config.minBrightRatio) {
      this.darkFrames = 0;
      this.brightFrames++;
      if (ratio > this.peakRatio) this.peakRatio = ratio;

      if (this.brightFrames >= this.config.confirmFrames && !this.overlayActive) {
        this.overlayActive = true;
        // Auto-save the raw crop frame for template collection (first 20 detections)
        this.autoSaveFrame(frame, width, height);
        // Pause RetroArch for template capture (dev mode)
        this.pauseForCapture();
        this.emit("textOverlayAppeared", {
          peakRatio: this.peakRatio,
          confirmFrames: this.brightFrames,
        } satisfies TextOverlayEvent);
      }
    } else {
      this.brightFrames = 0;
      this.darkFrames++;

      if (this.overlayActive && this.darkFrames >= 3) {
        // Text overlay has cleared
        this.overlayActive = false;
        this.peakRatio = 0;
        this.cooldownRemaining = this.config.cooldownFrames;
        this.emit("textOverlayCleared", {});
      }
    }
  }

  /** Get the current bright-pixel ratio (for diagnostics). */
  getBrightRatio(frame: Buffer, width: number, height: number): number {
    return this.countBrightPixels(frame, width, height) / (width * height);
  }

  /** Whether a text overlay is currently active. */
  isOverlayActive(): boolean {
    return this.overlayActive;
  }

  getTotalFrames(): number {
    return this.totalFrames;
  }

  /** Reset internal state for a new match/round. */
  reset(): void {
    this.brightFrames = 0;
    this.darkFrames = 0;
    this.cooldownRemaining = 0;
    this.overlayActive = false;
    this.peakRatio = 0;
    this.totalFrames = 0;
    this._saveCount = 0;
  }

  /** Auto-save raw crop frame as PPM for template collection. */
  private _saveCount = 0;
  private autoSaveFrame(frame: Buffer, width: number, height: number): void {
    if (this._saveCount >= 20) return; // limit to first 20 detections
    try {
      const dir = "/recordings/text-templates";
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const tag = `detect-${String(this._saveCount).padStart(3, "0")}-r${Math.round(this.peakRatio * 1000)}`;
      const ppmPath = join(dir, `${tag}.ppm`);
      const header = `P6\n${width} ${height}\n255\n`;
      writeFileSync(ppmPath, Buffer.concat([Buffer.from(header, "ascii"), frame]));
      console.log(`[text-detector] 💾 Saved text frame: ${ppmPath} (${width}x${height}, ratio=${(this.peakRatio * 100).toFixed(1)}%)`);
      this._saveCount++;
    } catch (e) {
      console.log(`[text-detector] Failed to save text frame: ${(e as Error).message}`);
    }
  }

  /** Pause RetroArch on text detection for template capture.
   *  Does NOT auto-unpause — the operator manually resumes via CLI. */
  private pauseForCapture(): void {
    if (!this.config.pauseOnDetect) return;
    try {
      execSync("xdotool key p", { timeout: 1000 });
      console.log(`[text-detector] ⏸️  PAUSED — template #${this._saveCount} saved, ratio=${(this.peakRatio * 100).toFixed(1)}% — run: docker exec game-server-game-server-1 xdotool key p`);
    } catch (e) {
      console.log(`[text-detector] Failed to pause RetroArch: ${(e as Error).message}`);
    }
  }

  /** Count pixels above the binarization threshold (colored text on dark bg).
   *  SFA2 uses white text for "ROUND 1/2/3", but yellow/orange/red for
   *  "FIGHT!", "KO", "PERFECT", etc. — so we use max-channel brightness
   *  rather than requiring ALL channels to be bright (which only matches white). */
  private countBrightPixels(frame: Buffer, width: number, height: number): number {
    const threshold = this.config.binarizeThreshold;
    const len = width * height * 3; // RGB24
    if (frame.length < len) return 0;

    let count = 0;
    // Sample every 4th pixel for performance. Text overlays are large enough
    // that sampling doesn't affect detection.
    for (let i = 0; i < len; i += 12) { // 12 bytes = 4 pixels × 3 channels
      const r = frame[i];
      const g = frame[i + 1];
      const b = frame[i + 2];
      // Colored text (yellow/orange/red/white) — at least one channel is bright.
      // Stage backgrounds typically have all channels dark in the center zone.
      if (r > threshold || g > threshold || b > threshold) {
        count++;
      }
    }
    return count * 4; // scale back up (we sampled every 4th pixel)
  }
}
