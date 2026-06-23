// ─── Emulator Status ───────────────────────────────────────────────
export type EmulatorStatus =
  | "idle"      // No ROM loaded, emulator waiting
  | "loading"   // ROM is being fetched and loaded
  | "running"   // Game is actively running
  | "paused"    // Game is paused
  | "error";    // ROM load or emulation error

// ─── ROM Entry ─────────────────────────────────────────────────────
export interface RomEntry {
  name: string;   // Display name (filename without extension)
  path: string;   // URL path relative to /roms/
  size: number;   // File size in bytes
}

// ─── Input Frame (per-frame input record for rollback) ─────────────
export interface InputFrame {
  frame: number;  // Absolute frame number
  p1: number;     // Player 1 button bitmask
  p2: number;     // Player 2 button bitmask
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

// ─── Emulator State (exposed by useEmulator hook) ──────────────────
export interface EmulatorState {
  status: EmulatorStatus;
  fps: number;
  currentRom: string | null;
  romList: RomEntry[];
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  // Actions
  loadRom: (rom: RomEntry) => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;
  setVolume: (v: number) => void;
  volume: number;
  isMuted: boolean;
  // Input (called by keyboard/gamepad hooks)
  buttonDown: (player: 1 | 2, button: number) => void;
  buttonUp: (player: 1 | 2, button: number) => void;
  // Rollback-ready buffers (exposed for P2P integration)
  stateBuffer: StateBufferInterface;
  inputBuffer: InputBufferInterface;
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
