/** WebSocket message types between browser and game server. */

export interface InitMessage {
  type: "init";
  sessionId: string;
  token: string;
  system: string;
  rom: string;
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

/** P2 accepts the rematch and provides new session info. */
export interface RematchAcceptMessage {
  type: "rematch_accept";
  newSessionId: string;
  newWsUrl: string;
  newRoomCode: string;
}

/** P2 declines the rematch. */
export interface RematchDeclineMessage {
  type: "rematch_decline";
}

export type ClientMessage =
  | InitMessage
  | JoinMessage
  | InputMessage
  | PingMessage
  | ControlMessage
  | RematchRequestMessage
  | RematchAcceptMessage
  | RematchDeclineMessage;

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

/** Session is closed — all players should return to lobby and reload. */
export interface SessionClosedMessage {
  type: "session_closed";
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
  | SessionClosedMessage;

/** Binary frame header: 0x01 + width(u16) + height(u16) + frameId(u32) + nalLength(u16) + H.264 NAL data */
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
  nalLength: number; // uint16 LE — H.264 NAL unit length
}
