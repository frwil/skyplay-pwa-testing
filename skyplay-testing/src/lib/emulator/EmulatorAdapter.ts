import type { EmulatorStatus, RomEntry, SystemType, SystemConfig } from "./types";

/**
 * Common interface that all emulator adapters must implement.
 *
 * NES uses a custom jsnes-based adapter with frame-by-frame control
 * and circular buffers. SNES/GB/GBC/GBA use Nostalgist.js (RetroArch
 * WASM) adapters that manage their own render loop.
 */
export interface EmulatorAdapter {
  readonly systemType: SystemType;

  // ── Lifecycle ─────────────────────────────────────────────────
  loadRom(rom: RomEntry): Promise<void>;
  exit(): void;
  setCanvas?(canvas: HTMLCanvasElement): void;

  // ── Playback ──────────────────────────────────────────────────
  pause(): void;
  resume(): void;
  reset(): void;

  // ── Input ─────────────────────────────────────────────────────
  /** Called by keyboard/gamepad hooks — button index is emulator-specific */
  buttonDown(player: 1 | 2, button: number): void;
  buttonUp(player: 1 | 2, button: number): void;

  // ── Volume ────────────────────────────────────────────────────
  setVolume(v: number): void;
  readonly volume: number;
  readonly isMuted: boolean;

  // ── State ─────────────────────────────────────────────────────
  readonly status: EmulatorStatus;
  readonly fps: number;
  readonly currentRom: string | null;
}

// ─── System Configurations ─────────────────────────────────────────

/**
 * Per-system metadata registry.
 *
 * Button indices match what each emulator core expects:
 * - NES (jsnes): A=0, B=1, SELECT=2, START=3, UP=4, DOWN=5, LEFT=6, RIGHT=7
 * - SNES (RetroArch): B=0, Y=1, SELECT=2, START=3, UP=4, DOWN=5, LEFT=6, RIGHT=7, A=8, X=9, L=10, R=11
 * - GB/GBC (RetroArch gambatte): A=0, B=1, SELECT=2, START=3, UP=4, DOWN=5, LEFT=6, RIGHT=7
 * - GBA (RetroArch mgba): B=0, A=1, SELECT=2, START=3, UP=4, DOWN=5, LEFT=6, RIGHT=7, L=8, R=9
 */
export const SYSTEM_CONFIGS: Record<SystemType, SystemConfig> = {
  nes: {
    type: "nes",
    labelKey: "play.systems.nes",
    width: 256,
    height: 240,
    buttonCount: 8,
    buttons: [
      { id: "A", index: 0, bit: 0x01 },
      { id: "B", index: 1, bit: 0x02 },
      { id: "SELECT", index: 2, bit: 0x04 },
      { id: "START", index: 3, bit: 0x08 },
      { id: "UP", index: 4, bit: 0x10 },
      { id: "DOWN", index: 5, bit: 0x20 },
      { id: "LEFT", index: 6, bit: 0x40 },
      { id: "RIGHT", index: 7, bit: 0x80 },
    ],
    coreName: "jsnes",
    romExtensions: [".nes"],
    touchLayout: "nes",
  },
  snes: {
    type: "snes",
    labelKey: "play.systems.snes",
    width: 256,
    height: 224,
    buttonCount: 12,
    buttons: [
      { id: "B", index: 0, bit: 0x001 },
      { id: "Y", index: 1, bit: 0x002 },
      { id: "SELECT", index: 2, bit: 0x004 },
      { id: "START", index: 3, bit: 0x008 },
      { id: "UP", index: 4, bit: 0x010 },
      { id: "DOWN", index: 5, bit: 0x020 },
      { id: "LEFT", index: 6, bit: 0x040 },
      { id: "RIGHT", index: 7, bit: 0x080 },
      { id: "A", index: 8, bit: 0x100 },
      { id: "X", index: 9, bit: 0x200 },
      { id: "L", index: 10, bit: 0x400 },
      { id: "R", index: 11, bit: 0x800 },
    ],
    coreName: "snes9x",
    romExtensions: [".sfc", ".smc", ".swc", ".fig"],
    touchLayout: "snes",
  },
  gb: {
    type: "gb",
    labelKey: "play.systems.gb",
    width: 160,
    height: 144,
    buttonCount: 8,
    buttons: [
      { id: "A", index: 0, bit: 0x01 },
      { id: "B", index: 1, bit: 0x02 },
      { id: "SELECT", index: 2, bit: 0x04 },
      { id: "START", index: 3, bit: 0x08 },
      { id: "UP", index: 4, bit: 0x10 },
      { id: "DOWN", index: 5, bit: 0x20 },
      { id: "LEFT", index: 6, bit: 0x40 },
      { id: "RIGHT", index: 7, bit: 0x80 },
    ],
    coreName: "gambatte",
    romExtensions: [".gb", ".gbc"],
    touchLayout: "gb",
  },
  gbc: {
    type: "gbc",
    labelKey: "play.systems.gbc",
    width: 160,
    height: 144,
    buttonCount: 8,
    buttons: [
      { id: "A", index: 0, bit: 0x01 },
      { id: "B", index: 1, bit: 0x02 },
      { id: "SELECT", index: 2, bit: 0x04 },
      { id: "START", index: 3, bit: 0x08 },
      { id: "UP", index: 4, bit: 0x10 },
      { id: "DOWN", index: 5, bit: 0x20 },
      { id: "LEFT", index: 6, bit: 0x40 },
      { id: "RIGHT", index: 7, bit: 0x80 },
    ],
    coreName: "gambatte",
    romExtensions: [".gbc", ".gb"],
    touchLayout: "gb",
  },
  gba: {
    type: "gba",
    labelKey: "play.systems.gba",
    width: 240,
    height: 160,
    buttonCount: 10,
    buttons: [
      { id: "B", index: 0, bit: 0x001 },
      { id: "A", index: 1, bit: 0x002 },
      { id: "SELECT", index: 2, bit: 0x004 },
      { id: "START", index: 3, bit: 0x008 },
      { id: "UP", index: 4, bit: 0x010 },
      { id: "DOWN", index: 5, bit: 0x020 },
      { id: "LEFT", index: 6, bit: 0x040 },
      { id: "RIGHT", index: 7, bit: 0x080 },
      { id: "L", index: 8, bit: 0x100 },
      { id: "R", index: 9, bit: 0x200 },
    ],
    coreName: "mgba",
    romExtensions: [".gba"],
    touchLayout: "snes",
  },
};

/** Look up a button definition by system and button ID. */
export function getButton(system: SystemType, id: string) {
  return SYSTEM_CONFIGS[system]?.buttons.find((b) => b.id === id);
}

/** Build a BUTTON_INDEX_TO_BIT mapping for a given system. */
export function getButtonIndexToBit(system: SystemType): Record<number, number> {
  const cfg = SYSTEM_CONFIGS[system];
  const map: Record<number, number> = {};
  for (const btn of cfg.buttons) {
    map[btn.index] = btn.bit;
  }
  return map;
}

/** Detect system type from a file extension (lowercase, with dot). */
export function detectSystem(ext: string): SystemType | null {
  const lower = ext.toLowerCase();
  for (const [type, cfg] of Object.entries(SYSTEM_CONFIGS)) {
    if (cfg.romExtensions.includes(lower)) return type as SystemType;
  }
  return null;
}

// ─── Per-system Keyboard Mappings ─────────────────────────────────────
// These map physical KeyboardEvent.code values to
// { player, button: <emulator-specific index> }.

export type KeyMapping = Record<string, { player: 1 | 2; button: number }>;

const BASE_D_PAD: KeyMapping = {
  ArrowUp:    { player: 1, button: 4 },
  ArrowDown:  { player: 1, button: 5 },
  ArrowLeft:  { player: 1, button: 6 },
  ArrowRight: { player: 1, button: 7 },
  KeyW:       { player: 1, button: 4 },
  KeyS:       { player: 1, button: 5 },
  KeyA:       { player: 1, button: 6 },
  KeyD:       { player: 1, button: 7 },
};

const BASE_FACE_BUTTONS_NES_LIKE: KeyMapping = {
  KeyX:  { player: 1, button: 0 }, // A
  KeyZ:  { player: 1, button: 1 }, // B
  KeyQ:  { player: 1, button: 0 }, // A (alternate)
  KeyE:  { player: 1, button: 1 }, // B (alternate)
};

const BASE_MENU_BUTTONS: KeyMapping = {
  Enter:      { player: 1, button: 3 }, // START
  ShiftRight: { player: 1, button: 2 }, // SELECT
  Space:      { player: 1, button: 3 }, // START (alternate)
  Tab:        { player: 1, button: 2 }, // SELECT (alternate)
};

/**
 * Per-system keyboard mappings.
 *
 * Button indices are emulator-specific and MUST match
 * what each core expects (see SYSTEM_CONFIGS for reference).
 *
 * NES (jsnes):       A=0, B=1, SELECT=2, START=3, +DPAD
 * SNES (snes9x):     B=0, Y=1, SELECT=2, START=3, +DPAD, A=8, X=9, L=10, R=11
 * GB/GBC (gambatte): A=0, B=1, SELECT=2, START=3, +DPAD
 * GBA (mgba):        B=0, A=1, SELECT=2, START=3, +DPAD, L=8, R=9
 */
export const SYSTEM_KEY_MAPS: Record<SystemType, KeyMapping> = {
  nes: {
    ...BASE_D_PAD,
    ...BASE_FACE_BUTTONS_NES_LIKE,
    ...BASE_MENU_BUTTONS,
  },
  snes: {
    ...BASE_D_PAD,
    // SNES: A=8, B=0, X=9, Y=1, L=10, R=11
    KeyX:  { player: 1, button: 8 },  // X key → A
    KeyZ:  { player: 1, button: 0 },  // Z key → B
    KeyC:  { player: 1, button: 9 },  // C key → X
    KeyV:  { player: 1, button: 1 },  // V key → Y
    KeyA:  { player: 1, button: 10 }, // A key → L
    KeyS:  { player: 1, button: 11 }, // S key → R
    KeyQ:  { player: 1, button: 8 },  // Q key → A (alternate)
    KeyE:  { player: 1, button: 1 },  // E key → Y (alternate)
    ...BASE_MENU_BUTTONS,
  },
  gb: {
    ...BASE_D_PAD,
    ...BASE_FACE_BUTTONS_NES_LIKE,
    ...BASE_MENU_BUTTONS,
  },
  gbc: {
    ...BASE_D_PAD,
    ...BASE_FACE_BUTTONS_NES_LIKE,
    ...BASE_MENU_BUTTONS,
  },
  gba: {
    ...BASE_D_PAD,
    // GBA: B=0, A=1, L=8, R=9
    KeyX:  { player: 1, button: 1 },  // X key → A
    KeyZ:  { player: 1, button: 0 },  // Z key → B
    KeyA:  { player: 1, button: 8 },  // A key → L
    KeyS:  { player: 1, button: 9 },  // S key → R
    KeyQ:  { player: 1, button: 1 },  // Q key → A (alternate)
    KeyE:  { player: 1, button: 0 },  // E key → B (alternate)
    ...BASE_MENU_BUTTONS,
  },
};

// ─── Per-system Gamepad Mappings ───────────────────────────────────────
// Maps standard gamepad button/axis indices to emulator-specific button
// indices. Assumes standard gamepad layout:
//   gp.buttons[0]  = A/Cross (bottom face)
//   gp.buttons[1]  = B/Circle (right face)
//   gp.buttons[2]  = X/Square (left face)
//   gp.buttons[3]  = Y/Triangle (top face)
//   gp.buttons[4]  = L1 (left bumper)
//   gp.buttons[5]  = R1 (right bumper)
//   gp.buttons[8]  = Select/Share/Back
//   gp.buttons[9]  = Start/Options
//   gp.buttons[12] = D-pad Up
//   gp.buttons[13] = D-pad Down
//   gp.buttons[14] = D-pad Left
//   gp.buttons[15] = D-pad Right

export interface GamepadMapping {
  /** Map standard gamepad button index → emulator button index, or null if unused */
  faceButtons: Record<number, number>;
  /** D-pad emulator indices: [UP, DOWN, LEFT, RIGHT] */
  dPadIndices: [number, number, number, number];
}

export const SYSTEM_GAMEPAD_MAPS: Record<SystemType, GamepadMapping> = {
  nes: {
    faceButtons: {
      0: 0, // A
      1: 1, // B
      8: 2, // SELECT
      9: 3, // START
    },
    dPadIndices: [4, 5, 6, 7], // UP, DOWN, LEFT, RIGHT
  },
  snes: {
    faceButtons: {
      0: 8,  // Cross → A
      1: 0,  // Circle → B
      2: 9,  // Square → X
      3: 1,  // Triangle → Y
      4: 10, // L1 → L
      5: 11, // R1 → R
      8: 2,  // Share → SELECT
      9: 3,  // Options → START
    },
    dPadIndices: [4, 5, 6, 7],
  },
  gb: {
    faceButtons: {
      0: 0, // A
      1: 1, // B
      8: 2, // SELECT
      9: 3, // START
    },
    dPadIndices: [4, 5, 6, 7],
  },
  gbc: {
    faceButtons: {
      0: 0, // A
      1: 1, // B
      8: 2, // SELECT
      9: 3, // START
    },
    dPadIndices: [4, 5, 6, 7],
  },
  gba: {
    faceButtons: {
      0: 1, // Cross → A
      1: 0, // Circle → B
      4: 8, // L1 → L
      5: 9, // R1 → R
      8: 2, // Share → SELECT
      9: 3, // Options → START
    },
    dPadIndices: [4, 5, 6, 7],
  },
};
