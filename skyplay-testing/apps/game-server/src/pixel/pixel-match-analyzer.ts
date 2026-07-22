import { EventEmitter } from "events";
import { type PixelGameConfig } from "./pixel-game-config.js";
import { TimerDetector } from "./timer-detector.js";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";

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
const WARMUP_TIMEOUT_FRAMES = 300; // ~75s at 4fps — force-exit if warmup never ends
const PERFECT_HEALTH = 95; // kept for backwards compat, prefer isPerfectKo()
const PERFECT_RATIO = 0.95; // minFilled / maxFilled must be ≥ this
const ROUND_START_CALIB_FRAMES = 4; // PLAYING frames over which full-bar width is re-measured (bars are full during the round intro)
const HEALTH_HISTORY_SIZE = 3; // median-of-3 — minimal lag while filtering single-frame noise
const KO_CONFIRM_REQUIRED = 5;        // ~2.5s at 2 fps — longer than a timer tick (~1.8s), so a live round's tick always resets the count (sliver-of-health guard)
const KO_RECOVERY_CONFIRM_REQUIRED = 3; // consecutive recovered frames to exit KO_PENDING (flash immunity)
const NEW_ROUND_CONFIRM_REQUIRED = 5; // ~2.5s at 2 fps
const PLAYING_GRACE_FRAMES = 16;      // ~4s at 4 reads/sec — skips FIGHT! overlay
const TIME_OVER_CONFIRM_REQUIRED = 3; // ~1.5s at 2 fps

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
  /** True once BOTH bars were seen ≥50% during this round's PLAYING phase.
   *  A real KO always follows a period of healthy bars — screens where the
   *  bars are invisible (VS/intros) read as ~0% and must never arm KO. */
  private roundSawHealthyBars = false;
  /** Last valid (>0) timer reading this round — decrease detection. */
  private roundTimerLastValue = -1;
  /** Highest timer value seen this round. Must be ≥ 50 before time-over
   *  is trusted — otherwise we joined mid-round and lack enough data
   *  to call a winner (produces phantom draws). */
  private roundTimerMaxSeen = 0;
  /** True when PLAYING was entered from WARMUP: the warmup can complete on
   *  the VS/loading screen, so the frames-1-4 recalibration may measure
   *  garbage (observed: P2 full-bar 282 vs real 210 → perfect KO read as
   *  79%). In that case recalibration is deferred until the timer is first
   *  confirmed decreasing (proof of a real round). */
  private calibrateOnTimerStart = false;
  /** Locked at timer-start calibration — prevents damage from being
   *  misinterpreted as intro fade. Once locked, fullBarWidth is fixed. */
  private p1FullBarLocked = false;
  private p2FullBarLocked = false;
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
  private _warmupFrameCount = 0;  // safety timeout counter
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
  private koDetected = false;
  /** One-shot debug flag — saves the full stripe PPM during combat. */
  private _debugStripeSaved = false;
  /** Post-timer-start calibration countdown (0 = inactive). */
  private _postTimerCalibFrames = 0;
  /** Consecutive frames where both bars are ≥80% without a timer decrease.
   *  Triggers bar-stable fallback calibration after 30 frames (~7.5s). */
  private _barStableFrames = 0;
  /** Throttle for live health events — emit at most once per 500ms. */
  private _lastHealthEmit = 0;

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

  /** Ratio-based perfect KO — uses raw filled-column min/max so it's immune
   *  to fullBarWidth calibration drift. A true perfect means the winner's bar
   *  never shrank: minFilled ≥ 95% of maxFilled during the round. */
  private isPerfectKo(player: 1 | 2): boolean {
    const minFilled = player === 1 ? this.roundP1MinFilled : this.roundP2MinFilled;
    const maxFilled = player === 1 ? this.roundP1MaxFilled : this.roundP2MaxFilled;
    return maxFilled > 0 && (minFilled / maxFilled) >= PERFECT_RATIO;
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
    // Restrict the scan to the stripe rows that actually contain the BARS.
    // On SNES SFA2 the stripe also covers the score digits and names
    // (above) and the timer digits (middle) — barRowStart/barRowH from the
    // game config exclude them. Configs without these fields keep the
    // legacy full-stripe scan.
    const barStartY = Math.min(this.config.barRowStart ?? 0, Math.max(0, height - 1));
    const barRows = Math.min(this.config.barRowH ?? height, height - barStartY);
    const p1Filled = this.measureFilledColumns(frame, width, this.p1StartX, barStartY, this.p1EndX - this.p1StartX, barRows);
    const p2Filled = this.measureFilledColumns(frame, width, this.p2StartX, barStartY, this.p2EndX - this.p2StartX, barRows);

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
      try {
        const dir = "/recordings/calibration";
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const ppmPath = join(dir, "debug-stripe-combat.ppm");
        const header = `P6\n${width} ${height}\n255\n`;
        writeFileSync(ppmPath, Buffer.concat([Buffer.from(header, "ascii"), frame]));
        console.log(`[pixel-analyzer] 🔬 Saved combat stripe debug: ${ppmPath} (${width}x${height}, p1Filled=${p1Filled} p2Filled=${p2Filled})`);
        try { execSync(`convert "${ppmPath}" "${ppmPath.replace('.ppm', '.png')}"`, { stdio: "pipe", timeout: 5000 }); } catch { /* PNG optional — PPM is enough */ }
      } catch (e) {
        console.log(`[pixel-analyzer] 🔬 Failed to save combat stripe: ${(e as Error).message}`);
      }
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

    // ── State machine ────────────────────────────────────────────────
    this.runStateMachine(p1Health, p2Health, rawP1, rawP2, p1Filled, p2Filled, timerValue);

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
    this.koConfirmFrames = 0;
    this.newRoundConfirmFrames = 0;
    this.timeOverConfirmFrames = 0;
    this.roundTimerWasRunning = false;
    this.roundSawHealthyBars = false;
    this.roundTimerLastValue = -1;
    this.roundTimerMaxSeen = 0;
    this.calibrateOnTimerStart = false;
    this.p1FullBarLocked = false;
    this.p2FullBarLocked = false;
    this.koPendingTimerAtStart = -1;
    this.koPendingMaxTimer = -1;
    this.koPendingLoser = 0;
    this.koRecoveryFrames = 0;
    this.lastRunningP1Health = -1;
    this.lastRunningP2Health = -1;
    this.roundP1MinHealth = 100;
    this.roundP2MinHealth = 100;
    this.roundP1MinFilled = 9999;
    this.roundP2MinFilled = 9999;
    this.roundP1MaxFilled = 0;
    this.roundP2MaxFilled = 0;
    this.roundStartMaxP1Filled = 0;
    this.roundStartMaxP2Filled = 0;
    this.koDetected = false;
    this.matchEnded = false;
    this._debugStripeSaved = false;
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
          this.roundTimerWasRunning = false;
          this._postTimerCalibFrames = 0;
    this._barStableFrames = 0;
          console.log(`[pixel-analyzer] 🎮 Phase: WARMUP → PLAYING (bars visible: P1=${this.p1FullBarWidth} P2=${this.p2FullBarWidth} cols — waiting for timer-drop to arm)`);
          break;
        }

        // ── Timer-based exit: fallback if bars haven't been seen yet but ──
        //     the timer is clearly in-match (≥30). This catches cases where
        //     the stripe geometry is wrong and bars are never detected.
        if (timerValue >= 30) {
          this.healthHistoryP1 = [];
          this.healthHistoryP2 = [];
          this.gamePhase = GamePhase.PLAYING;
          this.playingFrameCount = 0;
          this.fastWarmup = false;
          this.calibrateOnTimerStart = false;
          this.roundTimerLastValue = timerValue;
          // Timer-based exit: a plausible timer value (≥30) means the game
          // is past loading screens — exit WARMUP immediately. Do NOT arm
          // roundTimerWasRunning here: on SFA2 SNES the timer is displayed
          // during the VS screen and character intros but does NOT decrease
          // until "FIGHT!" clears. Arming early allows KO detection while
          // bars are invisible (intros) → false KO → calibration never runs.
          // Instead, keep roundTimerWasRunning false and let the first
          // confirmed timer decrease in PLAYING (line ~487) arm it — that
          // proves the round is actually live. The PLAYING_GRACE_FRAMES
          // guard (16 frames) covers the gap between warmup exit and that
          // first decrease. roundTimerLastValue is seeded so the dropped
          // calculation works when the timer finally ticks.
          this.roundTimerWasRunning = false;
          this.roundTimerMaxSeen = 0;
          this._postTimerCalibFrames = 0;
    this._barStableFrames = 0;
          console.log(`[pixel-analyzer] 🎮 Phase: WARMUP → PLAYING (timer=${timerValue}, barW warmup P1=${this.p1FullBarWidth} P2=${this.p2FullBarWidth} — waiting for timer-drop to arm)`);
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
                  } else if (timedOut && this.p2FullBarLocked) {
                    // ── Symmetry fallback ──────────────────────────
                    // P2 locked correctly but P1 never reached its floor.
                    const oldW = this.p1FullBarWidth;
                    this.p1FullBarWidth = this.p2FullBarWidth;
                    this.healthHistoryP1 = [];
                    this.p1FullBarLocked = true;
                    console.log(`[pixel-analyzer] 📏🔒 P1 post-glow calibrated (symmetry fallback): fullBarW=${this.p1FullBarWidth} (was ${oldW}, copied from P2, waited ${this._postTimerCalibFrames}f)`);
                  } else if (this._postTimerCalibFrames === 60) {
                    // Bar still hasn't reached the floor — do NOT lock a
                    // garbage width (a VS-screen misread can arm the window
                    // while the bars are still invisible). Keep waiting;
                    // the floor check fires whenever the bar finally shows.
                    console.log(`[pixel-analyzer] ⏳ P1 post-glow calib still waiting: max=${this.roundStartMaxP1Filled} < floor=${floor1} (fullBarW stays ${this.p1FullBarWidth})`);
                  }
                }
                if (!this.p2FullBarLocked) {
                  if (p2Ready) {
                    const oldW = this.p2FullBarWidth;
                    this.p2FullBarWidth = this.roundStartMaxP2Filled;
                    this.healthHistoryP2 = [];
                    this.p2FullBarLocked = true;
                    console.log(`[pixel-analyzer] 📏🔒 P2 post-glow calibrated: fullBarW=${this.p2FullBarWidth} (was ${oldW}, waited ${this._postTimerCalibFrames}f)`);
                  } else if (timedOut && this.p1FullBarLocked) {
                    // ── Symmetry fallback ──────────────────────────
                    // P1 locked correctly but P2 never reached its floor.
                    // SFA2 bars are symmetric — copy P1's width.
                    const oldW = this.p2FullBarWidth;
                    this.p2FullBarWidth = this.p1FullBarWidth;
                    this.healthHistoryP2 = [];
                    this.p2FullBarLocked = true;
                    console.log(`[pixel-analyzer] 📏🔒 P2 post-glow calibrated (symmetry fallback): fullBarW=${this.p2FullBarWidth} (was ${oldW}, copied from P1, waited ${this._postTimerCalibFrames}f)`);
                  } else if (this._postTimerCalibFrames === 60) {
                    console.log(`[pixel-analyzer] ⏳ P2 post-glow calib still waiting: max=${this.roundStartMaxP2Filled} < floor=${floor2} (fullBarW stays ${this.p2FullBarWidth})`);
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
              this.calibrateOnTimerStart = false;
              this._postTimerCalibFrames = 0;
            }
          } else {
            this._barStableFrames = 0;
          }
        }

        // Grace period: ignore all KO/time-over signals for the first N frames
        if (this.playingFrameCount <= PLAYING_GRACE_FRAMES) break;

        const p1Down = p1Health <= KO_THRESHOLD;
        const p2Down = p2Health <= KO_THRESHOLD;

        // Simultaneous double-drop guard — screen transition, not a real double KO.
        // BUT: if the round was live and we have lastRunning values, a simultaneous
        // drop to 0 on both bars is a result-screen transition. Use lastRunning to
        // determine the winner (lower health = loser). The actual KO frame was
        // missed between 4fps samples.
        if (p1Down && p2Down) {
          const roundIsLive = this.timerDetector ? this.roundTimerWasRunning : this.roundSawHealthyBars;
          // Only fire once per round: koDetected prevents re-triggering on the
          // same result screen (bars stay at 0% after KO and would loop forever).
          if (!this.koDetected && roundIsLive && this.lastRunningP1Health >= 0 && this.lastRunningP2Health >= 0 &&
              this.lastRunningP1Health > KO_THRESHOLD && this.lastRunningP2Health > KO_THRESHOLD) {
            // Both bars were healthy in the last running frame, then both vanished.
            // This is a screen transition. If healths differ by >10%, the lower player lost.
            const lrP1 = this.lastRunningP1Health;
            const lrP2 = this.lastRunningP2Health;
            const healthDiff = Math.abs(lrP1 - lrP2);
            if (healthDiff > 10) {
              if (lrP1 < lrP2) {
                this.p1Losses++;
                this.roundNumber++;
                this.gamePhase = GamePhase.KO_CONFIRMED;
                this.koDetected = true;
                this.newRoundConfirmFrames = 0;
                const koType = this.isPerfectKo(2) ? "perfect" : "normal";
                if (koType === "perfect") this.matchPerfectKos++;
                console.log(`[pixel-analyzer] 🎮 Bars-vanished KO: P1 was ${lrP1}% vs P2 ${lrP2}% → P2 wins (${koType}). Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
                this.emit("roundResult", { loser: 1, winner: 2, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType } satisfies RoundResultEvent);
                break;
              } else {
                this.p2Losses++;
                this.roundNumber++;
                this.gamePhase = GamePhase.KO_CONFIRMED;
                this.koDetected = true;
                this.newRoundConfirmFrames = 0;
                const koType = this.isPerfectKo(1) ? "perfect" : "normal";
                if (koType === "perfect") this.matchPerfectKos++;
                console.log(`[pixel-analyzer] 🎮 Bars-vanished KO: P2 was ${lrP2}% vs P1 ${lrP1}% → P1 wins (${koType}). Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
                this.emit("roundResult", { loser: 2, winner: 1, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType } satisfies RoundResultEvent);
                break;
              }
            }
            // Healths were close (≤10% diff) — could be a timeout draw or menu transition
          }
          // Genuine double-drop: menu/attract transition with no round context
          break;
        }

        // Both bars seen healthy → this round's bars are real and visible.
        // Screens without bars (VS/intros/menus) read ~0% for both.
        if (p1Health >= 50 && p2Health >= 50) this.roundSawHealthyBars = true;

        // KO/time-over are only armed once the round is provably live
        // (timer seen decreasing AND both bars seen healthy). ROMs without
        // timer templates keep the legacy always-armed behavior.
        // With timer detector: a confirmed timer decrease proves the round is
        // live — no need to also wait for both bars to appear at ≥50%. Without
        // timer detector (legacy): require both bars to be seen healthy at least
        // once to filter out attract-demo / menu artifacts.
        const roundIsLive = this.timerDetector ? this.roundTimerWasRunning : this.roundSawHealthyBars;

        // ── Time-over detection ──────────────────────────────────────
        // Only armed once the timer was seen running (>0) this round —
        // otherwise the frozen "00" of the previous round's result screen
        // fabricates a phantom time-over.
        if (!p1Down && !p2Down && timerValue === 0 && this.roundTimerWasRunning && this.roundSawHealthyBars) {
          this.timeOverConfirmFrames++;
          if (this.timeOverConfirmFrames >= TIME_OVER_CONFIRM_REQUIRED) {
            // Require at least one lastRunning health capture: the timer must
            // have been seen > 0 while the round was armed for this to be a
            // real time-over. Without it, "timer=0" is just the inter-round
            // screen transition (bars refilled, timer frozen) — not a draw.
            if (this.lastRunningP1Health < 0 && this.lastRunningP2Health < 0) {
              this.timeOverConfirmFrames = 0;
              break;
            }
            // Guard: timer must have been seen ≥ 50 at some point this round.
            // If we joined mid-round (timer already near zero), we lack enough
            // data to call the winner — produces phantom draws.
            if (this.roundTimerMaxSeen < 50) {
              this.timeOverConfirmFrames = 0;
              break;
            }
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
          // Bar drained but the round was never proven live (timer frozen or
          // bars never seen healthy) — screen artifact, not a KO. Log sparsely.
          if (this.playingFrameCount % 20 === 0) {
            console.log(`[pixel-analyzer] 🛡️ KO signal ignored — round not live (timerRunning=${this.roundTimerWasRunning} sawHealthy=${this.roundSawHealthyBars}). P1=${p1Health}% P2=${p2Health}% timer=${timerValue}`);
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
              const koType = this.isPerfectKo(1) ? "perfect" : "normal";
              if (koType === "perfect") this.matchPerfectKos++;
              console.log(`[pixel-analyzer] 🎮 KO_CONFIRMED: P2 KO'd! P1 wins (${koType}). P1=${p1Health}% P2=${p2Health}% minP1=${this.roundP1MinHealth}% Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
              this.emit("roundResult", { loser: 2, winner: 1, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType } satisfies RoundResultEvent);
            } else if (p2WinsRound) {
              this.p1Losses++;
              this.roundNumber++;
              const koType = this.isPerfectKo(2) ? "perfect" : "normal";
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
              const koType = this.isPerfectKo(2) ? "perfect" : "normal";
              if (koType === "perfect") this.matchPerfectKos++;
              console.log(`[pixel-analyzer] 🎮 KO_CONFIRMED (retroactive, ${signal}): P1 KO'd! P2 wins (${koType}). Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
              this.emit("roundResult", { loser: 1, winner: 2, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType } satisfies RoundResultEvent);
            } else {
              this.p2Losses++;
              const koType = this.isPerfectKo(1) ? "perfect" : "normal";
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
          this.needsTimerCalibration = true; // recalibrate for next match
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
            this.roundP1MinFilled = 9999;
            this.roundP2MinFilled = 9999;
            // Fresh round: forget the previous round's frozen timer state and
            // require the timer to be seen running again before time-over re-arms.
            this.roundTimerWasRunning = false;
            this.roundSawHealthyBars = false;
            this.roundTimerLastValue = -1;
            this.roundTimerMaxSeen = 0;
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
  private measureFilledColumns(
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
        if (this.isHealthPixel(frame[idx]!, frame[idx + 1]!, frame[idx + 2]!)) {
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
    // Threshold = max(45% of peak, absolute floor at 16 rows).
    // The floor prevents the relative threshold from collapsing to
    // near-zero on menu screens (where a single bright pixel can
    // push maxScore just above the old 0.18 gate).
    const absFloor = 0.45; // require ≥45% of rows have health pixels (was 16/regionH — broke when regionH < 28)
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
  private getSmoothedHealth(history: number[]): number {
    if (history.length === 0) return 0;
    const sorted = [...history].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }
}
