// ── Per-game pixel-based health + timer detection config ────────────
// Every ROM gets its OWN config entry. Adding a new game = adding one entry here.
// The detection engine (state machine, column scan, template matching) stays the same.
//
// Lookup: matched by ROM basename (stripped of path + extension), same as HEALTH_MEMORY_MAP.
//
// In the future, these configs can be loaded from the Turso DB (duel_games.ram_config)
// instead of being hardcoded here.

// ── Portrait template matching config ─────────────────────────────────

/** Template dimensions for portrait matching (24×24 bits per character). */
export const PORTRAIT_TEMPLATE_W = 24;
export const PORTRAIT_TEMPLATE_H = 24;

/** Per-game portrait detection configuration for character select screens. */
export interface PortraitConfig {
  /** X offset of the portrait grid from the left of Xvfb. */
  gridX: number;
  /** Y offset of the portrait grid from the top of Xvfb. */
  gridY: number;
  /** Number of columns in the character select grid. */
  cols: number;
  /** Number of rows in the character select grid. */
  rows: number;
  /** Width of each portrait cell in pixels. */
  cellW: number;
  /** Height of each portrait cell in pixels. */
  cellH: number;
  /**
   * Character templates — one entry per grid cell in row-major order
   * (index = row * cols + col). Each template is an array of
   * PORTRAIT_TEMPLATE_H rows, each row a number whose lower
   * PORTRAIT_TEMPLATE_W bits encode the binarized portrait (MSB = left).
   *
   * Seed with all zeros for calibration mode — the calibrator populates them.
   */
  templates: number[][];
  /** Display names indexed by character ID (0x00-0x11 for SFA2). */
  charNames: string[];
  /** Minimum Hamming-distance confidence to consider a cell reliable (0-1). */
  minConfidence: number;
  /** Minimum margin vs 2nd-best match to consider unambiguous (0-1). */
  minMargin: number;
}

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
  /** First stripe row that belongs to the health BARS (0 = stripe top).
   *  Rows above may contain score digits/names that would pollute the
   *  column fill measurement. Absent → scan the whole stripe height. */
  barRowStart?: number;
  /** Number of stripe rows to scan for the bars. Absent → to stripe bottom. */
  barRowH?: number;
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
    /** Absolute brightness threshold for binarization (0-255). White digits on dark bg. */
    binarizeThreshold?: number;
    /** Minimum bright pixel ratio to consider the region readable. */
    minBrightRatio: number;
    /** Y offset of the digit top within the stripe (0 = stripe top).
     *  When absent the detector centers the digit vertically. */
    digitYOffset?: number;
  };
  /** Portrait detection config for character select screens (absent → no pixel portraits). */
  portrait?: PortraitConfig;
}

export const PIXEL_GAME_CONFIGS: Record<string, PixelGameConfig> = {
  // ── Street Fighter Alpha 2 (SNES) ──────────────────────────────────
  "Street Fighter Alpha 2 (Europe).sfc": {
    // Stripe covers score digits/names (top rows), timer digits, and the
    // health bars. Measured on live frames (2026-07-19 debug-stripe-combat.ppm):
    //   stripe y=0-19:  score digits + names (NOT bars — excluded)
    //   stripe y=20-30: timer digits + gap
    //   stripe y=31-45: health bars (15 rows, 291 health px/row at 100%)
    //   stripe y=46-51: gap + leftover pixels
    // barRowStart/barRowH restrict the fill measurement to the bar rows so
    // the bright score digits above P1's bar don't pollute the columns.
    stripeY: 110, stripeH: 52,
    p1StartX: 44, p1EndX: 348,
    p2StartX: 420, p2EndX: 724,
    barRowStart: 29, barRowH: 19, // stripe y=29-47, screen y=139-157 (bars at y=31-45 + 2px margin)
    winsNeeded: 2,
    timer: {
      digits: [ // REAL templates from 220-frame capture, binarized @ threshold=160, 8×12 grid
        [0b01111110,0b11111111,0b11000011,0b11000011,0b11000011,0b11000011,0b11000011,0b11000011,0b11000011,0b11000011,0b11111111,0b01111110], // 0
        [0b11111100,0b11111100,0b00111100,0b00111100,0b00111100,0b00111100,0b00111100,0b00111100,0b00111100,0b00111100,0b11111111,0b11111111], // 1
        [0b01111110,0b11111111,0b11000011,0b11000011,0b00000011,0b00000011,0b01111111,0b11111110,0b11000000,0b11000000,0b11111111,0b01111111], // 2
        [0b11111110,0b11111111,0b00000011,0b00000011,0b00000011,0b11111111,0b11111111,0b00000011,0b00000011,0b00000011,0b11111111,0b11111110], // 3
        [0b11000011,0b11000011,0b11000011,0b11000011,0b11000011,0b11000011,0b11111111,0b01111111,0b00000011,0b00000011,0b00000011,0b00000011], // 4
        [0b01111111,0b11111111,0b11000000,0b11000000,0b11000000,0b11111110,0b01111111,0b00000011,0b00000011,0b00000011,0b11111111,0b11111110], // 5
        [0b01111110,0b11111111,0b11000011,0b11000000,0b11000000,0b11111110,0b11111111,0b11000011,0b11000011,0b11000011,0b11111111,0b01111110], // 6
        [0b01111110,0b11111111,0b11000011,0b11000011,0b00000011,0b00000011,0b00000011,0b00000011,0b00000011,0b00000011,0b00000011,0b00000011], // 7
        [0b01111110,0b11111111,0b11000011,0b11000011,0b11000011,0b11111111,0b11111111,0b11000011,0b11000011,0b11000011,0b11111111,0b01111110], // 8
        [0b01111110,0b11111111,0b11000011,0b11000011,0b11000011,0b11111111,0b01111111,0b00000011,0b00000011,0b11000011,0b11111111,0b01111110], // 9
      ],
      leftDigitX: 354, rightDigitX: 382, digitW: 26, digitH: 40,
      digitYOffset: 8, // digit top at y=118 relative to stripeY=110
      binarizeThreshold: 160, // absolute threshold — white digits (~255) on dark bg
      minBrightRatio: 0.10,
    },
    portrait: {
      // Measured from char-select-full.ppm: portrait content x=30→552, y=230→450 at 3x upscale.
      // cellW=58 gives 522px total (9 cols); previous 80px overflowed into background (cols 7-8 all-green).
      gridX: 30, gridY: 230,
      cols: 9, rows: 2,
      cellW: 58, cellH: 110,
      // 18 zero-seed templates (one per character). Calibrator populates them.
      templates: Array.from({ length: 18 }, () => Array(24).fill(0)),
      charNames: [
        "Ryu",        // 0x00  row 0 col 0
        "Ken",        // 0x01  row 0 col 1
        "Chun-Li",    // 0x02  row 0 col 2
        "Adon",       // 0x03  row 0 col 3
        "Guy",        // 0x04  row 0 col 4
        "Akuma",      // 0x05  row 0 col 5
        "Charlie",    // 0x06  row 0 col 6
        "Sodom",      // 0x07  row 0 col 7
        "Rose",       // 0x08  row 0 col 8
        "Birdie",     // 0x09  row 1 col 0
        "Sagat",      // 0x0A  row 1 col 1
        "M. Bison",   // 0x0B  row 1 col 2
        "Dan",        // 0x0C  row 1 col 3
        "Dhalsim",    // 0x0D  row 1 col 4
        "Gen",        // 0x0E  row 1 col 5
        "Sakura",     // 0x0F  row 1 col 6
        "Rolento",    // 0x10  row 1 col 7
        "Zangief",    // 0x11  row 1 col 8
      ],
      minConfidence: 0.65,
      minMargin: 0.08,
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
