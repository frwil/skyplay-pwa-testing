import { EventEmitter } from "events";
import { type PixelGameConfig } from "./pixel-game-config.js";
import { TimerDetector } from "./timer-detector.js";

// ── State machine phases ────────────────────────────────────────────

/** Pixel-based health detection state machine.
 *  Replaces implicit boolean-flag state with explicit phases so every
 *  transition requires multi-frame evidence — no single-frame false positives. */
export enum GamePhase {
  WARMUP       = "WARMUP",        // collecting calibration frames, no KO detection
  PLAYING      = "PLAYING",       // active KO detection
  KO_PENDING   = "KO_PENDING",    // potential KO — confirming over N frames
  KO_CONFIRMED = "KO_CONFIRMED",  // KO confirmed, waiting for new round
  NEW_ROUND    = "NEW_ROUND",     // health bars back, transitioning to next round
  MATCH_END    = "MATCH_END",     // match is over
}

// ── Event payload types ─────────────────────────────────────────────

export interface RoundResultEvent {
  loser: number;      // 1 or 2, or 0 for draw
  winner: number;     // 1 or 2, or 0 for draw
  p1Losses: number;
  p2Losses: number;
  koType: "normal" | "perfect" | "timeout" | "draw";
}

export interface MatchEndEvent {
  winner: number;
  loser: number;
  p1Losses: number;
  p2Losses: number;
  matchNumber: number;
  totalRounds: number;
  perfectKos: number;
}

export interface MatchStateEvent {
  p1Health: number;
  p2Health: number;
  timerValue: number;
  phase: GamePhase;
  p1Losses: number;
  p2Losses: number;
  roundNumber: number;
}

// ── Constants ───────────────────────────────────────────────────────

const KO_THRESHOLD = 2;          // health ≤ this = KO'd
const KO_RECOVERY = 5;          // health > this after KO_PENDING = false alarm
const NEW_ROUND_HEALTH = 80;    // both bars ≥ this = new round
const WARMUP_HEALTHY = 65;      // health ≥ this = "healthy" for warmup counting
const WARMUP_MIN_RATIO = 0.65;
const PERFECT_HEALTH = 95;
const HEALTH_HISTORY_SIZE = 5;
const KO_CONFIRM_REQUIRED = 4;        // ~2s at 2 fps
const NEW_ROUND_CONFIRM_REQUIRED = 5; // ~2.5s at 2 fps
const PLAYING_GRACE_FRAMES = 16;      // ~4s at 4 reads/sec — skips FIGHT! overlay
const TIME_OVER_CONFIRM_REQUIRED = 3; // ~1.5s at 2 fps
const MIN_COL_PIXELS_RATIO = 0.33;    // fraction of stripe height for column to count as "filled"

/**
 * Orchestrates pixel-based health + timer detection for a single game.
 *
 * Owns the full state machine (WARMUP → PLAYING → KO_PENDING →
 * KO_CONFIRMED → MATCH_END), health bar measurement via column-scan +
 * color saturation, timer digit recognition via template matching, and
 * round/match end event emission.
 *
 * Stateless except for the game config — all mutable state is internal
 * and reset-able, so a single instance can be reused across matches.
 */
export class PixelMatchAnalyzer extends EventEmitter {
  // ── Per-ROM config ────────────────────────────────────────────────
  private readonly config: PixelGameConfig;

  // ── Timer detection ───────────────────────────────────────────────
  private timerDetector: TimerDetector | null = null;

  // ── State machine ──────────────────────────────────────────────────
  private gamePhase: GamePhase = GamePhase.WARMUP;
  private playingFrameCount = 0;
  private koConfirmFrames = 0;
  private newRoundConfirmFrames = 0;
  private timeOverConfirmFrames = 0;

  // ── Health bar calibration ─────────────────────────────────────────
  private p1FullBarWidth = 0;
  private p2FullBarWidth = 0;
  private healthHistoryP1: number[] = [];
  private healthHistoryP2: number[] = [];
  private healthStableFrames = 0;
  private healthStableFramesHealthy = 0;
  private fastWarmup = false;
  private healthPollErrorCount = 0;

  // ── Round / match tracking ─────────────────────────────────────────
  private previousP1Health = -1;
  private previousP2Health = -1;
  private p1Losses = 0;
  private p2Losses = 0;
  private roundNumber = 0;
  private matchNumber = 0;
  private matchPerfectKos = 0;
  private matchEnded = false;
  private roundP1MinHealth = 100;
  private roundP2MinHealth = 100;
  private koDetected = false;

  // ── Health bar X regions (set from config, fallback to defaults) ───
  private p1StartX: number;
  private p1EndX: number;
  private p2StartX: number;
  private p2EndX: number;

  constructor(config: PixelGameConfig) {
    super();
    this.config = config;
    this.p1StartX = config.p1StartX;
    this.p1EndX = config.p1EndX;
    this.p2StartX = config.p2StartX;
    this.p2EndX = config.p2EndX;

    if (config.timer) {
      this.timerDetector = new TimerDetector(config.timer);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────

  getPhase(): GamePhase {
    return this.gamePhase;
  }

  getHealth(): { p1: number; p2: number } {
    return { p1: this.previousP1Health, p2: this.previousP2Health };
  }

  getTimerValue(): number {
    return this.timerDetector?.getLastValue() ?? -1;
  }

  getLosses(): { p1: number; p2: number } {
    return { p1: this.p1Losses, p2: this.p2Losses };
  }

  getRoundNumber(): number {
    return this.roundNumber;
  }

  isMatchEnded(): boolean {
    return this.matchEnded;
  }

  /**
   * Main entry point — process a raw RGB24 frame of the health bar stripe.
   * Called by GameRunner for each frame captured by ffmpeg x11grab.
   */
  processFrame(frame: Buffer, width: number, height: number): void {
    if (this.matchEnded) return;
    if (this.healthPollErrorCount >= 10) return;
    this.healthPollErrorCount = 0;

    // ── Measure bar extent (column scan) then normalize ──────────────
    const p1BarEnd = this.measureBarEndX(frame, width, this.p1StartX, 0, this.p1EndX - this.p1StartX, height);
    const p2BarEnd = this.measureBarEndX(frame, width, this.p2StartX, 0, this.p2EndX - this.p2StartX, height);

    const regionW1 = this.p1EndX - this.p1StartX;
    const regionW2 = this.p2EndX - this.p2StartX;
    const p1FullW = this.p1FullBarWidth > 0 ? this.p1FullBarWidth : regionW1;
    const p2FullW = this.p2FullBarWidth > 0 ? this.p2FullBarWidth : regionW2;

    const rawP1 = Math.min(100, Math.round(((p1BarEnd - this.p1StartX) / Math.max(1, p1FullW)) * 100));
    const rawP2 = Math.min(100, Math.round(((p2BarEnd - this.p2StartX) / Math.max(1, p2FullW)) * 100));

    // ── Rolling average ──────────────────────────────────────────────
    this.healthHistoryP1.push(rawP1);
    this.healthHistoryP2.push(rawP2);
    if (this.healthHistoryP1.length > HEALTH_HISTORY_SIZE) this.healthHistoryP1.shift();
    if (this.healthHistoryP2.length > HEALTH_HISTORY_SIZE) this.healthHistoryP2.shift();

    const p1Health = Math.round(this.getSmoothedHealth(this.healthHistoryP1));
    const p2Health = Math.round(this.getSmoothedHealth(this.healthHistoryP2));

    // ── Track round min health (for perfect KO detection) ─────────────
    if (this.gamePhase === GamePhase.PLAYING) {
      if (p1Health > 0) this.roundP1MinHealth = Math.min(this.roundP1MinHealth, p1Health);
      if (p2Health > 0) this.roundP2MinHealth = Math.min(this.roundP2MinHealth, p2Health);
    }

    // ── Timer digit recognition (only if this ROM has timer templates) ──
    let timerValue = -1;
    if (this.timerDetector && this.gamePhase !== GamePhase.WARMUP) {
      timerValue = this.timerDetector.readFromFrame(frame, width, height);
    }

    // ── State machine ────────────────────────────────────────────────
    this.runStateMachine(p1Health, p2Health, rawP1, rawP2, p1BarEnd, p2BarEnd, timerValue);

    // Update previous values for the next frame
    this.previousP1Health = p1Health;
    this.previousP2Health = p2Health;
  }

  /**
   * Reset all internal state for a new match / rematch.
   * @param fastWarmup If true, use a shorter warmup period (8 frames instead of 24).
   */
  reset(fastWarmup = false): void {
    this.gamePhase = GamePhase.WARMUP;
    this.playingFrameCount = 0;
    this.p1FullBarWidth = 0;
    this.p2FullBarWidth = 0;
    this.healthHistoryP1 = [];
    this.healthHistoryP2 = [];
    this.healthStableFrames = 0;
    this.healthStableFramesHealthy = 0;
    this.healthPollErrorCount = 0;
    this.koConfirmFrames = 0;
    this.newRoundConfirmFrames = 0;
    this.timeOverConfirmFrames = 0;
    this.roundP1MinHealth = 100;
    this.roundP2MinHealth = 100;
    this.koDetected = false;
    this.matchEnded = false;
    this.p1Losses = 0;
    this.p2Losses = 0;
    this.roundNumber = 0;
    this.matchPerfectKos = 0;
    this.previousP1Health = -1;
    this.previousP2Health = -1;
    this.fastWarmup = fastWarmup;
    this.timerDetector?.reset();
  }

  /** Signal an unrecoverable ffmpeg error (stops processing). */
  signalError(): void {
    this.healthPollErrorCount++;
  }

  // ── State machine ──────────────────────────────────────────────────

  private runStateMachine(
    p1Health: number, p2Health: number,
    rawP1: number, rawP2: number,
    p1BarEnd: number, p2BarEnd: number,
    timerValue: number,
  ): void {
    const WARMUP_FRAMES = this.fastWarmup ? 8 : 24;

    switch (this.gamePhase) {

      case GamePhase.WARMUP: {
        // Calibrate full-bar width: track the max measured bar extent.
        const p1Extent = p1BarEnd - this.p1StartX;
        const p2Extent = p2BarEnd - this.p2StartX;
        if (p1Extent > this.p1FullBarWidth) this.p1FullBarWidth = p1Extent;
        if (p2Extent > this.p2FullBarWidth) this.p2FullBarWidth = p2Extent;

        this.healthStableFrames++;
        if (rawP1 >= WARMUP_HEALTHY && rawP2 >= WARMUP_HEALTHY) {
          this.healthStableFramesHealthy++;
        }

        if (this.healthStableFrames >= WARMUP_FRAMES) {
          const ratio = this.healthStableFramesHealthy / this.healthStableFrames;
          if (ratio >= WARMUP_MIN_RATIO) {
            this.gamePhase = GamePhase.PLAYING;
            this.playingFrameCount = 0;
            this.fastWarmup = false;
            console.log(`[pixel-analyzer] 🎮 Phase: WARMUP → PLAYING (${this.healthStableFramesHealthy}/${this.healthStableFrames} healthy, ${(ratio * 100).toFixed(0)}%, fullBarW P1=${this.p1FullBarWidth} P2=${this.p2FullBarWidth})`);
          } else {
            // Slide the window: keep oldest 50%
            const keep = Math.floor(WARMUP_FRAMES * 0.5);
            this.healthStableFrames = keep;
            this.healthStableFramesHealthy = Math.floor(this.healthStableFramesHealthy * (keep / (WARMUP_FRAMES + 1)));
            console.log(`[pixel-analyzer] 🎮 Warmup: ${(ratio * 100).toFixed(0)}% < ${(WARMUP_MIN_RATIO * 100).toFixed(0)}% — sliding window`);
          }
        } else if (this.healthStableFrames > 0 && this.healthStableFrames % 8 === 0) {
          console.log(`[pixel-analyzer] 🎮 Warmup: ${this.healthStableFrames}/${WARMUP_FRAMES} (${this.healthStableFramesHealthy} healthy, barW P1=${this.p1FullBarWidth} P2=${this.p2FullBarWidth})`);
        }
        break;
      }

      case GamePhase.PLAYING: {
        this.playingFrameCount++;

        // Grace period: ignore all KO/time-over signals for the first N frames
        if (this.playingFrameCount <= PLAYING_GRACE_FRAMES) break;

        const p1Down = p1Health <= KO_THRESHOLD;
        const p2Down = p2Health <= KO_THRESHOLD;

        // Simultaneous double-drop guard — screen transition, not a real double KO
        if (p1Down && p2Down) break;

        // ── Time-over detection ──────────────────────────────────────
        if (!p1Down && !p2Down && timerValue === 0) {
          this.timeOverConfirmFrames++;
          if (this.timeOverConfirmFrames >= TIME_OVER_CONFIRM_REQUIRED) {
            if (p1Health > p2Health) {
              this.p2Losses++;
              this.roundNumber++;
              console.log(`[pixel-analyzer] ⏱️ TIME OVER! P1 wins (health P1=${p1Health}% > P2=${p2Health}%). Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
              this.emit("roundResult", { loser: 2, winner: 1, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType: "timeout" } satisfies RoundResultEvent);
            } else if (p2Health > p1Health) {
              this.p1Losses++;
              this.roundNumber++;
              console.log(`[pixel-analyzer] ⏱️ TIME OVER! P2 wins (health P2=${p2Health}% > P1=${p1Health}%). Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
              this.emit("roundResult", { loser: 1, winner: 2, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType: "timeout" } satisfies RoundResultEvent);
            } else {
              this.p1Losses++;
              this.p2Losses++;
              this.roundNumber++;
              console.log(`[pixel-analyzer] ⏱️ TIME OVER DRAW! Equal health (P1=${p1Health}% P2=${p2Health}%). Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
              this.emit("roundResult", { loser: 0, winner: 0, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType: "draw" } satisfies RoundResultEvent);
            }
            this.gamePhase = GamePhase.KO_CONFIRMED;
            this.koDetected = true;
            this.newRoundConfirmFrames = 0;
            break;
          }
        } else {
          this.timeOverConfirmFrames = 0;
        }

        if (p1Down || p2Down) {
          this.gamePhase = GamePhase.KO_PENDING;
          this.koConfirmFrames = 1;
          console.log(`[pixel-analyzer] 🎮 Phase: PLAYING → KO_PENDING (P1=${p1Health}% P2=${p2Health}%)`);
        }
        break;
      }

      case GamePhase.KO_PENDING: {
        const p1Down = p1Health <= KO_THRESHOLD;
        const p2Down = p2Health <= KO_THRESHOLD;

        if (p1Down || p2Down) {
          this.koConfirmFrames++;
          if (this.koConfirmFrames >= KO_CONFIRM_REQUIRED) {
            const p1Lost = p1Down && !p2Down;
            const p2Lost = p2Down && !p1Down;
            const draw = p1Down && p2Down;
            const p1WinsRound = p2Lost || (draw && this.previousP1Health > this.previousP2Health);
            const p2WinsRound = p1Lost || (draw && this.previousP2Health > this.previousP1Health);

            this.gamePhase = GamePhase.KO_CONFIRMED;
            this.koDetected = true;
            this.newRoundConfirmFrames = 0;

            if (draw && !p1WinsRound && !p2WinsRound) {
              this.p1Losses++;
              this.p2Losses++;
              this.roundNumber++;
              console.log(`[pixel-analyzer] 🎮 KO_CONFIRMED: DRAW! P1=${p1Health}% P2=${p2Health}% Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
              this.emit("roundResult", { loser: 0, winner: 0, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType: "draw" } satisfies RoundResultEvent);
            } else if (p1WinsRound) {
              this.p2Losses++;
              this.roundNumber++;
              const koType = (this.roundP1MinHealth >= PERFECT_HEALTH) ? "perfect" : "normal";
              if (koType === "perfect") this.matchPerfectKos++;
              console.log(`[pixel-analyzer] 🎮 KO_CONFIRMED: P2 KO'd! P1 wins (${koType}). P1=${p1Health}% P2=${p2Health}% minP1=${this.roundP1MinHealth}% Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
              this.emit("roundResult", { loser: 2, winner: 1, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType } satisfies RoundResultEvent);
            } else if (p2WinsRound) {
              this.p1Losses++;
              this.roundNumber++;
              const koType = (this.roundP2MinHealth >= PERFECT_HEALTH) ? "perfect" : "normal";
              if (koType === "perfect") this.matchPerfectKos++;
              console.log(`[pixel-analyzer] 🎮 KO_CONFIRMED: P1 KO'd! P2 wins (${koType}). P1=${p1Health}% P2=${p2Health}% minP2=${this.roundP2MinHealth}% Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
              this.emit("roundResult", { loser: 1, winner: 2, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType } satisfies RoundResultEvent);
            }
          } else {
            console.log(`[pixel-analyzer] 🎮 KO_PENDING: ${this.koConfirmFrames}/${KO_CONFIRM_REQUIRED} (P1=${p1Health}% P2=${p2Health}%)`);
          }
        } else {
          console.log(`[pixel-analyzer] 🎮 Phase: KO_PENDING → PLAYING (false alarm — P1=${p1Health}% P2=${p2Health}%)`);
          this.gamePhase = GamePhase.PLAYING;
          this.koConfirmFrames = 0;
        }
        break;
      }

      case GamePhase.KO_CONFIRMED: {
        const winsNeeded = this.config.winsNeeded;
        if (this.p1Losses >= winsNeeded || this.p2Losses >= winsNeeded) {
          this.gamePhase = GamePhase.MATCH_END;
          this.matchEnded = true;
          this.matchNumber++;
          const winner = this.p1Losses >= winsNeeded ? 2 : 1;
          const loser = winner === 1 ? 2 : 1;
          console.log(`[pixel-analyzer] 🎮 Phase: KO_CONFIRMED → MATCH_END. Winner: P${winner} Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
          this.emit("matchEnd", {
            winner, loser,
            p1Losses: this.p1Losses, p2Losses: this.p2Losses,
            matchNumber: this.matchNumber,
            totalRounds: this.roundNumber,
            perfectKos: this.matchPerfectKos,
          } satisfies MatchEndEvent);
          break;
        }

        if (p1Health >= NEW_ROUND_HEALTH && p2Health >= NEW_ROUND_HEALTH) {
          this.newRoundConfirmFrames++;
          if (this.newRoundConfirmFrames >= NEW_ROUND_CONFIRM_REQUIRED) {
            this.gamePhase = GamePhase.PLAYING;
            this.playingFrameCount = 0;
            this.koDetected = false;
            this.koConfirmFrames = 0;
            this.newRoundConfirmFrames = 0;
            this.roundP1MinHealth = 100;
            this.roundP2MinHealth = 100;
            console.log(`[pixel-analyzer] 🎮 Phase: KO_CONFIRMED → PLAYING (new round). P1=${p1Health}% P2=${p2Health}% Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
          }
        } else {
          this.newRoundConfirmFrames = 0;
        }
        break;
      }

      case GamePhase.MATCH_END:
        // Nothing to do — matchEnd already emitted
        break;
    }
  }

  // ── Health bar measurement ─────────────────────────────────────────

  /**
   * Check if a pixel belongs to a health bar by saturation, not raw brightness.
   * Health bars are colored (yellow/green/red) — they have significant
   * channel variance. Gray/white UI text, timer digits, and dark background
   * all have low saturation. This is robust to shaders, gamma, and bloom.
   */
  private isHealthPixel(r: number, g: number, b: number): boolean {
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    return (maxC - minC) > 30   // has color saturation (not gray/white UI)
        && maxC > 80;           // not too dark
  }

  /**
   * Measure the health bar extent by scanning columns left-to-right.
   * Returns the X position of the rightmost column that still has enough
   * health-colored pixels.
   */
  private measureBarEndX(
    frame: Buffer, frameWidth: number,
    startX: number, startY: number, regionW: number, regionH: number,
  ): number {
    const minColPixels = Math.ceil(regionH * MIN_COL_PIXELS_RATIO);
    let lastFilledX = startX;

    for (let x = startX; x < startX + regionW; x++) {
      let colCount = 0;
      for (let y = startY; y < startY + regionH; y++) {
        const idx = (y * frameWidth + x) * 3;
        const r = frame[idx] ?? 0;
        const g = frame[idx + 1] ?? 0;
        const b = frame[idx + 2] ?? 0;
        if (this.isHealthPixel(r, g, b)) colCount++;
      }
      if (colCount >= minColPixels) {
        lastFilledX = x;
      }
    }
    return lastFilledX;
  }

  /** Median-of-N rolling average — filters out hit-flash spikes. */
  private getSmoothedHealth(history: number[]): number {
    if (history.length === 0) return 0;
    const sorted = [...history].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }
}
