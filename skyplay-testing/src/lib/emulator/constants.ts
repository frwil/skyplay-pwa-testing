// ─── Buffer Sizes ──────────────────────────────────────────────────
/** Number of savestates to keep in the circular buffer (~500ms at 60fps) */
export const STATE_BUFFER_SIZE = 30;

/** Number of input frames to keep in the circular buffer */
export const INPUT_BUFFER_SIZE = 30;

// ─── NES Display ───────────────────────────────────────────────────
export const NES_WIDTH = 256;
export const NES_HEIGHT = 240;

// ─── Framerate ─────────────────────────────────────────────────────
export const TARGET_FPS = 60;
export const FRAME_TIME_MS = 1000 / TARGET_FPS; // ~16.67ms

// ─── Audio ─────────────────────────────────────────────────────────
export const SAMPLE_RATE = 48000;
export const AUDIO_BUFFER_SIZE = 4096; // ScriptProcessor buffer
export const RING_BUFFER_SIZE = 16384; // Float32 ring buffer (power of 2)

// ─── jsnes Button Indices ──────────────────────────────────────────
// These match jsnes.Controller.BUTTON_* constants:
//   BUTTON_A=0, BUTTON_B=1, BUTTON_SELECT=2, BUTTON_START=3,
//   BUTTON_UP=4, BUTTON_DOWN=5, BUTTON_LEFT=6, BUTTON_RIGHT=7
export const enum NesButtonIndex {
  A      = 0,
  B      = 1,
  SELECT = 2,
  START  = 3,
  UP     = 4,
  DOWN   = 5,
  LEFT   = 6,
  RIGHT  = 7,
}

// ─── Keyboard Mapping ──────────────────────────────────────────────
// Physical key code → { player, button: jsnes button index }
export const KEY_MAP: Record<string, { player: 1 | 2; button: number }> = {
  // Player 1 (Arrows + Z/X)
  ArrowUp:    { player: 1, button: NesButtonIndex.UP },
  ArrowDown:  { player: 1, button: NesButtonIndex.DOWN },
  ArrowLeft:  { player: 1, button: NesButtonIndex.LEFT },
  ArrowRight: { player: 1, button: NesButtonIndex.RIGHT },
  KeyX:       { player: 1, button: NesButtonIndex.A },
  KeyZ:       { player: 1, button: NesButtonIndex.B },
  Enter:      { player: 1, button: NesButtonIndex.START },
  ShiftRight: { player: 1, button: NesButtonIndex.SELECT },

  // Player 1 alternate (WASD + Q/E)
  KeyW:       { player: 1, button: NesButtonIndex.UP },
  KeyS:       { player: 1, button: NesButtonIndex.DOWN },
  KeyA:       { player: 1, button: NesButtonIndex.LEFT },
  KeyD:       { player: 1, button: NesButtonIndex.RIGHT },
  KeyQ:       { player: 1, button: NesButtonIndex.A },
  KeyE:       { player: 1, button: NesButtonIndex.B },
  Space:      { player: 1, button: NesButtonIndex.START },
  Tab:        { player: 1, button: NesButtonIndex.SELECT },
};

// ─── NES Button Bitmask ────────────────────────────────────────────
// For InputBuffer storage (bit position per button)
export const NES_BUTTON_BITS: Record<string, number> = {
  A:      0x01,
  B:      0x02,
  SELECT: 0x04,
  START:  0x08,
  UP:     0x10,
  DOWN:   0x20,
  LEFT:   0x40,
  RIGHT:  0x80,
};

// Map jsnes button index (0-7) → bitmask for InputBuffer
// Index: A=0, B=1, SELECT=2, START=3, UP=4, DOWN=5, LEFT=6, RIGHT=7
export const BUTTON_INDEX_TO_BIT: Record<number, number> = {
  [NesButtonIndex.A]:      0x01,
  [NesButtonIndex.B]:      0x02,
  [NesButtonIndex.SELECT]: 0x04,
  [NesButtonIndex.START]:  0x08,
  [NesButtonIndex.UP]:     0x10,
  [NesButtonIndex.DOWN]:   0x20,
  [NesButtonIndex.LEFT]:   0x40,
  [NesButtonIndex.RIGHT]:  0x80,
};
