// ─── DataChannel Message Types ──────────────────────────────────────

/** Every message sent over the WebRTC DataChannel is one of these. */
export interface NetplayInputMessage {
  type: "input";
  frame: number;
  /** Player 1 button bitmask (sent by P1, received by P2) */
  p1?: number;
  /** Player 2 button bitmask (sent by P2, received by P1) */
  p2?: number;
}

export interface NetplayPingMessage {
  type: "ping";
  timestamp: number;
}

export interface NetplayPongMessage {
  type: "pong";
  timestamp: number;
  originalTimestamp: number;
}

export interface NetplayReadyMessage {
  type: "ready";
}

export interface NetplayStartMessage {
  type: "start";
  startFrame: number;
}

export type NetplayDataMessage =
  | NetplayInputMessage
  | NetplayPingMessage
  | NetplayPongMessage
  | NetplayReadyMessage
  | NetplayStartMessage;

// ─── Session Configuration ──────────────────────────────────────────

export interface SessionConfig {
  sessionId: number;
  challengeId: number;
  /** Which player am I? (1 or 2) */
  playerNumber: 1 | 2;
  opponentId: number;
  opponentName: string;
}

// ─── Status ─────────────────────────────────────────────────────────

export type NetplayStatus =
  | "idle"
  | "connecting"   // WebRTC handshake in progress
  | "connected"    // DataChannel open, waiting for countdown
  | "countdown"    // 3-2-1 before game start
  | "playing"      // Game in progress
  | "finished"
  | "error";

export interface NetplayState {
  status: NetplayStatus;
  latency: number;    // ms, round-trip
  rollbacks: number;  // Total rollbacks performed
  session: SessionConfig | null;
  error: string | null;
}

// ─── WebRTC Configuration ───────────────────────────────────────────

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export const DATA_CHANNEL_LABEL = "skyplay-netplay";
export const SIGNALING_POLL_MS = 200;
export const PING_INTERVAL_MS = 1000;
export const COUNTDOWN_SECONDS = 3;
