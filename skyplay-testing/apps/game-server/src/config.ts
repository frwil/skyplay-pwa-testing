/**
 * Button index → RetroArch config key name.
 *
 * Button indices match what each emulator core expects.
 * For Neo Geo (fbneo): A=0, B=1, C=2, D=3, SELECT=4, START=5, UP=6, DOWN=7, LEFT=8, RIGHT=9
 * For PS1 (pcsx_rearmed): CROSS=0, CIRCLE=1, SQUARE=2, TRIANGLE=3, L1=4, R1=5, L2=6, R2=7, SELECT=8, START=9, UP=10, DOWN=11, LEFT=12, RIGHT=13
 *
 * We also accept extended SNES-style indices (10=l, 11=r) for compatibility.
 */
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

/** Build RetroArch keyboard config entries from button mapping. */
export function buildRetroarchKeyConfig(): Record<string, string> {
  const config: Record<string, string> = {};
  for (const [btnIdx, retroarchName] of Object.entries(BUTTON_TO_RETROARCH)) {
    const xdoKey = XDOTOOL_KEY_MAP[retroarchName];
    if (!xdoKey) continue;
    // Convert xdotool key to RetroArch key name
    const raKey = xdotoolToRetroarchKey(xdoKey);
    if (!raKey) continue;
    config[`input_player1_${retroarchName}`] = raKey;
  }
  return config;
}

/** Convert xdotool key name to RetroArch config key name. */
function xdotoolToRetroarchKey(xdo: string): string | null {
  const map: Record<string, string> = {
    x: "x", z: "z", c: "c", v: "v", a: "a", s: "s",
    Up: "up", Down: "down", Left: "left", Right: "right",
    Return: "enter", Shift_R: "rshift",
  };
  return map[xdo] ?? null;
}

/** Core name mapping for each system type. */
export const SYSTEM_CORES: Record<string, string> = {
  neogeo: "fbneo_libretro.so",
  ps1: "pcsx_rearmed_libretro.so",
};

/** System display resolution. */
export const SYSTEM_RESOLUTIONS: Record<string, { w: number; h: number }> = {
  neogeo: { w: 320, h: 224 },
  ps1: { w: 640, h: 480 },
};

/** 3x upscale for the display (Xvfb screen size). */
export const UPSCALE = 3;
