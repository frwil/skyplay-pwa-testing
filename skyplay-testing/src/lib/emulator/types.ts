// ─── System Type ───────────────────────────────────────────────────
export type SystemType = "nes" | "snes" | "gb" | "gbc" | "gba" | "neogeo" | "ps1";

// ─── Emulator Status ───────────────────────────────────────────────
export type EmulatorStatus =
  | "idle"      // No ROM loaded, emulator waiting
  | "loading"   // ROM is being fetched and loaded
  | "running"   // Game is actively running
  | "paused"    // Game is paused
  | "error";    // ROM load or emulation error

// ─── ROM Entry ─────────────────────────────────────────────────────
export interface RomEntry {
  name: string;       // Display name (filename without extension)
  path: string;       // URL path relative to /roms/
  size: number;       // File size in bytes
  system: SystemType; // Detected system from file extension
}

// ─── Input Frame (per-frame input record for rollback) ─────────────
export interface InputFrame {
  frame: number;  // Absolute frame number
  p1: number;     // Player 1 button bitmask
  p2: number;     // Player 2 button bitmask
}

// ─── System Button Definition ──────────────────────────────────────
export interface SystemButton {
  id: string;        // e.g. "A", "B", "X", "Y", "L", "R", "START"
  index: number;     // Button index for the emulator core
  bit: number;       // Bitmask position (0x01, 0x02, ...)
}

// ─── System Configuration ──────────────────────────────────────────
export interface SystemConfig {
  type: SystemType;
  labelKey: string;          // i18n key for system name
  width: number;
  height: number;
  buttonCount: number;
  buttons: SystemButton[];
  coreName: string;           // Nostalgist core name (or "jsnes" for NES)
  romExtensions: string[];    // e.g. [".nes"] or [".sfc", ".smc"]
  touchLayout: "nes" | "snes" | "gb";  // which touch control layout
  desktopOnly?: boolean;      // true for systems only available on desktop app
  cloud?: boolean;            // true for systems streamed via Docker cloud gaming
}

// ─── NES Button Constants (bit positions) ──────────────────────────
// Maps to jsnes.Controller.BUTTON_* values
export const enum NesButton {
  A      = 0x01,
  B      = 0x02,
  SELECT = 0x04,
  START  = 0x08,
  UP     = 0x10,
  DOWN   = 0x20,
  LEFT   = 0x40,
  RIGHT  = 0x80,
}

// ─── Gift Notification Data ─────────────────────────────────────────
/** Gift notification received from game-server (real-time overlay). */
export interface GiftNotifyData {
  gift: {
    id: string;
    name: string;
    iconUrl: string;
    animationUrl?: string;
    category: string;
  };
  from: {
    username: string;
    avatar?: string;
  };
  quantity: number;
  diamondAmount: number;
  message?: string;
}

// ─── Emulator State (exposed by useEmulator hook) ──────────────────
export interface EmulatorState {
  status: EmulatorStatus;
  fps: number;
  currentRom: string | null;
  romList: RomEntry[];
  system: SystemType;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  // Actions
  loadRom: (rom: RomEntry) => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;
  exit: () => void;
  setVolume: (v: number) => void;
  volume: number;
  isMuted: boolean;
  // Input (called by keyboard/gamepad hooks)
  buttonDown: (player: 1 | 2, button: number) => void;
  buttonUp: (player: 1 | 2, button: number) => void;
  /** Read emulated system RAM for auto-detection. Returns null if not available. */
  readRam: () => Uint8Array | null;
  // Rollback-ready buffers (NES only — null for other systems)
  stateBuffer: StateBufferInterface | null;
  inputBuffer: InputBufferInterface | null;
  // Netplay hooks
  /** Inject a NetplayManager into the emulator game loop. */
  setNetplayManager?: (manager: unknown) => void;
  /** Whether netplay is currently active. */
  isNetplay?: boolean;
  // Netplay dependencies (exposed for NetplayManager wiring)
  /** Get the raw jsnes instance for state save/restore during rollback. */
  getNes: () => { fromJSON(state: object): void; frame(): void } | null;
  /** Mute audio during rollback fast-forward. */
  muteAudio: () => void;
  /** Unmute audio after rollback fast-forward. */
  unmuteAudio: () => void;
  /** Apply bulk button transitions for input correction during rollback. */
  applyInputs: (player: 1 | 2, bitmask: number, prevBitmask: number) => void;
  /** Apply a single button press/release (bypasses netplay routing). Used by InputDelayManager. */
  applyButton: (player: 1 | 2, button: number, pressed: boolean) => void;
  /**
   * Inject a key event directly on the canvas as a real KeyboardEvent.
   * Bypasses Nostalgist's broken pressDown() (which relies on RetroArch
   * config key mappings that don't exist by default).
   *
   * Used by netplay managers for:
   *  - Start button simulation after countdown
   *  - Applying delayed remote inputs on the local emulator
   */
  injectKeyEvent: (player: 1 | 2, button: number, pressed: boolean) => void;
  /** Cloud gaming session ID (for stats lookup). null if not in cloud mode. */
  sessionId: string | null;
  /** Cloud gaming room code (P1 creates, P2 joins). null if not in cloud mode. */
  roomCode: string | null;
  /** Join an existing cloud session as Player 2 via room code. */
  joinSession: (roomCode: string) => Promise<void>;
  /** Connect as host (P1) to a pre-created cloud session (for duel matchmaking). */
  connectDuelHost?: (wsUrl: string, sessionId: string, rom: string, roomCode: string) => Promise<void>;
  /** Whether this emulator is running in cloud streaming mode. */
  isCloud: boolean;
  /** Latest duel round result (null until first KO detected). */
  duelRoundResult: DuelRoundResult | null;
  /** Latest duel match result (updated on every match end — continuous play). */
  duelMatchResult: DuelMatchResult | null;
  /** Cumulative match history for the current session (scoreboard). */
  duelMatchHistory: DuelMatchResult[];
  /** Stop the duel and close the session. */
  stopDuel: () => void;
  /** Request a rematch from the opponent. */
  requestRematch: () => void;
  /** Accept a rematch (P2 side). Same-session — the server unlocks input. */
  acceptRematch: () => void;
  /** Decline a rematch request (P2 side). */
  declineRematch: () => void;
  /** True when opponent requested a rematch — show accept/decline UI. */
  rematchRequested: boolean;
  /** True when opponent declined the rematch — show message, return to lobby. */
  rematchDeclined: boolean;
  /** True when the server closed the session — client should return to lobby and reload. */
  duelSessionClosed: boolean;
  /** Live in-match state (teams, active char, gauge mode) pushed from the cloud server. null until first update. */
  matchState: MatchStateData | null;
  /** New session id emitted when a rematch is accepted (WS path). Used to charge the rematch stake. */
  duelRematchSessionId: string | null;
  /** Side (1|2) of the opponent who disconnected mid-match (forfeit), else null. */
  opponentAbandoned: number | null;
  /** Clear the abandon flag (e.g. after handling the forfeit or on reconnect). */
  clearOpponentAbandoned: () => void;
  /** Auto-rematch info for multi-match modes (XL/Fighter). null when not in auto-rematch. */
  autoRematch: { matchNumber: number; totalMatches: number } | null;
  /** Send an auto-rematch request to the server (skips stats overlay, rolls to next match). */
  requestAutoRematch: (matchNumber: number, totalMatches: number) => void;
  /** Duel pause state: who paused + remaining countdown. null when game is running. */
  pauseState: { pausedBy: 1 | 2; countdown: number } | null;
  /** Character names selected by each player (from char_selected / match_end messages). */
  p1CharName: string | null;
  p2CharName: string | null;
  /** Active gift notifications for the GiftOverlay (auto-removed after 5s). */
  giftNotifications: GiftNotifyData[];
}

/** Live in-match state for the on-canvas HUD (cloud/neogeo/snes only). */
export interface MatchStateData {
  /** Team rosters as character names, in-game roster order. */
  p1Team: string[];
  p2Team: string[];
  /** Currently-fighting character IDs (0x00-0x25 KOF, 0x00-0x11 SFA2); -1 when unknown. */
  p1Active: number;
  p2Active: number;
  /** Currently-fighting character display name (resolved server-side, game-aware). */
  p1ActiveName?: string;
  p2ActiveName?: string;
  /** Gauge mode per player (KOF98/2002). */
  p1Mode: "ADVANCED" | "EXTRA";
  p2Mode: "ADVANCED" | "EXTRA";
  /** Play mode per player (SFA2: "Auto" or "Manual"). */
  p1PlayMode?: "Auto" | "Manual";
  p2PlayMode?: "Auto" | "Manual";
  /** Health percentages (0-100). */
  p1Health: number;
  p2Health: number;
  /** Raw match flag: 0x40/0x48 = steady combat, 0x00 = char select. */
  matchFlag: number;
  /** True after the server has injected coins+START — gates charge/debit to prevent
   *  debiting players during demo/attract mode (CPU-vs-CPU). */
  gameStarted?: boolean;
}

/** Result of a single round in a duel. */
export interface DuelRoundResult {
  loser: number;
  winner: number;
  p1Losses: number;
  p2Losses: number;
  koType?: "normal" | "perfect";
}

/** Result of a full duel match (best-of-3, first to 2 losses). */
export interface DuelMatchResult {
  winner: number;
  loser: number;
  p1Losses: number;
  p2Losses: number;
  matchNumber?: number;
  totalRounds?: number;
  perfectKos?: number;
  /** Per-round perfect KO detail: which player scored a perfect in which round. */
  perfectKoDetails?: { round: number; player: number }[];
  /** Team rosters as character IDs (0x00-0x25), slot order — for end-match stats. */
  p1TeamIds?: number[];
  p2TeamIds?: number[];
  /** Character IDs in the order each player selected them. */
  p1SelectOrder?: number[];
  p2SelectOrder?: number[];
  /** Gauge mode per player (KOF98/2002 only; undefined for SFA2). */
  p1Mode?: "ADVANCED" | "EXTRA";
  p2Mode?: "ADVANCED" | "EXTRA";
  /** Play mode per player (SFA2 only: "Auto" or "Manual"; undefined for KOF98). */
  p1PlayMode?: "Auto" | "Manual";
  p2PlayMode?: "Auto" | "Manual";
  /** Rounds won per character (charId → win count) for the end-match overlay tally. */
  p1CharWins?: Record<number, number>;
  p2CharWins?: Record<number, number>;
}

// ─── Buffer Interfaces ─────────────────────────────────────────────
export interface StateBufferInterface {
  push(state: object): void;
  get(framesAgo: number): object | null;
  readonly current: object | null;
  readonly length: number;
  clear(): void;
}

export interface InputBufferInterface {
  push(frame: number, p1: number, p2: number): void;
  get(framesAgo: number): InputFrame | null;
  update(framesAgo: number, p1?: number, p2?: number): void;
  readonly length: number;
  clear(): void;
}
