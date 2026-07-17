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
const ROUND_START_CALIB_FRAMES = 4; // PLAYING frames over which full-bar width is re-measured (bars are full during the round intro)
const HEALTH_HISTORY_SIZE = 5;
const KO_CONFIRM_REQUIRED = 5;        // ~2.5s at 2 fps — longer than a timer tick (~1.8s), so a live round's tick always resets the count (sliver-of-health guard)
const KO_RECOVERY_CONFIRM_REQUIRED = 3; // consecutive recovered frames to exit KO_PENDING (flash immunity)
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
  /** True once the timer has been seen DECREASING in the current round.
   *  Guards against phantom rounds: after a real KO/TIME OVER the result
   *  screen re-fills both bars (fake new-round transition) and then the
   *  victory screen re-drains the loser's bar with a FROZEN timer — which
   *  used to fabricate a KO. A frozen timer never decreases, so requiring
   *  a confirmed decrease proves the round is actually live. */
  private roundTimerWasRunning = false;
  /** Last valid (>0) timer reading this round — decrease detection. */
  private roundTimerLastValue = -1;
  /** True when PLAYING was entered from WARMUP: the warmup can complete on
   *  the VS/loading screen, so the frames-1-4 recalibration may measure
   *  garbage (observed: P2 full-bar 282 vs real 210 → perfect KO read as
   *  79%). In that case recalibration is deferred until the timer is first
   *  confirmed decreasing (proof of a real round). */
  private calibrateOnTimerStart = false;
  /** Timer value when KO_PENDING was entered (-1 if timer unknown). */
  private koPendingTimerAtStart = -1;
  /** MAX timer value seen at any point during KO_PENDING. A transient 99
   *  (next round's reset) proves the round ended even if the digits become
   *  unreadable again on the victory screen (timerValue back to -1). */
  private koPendingMaxTimer = -1;
  /** Player who was down when KO_PENDING was entered (1 or 2, 0 = none). */
  private koPendingLoser = 0;
  /** Consecutive recovered frames while in KO_PENDING (flash immunity). */
  private koRecoveryFrames = 0;
  /** Frame counter for periodic health debug logging. */
  private healthDebugCounter = 0;
  /** Last healths observed while the timer was RUNNING (>0) this round.
   *  Used for the time-over verdict: by the time timer=0 is confirmed, the
   *  result screen has already re-filled both bars to 100%. */
  private lastRunningP1Health = -1;
  private lastRunningP2Health = -1;

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
  /** Max filled-column counts seen during the round-start calibration
   *  window — bars are guaranteed full during the round intro. */
  private roundStartMaxP1Filled = 0;
  private roundStartMaxP2Filled = 0;
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

    // ── Measure bar fill (filled-column count) then normalize ─────────
    // Only scan the TOP rows of the stripe: the stripe was widened to 48px
    // for the timer digits, but the health bars live in rows 0-23 — below
    // that is the game scene (sprites/projectiles pollute the count).
    const barRows = Math.min(height, 24);
    const p1Filled = this.measureFilledColumns(frame, width, this.p1StartX, 0, this.p1EndX - this.p1StartX, barRows);
    const p2Filled = this.measureFilledColumns(frame, width, this.p2StartX, 0, this.p2EndX - this.p2StartX, barRows);

    const regionW1 = this.p1EndX - this.p1StartX;
    const regionW2 = this.p2EndX - this.p2StartX;
    const p1FullW = this.p1FullBarWidth > 0 ? this.p1FullBarWidth : regionW1;
    const p2FullW = this.p2FullBarWidth > 0 ? this.p2FullBarWidth : regionW2;

    const rawP1 = Math.min(100, Math.round((p1Filled / Math.max(1, p1FullW)) * 100));
    const rawP2 = Math.min(100, Math.round((p2Filled / Math.max(1, p2FullW)) * 100));

    // ── Rolling average ──────────────────────────────────────────────
    this.healthHistoryP1.push(rawP1);
    this.healthHistoryP2.push(rawP2);
    if (this.healthHistoryP1.length > HEALTH_HISTORY_SIZE) this.healthHistoryP1.shift();
    if (this.healthHistoryP2.length > HEALTH_HISTORY_SIZE) this.healthHistoryP2.shift();

    const p1Health = Math.round(this.getSmoothedHealth(this.healthHistoryP1));
    const p2Health = Math.round(this.getSmoothedHealth(this.healthHistoryP2));

    // ── Periodic health debug (every 20 frames ≈ 3-4s) ────────────────
    this.healthDebugCounter++;
    if (this.healthDebugCounter % 20 === 1) {
      console.log(
        `[health-debug] phase=${this.gamePhase} P1=${p1Health}% (raw ${rawP1}, filled ${p1Filled}/${p1FullW}) ` +
        `P2=${p2Health}% (raw ${rawP2}, filled ${p2Filled}/${p2FullW}) ` +
        `lastRunning=${this.lastRunningP1Health}/${this.lastRunningP2Health} timer=${this.timerDetector?.getLastValue() ?? "n/a"}`
      );
    }

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
    this.runStateMachine(p1Health, p2Health, rawP1, rawP2, p1Filled, p2Filled, timerValue);

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
    this.roundTimerWasRunning = false;
    this.roundTimerLastValue = -1;
    this.calibrateOnTimerStart = false;
    this.koPendingTimerAtStart = -1;
    this.koPendingMaxTimer = -1;
    this.koPendingLoser = 0;
    this.koRecoveryFrames = 0;
    this.lastRunningP1Health = -1;
    this.lastRunningP2Health = -1;
    this.roundP1MinHealth = 100;
    this.roundP2MinHealth = 100;
    this.roundStartMaxP1Filled = 0;
    this.roundStartMaxP2Filled = 0;
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
    p1Filled: number, p2Filled: number,
    timerValue: number,
  ): void {
    const WARMUP_FRAMES = this.fastWarmup ? 8 : 24;

    switch (this.gamePhase) {

      case GamePhase.WARMUP: {
        // Calibrate full-bar width: track the max filled-column count.
        const p1Extent = p1Filled;
        const p2Extent = p2Filled;
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
            // Warmup may complete on the VS/loading screen — defer the
            // full-bar recalibration until the timer is proven running.
            this.calibrateOnTimerStart = true;
            this.roundTimerLastValue = -1;
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

        // Round-start recalibration: bars are guaranteed full during the
        // round intro ("Round N — FIGHT!"), and the character name drawn on
        // the bar shifts the filled-column count per character (observed:
        // full bars reading 95%/84% against a stale fullBarW). Re-measure
        // over the first frames of each round (max rides out flashes), then
        // restart the smoothing history and perfect-KO min tracking so
        // pre-recalibration percentages don't pollute them.
        // Skipped when PLAYING was entered from WARMUP (VS-screen risk) —
        // the deferred timer-start recalibration below handles that case.
        if (!this.calibrateOnTimerStart) {
          if (this.playingFrameCount === 1) {
            this.roundStartMaxP1Filled = p1Filled;
            this.roundStartMaxP2Filled = p2Filled;
          } else if (this.playingFrameCount <= ROUND_START_CALIB_FRAMES) {
            this.roundStartMaxP1Filled = Math.max(this.roundStartMaxP1Filled, p1Filled);
            this.roundStartMaxP2Filled = Math.max(this.roundStartMaxP2Filled, p2Filled);
            if (this.playingFrameCount === ROUND_START_CALIB_FRAMES) {
              this.recalibrateFullBars(this.roundStartMaxP1Filled, this.roundStartMaxP2Filled, "round-start");
            }
          }
        }

        // ── Timer liveness: require a confirmed DECREASE ─────────────
        // A result/victory screen freezes the timer at its end-of-round
        // value (>0 after a KO), so "timer > 0" is NOT proof of a live
        // round. Only a decrease by a plausible tick proves the round is
        // actually running — this arms KO and time-over detection.
        if (timerValue > 0) {
          const dropped = this.roundTimerLastValue - timerValue;
          if (this.roundTimerLastValue > 0 && dropped >= 1 && dropped <= 5) {
            if (!this.roundTimerWasRunning) {
              this.roundTimerWasRunning = true;
              // Deferred round-1 recalibration: first proof of a real round.
              // Bars are still ~full this early (≤ a few seconds in).
              if (this.calibrateOnTimerStart) {
                this.calibrateOnTimerStart = false;
                this.recalibrateFullBars(p1Filled, p2Filled, "timer-start");
              }
            }
          }
          this.roundTimerLastValue = timerValue;
          if (this.roundTimerWasRunning) {
            this.lastRunningP1Health = p1Health;
            this.lastRunningP2Health = p2Health;
          }
        }

        // Grace period: ignore all KO/time-over signals for the first N frames
        if (this.playingFrameCount <= PLAYING_GRACE_FRAMES) break;

        const p1Down = p1Health <= KO_THRESHOLD;
        const p2Down = p2Health <= KO_THRESHOLD;

        // Simultaneous double-drop guard — screen transition, not a real double KO
        if (p1Down && p2Down) break;

        // KO/time-over are only armed once the round is provably live
        // (timer seen decreasing). ROMs without timer templates keep the
        // legacy always-armed behavior.
        const roundIsLive = this.timerDetector ? this.roundTimerWasRunning : true;

        // ── Time-over detection ──────────────────────────────────────
        // Only armed once the timer was seen running (>0) this round —
        // otherwise the frozen "00" of the previous round's result screen
        // fabricates a phantom time-over.
        if (!p1Down && !p2Down && timerValue === 0 && this.roundTimerWasRunning) {
          this.timeOverConfirmFrames++;
          if (this.timeOverConfirmFrames >= TIME_OVER_CONFIRM_REQUIRED) {
            // Verdict from the last FIGHTING healths (timer still running) —
            // the current frame may already be the result screen (bars refilled).
            const toP1 = this.lastRunningP1Health >= 0 ? this.lastRunningP1Health : p1Health;
            const toP2 = this.lastRunningP2Health >= 0 ? this.lastRunningP2Health : p2Health;
            if (toP1 > toP2) {
              this.p2Losses++;
              this.roundNumber++;
              console.log(`[pixel-analyzer] ⏱️ TIME OVER! P1 wins (fighting health P1=${toP1}% > P2=${toP2}%). Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
              this.emit("roundResult", { loser: 2, winner: 1, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType: "timeout" } satisfies RoundResultEvent);
            } else if (toP2 > toP1) {
              this.p1Losses++;
              this.roundNumber++;
              console.log(`[pixel-analyzer] ⏱️ TIME OVER! P2 wins (fighting health P2=${toP2}% > P1=${toP1}%). Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
              this.emit("roundResult", { loser: 1, winner: 2, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType: "timeout" } satisfies RoundResultEvent);
            } else {
              // Equal health at time over — DRAW. SFA2 gives NO round mark
              // for a time-over draw (observed 2026-07-16: the game replayed
              // the round after a 100%/100% draw), so losses stay unchanged
              // and the game replays the round.
              this.roundNumber++;
              console.log(`[pixel-analyzer] ⏱️ TIME OVER DRAW! Equal fighting health (P1=${toP1}% P2=${toP2}%) — no round mark, game replays. Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
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

        if ((p1Down || p2Down) && roundIsLive) {
          this.gamePhase = GamePhase.KO_PENDING;
          this.koConfirmFrames = 1;
          this.koRecoveryFrames = 0;
          this.koPendingTimerAtStart = timerValue;
          this.koPendingMaxTimer = timerValue;
          this.koPendingLoser = p1Down ? 1 : 2;
          console.log(`[pixel-analyzer] 🎮 Phase: PLAYING → KO_PENDING (P1=${p1Health}% P2=${p2Health}%)`);
        } else if ((p1Down || p2Down) && !roundIsLive) {
          // Bar drained but the round was never proven live (timer frozen) —
          // victory/result screen artifact, not a KO. Log sparsely.
          if (this.playingFrameCount % 20 === 0) {
            console.log(`[pixel-analyzer] 🛡️ KO signal ignored — round not live (timer never seen decreasing). P1=${p1Health}% P2=${p2Health}% timer=${timerValue}`);
          }
        }
        break;
      }

      case GamePhase.KO_PENDING: {
        const p1Down = p1Health <= KO_THRESHOLD;
        const p2Down = p2Health <= KO_THRESHOLD;

        // Sticky: remember the highest timer seen during KO_PENDING — the
        // next round's transient 99 proves the round ended even if the
        // digits become unreadable again (victory screen → timerValue -1).
        if (timerValue > this.koPendingMaxTimer) this.koPendingMaxTimer = timerValue;

        // Sliver-of-health guard: a bar can sit at ≤2% with the player still
        // ALIVE (observed: premature KO_CONFIRMED + matchEnd overlay while
        // the round was still being fought). A real KO freezes the timer —
        // so if the timer keeps TICKING DOWN, the round is live and this is
        // not a KO yet. Restart the confirmation count on every tick; once
        // the player actually dies the timer freezes and confirmation
        // completes unimpeded.
        let timerTicked = false;
        if (timerValue > 0 && this.roundTimerLastValue > 0) {
          const dropped = this.roundTimerLastValue - timerValue;
          if (dropped >= 1 && dropped <= 5) timerTicked = true;
        }
        if (timerValue > 0) this.roundTimerLastValue = timerValue;

        if (p1Down || p2Down) {
          if (timerTicked) {
            this.koConfirmFrames = 0;
            console.log(`[pixel-analyzer] 🛡️ KO confirm reset — timer still ticking (${timerValue}): sliver of health, round live`);
            break;
          }
          this.koRecoveryFrames = 0;
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
          // Bars recovered mid-confirmation. Three signals distinguish a
          // REAL round end (KO we must not lose) from a screen-flash artifact:
          // 1. Sticky timer jump: the next round's 99 was seen during
          //    KO_PENDING (even transiently — victory screens hide digits).
          // 2. Impossible healing: a KO'd bar (≥3 down frames) can NEVER
          //    refill to ≥NEW_ROUND_HEALTH mid-round — that's a screen change.
          // 3. Otherwise: require consecutive recovered frames before
          //    declaring a false alarm (a 1-2 frame flash must not cancel).
          const timerJumpedUp = this.koPendingMaxTimer >= 0 && (
            (this.koPendingTimerAtStart >= 0 && this.koPendingMaxTimer > this.koPendingTimerAtStart + 10)
            || (this.koPendingTimerAtStart < 90 && this.koPendingMaxTimer >= 90)
          );
          const loserHealthNow = this.koPendingLoser === 1 ? p1Health : p2Health;
          const impossibleHealing = this.koConfirmFrames >= 3 && loserHealthNow >= NEW_ROUND_HEALTH;
          if ((timerJumpedUp && this.koConfirmFrames >= 2 || impossibleHealing) && this.koPendingLoser !== 0) {
            const loserP = this.koPendingLoser;
            const signal = timerJumpedUp ? `timer ${this.koPendingTimerAtStart}→${this.koPendingMaxTimer}` : `impossible healing (loser ${loserHealthNow}%)`;
            this.gamePhase = GamePhase.KO_CONFIRMED;
            this.koDetected = true;
            this.newRoundConfirmFrames = 0;
            this.roundNumber++;
            if (loserP === 1) {
              this.p1Losses++;
              const koType = (this.roundP2MinHealth >= PERFECT_HEALTH) ? "perfect" : "normal";
              if (koType === "perfect") this.matchPerfectKos++;
              console.log(`[pixel-analyzer] 🎮 KO_CONFIRMED (retroactive, ${signal}): P1 KO'd! P2 wins (${koType}). Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
              this.emit("roundResult", { loser: 1, winner: 2, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType } satisfies RoundResultEvent);
            } else {
              this.p2Losses++;
              const koType = (this.roundP1MinHealth >= PERFECT_HEALTH) ? "perfect" : "normal";
              if (koType === "perfect") this.matchPerfectKos++;
              console.log(`[pixel-analyzer] 🎮 KO_CONFIRMED (retroactive, ${signal}): P2 KO'd! P1 wins (${koType}). Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
              this.emit("roundResult", { loser: 2, winner: 1, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType } satisfies RoundResultEvent);
            }
            this.koPendingTimerAtStart = -1;
            this.koPendingMaxTimer = -1;
            this.koPendingLoser = 0;
            this.koRecoveryFrames = 0;
          } else {
            this.koRecoveryFrames++;
            if (this.koRecoveryFrames >= KO_RECOVERY_CONFIRM_REQUIRED) {
              console.log(`[pixel-analyzer] 🎮 Phase: KO_PENDING → PLAYING (false alarm — P1=${p1Health}% P2=${p2Health}%, ${this.koRecoveryFrames} recovered frames)`);
              this.gamePhase = GamePhase.PLAYING;
              this.koConfirmFrames = 0;
              this.koPendingTimerAtStart = -1;
              this.koPendingMaxTimer = -1;
              this.koPendingLoser = 0;
              this.koRecoveryFrames = 0;
            } else {
              console.log(`[pixel-analyzer] 🎮 KO_PENDING: recovery ${this.koRecoveryFrames}/${KO_RECOVERY_CONFIRM_REQUIRED} (flash? P1=${p1Health}% P2=${p2Health}%)`);
            }
          }
        }
        break;
      }

      case GamePhase.KO_CONFIRMED: {
        const winsNeeded = this.config.winsNeeded;
        if (this.p1Losses >= winsNeeded || this.p2Losses >= winsNeeded) {
          this.gamePhase = GamePhase.MATCH_END;
          this.matchEnded = true;
          this.matchNumber++;
          // If BOTH somehow reach winsNeeded (double KO at double match
          // point), pick the player with fewer losses; log if truly equal.
          let winner: number;
          if (this.p1Losses >= winsNeeded && this.p2Losses >= winsNeeded) {
            winner = this.p1Losses < this.p2Losses ? 1
                   : this.p2Losses < this.p1Losses ? 2 : 2;
            if (this.p1Losses === this.p2Losses) {
              console.warn(`[pixel-analyzer] ⚠️ MATCH_END with EQUAL losses (${this.p1Losses}-${this.p2Losses}) — arbitrary winner P${winner}`);
            }
          } else {
            winner = this.p1Losses >= winsNeeded ? 2 : 1;
          }
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
            // Fresh round: forget the previous round's frozen timer state and
            // require the timer to be seen running again before time-over re-arms.
            this.roundTimerWasRunning = false;
            this.roundTimerLastValue = -1;
            this.calibrateOnTimerStart = false;
            this.timeOverConfirmFrames = 0;
            this.lastRunningP1Health = -1;
            this.lastRunningP2Health = -1;
            this.timerDetector?.reset();
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
        && maxC > 120           // bright — SFA2 empty-bar bg is dark blue (max ~82-107)
        && !(b >= r && b >= g); // not blue-dominant — excludes the empty-bar blue even under flash tint
  }

  /**
   * Adopt new full-bar widths from filled-column counts measured at a
   * moment when both bars are known to be full (round intro, or first
   * confirmed timer decrease). Also restarts the smoothing history and
   * perfect-KO min tracking so pre-recalibration percentages don't
   * pollute them.
   */
  private recalibrateFullBars(p1Filled: number, p2Filled: number, reason: string): void {
    // Sanity guard: reject a calibration that would shrink the bar below
    // 40% of its region (screen transition, flash, occlusion).
    const minW1 = Math.floor((this.p1EndX - this.p1StartX) * 0.4);
    const minW2 = Math.floor((this.p2EndX - this.p2StartX) * 0.4);
    if (p1Filled >= minW1) this.p1FullBarWidth = p1Filled;
    if (p2Filled >= minW2) this.p2FullBarWidth = p2Filled;
    this.healthHistoryP1 = [];
    this.healthHistoryP2 = [];
    this.roundP1MinHealth = 100;
    this.roundP2MinHealth = 100;
    console.log(`[pixel-analyzer] 📏 Recalibration (${reason}): fullBarW P1=${this.p1FullBarWidth} P2=${this.p2FullBarWidth}`);
  }

  /**
   * Measure the health bar by COUNTING filled columns in the region
   * (direction-agnostic geometric measure). SFA2 bars drain toward the
   * screen edges asymmetrically: P2's bar empties from its INNER (center)
   * edge, so a rightmost-edge scan reads P2 at 100% until the bar is
   * completely empty. Counting filled columns works for both players
   * regardless of drain direction.
   */
  private measureFilledColumns(
    frame: Buffer, frameWidth: number,
    startX: number, startY: number, regionW: number, regionH: number,
  ): number {
    const minColPixels = Math.ceil(regionH * MIN_COL_PIXELS_RATIO);
    let filled = 0;

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
        filled++;
      }
    }
    return filled;
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
