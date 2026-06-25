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

export type ClientMessage = InitMessage | JoinMessage | InputMessage | PingMessage | ControlMessage;

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

export type ServerMessage = StatusMessage | ReadyMessage | ErrorMessage | PongMessage | PlayerEventMessage;

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
