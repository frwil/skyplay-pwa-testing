// ── Per-game pixel-based health + timer detection config ────────────
// Every ROM gets its OWN config entry. Adding a new game = adding one entry here.
// The detection engine (state machine, column scan, template matching) stays the same.
//
// Lookup: matched by ROM basename (stripped of path + extension), same as HEALTH_MEMORY_MAP.
//
// In the future, these configs can be loaded from the Turso DB (duel_games.ram_config)
// instead of being hardcoded here.

/** Full pixel-detection configuration for a single game ROM. */
export interface PixelGameConfig {
  // ── Health bar stripe (ffmpeg capture region) ──
  /** Y offset of the health bar stripe from the top of Xvfb. */
  stripeY: number;
  /** Height of the captured stripe in pixels. */
  stripeH: number;
  // ── Health bar X regions (within the stripe, at display width) ──
  p1StartX: number;
  p1EndX: number;
  p2StartX: number;
  p2EndX: number;
  // ── Round / match rules ──
  /** Number of rounds needed to win the match (2 = best-of-3, 3 = best-of-5). */
  winsNeeded: number;
  // ── Timer digit recognition (absent → no pixel timer for this ROM) ──
  timer?: {
    /** 10 digit templates, each 12 rows × 8 bits (MSB=left). */
    digits: number[][];
    /** Left digit X position in the health bar stripe. */
    leftDigitX: number;
    /** Right digit X position in the health bar stripe. */
    rightDigitX: number;
    /** Width of each digit in pixels. */
    digitW: number;
    /** Height of each digit in pixels. */
    digitH: number;
    /** Minimum bright pixel ratio to consider the region readable. */
    minBrightRatio: number;
  };
}

export const PIXEL_GAME_CONFIGS: Record<string, PixelGameConfig> = {
  // ── Street Fighter Alpha 2 (SNES) ──────────────────────────────────
  "Street Fighter Alpha 2 (Europe).sfc": {
    stripeY: 110, stripeH: 24,
    p1StartX: 70, p1EndX: 310,
    p2StartX: 450, p2EndX: 768,
    winsNeeded: 2,
    timer: {
      // Arcade-style bold white digits on dark background, ~22×24px each at 3x upscale.
      // Timer sits between P1 health (ends 310) and P2 health (starts 450).
      digits: [
        [0b00111100,0b01100110,0b01100110,0b01100110,0b01100110,0b01100110,0b01100110,0b01100110,0b01100110,0b01100110,0b01100110,0b00111100], // 0
        [0b00011000,0b00111000,0b00011000,0b00011000,0b00011000,0b00011000,0b00011000,0b00011000,0b00011000,0b00011000,0b00011000,0b01111110], // 1
        [0b00111100,0b01100110,0b00000110,0b00000110,0b00000110,0b00001100,0b00011000,0b00110000,0b01100000,0b01100000,0b01111110,0b01111110], // 2
        [0b00111100,0b01100110,0b00000110,0b00000110,0b00001100,0b00111100,0b00000110,0b00000110,0b00000110,0b00000110,0b01100110,0b00111100], // 3
        [0b00001100,0b00011100,0b00111100,0b01101100,0b11001100,0b11001100,0b11111110,0b11111110,0b00001100,0b00001100,0b00001100,0b00001100], // 4
        [0b01111110,0b01100000,0b01100000,0b01100000,0b01111100,0b00000110,0b00000110,0b00000110,0b00000110,0b00000110,0b01100110,0b00111100], // 5
        [0b00011100,0b00110000,0b01100000,0b01100000,0b01111100,0b01100110,0b01100110,0b01100110,0b01100110,0b01100110,0b01100110,0b00111100], // 6
        [0b01111110,0b01111110,0b00000110,0b00000110,0b00001100,0b00011000,0b00011000,0b00110000,0b00110000,0b01100000,0b01100000,0b01100000], // 7
        [0b00111100,0b01100110,0b01100110,0b01100110,0b00111100,0b01100110,0b01100110,0b01100110,0b01100110,0b01100110,0b01100110,0b00111100], // 8
        [0b00111100,0b01100110,0b01100110,0b01100110,0b01100110,0b01100110,0b00111110,0b00000110,0b00000110,0b00000110,0b00001100,0b01111000], // 9
      ],
      leftDigitX: 338, rightDigitX: 362, digitW: 22, digitH: 24, minBrightRatio: 0.15,
    },
  },
};

/** Template dimensions (all digit templates are 8×12 bitmaps). */
export const DIGIT_TEMPLATE_W = 8;
export const DIGIT_TEMPLATE_H = 12;

/** Look up the pixel config for a ROM. Returns null if the game uses RAM-based detection. */
export function getPixelConfig(rom: string): PixelGameConfig | null {
  const romKey = rom.split("/").pop()?.replace(/\.(zip|sfc|smc|nes|gb|gbc|gba)$/i, "") ?? rom;
  const entry = Object.entries(PIXEL_GAME_CONFIGS).find(([k]) =>
    k.replace(/\.(zip|sfc|smc|nes|gb|gbc|gba)$/i, "") === romKey
  );
  return entry?.[1] ?? null;
}
