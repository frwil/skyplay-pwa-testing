/**
 * Button index → RetroArch config key name.
 *
 * Button indices match what each emulator core expects.
 * For Neo Geo (fbneo): A=0, B=1, C=2, D=3, SELECT=4, START=5, UP=6, DOWN=7, LEFT=8, RIGHT=9
 * For PS1 (pcsx_rearmed): CROSS=0, CIRCLE=1, SQUARE=2, TRIANGLE=3, L1=4, R1=5, L2=6, R2=7, SELECT=8, START=9, UP=10, DOWN=11, LEFT=12, RIGHT=13
 *
 * We also accept extended SNES-style indices (10=l, 11=r) for compatibility.
 */
/** Neo Geo / arcade layout: A=0,B=1,C=2,D=3,SELECT=4,START=5,UP=6,DOWN=7,LEFT=8,RIGHT=9 */
export const BUTTON_TO_RETROARCH: Record<number, string> = {
  // Face buttons (Neo Geo / arcade layout)
  0: "a",
  1: "b",
  2: "x",
  3: "y",
  // SELECT / START
  4: "select",
  5: "start",
  // D-Pad
  6: "up",
  7: "down",
  8: "left",
  9: "right",
  // Shoulder buttons (SNES / PS1 extended layout)
  10: "l",
  11: "l2",     // L2 if supported
  12: "r",
  13: "r2",     // R2 if supported
};

/**
 * PS1 layout (pcsx_rearmed): CROSS=0,CIRCLE=1,SQUARE=2,TRIANGLE=3,
 * L1=4,R1=5,L2=6,R2=7,SELECT=8,START=9,UP=10,DOWN=11,LEFT=12,RIGHT=13
 */
export const PS1_BUTTON_TO_RETROARCH: Record<number, string> = {
  // Face buttons
  0: "a",
  1: "b",
  2: "x",
  3: "y",
  // L1 / R1 / L2 / R2
  4: "l",
  5: "r",
  6: "l2",
  7: "r2",
  // SELECT / START
  8: "select",
  9: "start",
  // D-Pad
  10: "up",
  11: "down",
  12: "left",
  13: "right",
};

/**
 * SNES layout (snes9x): B=0, Y=1, SELECT=2, START=3, UP=4, DOWN=5, LEFT=6, RIGHT=7, A=8, X=9, L=10, R=11
 *
 * The RetroArch snes9x core uses the same config key names (a/b/x/y/l/r) as the
 * default Neo Geo layout, but the button indices differ — e.g. SNES index 0 is B
 * (not A), index 8 is A (not LEFT). This mapping translates SNES button indices
 * to the correct RetroArch config key.
 */
export const SNES_BUTTON_TO_RETROARCH: Record<number, string> = {
  // Face buttons
  0: "b",
  1: "y",
  2: "select",
  3: "start",
  // D-Pad
  4: "up",
  5: "down",
  6: "left",
  7: "right",
  // A / X / L / R (higher indices)
  8: "a",
  9: "x",
  10: "l",
  11: "r",
};

/** Return the correct BUTTON_TO_RETROARCH for a given system. */
export function getButtonToRetroarch(system: string): Record<number, string> {
  if (system === "ps1") return PS1_BUTTON_TO_RETROARCH;
  if (system === "snes") return SNES_BUTTON_TO_RETROARCH;
  return BUTTON_TO_RETROARCH;
}

/** X11 keysym name → xdotool key name.
 *  Maps RetroArch config names to keyboard keys injected via xdotool. */
export const XDOTOOL_KEY_MAP: Record<string, string> = {
  a: "x",       // P1 A → X key
  b: "z",       // P1 B → Z key
  x: "c",       // P1 X → C key
  y: "v",       // P1 Y → V key
  l: "a",       // P1 L → A key
  r: "s",       // P1 R → S key
  l2: "q",      // P1 L2 → Q key
  r2: "w",      // P1 R2 → W key
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  start: "Return",
  select: "Shift_R",
};

/** P2 xdotool key map — uses completely different physical keys from P1.
 *  P1 occupies: x, z, c, v, a, s, q, w, arrows, Return, Shift_R
 *  P2 uses (right side of keyboard): i, k, o, l, u, j, y, h, t, g, f, r, n, m
 *  These are all free and non-overlapping with P1. */
export const XDOTOOL_KEY_MAP_P2: Record<string, string> = {
  a: "i",       // P2 A → I key
  b: "k",       // P2 B → K key
  x: "o",       // P2 X → O key
  y: "l",       // P2 Y → L key
  l: "u",       // P2 L → U key
  r: "j",       // P2 R → J key
  l2: "y",      // P2 L2 → Y key
  r2: "p",      // P2 R2 → P key (was H, now reused for D-pad RIGHT)
  up: "t",      // P2 Up → T key
  down: "g",    // P2 Down → G key
  left: "f",    // P2 Left → F key
  right: "h",   // P2 Right → H key (WASD-like cluster: T/G/F/H)
  start: "n",   // P2 Start → N key
  select: "m",  // P2 Select → M key
};

/** Build RetroArch keyboard config entries for both players. */
export function buildRetroarchKeyConfig(): Record<string, string> {
  const config: Record<string, string> = {};
  // Player 1
  for (const [btnIdx, retroarchName] of Object.entries(BUTTON_TO_RETROARCH)) {
    const xdoKey = XDOTOOL_KEY_MAP[retroarchName];
    if (!xdoKey) continue;
    const raKey = xdotoolToRetroarchKey(xdoKey);
    if (!raKey) continue;
    config[`input_player1_${retroarchName}`] = raKey;
  }
  // Player 2
  for (const [btnIdx, retroarchName] of Object.entries(BUTTON_TO_RETROARCH)) {
    const xdoKey = XDOTOOL_KEY_MAP_P2[retroarchName];
    if (!xdoKey) continue;
    const raKey = xdotoolToRetroarchKey(xdoKey);
    if (!raKey) continue;
    config[`input_player2_${retroarchName}`] = raKey;
  }
  return config;
}

/** Convert xdotool key name to RetroArch config key name. */
function xdotoolToRetroarchKey(xdo: string): string | null {
  const map: Record<string, string> = {
    x: "x", z: "z", c: "c", v: "v", a: "a", s: "s",
    i: "i", k: "k", o: "o", l: "l", u: "u", j: "j",
    y: "y", h: "h", t: "t", g: "g", f: "f", r: "r", p: "p",
    n: "n", m: "m",
    Up: "up", Down: "down", Left: "left", Right: "right",
    Return: "enter", Shift_R: "rshift",
  };
  return map[xdo] ?? null;
}

/** Core name mapping for each system type. */
export const SYSTEM_CORES: Record<string, string> = {
  neogeo: "fbneo_libretro.so",
  ps1: "pcsx_rearmed_libretro.so",
  snes: "snes9x_libretro.so",
};

/** System display resolution. */
export const SYSTEM_RESOLUTIONS: Record<string, { w: number; h: number }> = {
  neogeo: { w: 320, h: 224 },
  ps1: { w: 640, h: 480 },
  snes: { w: 256, h: 224 },
};

/** 3x upscale for the display (Xvfb screen size). */
export const UPSCALE = 3;
