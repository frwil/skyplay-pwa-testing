import { EventEmitter } from "events";
import { type PixelGameConfig } from "./pixel-game-config.js";
import { TimerDetector } from "./timer-detector.js";
import { type TextOverlayEvent } from "./text-event-detector.js";
import { isHealthPixel, measureFilledColumns, getSmoothedHealth, saveDebugStripe } from "./pixel-health-measurement.js";
import {
  GamePhase,
  type RoundResultEvent,
  type MatchEndEvent,
  type MatchStateEvent,
  NEW_ROUND_HEALTH,
  WARMUP_HEALTHY,
  WARMUP_MIN_RATIO,
  WARMUP_TIMEOUT_FRAMES,
  PERFECT_RATIO,
  HEALTH_HISTORY_SIZE,
  PLAYING_GRACE_FRAMES,
  DESPERATION_ARM_FRAMES,
  MIN_WARMUP_BAR_COLS,
  HEALTH_DIFF_THRESHOLD,
  ROUND_END_COOLDOWN,
  TIME_OVER_CONFIRM_FRAMES,
  BARS_VANISHED_CONFIRM_FRAMES,
  TEXT_CONFIRM_FRAMES,
} from "./pixel-match-analyzer-types.js";

// Re-export types for consumers (game-runner.ts imports from here)
export { GamePhase };
export type { RoundResultEvent, MatchEndEvent, MatchStateEvent };

/**
 * Orchestrates pixel-based health + timer detection for a single game.
 *
 * Text-primary architecture: text overlays (KO, PERFECT, TIME OVER, DRAW GAME)
 * detected by TextEventDetector are the PRIMARY round-end trigger. Health bars
 * provide only the winner/loser verdict via simple filled-column comparison.
 * Fallback paths (bars-vanished, timer==0) are safety nets.
 *
 * State machine: WARMUP → PLAYING → MATCH_END. New rounds are detected
 * within PLAYING via bar refill. Health bar measurement uses column-scan +
 * color saturation; timer uses template-matching digit recognition.
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
  /** True once the timer has been seen DECREASING in the current round.
   *  Guards against phantom rounds: text overlays during intros/transitions
   *  must not trigger round-end. A frozen timer never decreases, so requiring
   *  a confirmed decrease proves the round is actually live. */
  private roundTimerWasRunning = false;
  /** Last valid (>0) timer reading this round — decrease detection. */
  private roundTimerLastValue = -1;
  /** Highest timer value seen this round. Must be ≥ 50 before round-end
   *  is trusted — otherwise we joined mid-round and lack enough data. */
  private roundTimerMaxSeen = 0;
  /** Locked at timer-start calibration — prevents damage from being
   *  misinterpreted as intro fade. Once locked, fullBarWidth is fixed. */
  private p1FullBarLocked = false;
  private p2FullBarLocked = false;
  /** Consecutive frames where both bars are ≤2% (bars-vanished fallback). */
  private barsVanishedFrames = 0;
  /** Consecutive frames where timer reads 0 with healthy bars (time-over fallback). */
  private timeOverFrames = 0;
  /** Last healths observed while the timer was RUNNING (>0) this round.
   *  Used for the round-end verdict: by the time the text overlay appears,
   *  the result screen has already re-filled both bars to 100%. */
  private lastRunningP1Health = -1;
  private lastRunningP2Health = -1;
  /** Last raw filled-column counts while timer was running (for PERFECT check). */
  private lastRunningP1Filled = 0;
  private lastRunningP2Filled = 0;
  /** Frames remaining in post-round-end cooldown. Text events are ignored
   *  and new-round detection is suppressed until this reaches 0. */
  private roundEndCooldown = 0;
  /** Set when cooldown expires — arms new-round detection for exactly one frame. */
  private _newRoundArmed = false;

  // ── Text overlay integration ─────────────────────────────────────────
  /** Set when the text detector reports an active overlay while the round
   *  was armed. On the next processFrame tick (where we have access to the
   *  raw frame data), the round-end verdict is evaluated. */
  private _textRoundEndPending = false;
  /** Peak ratio of the text overlay that triggered the pending round end. */
  private _textRoundEndRatio = 0;
  /** True while waiting for bar/timer confirmation after text was detected.
   *  Replaces the immediate _textRoundEndPending resolution with a window
   *  that filters out "FIGHT!" and "ROUND X" text (which never lead to
   *  bars vanishing or timer hitting 0). */
  private _textConfirming = false;
  /** Frames remaining in the text confirmation window. */
  private _textConfirmFramesRemaining = 0;

  // ── Health bar calibration ─────────────────────────────────────────
  private p1FullBarWidth = 0;
  private p2FullBarWidth = 0;
  private healthHistoryP1: number[] = [];
  private healthHistoryP2: number[] = [];
  private healthStableFrames = 0;
  private healthStableFramesHealthy = 0;
  private fastWarmup = false;
  private _warmupFrameCount = 0;  // safety timeout counter
  private healthPollErrorCount = 0;
  /** Defer full-bar recalibration until the timer is proven running (first decrease). */
  private calibrateOnTimerStart = false;

  // ── Round / match tracking ─────────────────────────────────────────
  private previousP1Health = -1;
  private previousP2Health = -1;
  private p1Losses = 0;
  private p2Losses = 0;
  private roundNumber = 0;
  private matchNumber = 0;
  private matchPerfectKos = 0;
  private matchEnded = false;
  /** Set when a match ends; cleared when reset() calibrates for the next match. */
  private needsTimerCalibration = true;
  private roundP1MinHealth = 100;
  private roundP2MinHealth = 100;
  /** Max filled-column counts seen during the round-start calibration
   *  window — bars are guaranteed full during the round intro. */
  private roundStartMaxP1Filled = 0;
  private roundStartMaxP2Filled = 0;
  /** Min RAW filled-column counts during PLAYING — used for ratio-based
   *  perfect KO detection (insensitive to fullBarWidth calibration drift). */
  private roundP1MinFilled = 9999;
  private roundP2MinFilled = 9999;
  private roundP1MaxFilled = 0;
  private roundP2MaxFilled = 0;
  /** One-shot debug flag — saves the full stripe PPM during combat. */
  private _debugStripeSaved = false;
  /** Flag set by warmup exit — save debug stripe on next processFrame. */
  private _saveDebugOnNextFrame = false;
  /** playingFrameCount when stuck state was first detected (0 = not stuck). */
  private _playingFrameAtStuck = 0;
  /** Total processFrame calls — used for low-level heartbeat. */
  private _totalFrameCount = 0;
  /** Post-timer-start calibration countdown (0 = inactive). */
  private _postTimerCalibFrames = 0;
  /** Consecutive frames where both bars are ≥80% without a timer decrease.
   *  Triggers bar-stable fallback calibration after 30 frames (~7.5s). */
  private _barStableFrames = 0;
  /** Throttle for live health events — emit at most once per 500ms. */
  private _lastHealthEmit = 0;
  /** Emit matchStarted once per match (first WARMUP→PLAYING transition). */
  private _matchStartedEmitted = false;

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

  /** Feed a text overlay detection event from the TextEventDetector.
   *
   *  **Text-primary architecture (2026-07-24):** text overlays are the PRIMARY
   *  round-end trigger. When the round was armed (timer seen decreasing) and a
   *  text overlay appears, the round is over. Health bars provide only the
   *  winner/loser verdict via simple filled-column comparison.
   *
   *  The old bar-threshold KO detection (KO_PENDING/KO_CONFIRMED) and the
   *  80%-ratio gate are removed — they were the source of calibration drift,
   *  P1/P2 inversion, and phantom KO bugs. */
  onTextOverlayAppeared(evt: TextOverlayEvent): void {
    if (this.gamePhase === GamePhase.MATCH_END) return;
    if (this.roundEndCooldown > 0) return; // still in post-round transition

    const ratioPct = (evt.peakRatio * 100).toFixed(1);
    console.log(`[pixel-analyzer] 📝 Text overlay appeared — phase=${this.gamePhase} round=${this.roundNumber} peakRatio=${ratioPct}% running=${this.roundTimerWasRunning} maxTimer=${this.roundTimerMaxSeen}`);

    // Only act in PLAYING phase with a confirmed-live round.
    // roundTimerWasRunning proves the timer was seen decreasing (real combat),
    // which excludes FIGHT!/ROUND-X texts at round start.
    // roundTimerMaxSeen ≥ 50 proves we didn't join mid-round.
    if (this.gamePhase !== GamePhase.PLAYING) return;
    if (!this.roundTimerWasRunning) {
      console.log(`[pixel-analyzer] 📝 Text ignored — round not armed (start-of-round text like FIGHT!/ROUND X)`);
      return;
    }
    if (this.roundTimerMaxSeen < 50) {
      console.log(`[pixel-analyzer] 📝 Text ignored — maxTimer=${this.roundTimerMaxSeen} < 50 (joined mid-round, insufficient data)`);
      return;
    }
    if (this.playingFrameCount <= PLAYING_GRACE_FRAMES) {
      console.log(`[pixel-analyzer] 📝 Text ignored — within grace period (f=${this.playingFrameCount})`);
      return;
    }

    // ── Open confirmation window ──────────────────────────────────
    // Don't resolve immediately — "FIGHT!" and "ROUND X" text also
    // trigger brightness spikes. Instead, open a confirmation window
    // and wait for bars-vanished (result screen transition) or
    // timer==0 (TIME OVER). If neither happens within the window,
    // it's a false positive and we ignore it.
    this._textConfirming = true;
    this._textConfirmFramesRemaining = TEXT_CONFIRM_FRAMES;
    this._textRoundEndRatio = evt.peakRatio;
    console.log(`[pixel-analyzer] 🎯 Text overlay — opening confirmation window (${TEXT_CONFIRM_FRAMES}f) — lastRunning P1=${this.lastRunningP1Health}% P2=${this.lastRunningP2Health}%`);
  }

  /** Called when a previously-active text overlay disappears from the screen. */
  onTextOverlayCleared(): void {
    if (this.gamePhase === GamePhase.MATCH_END) return;
    // If we were in a confirmation window and the text disappeared
    // without bars vanishing or timer hitting 0, it was a false positive
    // (FIGHT!, ROUND X, etc.). Cancel the confirmation.
    if (this._textConfirming) {
      this._textConfirming = false;
      console.log(`[pixel-analyzer] 📝 Text overlay cleared during confirmation — false positive, cancelled`);
    }
    console.log(`[pixel-analyzer] 📝 Text overlay cleared — phase=${this.gamePhase} round=${this.roundNumber}`);
  }

  /** Resolve a confirmed round-end using lastRunning health values.
   *  Called from the confirmation-window code path (bars-vanished or
   *  timer==0 confirmed a real KO/TIME-OVER, not FIGHT!/ROUND X).
   *  Uses the same health-comparison logic as the old immediate-path. */
  private resolveTextRoundEnd(p1Health: number, p2Health: number): void {
    const lrP1 = this.lastRunningP1Health >= 0 ? this.lastRunningP1Health : p1Health;
    const lrP2 = this.lastRunningP2Health >= 0 ? this.lastRunningP2Health : p2Health;
    const healthDiff = Math.abs(lrP1 - lrP2);
    let hadWinner = false;

    if (healthDiff <= HEALTH_DIFF_THRESHOLD) {
      console.log(`[pixel-analyzer] 📝 Text round-end: DRAW (P1=${lrP1}% P2=${lrP2}%, diff=${healthDiff}%). No round mark. Losses: P1=${this.p1Losses} P2=${this.p2Losses}`);
    } else if (lrP1 > lrP2) {
      hadWinner = true;
      this.p2Losses++;
      this.roundNumber++;
      const koType = this.isPerfectKo(1) ? "perfect" : "normal";
      if (koType === "perfect") this.matchPerfectKos++;
      console.log(`[pixel-analyzer] 📝 Text round-end: P1 WINS (P1=${lrP1}% > P2=${lrP2}%, ${koType}). Losses: P1=${this.p1Losses} P2=${this.p2Losses}`);
      this.emit("roundResult", { loser: 2, winner: 1, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType } satisfies RoundResultEvent);
      this.checkMatchEnd();
    } else {
      hadWinner = true;
      this.p1Losses++;
      this.roundNumber++;
      const koType = this.isPerfectKo(2) ? "perfect" : "normal";
      if (koType === "perfect") this.matchPerfectKos++;
      console.log(`[pixel-analyzer] 📝 Text round-end: P2 WINS (P2=${lrP2}% > P1=${lrP1}%, ${koType}). Losses: P1=${this.p1Losses} P2=${this.p2Losses}`);
      this.emit("roundResult", { loser: 1, winner: 2, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType } satisfies RoundResultEvent);
      this.checkMatchEnd();
    }

    if (hadWinner) {
      this.roundEndCooldown = ROUND_END_COOLDOWN;
      this.roundStartMaxP1Filled = 0;
      this.roundStartMaxP2Filled = 0;
      this.p1FullBarLocked = false;
      this.p2FullBarLocked = false;
    }
    this.barsVanishedFrames = 0;
    this.timeOverFrames = 0;
  }

  /** Ratio-based perfect KO — uses raw filled-column min/max so it's immune
   *  to fullBarWidth calibration drift. A true perfect means the winner's bar
   *  never shrank: minFilled ≥ 95% of maxFilled during the round. */
  private isPerfectKo(player: 1 | 2): boolean {
    const minFilled = player === 1 ? this.roundP1MinFilled : this.roundP2MinFilled;
    const maxFilled = player === 1 ? this.roundP1MaxFilled : this.roundP2MaxFilled;
    return maxFilled > 0 && (minFilled / maxFilled) >= PERFECT_RATIO;
  }

  /** Check if the match is over (best-of-3: first to 2 losses loses).
   *  Must be called after every round result emission. */
  private checkMatchEnd(): void {
    if (!this.matchEnded && (this.p1Losses >= 2 || this.p2Losses >= 2)) {
      this.matchEnded = true;
      this.gamePhase = GamePhase.MATCH_END;
      const winner = this.p1Losses >= 2 ? 2 : 1;
      const loser = winner === 1 ? 2 : 1;
      console.log(`[pixel-analyzer] 🏆 MATCH END! P${winner} wins (P1=${this.p1Losses} P2=${this.p2Losses} in ${this.roundNumber} rounds, ${this.matchPerfectKos} perfect KOs).`);
      this.emit("matchEnd", {
        winner, loser,
        p1Losses: this.p1Losses,
        p2Losses: this.p2Losses,
        matchNumber: this.matchNumber,
        totalRounds: this.roundNumber,
        perfectKos: this.matchPerfectKos,
      } satisfies MatchEndEvent);
    }
  }

  /**
   * Main entry point — process a raw RGB24 frame of the health bar stripe.
   * Called by GameRunner for each frame captured by ffmpeg x11grab.
   */
  processFrame(frame: Buffer, width: number, height: number): void {
    this._totalFrameCount++;
    // Low-level heartbeat: log every 600 raw frames (~10s at 60fps) to
    // confirm the stripe reader is flowing and processFrame is called.
    if (this._totalFrameCount % 600 === 0) {
      console.log(`[pixel-analyzer] 📡 Raw frame #${this._totalFrameCount} — phase=${this.gamePhase} matchEnded=${this.matchEnded} suspended? (see runner)`);
    }

    if (this.matchEnded) return;
    if (this.healthPollErrorCount >= 10) return;
    this.healthPollErrorCount = 0;

    // ── Measure bar fill (filled-column count) then normalize ─────────
    // Restrict the scan to the stripe rows that actually contain the BARS.
    // On SNES SFA2 the stripe also covers the score digits and names
    // (above) and the timer digits (middle) — barRowStart/barRowH from the
    // game config exclude them. Configs without these fields keep the
    // legacy full-stripe scan.
    const barStartY = Math.min(this.config.barRowStart ?? 0, Math.max(0, height - 1));
    const barRows = Math.min(this.config.barRowH ?? height, height - barStartY);
    const p1Filled = measureFilledColumns(frame, width, this.p1StartX, barStartY, this.p1EndX - this.p1StartX, barRows);
    const p2Filled = measureFilledColumns(frame, width, this.p2StartX, barStartY, this.p2EndX - this.p2StartX, barRows);

    const regionW1 = this.p1EndX - this.p1StartX;
    const regionW2 = this.p2EndX - this.p2StartX;
    const p1FullW = this.p1FullBarWidth > 0 ? this.p1FullBarWidth : regionW1;
    const p2FullW = this.p2FullBarWidth > 0 ? this.p2FullBarWidth : regionW2;

    // ── Debug: save full stripe when we first detect health bars ──
    //     Helps diagnose why health bars aren't detected on new Xvfb sessions.
    //     Triggered by non-zero filled columns (not timer, which may never
    //     be confirmed running if the template correction jump is too large).
    if (this.roundTimerWasRunning && !this._debugStripeSaved && (p1Filled > 0 || p2Filled > 0)) {
      this._debugStripeSaved = true;
      saveDebugStripe(frame, width, height, "combat", p1Filled, p2Filled);
    }

    // ── Recovery: if fullBarWidth is clearly wrong (filled >> barWidth, ──
    //     e.g. calibrated to 8 during a dark intro frame), force
    //     recalibration. "Clearly wrong" = filled > 3× fullBarWidth AND
    //     filled > 20 (not a single stray pixel). This is a safety net —
    //     the timer-start calibration should normally prevent this.
    if (this.p1FullBarLocked && p1Filled > this.p1FullBarWidth * 3 && p1Filled > 20) {
      console.log(`[pixel-analyzer] 🔓 P1 unlock + recalibrate UP: filled=${p1Filled} >> fullBarW=${this.p1FullBarWidth} (was locked)`);
      this.p1FullBarWidth = p1Filled;
      this.healthHistoryP1 = [];
      this.roundStartMaxP1Filled = p1Filled;
    }
    if (this.p2FullBarLocked && p2Filled > this.p2FullBarWidth * 3 && p2Filled > 20) {
      console.log(`[pixel-analyzer] 🔓 P2 unlock + recalibrate UP: filled=${p2Filled} >> fullBarW=${this.p2FullBarWidth} (was locked)`);
      this.p2FullBarWidth = p2Filled;
      this.healthHistoryP2 = [];
      this.roundStartMaxP2Filled = p2Filled;
    }

    const rawP1 = Math.min(100, Math.round((p1Filled / Math.max(1, p1FullW)) * 100));
    const rawP2 = Math.min(100, Math.round((p2Filled / Math.max(1, p2FullW)) * 100));

    // ── Rolling average ──────────────────────────────────────────────
    this.healthHistoryP1.push(rawP1);
    this.healthHistoryP2.push(rawP2);
    if (this.healthHistoryP1.length > HEALTH_HISTORY_SIZE) this.healthHistoryP1.shift();
    if (this.healthHistoryP2.length > HEALTH_HISTORY_SIZE) this.healthHistoryP2.shift();

    const p1Health = Math.round(getSmoothedHealth(this.healthHistoryP1));
    const p2Health = Math.round(getSmoothedHealth(this.healthHistoryP2));

    // ── Track round min health (for perfect KO detection) ─────────────
    if (this.gamePhase === GamePhase.PLAYING) {
      if (p1Health > 0) this.roundP1MinHealth = Math.min(this.roundP1MinHealth, p1Health);
      if (p2Health > 0) this.roundP2MinHealth = Math.min(this.roundP2MinHealth, p2Health);
      // Raw filled-column tracking — immune to fullBarWidth calibration drift.
      // A true perfect KO means the bar never shrank, so minFilled ≈ maxFilled.
      // CRITICAL: max is gated on bar-locked to skip early-round phantom
      // inflations (observed: P2 read 273 cols during intro, later ~210 stable
      // → perfect KO misread as 210/273=77%). Min is always tracked so any
      // pre-lock damage is still captured.
      const p1RegionW = this.p1EndX - this.p1StartX;
      const p2RegionW = this.p2EndX - this.p2StartX;
      if (p1Filled > 0) {
        this.roundP1MinFilled = Math.min(this.roundP1MinFilled, p1Filled);
        // Anti-glow: full-region fill is an artifact (FIGHT! glow, flashes), ignore.
        if (p1Filled < p1RegionW && this.p1FullBarLocked) {
          this.roundP1MaxFilled = Math.max(this.roundP1MaxFilled, p1Filled);
        }
      }
      if (p2Filled > 0) {
        this.roundP2MinFilled = Math.min(this.roundP2MinFilled, p2Filled);
        if (p2Filled < p2RegionW && this.p2FullBarLocked) {
          this.roundP2MaxFilled = Math.max(this.roundP2MaxFilled, p2Filled);
        }
      }
    }

    // ── Timer digit recognition (always — even during WARMUP, so we can
    //     use the timer as a signal that the fight has started) ─────────
    let timerValue = -1;
    if (this.timerDetector) {
      timerValue = this.timerDetector.readFromFrame(frame, width, height);
    }

    // ── Stuck-state debug stripe: when the round was live but bars read
    //     near-zero for an extended period, save the raw stripe for analysis.
    if (this.roundTimerWasRunning && this.gamePhase === GamePhase.PLAYING &&
        timerValue === 0 && p1Filled < 30 && p2Filled < 30 &&
        this._playingFrameAtStuck === 0) {
      this._playingFrameAtStuck = this.playingFrameCount;
    }
    if (this._playingFrameAtStuck > 0 &&
        this.playingFrameCount - this._playingFrameAtStuck === 10) {
      // Save after 10 stuck frames (~2.5s at 4fps) — enough to confirm it's real
      saveDebugStripe(frame, width, height, "stuck", p1Filled, p2Filled);
    }

    // ── State machine ────────────────────────────────────────────────
    this.runStateMachine(p1Health, p2Health, rawP1, rawP2, p1Filled, p2Filled, timerValue);

    // ── Debug stripe on demand (set by warmup exit with poor calib) ──
    if (this._saveDebugOnNextFrame) {
      this._saveDebugOnNextFrame = false;
      if (!this._debugStripeSaved) {
        this._debugStripeSaved = true;
        saveDebugStripe(frame, width, height,
          `poor-calib-P1w${this.p1FullBarWidth}-P2w${this.p2FullBarWidth}`, p1Filled, p2Filled);
      }
    }

    // ── Live health events (throttled ~500ms) ──────────────────────────
    // Emit current health + phase so ws-handler can forward match_state
    // to clients. Previously only KOF98 (RAM-based) did this; SFA2 clients
    // only saw round_result / match_end with no live HUD updates.
    if (Date.now() - this._lastHealthEmit >= 500) {
      this._lastHealthEmit = Date.now();
      this.emit("health", {
        p1Health, p2Health, timerValue,
        phase: this.gamePhase,
        roundTimerWasRunning: this.roundTimerWasRunning,
        p1FullBarWidth: this.p1FullBarWidth,
        p2FullBarWidth: this.p2FullBarWidth,
      });
    }

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
    this._warmupFrameCount = 0;
    this.healthPollErrorCount = 0;
    this.roundTimerWasRunning = false;
    this.roundTimerLastValue = -1;
    this.roundTimerMaxSeen = 0;
    this.calibrateOnTimerStart = false;
    this.p1FullBarLocked = false;
    this.p2FullBarLocked = false;
    this.lastRunningP1Health = -1;
    this.lastRunningP2Health = -1;
    this.lastRunningP1Filled = 0;
    this.lastRunningP2Filled = 0;
    this.barsVanishedFrames = 0;
    this.timeOverFrames = 0;
    this.roundEndCooldown = 0;
    this._newRoundArmed = false;
    this._textRoundEndPending = false;
    this._textRoundEndRatio = 0;
    this._textConfirming = false;
    this._textConfirmFramesRemaining = 0;
    this.roundP1MinHealth = 100;
    this.roundP2MinHealth = 100;
    this.roundP1MinFilled = 9999;
    this.roundP2MinFilled = 9999;
    this.roundP1MaxFilled = 0;
    this.roundP2MaxFilled = 0;
    this.roundStartMaxP1Filled = 0;
    this.roundStartMaxP2Filled = 0;
    this.matchEnded = false;
    this._debugStripeSaved = false;
    this._saveDebugOnNextFrame = false;
    this._totalFrameCount = 0;
    this._playingFrameAtStuck = 0;
    this._matchStartedEmitted = false;
    this._postTimerCalibFrames = 0;
    this._barStableFrames = 0;
    this.p1Losses = 0;
    this.p2Losses = 0;
    this.roundNumber = 0;
    this.matchPerfectKos = 0;
    this.previousP1Health = -1;
    this.previousP2Health = -1;
    this.fastWarmup = fastWarmup;
    if (this.needsTimerCalibration) {
      this.needsTimerCalibration = false;
      this.timerDetector?.resetCalibration();
    }
    this.timerDetector?.reset();
  }

  /** Signal an unrecoverable ffmpeg error (stops processing). */
  signalError(): void {
    this.healthPollErrorCount++;
  }

  /** Emit matchStarted once per match — first WARMUP→PLAYING transition. */
  private emitMatchStarted(p1Health: number, p2Health: number, timerValue: number): void {
    if (this._matchStartedEmitted) return;
    this._matchStartedEmitted = true;
    console.log(
      `[pixel-analyzer] 🎬 MATCH STARTED! ` +
      `Bar regions: P1 x=${this.p1StartX}-${this.p1EndX} P2 x=${this.p2StartX}-${this.p2EndX} ` +
      `fullBarW P1=${this.p1FullBarWidth} P2=${this.p2FullBarWidth} ` +
      `initial health P1=${p1Health}% P2=${p2Health}% timer=${timerValue}`
    );
    this.emit("matchStarted", {
      p1Health, p2Health, timerValue,
      p1FullBarWidth: this.p1FullBarWidth,
      p2FullBarWidth: this.p2FullBarWidth,
    });
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
        // ── Safety timeout: force-exit if warmup never ends ─────────
        // If bars are never visible (Xvfb black screen, ffmpeg failure,
        // stripe capture on wrong display) the warmup phase could loop
        // forever. After WARMUP_TIMEOUT_FRAMES (~75s at 4fps) we force
        // exit to PLAYING so the timer-based arming paths have a chance
        // to recover.
        this._warmupFrameCount++;
        if (this._warmupFrameCount >= WARMUP_TIMEOUT_FRAMES) {
          this.healthHistoryP1 = [];
          this.healthHistoryP2 = [];
          this.gamePhase = GamePhase.PLAYING;
          this.playingFrameCount = 0;
          this.fastWarmup = false;
          this.calibrateOnTimerStart = true;
          this.roundTimerLastValue = -1;
          this.roundTimerMaxSeen = 0;
          this.roundTimerWasRunning = false;
          console.log(`[pixel-analyzer] ⏰ Warmup timeout after ${this._warmupFrameCount} frames — forcing PLAYING (bars may be invisible)`);
          this.emitMatchStarted(rawP1, rawP2, timerValue);
          break;
        }

        // Calibrate full-bar width: track the max filled-column count.
        const p1Extent = p1Filled;
        const p2Extent = p2Filled;
        if (p1Extent > this.p1FullBarWidth) this.p1FullBarWidth = p1Extent;
        if (p2Extent > this.p2FullBarWidth) this.p2FullBarWidth = p2Extent;

        // ── Bar-based fast exit ───────────────────────────────────────
        // If both bars have shown substantial fill (≥100 columns each,
        // ~⅓ of the region), the bars are definitely real and visible —
        // exit warmup immediately. The timer-based exit (≥30) is too slow:
        // the timer detector needs calibration frames, so the first valid
        // timer read can arrive mid-round (observed: timer=34 instead of
        // 99). The health-based exit (24 frames @ 65% healthy) never fires
        // on loading screens where bars are invisible.
        // fullBarWidth captured here is the max seen during warmup; the
        // post-glow calibration in PLAYING can still refine it once the
        // timer starts decreasing (first decrease arms roundTimerWasRunning
        // → roundStartMax tracking activates → locks at ≥80% floor).
        const MIN_BAR_COLUMNS = 100;
        if (this.p1FullBarWidth >= MIN_BAR_COLUMNS && this.p2FullBarWidth >= MIN_BAR_COLUMNS) {
          this.healthHistoryP1 = [];
          this.healthHistoryP2 = [];
          this.gamePhase = GamePhase.PLAYING;
          this.playingFrameCount = 0;
          this.fastWarmup = false;
          this.calibrateOnTimerStart = false;
          this.roundTimerLastValue = timerValue > 0 ? timerValue : -1;
          this.roundTimerMaxSeen = 0;
          // Both bars confirmed visible (≥100 cols each) — arm immediately.
          // The warmup has proven bars are real, which is a stronger signal
          // than the old bar-visibility guard (filled>100 for a single bar).
          // Without this, a fast R1 KO can land before the 30-frame bar-stable
          // fallback or the first timer decrease, and the bars-vanished KO path
          // is blocked by !roundTimerWasRunning.
          this.roundTimerWasRunning = true;
          this.lastRunningP1Health = rawP1;
          this.lastRunningP2Health = rawP2;
          this._postTimerCalibFrames = 0;
    this._barStableFrames = 0;
          console.log(`[pixel-analyzer] 🎮 Phase: WARMUP → PLAYING (bars visible: P1=${this.p1FullBarWidth} P2=${this.p2FullBarWidth} cols — round armed, health P1=${rawP1}% P2=${rawP2}%)`);
          this.emitMatchStarted(rawP1, rawP2, timerValue);
          break;
        }

        // ── Timer-based exit: fallback if bars haven't been seen yet but ──
        //     the timer is clearly in-match (≥30). This catches cases where
        //     the stripe geometry is wrong and bars are never detected.
        if (timerValue >= 30) {
          // ── Asymmetric calibration guard ───────────────────────────
          // If warmup captured a damaged/KO'd bar as the "full" width
          // (e.g. P1=57 because reset() was called late, mid-combat),
          // the small calibration makes health read too high and delays
          // KO detection. SFA2 bars are symmetric within ~10% — if one
          // bar is clearly healthy (≥ 80% of its region) and the other
          // is less than half of the healthy bar's width, copy the
          // healthy width. Also arm the round immediately: asymmetric
          // bars prove combat happened (intros show both at zero/full).
          const p1RegionW = this.p1EndX - this.p1StartX;
          const p2RegionW = this.p2EndX - this.p2StartX;
          const healthyFloor1 = Math.floor(p1RegionW * 0.8);
          const healthyFloor2 = Math.floor(p2RegionW * 0.8);
          let asymmetricFixed = false;
          if (this.p2FullBarWidth >= healthyFloor2 && this.p1FullBarWidth < this.p2FullBarWidth * 0.5) {
            // Copy the healthy bar's width so calibration doesn't break, but
            // only arm the round if the damaged bar is actually visible.
            // < MIN_WARMUP_BAR_COLS means the bar isn't rendered yet
            // (intro animation still playing), not that it's genuinely KO'd.
            const savedP1W = this.p1FullBarWidth;
            this.p1FullBarWidth = this.p2FullBarWidth;
            if (savedP1W >= MIN_WARMUP_BAR_COLS) {
              console.log(`[pixel-analyzer] 🔧 P1 bar looks damaged/KO'd at warmup (was ${savedP1W} vs P2=${this.p2FullBarWidth}) — copying P2 width, arming round`);
              asymmetricFixed = true;
            } else {
              console.log(`[pixel-analyzer] 🔧 P1 bar not visible yet at warmup (${savedP1W} cols, P2=${this.p2FullBarWidth}) — copied P2 width, waiting for bar visibility`);
            }
          } else if (this.p1FullBarWidth >= healthyFloor1 && this.p2FullBarWidth < this.p1FullBarWidth * 0.5) {
            const savedP2W = this.p2FullBarWidth;
            this.p2FullBarWidth = this.p1FullBarWidth;
            if (savedP2W >= MIN_WARMUP_BAR_COLS) {
              console.log(`[pixel-analyzer] 🔧 P2 bar looks damaged/KO'd at warmup (was ${savedP2W} vs P1=${this.p1FullBarWidth}) — copying P1 width, arming round`);
              asymmetricFixed = true;
            } else {
              console.log(`[pixel-analyzer] 🔧 P2 bar not visible yet at warmup (${savedP2W} cols, P1=${this.p1FullBarWidth}) — copied P1 width, waiting for bar visibility`);
            }
          }
          this.healthHistoryP1 = [];
          this.healthHistoryP2 = [];
          this.gamePhase = GamePhase.PLAYING;
          this.playingFrameCount = 0;
          this.fastWarmup = false;
          this.calibrateOnTimerStart = false;
          this.roundTimerLastValue = timerValue;
          this._postTimerCalibFrames = 0;
          this._barStableFrames = 0;
          if (asymmetricFixed) {
            // Asymmetric bars prove combat happened — arm immediately.
            this.roundTimerWasRunning = true;
            this.roundTimerMaxSeen = timerValue;
            this.lastRunningP1Health = Math.round((p1Filled / this.p1FullBarWidth) * 100);
            this.lastRunningP2Health = Math.round((p2Filled / this.p2FullBarWidth) * 100);
            console.log(`[pixel-analyzer] 🎮 Phase: WARMUP → PLAYING (asymmetric fix — round armed, health P1=${this.lastRunningP1Health}% P2=${this.lastRunningP2Health}%)`);
            this.emitMatchStarted(this.lastRunningP1Health, this.lastRunningP2Health, timerValue);
          } else {
            // Timer-based exit: timer ≥30 but bars symmetric — don't arm yet;
            // wait for first timer decrease in PLAYING to prove round is live.
            this.roundTimerWasRunning = false;
            this.roundTimerMaxSeen = 0;
            console.log(`[pixel-analyzer] 🎮 Phase: WARMUP → PLAYING (timer=${timerValue}, barW warmup P1=${this.p1FullBarWidth} P2=${this.p2FullBarWidth} — waiting for timer-drop to arm)`);
            this.emitMatchStarted(rawP1, rawP2, timerValue);
            // Flag for processFrame to save a debug stripe on the next frame
            // so we can diagnose why bar calibration is poor.
            this._saveDebugOnNextFrame = true;
          }
          break;
        }

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
            this.emitMatchStarted(rawP1, rawP2, timerValue);
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

        // Track max filled columns while calibration is not locked. Intro
        // elements (FIGHT! glow, flashes) fill the ENTIRE stripe — every
        // column of the region passes, giving exactly regionW. A real bar
        // never touches both region edges (regions have a small margin
        // around the measured bar span), so a full-region fill is an
        // artifact and is ignored.
        if (!this.p1FullBarLocked || !this.p2FullBarLocked) {
          const p1RegionW = this.p1EndX - this.p1StartX;
          const p2RegionW = this.p2EndX - this.p2StartX;
          if (p1Filled > this.roundStartMaxP1Filled && p1Filled < p1RegionW) this.roundStartMaxP1Filled = p1Filled;
          if (p2Filled > this.roundStartMaxP2Filled && p2Filled < p2RegionW) this.roundStartMaxP2Filled = p2Filled;
        }

        // ── Timer liveness: require a confirmed DECREASE ─────────────
        // A result/victory screen freezes the timer at its end-of-round
        // value (>0 after a KO), so "timer > 0" is NOT proof of a live
        // round. Only a decrease by a plausible tick proves the round is
        // actually running — this arms KO and time-over detection.
        if (timerValue > 0) {
          const dropped = this.roundTimerLastValue - timerValue;
          // Accept any decrease ≥ 1 as proof the round is live.
          // The old ≤ 5 cap prevented false positives from timer glitches but
          // also blocked legitimate template-correction jumps (e.g. misread 81
          // correcting to true 45 → a 36-tick drop that IS a valid timer tick
          // once the template is fixed). With captured templates, corrections
          // are rare, so any confirmed decrease arms the round.
          if (this.roundTimerLastValue > 0 && dropped >= 1) {
            if (!this.roundTimerWasRunning) {
              // ── Timer-start calibration (no reset, no guard) ─────
              // The timer just decreased for the first time — the fight is
              // live. We do NOT gate on bar visibility here because the
              // timer detector may fire early (during VS countdown or
              // FIGHT! glow) while bars are still absent — checking
              // current filled misses the window if bars appear later.
              //
              // Instead we rely on roundStartMax, which has been tracking
              // since PLAYING start with the anti-glow filter (< regionW).
              // It stays at 0 through the VS screen / glow, then jumps to
              // the true bar width (270-295) as soon as bars appear. The
              // post-glow calibration below locks the instant max ≥ floor.
              // No reset means the accumulated max survives across the
              // timer-start boundary.
              this.roundTimerWasRunning = true;
              this.calibrateOnTimerStart = false;
              this._postTimerCalibFrames = 0;
    this._barStableFrames = 0;
            }
          }

          this.roundTimerLastValue = timerValue;
          if (this.roundTimerWasRunning) {
            // Track the highest timer value seen AFTER the round was
            // confirmed running — transient high readings at screen
            // transitions (e.g. 73) happen BEFORE the first decrease
            // and must not inflate the max, or the ≥50 gate fails.
            if (timerValue > this.roundTimerMaxSeen) this.roundTimerMaxSeen = timerValue;
            this.lastRunningP1Health = p1Health;
            this.lastRunningP2Health = p2Health;

            // ── Post-glow calibration ──────────────────────────────
            // Track max filled from the moment the timer first decreases.
            // We wait until at least one bar exceeds its floor (40% of
            // region width) — this guarantees the bars are actually
            // visible before we lock. Safety timeout at 60 frames (~15s).
            if (!this.p1FullBarLocked || !this.p2FullBarLocked) {
              this._postTimerCalibFrames++;
              // 80% of region width = full bar (~270-288 of 304). Lower floors
              // (40%) cause calibration to lock prematurely on a partially-
              // revealed bar during intro animations (observed: locked at 183
              // when true width was 270).
              const floor1 = Math.floor((this.p1EndX - this.p1StartX) * 0.8);
              const floor2 = Math.floor((this.p2EndX - this.p2StartX) * 0.8);
              const p1Ready = this.roundStartMaxP1Filled >= floor1;
              const p2Ready = this.roundStartMaxP2Filled >= floor2;
              const timedOut = this._postTimerCalibFrames >= 60;

              if (p1Ready || p2Ready || timedOut) {
                if (!this.p1FullBarLocked) {
                  if (p1Ready) {
                    const oldW = this.p1FullBarWidth;
                    this.p1FullBarWidth = this.roundStartMaxP1Filled;
                    this.healthHistoryP1 = [];
                    this.p1FullBarLocked = true;
                    console.log(`[pixel-analyzer] 📏🔒 P1 post-glow calibrated: fullBarW=${this.p1FullBarWidth} (was ${oldW}, waited ${this._postTimerCalibFrames}f)`);
                  } else if (timedOut) {
                    // ── Timeout fallback ──────────────────────────
                    // Bar never reached the 80% floor within 60 frames.
                    // Use the bar's OWN measured max if available — do NOT
                    // copy from the other bar (P1/P2 regions may capture
                    // different widths due to mirroring or positioning).
                    if (this.roundStartMaxP1Filled > 0) {
                      const oldW = this.p1FullBarWidth;
                      this.p1FullBarWidth = this.roundStartMaxP1Filled;
                      this.healthHistoryP1 = [];
                      this.p1FullBarLocked = true;
                      console.log(`[pixel-analyzer] 📏🔒 P1 post-glow calibrated (own measurement): fullBarW=${this.p1FullBarWidth} (was ${oldW}, waited ${this._postTimerCalibFrames}f)`);
                    } else if (this._postTimerCalibFrames === 60) {
                    // Bar still hasn't reached the floor — do NOT lock a
                    // garbage width (a VS-screen misread can arm the window
                    // while the bars are still invisible). Keep waiting;
                    // the floor check fires whenever the bar finally shows.
                    console.log(`[pixel-analyzer] ⏳ P1 post-glow calib still waiting: max=${this.roundStartMaxP1Filled} < floor=${floor1} (fullBarW stays ${this.p1FullBarWidth})`);
                    }
                  }
                }
                if (!this.p2FullBarLocked) {
                  if (p2Ready) {
                    const oldW = this.p2FullBarWidth;
                    this.p2FullBarWidth = this.roundStartMaxP2Filled;
                    this.healthHistoryP2 = [];
                    this.p2FullBarLocked = true;
                    console.log(`[pixel-analyzer] 📏🔒 P2 post-glow calibrated: fullBarW=${this.p2FullBarWidth} (was ${oldW}, waited ${this._postTimerCalibFrames}f)`);
                  } else if (timedOut) {
                    // ── Timeout fallback ──────────────────────────
                    // Bar never reached the 80% floor within 60 frames.
                    // Use the bar's OWN measured max — do NOT copy P1's width.
                    if (this.roundStartMaxP2Filled > 0) {
                      const oldW = this.p2FullBarWidth;
                      this.p2FullBarWidth = this.roundStartMaxP2Filled;
                      this.healthHistoryP2 = [];
                      this.p2FullBarLocked = true;
                      console.log(`[pixel-analyzer] 📏🔒 P2 post-glow calibrated (own measurement): fullBarW=${this.p2FullBarWidth} (was ${oldW}, waited ${this._postTimerCalibFrames}f)`);
                    } else if (this._postTimerCalibFrames === 60) {
                    console.log(`[pixel-analyzer] ⏳ P2 post-glow calib still waiting: max=${this.roundStartMaxP2Filled} < floor=${floor2} (fullBarW stays ${this.p2FullBarWidth})`);
                    }
                  }
                }
              }
            }
          }
        }

        // ── Bar-stable fallback (timer-independent) ───────────────
        // The timer-drop arming path only fires when the timer reads a
        // non-zero value AND shows a confirmed decrease. Both conditions
        // fail when the OCR reads 0/-1 (loading screens) or a constant
        // value (VS screen freeze at "81"). This fallback is independent
        // of timer state: if bars are clearly visible (≥80% of region
        // width) for 30 consecutive frames, the fight is live regardless
        // of what the timer OCR says. Gated on calibration NOT being
        // locked (post-glow calibration only runs after arming, so unlocked
        // bars mean the round hasn't been armed yet).
        if (!this.roundTimerWasRunning && !this.p1FullBarLocked && !this.p2FullBarLocked) {
          const floorOne = Math.floor((this.p1EndX - this.p1StartX) * 0.8);
          const anyBarStable =
            this.roundStartMaxP1Filled >= floorOne ||
            this.roundStartMaxP2Filled >= floorOne;
          if (anyBarStable) {
            this._barStableFrames++;
            if (this._barStableFrames === 30) {
              console.log(`[pixel-analyzer] 🔄 Bar-stable fallback: P1=${this.roundStartMaxP1Filled} P2=${this.roundStartMaxP2Filled} timer=${timerValue} (30f stable, arming without timer drop)`);
              this.roundTimerWasRunning = true;
              this.roundTimerMaxSeen = Math.max(this.roundTimerMaxSeen, timerValue);
              this.calibrateOnTimerStart = false;
              this._postTimerCalibFrames = 0;
              // Capture current health as lastRunning so TIME_OVER detection
              // has valid values even before the first timer decrease.
              if (this.lastRunningP1Health < 0) this.lastRunningP1Health = p1Health;
              if (this.lastRunningP2Health < 0) this.lastRunningP2Health = p2Health;
            }
          } else {
            this._barStableFrames = 0;
          }
        }

        // ── Fallback lastRunning capture (timer-independent) ──────────
        // The timer-block above only updates lastRunning when timerValue > 0.
        // If the timer OCR fails (reads -1/0) but the round is already armed
        // (e.g. by warmup bar-visible exit), we still need valid lastRunning
        // values for the text-primary verdict. Only update when at least one
        // bar is meaningfully healthy (> 5%) to avoid overwriting
        // real values with zeroes on result screens.
        if (this.roundTimerWasRunning) {
          if (p1Health > 5 || p2Health > 5) {
            this.lastRunningP1Health = p1Health;
            this.lastRunningP2Health = p2Health;
            this.lastRunningP1Filled = p1Filled;
            this.lastRunningP2Filled = p2Filled;
          }
        }

        // ── Desperation arm: stuck in PLAYING without arming ─────────
        // If warmup exited with poor bar calibration (bars too narrow to
        // reach the 80%-region floor), neither the timer-decrease nor the
        // bar-stable fallback can arm the round. After DESPERATION_ARM_FRAMES
        // (~5-10s) in PLAYING, the fight is definitely live — arm anyway.
        // A poorly calibrated round is better than silently missing it.
        if (!this.roundTimerWasRunning && this.playingFrameCount >= DESPERATION_ARM_FRAMES) {
          console.log(`[pixel-analyzer] 🆘 Desperation arm after ${this.playingFrameCount}f in PLAYING (P1=${p1Health}% P2=${p2Health}%, barW P1=${this.p1FullBarWidth} P2=${this.p2FullBarWidth}, max P1=${this.roundStartMaxP1Filled} P2=${this.roundStartMaxP2Filled})`);
          this.roundTimerWasRunning = true;
          this.roundTimerMaxSeen = Math.max(this.roundTimerMaxSeen, timerValue > 0 ? timerValue : 99);
          this.calibrateOnTimerStart = false;
          this._postTimerCalibFrames = 0;
          this._barStableFrames = 0;
          if (this.lastRunningP1Health < 0) this.lastRunningP1Health = p1Health;
          if (this.lastRunningP2Health < 0) this.lastRunningP2Health = p2Health;
          // Force bar lock using whatever max we have — even if it's wrong,
          // it's better than not detecting any KO at all.
          if (!this.p1FullBarLocked && this.roundStartMaxP1Filled > 0) {
            this.p1FullBarWidth = this.roundStartMaxP1Filled;
            this.p1FullBarLocked = true;
            this.healthHistoryP1 = [];
            console.log(`[pixel-analyzer] 📏🔒 P1 desperation lock: fullBarW=${this.p1FullBarWidth}`);
          }
          if (!this.p2FullBarLocked && this.roundStartMaxP2Filled > 0) {
            this.p2FullBarWidth = this.roundStartMaxP2Filled;
            this.p2FullBarLocked = true;
            this.healthHistoryP2 = [];
            console.log(`[pixel-analyzer] 📏🔒 P2 desperation lock: fullBarW=${this.p2FullBarWidth}`);
          }
        }

        // ── Text confirmation window ─────────────────────────────────
        // When text was detected but we haven't confirmed it yet, watch
        // for hard evidence that the round actually ended. This filters
        // out "FIGHT!" and "ROUND X" text (which never lead to bars
        // vanishing or timer hitting 0) from real KO/PERFECT/TIME-OVER.
        if (this._textConfirming) {
          this._textConfirmFramesRemaining--;
          const barsVanished = p1Health <= 2 && p2Health <= 2;
          const timerExpired = timerValue === 0 && this.roundTimerWasRunning;

          if (barsVanished) {
            this._textConfirming = false;
            console.log(`[pixel-analyzer] ✅ Text confirmed — bars vanished (P1=${p1Health}% P2=${p2Health}%), resolving round end`);
            this.resolveTextRoundEnd(p1Health, p2Health);
            break; // round-end evaluation done for this frame
          } else if (timerExpired) {
            this._textConfirming = false;
            console.log(`[pixel-analyzer] ✅ Text confirmed — timer expired (timer=${timerValue}), resolving TIME OVER`);
            this.resolveTextRoundEnd(p1Health, p2Health);
            break; // round-end evaluation done for this frame
          } else if (this._textConfirmFramesRemaining <= 0) {
            this._textConfirming = false;
            console.log(`[pixel-analyzer] ❌ Text confirmation TIMED OUT (${TEXT_CONFIRM_FRAMES}f) — false positive (FIGHT!/ROUND X), ignoring. P1=${p1Health}% P2=${p2Health}% timer=${timerValue}`);
            // Don't break — continue to other round-end paths below
          } else {
            // Still waiting — don't evaluate any other round-end paths
            // on this frame (prevents double-resolution)
            break;
          }
        }

        // ── Text-primary round-end evaluation ─────────────────────────
        // When the text event detector reported an overlay and the round
        // was live, evaluate the verdict using lastRunning (fighting) healths.
        // By the time the result screen appears, bars are already refilled
        // to 100%, so lastRunning is essential for a correct verdict.
        // This is the PRIMARY round-end path — text overlays are more
        // reliable than bar-threshold detection across all SFA2 variants.
        if (this._textRoundEndPending) {
          this._textRoundEndPending = false;
          const lrP1 = this.lastRunningP1Health >= 0 ? this.lastRunningP1Health : p1Health;
          const lrP2 = this.lastRunningP2Health >= 0 ? this.lastRunningP2Health : p2Health;
          const healthDiff = Math.abs(lrP1 - lrP2);
          let hadWinner = false;

          if (healthDiff <= HEALTH_DIFF_THRESHOLD) {
            // DRAW or TIME_OVER_DRAW — SFA2 gives no round mark, game replays
            console.log(`[pixel-analyzer] 📝 Text round-end: DRAW (P1=${lrP1}% P2=${lrP2}%, diff=${healthDiff}%). No round mark. Losses: P1=${this.p1Losses} P2=${this.p2Losses}`);
          } else if (lrP1 > lrP2) {
            hadWinner = true;
            this.p2Losses++;
            this.roundNumber++;
            const koType = this.isPerfectKo(1) ? "perfect" : "normal";
            if (koType === "perfect") this.matchPerfectKos++;
            console.log(`[pixel-analyzer] 📝 Text round-end: P1 WINS (P1=${lrP1}% > P2=${lrP2}%, ${koType}). Losses: P1=${this.p1Losses} P2=${this.p2Losses}`);
            this.emit("roundResult", { loser: 2, winner: 1, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType } satisfies RoundResultEvent);
            this.checkMatchEnd();
          } else {
            hadWinner = true;
            this.p1Losses++;
            this.roundNumber++;
            const koType = this.isPerfectKo(2) ? "perfect" : "normal";
            if (koType === "perfect") this.matchPerfectKos++;
            console.log(`[pixel-analyzer] 📝 Text round-end: P2 WINS (P2=${lrP2}% > P1=${lrP1}%, ${koType}). Losses: P1=${this.p1Losses} P2=${this.p2Losses}`);
            this.emit("roundResult", { loser: 1, winner: 2, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType } satisfies RoundResultEvent);
            this.checkMatchEnd();
          }

          // Only set cooldown when a real round was scored — DRAW false-positives
          // must not start a cooldown cycle that arms new-round detection.
          if (hadWinner) {
            this.roundEndCooldown = ROUND_END_COOLDOWN;
            this.roundStartMaxP1Filled = 0;
            this.roundStartMaxP2Filled = 0;
            this.p1FullBarLocked = false;
            this.p2FullBarLocked = false;
          }
          this.barsVanishedFrames = 0;
          this.timeOverFrames = 0;
          break;
        }

        // ── Heartbeat: periodic confirmation the analyzer is alive ──
        if (this.playingFrameCount % 240 === 0) {
          console.log(`[pixel-analyzer] 💓 PLAYING heartbeat f${this.playingFrameCount}: ` +
            `P1=${p1Health}%/${p1Filled}c P2=${p2Health}%/${p2Filled}c ` +
            `timer=${timerValue} running=${this.roundTimerWasRunning} ` +
            `barW P1=${this.p1FullBarWidth} P2=${this.p2FullBarWidth} ` +
            `maxSeen=${this.roundTimerMaxSeen} cooldown=${this.roundEndCooldown}`);
        }

        // Grace period: ignore all KO/time-over signals for the first N frames
        if (this.playingFrameCount <= PLAYING_GRACE_FRAMES) break;

        // ── Bars-vanished fallback ──────────────────────────────────
        // Text-primary handles most round ends, but if the text detector
        // misses an event, we fall back to detecting simultaneous bar
        // disappearance (result screen transition). Requires the round to
        // be armed (timer was seen decreasing).
        const p1Down = p1Health <= 2;
        const p2Down = p2Health <= 2;

        if (p1Down && p2Down && this.roundTimerWasRunning && this.roundEndCooldown === 0) {
          this.barsVanishedFrames++;
          if (this.barsVanishedFrames >= BARS_VANISHED_CONFIRM_FRAMES) {
            const lrP1 = this.lastRunningP1Health >= 0 ? this.lastRunningP1Health : p1Health;
            const lrP2 = this.lastRunningP2Health >= 0 ? this.lastRunningP2Health : p2Health;
            const healthDiff = Math.abs(lrP1 - lrP2);
            let hadWinner = false;

            if (healthDiff <= HEALTH_DIFF_THRESHOLD) {
              console.log(`[pixel-analyzer] 🔻 Bars-vanished: DRAW (P1=${lrP1}% P2=${lrP2}%, diff=${healthDiff}%). No round mark. Losses: P1=${this.p1Losses} P2=${this.p2Losses}`);
            } else if (lrP1 > lrP2) {
              hadWinner = true;
              this.p2Losses++;
              this.roundNumber++;
              const koType = this.isPerfectKo(1) ? "perfect" : "normal";
              if (koType === "perfect") this.matchPerfectKos++;
              console.log(`[pixel-analyzer] 🔻 Bars-vanished: P1 WINS (P1=${lrP1}% > P2=${lrP2}%, ${koType}). Losses: P1=${this.p1Losses} P2=${this.p2Losses}`);
              this.emit("roundResult", { loser: 2, winner: 1, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType } satisfies RoundResultEvent);
            this.checkMatchEnd();
            } else {
              hadWinner = true;
              this.p1Losses++;
              this.roundNumber++;
              const koType = this.isPerfectKo(2) ? "perfect" : "normal";
              if (koType === "perfect") this.matchPerfectKos++;
              console.log(`[pixel-analyzer] 🔻 Bars-vanished: P2 WINS (P2=${lrP2}% > P1=${lrP1}%, ${koType}). Losses: P1=${this.p1Losses} P2=${this.p2Losses}`);
              this.emit("roundResult", { loser: 1, winner: 2, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType } satisfies RoundResultEvent);
            this.checkMatchEnd();
            }

            if (hadWinner) {
              this.roundEndCooldown = ROUND_END_COOLDOWN;
              this.roundStartMaxP1Filled = 0;
              this.roundStartMaxP2Filled = 0;
              this.p1FullBarLocked = false;
              this.p2FullBarLocked = false;
            }
            this.barsVanishedFrames = 0;
            this.timeOverFrames = 0;
            break;
          }
        } else {
          this.barsVanishedFrames = 0;
        }

        // ── Time-over fallback (timer==0, bars still healthy) ────────
        // Text-primary handles most time-overs, but the TIME OVER text
        // can have lower contrast than KO/PERFECT. Fallback: timer reads
        // 0 while bars are still healthy — classic time-over pattern.
        if (timerValue === 0 && this.roundTimerWasRunning && this.roundEndCooldown === 0) {
          if (p1Health > 10 && p2Health > 10) {
            this.timeOverFrames++;
            if (this.timeOverFrames >= TIME_OVER_CONFIRM_FRAMES) {
              if (this.roundTimerMaxSeen < 50) {
                this.timeOverFrames = 0;
              } else {
                const toP1 = this.lastRunningP1Health >= 0 ? this.lastRunningP1Health : p1Health;
                const toP2 = this.lastRunningP2Health >= 0 ? this.lastRunningP2Health : p2Health;
                let hadWinner = false;

                if (toP1 > toP2) {
                  hadWinner = true;
                  this.p2Losses++;
                  this.roundNumber++;
                  console.log(`[pixel-analyzer] ⏱️ TIME OVER! P1 wins (P1=${toP1}% > P2=${toP2}%). Losses: P1=${this.p1Losses} P2=${this.p2Losses}`);
                  this.emit("roundResult", { loser: 2, winner: 1, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType: "timeout" } satisfies RoundResultEvent);
                  this.checkMatchEnd();
                } else if (toP2 > toP1) {
                  hadWinner = true;
                  this.p1Losses++;
                  this.roundNumber++;
                  console.log(`[pixel-analyzer] ⏱️ TIME OVER! P2 wins (P2=${toP2}% > P1=${toP1}%). Losses: P1=${this.p1Losses} P2=${this.p2Losses}`);
                  this.emit("roundResult", { loser: 1, winner: 2, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType: "timeout" } satisfies RoundResultEvent);
                  this.checkMatchEnd();
                } else {
                  console.log(`[pixel-analyzer] ⏱️ TIME OVER DRAW! Equal health (P1=${toP1}% P2=${toP2}%) — no round mark, game replays. Losses: P1=${this.p1Losses} P2=${this.p2Losses}`);
                }

                if (hadWinner) {
                  this.roundEndCooldown = ROUND_END_COOLDOWN;
                  this.roundStartMaxP1Filled = 0;
                  this.roundStartMaxP2Filled = 0;
                  this.p1FullBarLocked = false;
                  this.p2FullBarLocked = false;
                }
                this.barsVanishedFrames = 0;
                this.timeOverFrames = 0;
                break;
              }
            }
          } else {
            this.timeOverFrames = 0;
          }
        } else {
          this.timeOverFrames = 0;
        }

        // ── Round-end cooldown & new-round detection ──────────────────
        if (this.roundEndCooldown > 0) {
          this.roundEndCooldown--;
          if (this.roundEndCooldown === 0) {
            this._newRoundArmed = true; // arm for exactly one detection
          }
        }

        // New round: both bars refilled to ≥80% after cooldown expired.
        // Uses one-shot _newRoundArmed flag to prevent repeated re-entry
        // (bars stay at 100% on result screen → would fire every frame).
        // Only applies when at least one round has been scored.
        if (this._newRoundArmed && this.roundNumber > 0 &&
            p1Health >= NEW_ROUND_HEALTH && p2Health >= NEW_ROUND_HEALTH) {
          this._newRoundArmed = false;
          this.roundTimerWasRunning = false;
          this.roundTimerLastValue = -1;
          this.roundTimerMaxSeen = 0;
          this.lastRunningP1Health = -1;
          this.lastRunningP2Health = -1;
          this.lastRunningP1Filled = 0;
          this.lastRunningP2Filled = 0;
          this.roundP1MinHealth = 100;
          this.roundP2MinHealth = 100;
          this.roundP1MinFilled = 9999;
          this.roundP2MinFilled = 9999;
          this.roundP1MaxFilled = 0;
          this.roundP2MaxFilled = 0;
          this.roundStartMaxP1Filled = 0;
          this.roundStartMaxP2Filled = 0;
          this.p1FullBarLocked = false;
          this.p2FullBarLocked = false;
          this.barsVanishedFrames = 0;
          this.timeOverFrames = 0;
          this._textRoundEndPending = false;
          this._textRoundEndRatio = 0;
          this._textConfirming = false; // cancel any pending confirmation (new round started)
          console.log(`[pixel-analyzer] 🆕 New round detected — bars refilled ≥${NEW_ROUND_HEALTH}% (round ${this.roundNumber})`);
        }
        break;
      }

      case GamePhase.MATCH_END:
        // Nothing to do — matchEnd already emitted
        break;
    }
  }

  // ── Health bar calibration ─────────────────────────────────────────

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
}
