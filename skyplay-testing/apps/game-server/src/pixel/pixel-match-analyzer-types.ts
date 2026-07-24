// ── State machine phases ────────────────────────────────────────────

/** Pixel-based health detection state machine.
 *
 *  Text-primary architecture (2026-07-24): text overlays (KO, PERFECT, TIME OVER,
 *  DRAW GAME) are the PRIMARY round-end trigger. Health bars provide only the
 *  winner/loser verdict via simple filled-column comparison. Fallback paths
 *  (bars-vanished, timer==0) are safety nets when the text detector misses.
 *
 *  Every transition requires multi-frame evidence — no single-frame false positives. */
export enum GamePhase {
  WARMUP    = "WARMUP",     // collecting calibration frames, no KO detection
  PLAYING   = "PLAYING",    // active round — text-primary round-end detection
  NEW_ROUND = "NEW_ROUND",  // health bars back, transitioning to next round
  MATCH_END = "MATCH_END",  // match is over
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

// ── Text-primary architecture (2026-07-24) ─────────────────────────
// Text overlays (KO, TIME OVER, PERFECT, DRAW GAME) are the PRIMARY
// round-end trigger. Health bars provide the winner/loser verdict via
// simple filled-column comparison — no calibration needed for the KO
// decision. This eliminates the P1/P2 inversion bug, calibration drift,
// and the entire KO_PENDING/KO_CONFIRMED state apparatus.
//
// Fallback paths (timer==0, bars-vanished) are kept as safety nets in
// case the text detector misses an event.

export const NEW_ROUND_HEALTH = 80;    // both bars ≥ this = new round
export const WARMUP_HEALTHY = 65;      // health ≥ this = "healthy" for warmup counting
export const WARMUP_MIN_RATIO = 0.65;
export const WARMUP_TIMEOUT_FRAMES = 60; // ~15s at 4fps — force-exit if warmup never ends
export const PERFECT_RATIO = 0.95; // minFilled / maxFilled must be ≥ this for perfect KO verdict
export const HEALTH_HISTORY_SIZE = 3; // median-of-3 — minimal lag while filtering single-frame noise
export const PLAYING_GRACE_FRAMES = 16;      // ~4s at 4 reads/sec — skips FIGHT! overlay at round start
export const DESPERATION_ARM_FRAMES = 180;    // ~3s at 60fps — force-arm if round still not live
export const MIN_WARMUP_BAR_COLS = 30;       // bar width below this = not visible yet (intro animation)
export const HEALTH_DIFF_THRESHOLD = 10;     // health % difference below which it's a DRAW
export const ROUND_END_COOLDOWN = 60;        // ~15s at 4fps — ignore text events after round end
export const TIME_OVER_CONFIRM_FRAMES = 3;   // consecutive timer==0 frames for time-over fallback
export const BARS_VANISHED_CONFIRM_FRAMES = 3; // consecutive (p1Down && p2Down) frames for bars-vanished fallback
export const TEXT_CONFIRM_FRAMES = 30; // frames to wait for bar/timer confirmation after text overlay detected (~7.5s @4fps)
