/** WebSocket message types between browser and game server. */

export interface InitMessage {
  type: "init";
  sessionId: string;
  token: string;
  system: string;
  rom: string;
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

export type ClientMessage = InitMessage | InputMessage | PingMessage | ControlMessage;

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

export type ServerMessage = StatusMessage | ReadyMessage | ErrorMessage | PongMessage;

/** Binary frame header: 0x01 + width(u16) + height(u16) + frameId(u32) + flags(u8) + jpeg data */
export const FRAME_MAGIC = 0x01;

/** Binary audio header: 0x02 + frameId(u32) + opus data */
export const AUDIO_MAGIC = 0x02;

export interface FrameHeader {
  magic: number;    // 0x01
  width: number;    // uint16 LE
  height: number;   // uint16 LE
  frameId: number;  // uint32 LE
  flags: number;    // uint8
}
