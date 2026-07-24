/** WebSocket message types between browser and game server. */

export interface InitMessage {
  type: "init";
  sessionId: string;
  token: string;
  system: string;
  rom: string;
  /** "cpu" = play page (P1 vs CPU), "pvp" = duel (P1 vs P2). Defaults to "cpu". */
  mode?: "cpu" | "pvp";
  /** Plan A (optional): RTMP ingest URL with embedded stream key for a live broadcast. */
  rtmpUrl?: string;
}

export interface JoinMessage {
  type: "join";
  sessionId: string;
  token: string;
}

export interface InputMessage {
  type: "input";
  player: number;
  button: number;
  pressed: boolean;
}

export interface PingMessage {
  type: "ping";
  t: number;
}

export interface ControlMessage {
  type: "pause" | "resume" | "stop";
}

/** P1 requests a rematch — server relays to P2. */
export interface RematchRequestMessage {
  type: "rematch_request";
}

/**
 * A player accepts the rematch. Same-session rematch (the default now) carries
 * no payload — the server unlocks input and broadcasts "rematch_starting".
 * The legacy new-session fields are kept optional for backward compatibility.
 */
export interface RematchAcceptMessage {
  type: "rematch_accept";
  newSessionId?: string;
  newWsUrl?: string;
  newRoomCode?: string;
}

/** P2 declines the rematch. */
export interface RematchDeclineMessage {
  type: "rematch_decline";
}

/** A player wants to stop the duel and close the session. */
export interface StopDuelMessage {
  type: "stop_duel";
}

/** Auto-rematch for multi-match modes — skip the stats overlay and restart immediately. */
export interface AutoRematchMessage {
  type: "auto_rematch";
  /** The NEXT match number (1-based). */
  matchNumber: number;
  /** Total matches in the series (3 for XL, 5 for Fighter). */
  totalMatches: number;
}

export interface ClientReadyMessage {
  type: "client_ready";
}

export type ClientMessage =
  | InitMessage
  | JoinMessage
  | InputMessage
  | PingMessage
  | ControlMessage
  | RematchRequestMessage
  | RematchAcceptMessage
  | RematchDeclineMessage
  | StopDuelMessage
  | AutoRematchMessage
  | ClientReadyMessage;

export interface StatusMessage {
  type: "status";
  fps: number;
  frames: number;
}

export interface ReadyMessage {
  type: "ready";
  width: number;
  height: number;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export interface PongMessage {
  type: "pong";
  t: number;
}

export interface PlayerEventMessage {
  type: "player_joined" | "player_disconnected";
  player: number;
}

/** A round/character was KO'd — sent when a health bar drops to 0. */
export interface RoundResultMessage {
  type: "round_result";
  /** Player whose character was KO'd (the loser of this round). */
  loser: number;
  /** Player who scored the KO (the winner of this round). */
  winner: number;
  /** Total KOs scored against P1 so far. */
  p1Losses: number;
  /** Total KOs scored against P2 so far. */
  p2Losses: number;
  /** KO type — "perfect" if winner still has full health, otherwise "normal". */
  koType?: "normal" | "perfect" | "timeout" | "draw";
}

/** Waiting message sent to P2 when they join before P1. */
export interface WaitingMessage {
  type: "waiting";
  message: string;
}

/** Match is over — one player has accumulated enough losses. */
export interface MatchEndMessage {
  type: "match_end";
  winner: number;
  loser: number;
  /** Final score: { p1Losses, p2Losses }. */
  p1Losses: number;
  p2Losses: number;
  /** 1-based match number within the session. */
  matchNumber?: number;
  /** Total rounds played in this match. */
  totalRounds?: number;
  /** Number of perfect KOs in this match. */
  perfectKos?: number;
  /** Team rosters as character IDs (0x00-0x25), slot order. For end-match stats. */
  p1TeamIds?: number[];
  p2TeamIds?: number[];
  /** Character IDs in the order each player selected them. */
  p1SelectOrder?: number[];
  p2SelectOrder?: number[];
  /** Gauge mode per player. */
  p1Mode?: "ADVANCED" | "EXTRA";
  p2Mode?: "ADVANCED" | "EXTRA";
  /** Rounds won per character (charId → win count), for the end-match overlay tally. */
  p1CharWins?: Record<number, number>;
  p2CharWins?: Record<number, number>;
  /** SNES/cursor-tracked character names (when RAM-based detection is unavailable). */
  p1CharName?: string;
  p2CharName?: string;
  /** Pixel/portrait-detected character names (diagnostic ground truth). */
  p1PixelCharName?: string;
  p2PixelCharName?: string;
  /** Portrait detection confidence for each player's selected cell (0-1). */
  p1PixelConfidence?: number;
  p2PixelConfidence?: number;
}

/** Rematch requested by opponent — show accept/decline UI. */
export interface RematchRequestedMessage {
  type: "rematch_requested";
}

/** Rematch was accepted — new session info follows. */
export interface RematchAcceptedMessage {
  type: "rematch_accepted";
  newSessionId: string;
  newWsUrl: string;
  newRoomCode: string;
}

/** Rematch was declined — return to lobby. */
export interface RematchDeclinedMessage {
  type: "rematch_declined";
}

/**
 * Same-session rematch is starting: the server has unlocked input and the game
 * is back at character select. Both clients reset their end-match state and
 * resume in place (no reconnect, no new session).
 */
export interface RematchStartingMessage {
  type: "rematch_starting";
}

/** Session is closed — all players should return to lobby and reload. */
export interface SessionClosedMessage {
  type: "session_closed";
}

/** Session was cancelled — the dual-client ready guard timed out (one side didn't load in time). */
export interface SessionCancelledMessage {
  type: "session_cancelled";
  reason: string;
}

/** Auto-rematch is starting — skip the stats overlay and roll to the next match. */
export interface AutoRematchServerMessage {
  type: "auto_rematch";
  /** The NEXT match number (1-based). */
  matchNumber: number;
  /** Total matches in the series. */
  totalMatches: number;
}

/** Live in-match state pushed ~every 500ms so the browser HUD updates during a match. */
export interface MatchStateMessage {
  type: "match_state";
  /** Team rosters as character names (locked at char select). */
  p1Team: string[];
  p2Team: string[];
  /** Currently-fighting character IDs (0x00-0x25), -1 when unknown. */
  p1Active: number;
  p2Active: number;
  /** Gauge mode per player. */
  p1Mode: "ADVANCED" | "EXTRA";
  p2Mode: "ADVANCED" | "EXTRA";
  /** Health percentages (0-100). */
  p1Health: number;
  p2Health: number;
  /** Raw match flag at 0xA840: 0x40/0x48 = steady combat, 0x00 = char select. */
  matchFlag: number;
}

/** Duel pause: a player paused the game. Both clients show the countdown overlay. */
export interface PausedMessage {
  type: "paused";
  /** Which player initiated the pause (1 or 2). */
  player: 1 | 2;
  /** Initial countdown value in seconds (typically 30). */
  countdown: number;
}

/** Duel resume: the game is resuming after a pause. */
export interface ResumedMessage {
  type: "resumed";
  /** Who triggered the resume: 1 or 2 = player-initiated, 0 = auto (timeout). */
  initiator: 1 | 2 | 0;
}

/** Match has started (pixel analyzer entered PLAYING) — character names for verification. */
export interface MatchStartedMessage {
  type: "match_started";
  /** Cursor-tracked character name for P1 (SNES) or RAM-based name (KOF98). */
  p1CharName?: string;
  /** Cursor-tracked character name for P2 (SNES) or RAM-based name (KOF98). */
  p2CharName?: string;
  /** Portrait/pixel-detected character name for P1 (diagnostic ground truth). */
  p1PixelCharName?: string;
  /** Portrait/pixel-detected character name for P2 (diagnostic ground truth). */
  p2PixelCharName?: string;
  /** Initial health percentages at match start. */
  p1Health?: number;
  p2Health?: number;
  /** Calibrated full-bar widths at match start. */
  p1FullBarWidth?: number;
  p2FullBarWidth?: number;
}

/** Character select phase has started — show the character select UI overlay. */
export interface CharSelectStartMessage {
  type: "char_select_start";
  /** Timeout in ms before auto-locking current cursor position. */
  timeout: number;
}

/** A player has selected their character. */
export interface CharSelectedMessage {
  type: "char_selected";
  /** Which player selected (1 or 2). */
  player: number;
  /** Internal character ID (0x00-0x11 for SFA2). */
  charId: number;
  /** Display name (e.g. "Ryu"). */
  charName: string;
  /** Cursor row position. */
  row: number;
  /** Cursor column position. */
  col: number;
}

export type ServerMessage =
  | StatusMessage
  | ReadyMessage
  | ErrorMessage
  | PongMessage
  | PlayerEventMessage
  | RoundResultMessage
  | WaitingMessage
  | MatchEndMessage
  | RematchRequestedMessage
  | RematchAcceptedMessage
  | RematchDeclinedMessage
  | RematchStartingMessage
  | SessionClosedMessage
  | MatchStateMessage
  | MatchStartedMessage
  | AutoRematchServerMessage
  | PausedMessage
  | ResumedMessage
  | CharSelectStartMessage
  | CharSelectedMessage
  | SessionCancelledMessage;

/** Binary frame header: 0x01 + width(u16) + height(u16) + frameId(u32) + nalLength(u32) + H.264 NAL data */
export const FRAME_MAGIC = 0x01;

/** Binary audio header: 0x02 + opusLength(u32) + Opus data */
export const AUDIO_MAGIC = 0x02;

/** Binary codec config: 0x03 + payloadLength(u16) + videoDescLength(u16) + videoDesc(JSON) + audioDesc(JSON) */
export const CODEC_CONFIG_MAGIC = 0x03;

export interface FrameHeader {
  magic: number;    // 0x01
  width: number;    // uint16 LE
  height: number;   // uint16 LE
  frameId: number;  // uint32 LE
  nalLength: number; // uint32 LE — H.264 NAL unit length
}
