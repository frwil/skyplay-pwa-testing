import { getDb } from "./db.js";

// ── Types ─────────────────────────────────────────────────────────────

/**
 * Memory addresses and detection parameters for a specific game ROM.
 * Mirrors the `ram_config` JSON column in duel_games.
 */
export interface RamConfig {
  /** P1 health bar address. */
  p1: number;
  /** P2 health bar address. */
  p2: number;
  /** Size of the health value in bytes. */
  size: number;
  /** Full-health raw value (e.g. 0x67 for NeoGeo). */
  maxHealth: number;
  /** 16-bit timer address (primary). */
  timer: number;
  /** Alternative timer address (backup). */
  timerAlt: number;
  /** Currently-fighting character ID address (P1). */
  p1Char: number;
  /** Currently-fighting character ID address (P2). */
  p2Char: number;
  /** Gauge mode address (P1): 1=ADVANCED, 0=EXTRA (KOF98/2002). */
  p1Mode: number;
  /** Gauge mode address (P2). */
  p2Mode: number;
  /** Play mode address (P1): 0=Manual, 1=Auto (SFA2). */
  p1PlayMode?: number;
  /** Play mode address (P2): 0=Manual, 1=Auto (SFA2). */
  p2PlayMode?: number;
  /** Additional character addresses to monitor. */
  altChars?: number[];
  /** Legacy team slot addresses. */
  teamSlots?: number[];
  /** Team roster base address (P1). */
  p1TeamBase?: number;
  /** Team roster base address (P2). */
  p2TeamBase?: number;
  /** Byte offsets from team base to each slot. */
  p1TeamOffsets?: number[];
  p2TeamOffsets?: number[];
  /** Active character slot index (P1). */
  p1ActiveIdx?: number;
  /** Active character slot index (P2). */
  p2ActiveIdx?: number;
  /** Currently-fighting character ID address (P1, direct). */
  p1Active?: number;
  /** Currently-fighting character ID address (P2, direct). */
  p2Active?: number;
  /** Match state flag address (0x40 = in-match, 0x00 = char select). */
  matchFlag?: number;
  /** Per-player "characters lost" counter (P1, 0->3). */
  p1Lost?: number;
  /** Per-player "characters lost" counter (P2, 0->3). */
  p2Lost?: number;
  /** Pick-order buffer absolute addresses [1st, 2nd, 3rd] for P1. */
  p1PickOrder?: number[];
  /** Pick-order buffer absolute addresses [1st, 2nd, 3rd] for P2. */
  p2PickOrder?: number[];

  // ── Brawler-mode fields (Cadillacs and Dinosaurs / CPS1) ──────────
  /** P1 lives remaining address. */
  p1Lives?: number;
  /** P2 lives remaining address. */
  p2Lives?: number;
  /** P1 score address (multi-byte, size in p1ScoreSize). */
  p1Score?: number;
  /** P2 score address (multi-byte, size in p2ScoreSize). */
  p2Score?: number;
  /** Score size in bytes for P1 (default 3). */
  p1ScoreSize?: number;
  /** Score size in bytes for P2 (default 3). */
  p2ScoreSize?: number;
  /** Current level/stage address. */
  level?: number;
  /** Current level/stage address (alias for level). */
  levelAddr?: number;
  /** Game over flag address. */
  gameOverFlag?: number;
  /** Game over flag address (alias for gameOverFlag). */
  gameOverAddr?: number;
  /** Game over value (e.g. 0x01 = game over screen active). */
  gameOverValue?: number;
  /** Pixel-based health/lives detection config (brawler games where RAM is unreliable). */
  pixel?: BrawlerPixelConfig;
}

// ── Pixel-based detection (brawler games where RAM addresses are unstable) ──

/** HUD region coordinates for pixel-based health + lives detection.
 *  All coordinates are in the upscaled display frame (1152×672 for CPS1 at 3×).
 *
 *  Cadillacs and Dinosaurs supports up to 3 players:
 *    P1 = left,  P2 = center,  P3 = right (far right).
 */
export interface BrawlerPixelConfig {
  /** Health bar ROI rectangles in upscaled pixels. */
  p1Bar: { x: number; y: number; w: number; h: number };
  p2Bar: { x: number; y: number; w: number; h: number };
  p3Bar: { x: number; y: number; w: number; h: number };
  /** Lives icon row ROI rectangles in upscaled pixels. */
  p1Lives: { x: number; y: number; w: number; h: number };
  p2Lives: { x: number; y: number; w: number; h: number };
  p3Lives: { x: number; y: number; w: number; h: number };
  /** Which end each bar fills from (direction of depletion). */
  fillFrom?: { p1: "left" | "right"; p2: "left" | "right"; p3?: "left" | "right" };
  /** Pre-calibrated full-bar pixel widths (auto-detected from warmup max if absent). */
  fullBarWidth?: { p1?: number; p2?: number; p3?: number };
  /** Maximum life icons displayed (default 3). */
  maxLives?: number;
  /** Minimum width of a life-icon cluster in upscaled pixels (default 21 = 7 native × 3). */
  minIconWidth?: number;
  /** Minimum gap between life-icon clusters in upscaled pixels (default 6). */
  iconGap?: number;
  /** Health % below this = dying (default 5). */
  deathHealthThreshold?: number;
  /** Consecutive low-health frames to confirm death (default 6 ≈ 1.5s at 4 fps). */
  deathConfirmFrames?: number;
  /** Health % above this after death = respawned (default 25). */
  respawnHealthThreshold?: number;
  /** Score digit ROI: { x, y, digitW, digitH, count }.
   *  x,y = top-left of the first (leftmost) score digit.
   *  digitW,digitH = size of each digit cell in upscaled pixels.
   *  count = number of digits (7 for Dino, score range 0–9,999,999).
   *  Digits are monospaced, left-to-right (most significant first).
   *  Set to undefined to disable OCR-based score reading. */
  score?: {
    x: number; y: number; digitW: number; digitH: number; count: number;
    /** Center-to-center pitch between consecutive digits (default = digitW).
     *  Allows digitW to be narrower than the pitch so each cell captures a
     *  single digit without bleeding into neighbors. */
    pitch?: number;
    /** Optional thousand-separator gaps. Each entry shifts all digits after
     *  `afterDigit` (0-based) by `size` pixels to the right. */
    gaps?: { afterDigit: number; size: number }[];
  };
  /** Rank ROI ("#TH" under the score, e.g. "10TH") in upscaled pixels.
   *  Right-aligned under the score, glyphs 21px tall. The rank is not shown
   *  in room 1 — measureRank returns null when the zone is empty.
   *  Set to undefined to disable rank OCR. */
  rank?: { x: number; y: number; w: number; h: number };
}

/** Hardcoded pixel-detection configs — used when DB ram_config has no pixel field. */
export const BRAWLER_PIXEL_CONFIGS: Record<string, BrawlerPixelConfig> = {
  // Cadillacs and Dinosaurs (CPS1) — 3-player brawler.
  // Health bars are yellow (255,238,0) at Y=51-68, character portraits above.
  // Calibrated 2026-08-04 via scripts/calibrate-brawler-hud.cjs (single-player capture).
  // P2/P3 bar extents estimated from HUD panel backgrounds — refine with 2P/3P gameplay.
  "dino.zip": {
    p1Bar: { x: 190, y: 48, w: 233, h: 24 },
    p2Bar: { x: 500, y: 48, w: 220, h: 24 },
    p3Bar: { x: 810, y: 48, w: 180, h: 24 },
    p1Lives: { x: 122, y: 0, w: 75, h: 52 },
    p2Lives: { x: 540, y: 0, w: 75, h: 52 },
    p3Lives: { x: 855, y: 0, w: 75, h: 52 },
    fillFrom: { p1: "left", p2: "left", p3: "left" },
    maxLives: 3,
    minIconWidth: 15,
    iconGap: 6,
    deathHealthThreshold: 5,
    deathConfirmFrames: 6,
    respawnHealthThreshold: 25,
    // Score digits OCR — calibrated 2026-08-12 via 6 confirmed debug frames
    // (1800,4100,4900,7200,9500,10600). Fond bleu (153,153,238), digits en
    // dégradé bleu foncé→cyan (204,255,255). Police bold ~10px/digit.
    // Pitch=18px centre-à-centre, cell=10px pour capture sans chevauchement.
    // Alignement DROITE : le score pousse vers la gauche quand il grandit.
    // x=301 = position du digit le plus à gauche pour 7 chiffres (max 9,999,999).
    // Scores à 4 chiffres: début à x=355, 5 chiffres: x=337, 6 chiffres: x=319.
    // count=7 couvre exactement le score max — les éléments UI fixes à droite
    // (coin counter ~408-423) sont hors zone de scan.
    score: { x: 301, y: 0, digitW: 10, digitH: 15, count: 7, pitch: 18 },
    // Rank ROI ("#TH" under the score) — discovered 2026-08-13 from 12 frames
    // of one session: y=24..44 (upscaled), right-aligned under the score at
    // x=354..423 for "10TH" (up to 4 glyphs, max "99TH" ≈ x=330..445).
    // Absent in room 1 — the analyzer latches the last read rank.
    rank: { x: 330, y: 24, w: 116, h: 21 },
  },
};

/** Look up the pixel config for a ROM. Returns null if the game has no pixel config. */
export function getBrawlerPixelConfig(rom: string): BrawlerPixelConfig | null {
  const romKey = rom.split("/").pop()?.replace(/\.(zip|sfc|smc|nes|gb|gbc|gba)$/i, "") ?? rom;
  const entry = Object.entries(BRAWLER_PIXEL_CONFIGS).find(([k]) =>
    k.replace(/\.(zip|sfc|smc|nes|gb|gbc|gba)$/i, "") === romKey
  );
  return entry?.[1] ?? null;
}

/** A control mapping entry for one player action. */
export interface GameControlEntry {
  player: number;
  actionKey: string;
  labelKey: string;
  defaultKeys: string;
}

/** Full game configuration loaded from the database. */
export interface GameConfig {
  id: string;
  label: string;
  system: string;
  rom: string;
  mode: string;
  entryFee: number;
  enabled: boolean;
  ramConfig: RamConfig | null;
  controls: GameControlEntry[];
}

// ── Hardcoded fallbacks (used when DB is unreachable) ─────────────────

const FALLBACK_RAM_CONFIGS: Record<string, RamConfig> = {
  "kof98.zip": {
    p1: 0x8238, p2: 0x8438, size: 1, maxHealth: 0x67,
    timer: 0xA83A, timerAlt: 0x85D2,
    p1Char: 0x823F, p2Char: 0x843F,
    p1Mode: 0x821E, p2Mode: 0x841E,
    p1TeamBase: 0xA84E, p2TeamBase: 0xA85E,
    p1TeamOffsets: [0, 1, 3], p2TeamOffsets: [0, 2, 3],
    p1Active: 0x8256, p2Active: 0x8456,
    matchFlag: 0xA840,
    p1Lost: 0xA859, p2Lost: 0xA868,
    p1PickOrder: [0x15CB, 0x15CA, 0x15CD],
    p2PickOrder: [0x17CB, 0x17CA, 0x17CD],
  },
  "kof2002.zip": {
    p1: 0x8238, p2: 0x8438, size: 1, maxHealth: 0x67,
    timer: 0xA83A, timerAlt: 0x85D2,
    p1Char: 0x823F, p2Char: 0x843F,
    p1Mode: 0x821E, p2Mode: 0x841E,
    p1TeamBase: 0xA84E, p2TeamBase: 0xA85E,
    p1TeamOffsets: [0, 1, 3], p2TeamOffsets: [0, 2, 3],
    p1Active: 0x8256, p2Active: 0x8456,
    matchFlag: 0xA840,
    p1Lost: 0xA859, p2Lost: 0xA868,
    p1PickOrder: [0x15CB, 0x15CA, 0x15CD],
    p2PickOrder: [0x17CB, 0x17CA, 0x17CD],
  },
  // SFA2 SNES (Europe) — RAM addresses discovered 2026-07-25—26 via full WRAM scans + live match differential.
  // Health: 4-byte block, max 96 (0x60), P2 offset +2.
  // Timer: 0x1B7D BCD-encoded (0x57 = 57s).
  // Char IDs: P1=0x1C07, P2=0x1C08 (+1 offset, S-DD1 interleaved).
  // Play Mode: P1=0x1C2A, P2=0x1C2B (+1 offset). 0=Manual, 1=Auto.
  //   Discovered 2026-07-26 via Manual->Auto diff (4-match controlled experiment).
  "Street Fighter Alpha 2 (Europe).sfc": {
    p1: 0x1D3D, p2: 0x1D3F, size: 1, maxHealth: 0x60,
    timer: 0x1B7D, timerAlt: 0x1B7D,
    p1Char: 0x1C07, p2Char: 0x1C08,
    p1Mode: 0x1D3D, p2Mode: 0x1D3D,
    p1PlayMode: 0x1C2A, p2PlayMode: 0x1C2B,
  },
  // SF2 (Street Fighter II, SNES) — "Street Fighter 5 (Hack).smc"
  // ⚠️ ALL ADDRESSES UNVERIFIED — placeholder based on PAR codes (SF2 Turbo USA).
  // Health: 0x0530 P1 / 0x0730 P2 (PAR 7E0530xx / 7E0730xx). Max health = 176 (0xB0).
  // Timer: 0x18F3 (PAR 7E18F3xx). Char IDs: not yet discovered.
  // This is a ROM hack — addresses may differ. Run discover-sf2.mjs for live verification.
  "Street Fighter 5 (Hack).smc": {
    p1: 0x0530, p2: 0x0730, size: 1, maxHealth: 0xB0,
    timer: 0x18F3, timerAlt: 0x18F3,
    p1Char: 0x0530, p2Char: 0x0730,
    p1Mode: 0x0530, p2Mode: 0x0730,
  },
  // Cadillacs and Dinosaurs (CPS1 / FBNeo) — brawler mode
  // Discovered via live differential RAM scans (discover-dino.mjs scan #2, 2026-07-31).
  // CPS1 work RAM mapped by FBNeo at 0x000000-0x00FFFF (64KB, 68000 big-endian).
  // Health: 1 byte, max 0x90 (144). Stored in [value, 0] 16-bit LE pairs.
  //   P1=0x0B46, P2=0x0B48 (paired +2 offset). Candidate — needs live combat verification.
  // Timer: 0x0B4C (cycles 67->84->102->111 pattern).
  // Lives: P1=0xB2C0 (CONFIRMED: tracks 1->0 on death). P2=0xB2C1 (+1, unverified).
  // Score: not yet found in 64KB work RAM (may be in VRAM or custom encoding).
  // Char ID: cheat addresses (0xB277,0x863A) return 0 for all chars in this RetroArch core.
  // Game Over: candidate 0xB335 — not validated live.
  "dino.zip": {
    p1: 0x0B46, p2: 0x0B48, size: 1, maxHealth: 0x90,
    timer: 0x0B4C, timerAlt: 0x0B4C,
    p1Char: 0xB276, p2Char: 0xB3F6,
    p1Mode: 0x0000, p2Mode: 0x0000,
    // Brawler-specific (Phase 2 discovery, 2026-07-31)
    p1Lives: 0xB2C0, p2Lives: 0xB2C1,
    p1Score: 0x0000, p2Score: 0x0000, p1ScoreSize: 3, p2ScoreSize: 3,
    level: 0x84F2,
    gameOverFlag: 0xB335,
  },
};

// ── In-memory cache ───────────────────────────────────────────────────

let cachedConfigs: GameConfig[] | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── Public API ────────────────────────────────────────────────────────

/**
 * Load all enabled duel games from the database.
 * Results are cached for 5 minutes. Falls back to hardcoded configs on error.
 */
export async function loadAllGames(): Promise<GameConfig[]> {
  const now = Date.now();
  if (cachedConfigs && now - cacheLoadedAt < CACHE_TTL_MS) {
    return cachedConfigs;
  }

  try {
    const db = getDb();

    const gamesRs = await db.execute(
      "SELECT id, label, system, rom, mode, entry_fee, enabled FROM duel_games WHERE enabled = 1 ORDER BY id"
    );

    const games: GameConfig[] = [];

    for (const row of gamesRs.rows) {
      const gameId = row.id as string;
      const rom = row.rom as string;

      // ── Prefer the active config version snapshot ──
      const activeVersionRs = await db.execute({
        sql: "SELECT ram_config, controls FROM duel_game_config_versions WHERE game_id = ? AND is_active = 1 LIMIT 1",
        args: [gameId],
      });

      let ramConfig: RamConfig | null = null;
      let controls: GameControlEntry[] = [];

      if (activeVersionRs.rows.length > 0) {
        const v = activeVersionRs.rows[0];
        // Parse ram_config from the active version
        const ramRaw = v.ram_config as string | null;
        if (ramRaw) {
          try { ramConfig = JSON.parse(ramRaw) as RamConfig; } catch {
            console.warn(`[game-config] Invalid ram_config JSON in active version for ${gameId}`);
          }
        }
        // Parse controls from the active version
        try {
          const rawControls = JSON.parse((v.controls as string) ?? "[]");
          if (Array.isArray(rawControls)) {
            controls = rawControls.map((c: Record<string, unknown>) => ({
              player: c.player as number,
              actionKey: c.actionKey as string,
              labelKey: c.labelKey as string,
              defaultKeys: c.defaultKeys as string,
            }));
          }
        } catch { /* keep controls empty */ }
      } else {
        // ── Fallback: read from legacy tables ──
        const controlsRs = await db.execute({
          sql: "SELECT player, action_key, label_key, default_keys FROM duel_game_controls WHERE game_id = ? ORDER BY player, action_key",
          args: [gameId],
        });
        controls = controlsRs.rows.map((c) => ({
          player: c.player as number,
          actionKey: c.action_key as string,
          labelKey: c.label_key as string,
          defaultKeys: c.default_keys as string,
        }));
      }

      // If no ram_config from DB at all, try the hardcoded fallback
      if (!ramConfig) {
        const romKey = rom.split("/").pop() ?? rom;
        ramConfig = FALLBACK_RAM_CONFIGS[romKey] ?? null;
      }

      games.push({
        id: gameId,
        label: row.label as string,
        system: row.system as string,
        rom,
        mode: row.mode as string,
        entryFee: row.entry_fee as number,
        enabled: (row.enabled as number) === 1,
        ramConfig,
        controls,
      });
    }

    cachedConfigs = games;
    cacheLoadedAt = now;
    console.log(`[game-config] Loaded ${games.length} games from DB`);
    return games;
  } catch (err) {
    console.warn("[game-config] DB load failed, using fallback configs:", err);
    return buildFallbackConfigs();
  }
}

/**
 * Get config for a specific ROM file.
 * Returns null if the game is not found or not enabled.
 */
export async function getGameConfig(rom: string): Promise<GameConfig | null> {
  const games = await loadAllGames();
  // Match by ROM basename (with or without .zip extension)
  const romKey = rom.split("/").pop()?.replace(/\.zip$/i, "") ?? rom;
  return games.find((g) => {
    const gRomKey = g.rom.split("/").pop()?.replace(/\.zip$/i, "") ?? g.rom;
    return gRomKey === romKey || g.rom === rom;
  }) ?? null;
}

/** Force a refresh of the cached configs on the next loadAllGames() call. */
export function invalidateGameConfigCache(): void {
  cachedConfigs = null;
  cacheLoadedAt = 0;
}

// ── Internal helpers ──────────────────────────────────────────────────

function buildFallbackConfigs(): GameConfig[] {
  return Object.entries(FALLBACK_RAM_CONFIGS).map(([rom, ramConfig]) => {
    const isBrawler = rom === "dino.zip";
    const isSnes = rom.endsWith(".sfc") || rom.endsWith(".smc");
    return {
      id: rom.replace(/\.(zip|sfc|smc)$/i, ""),
      label: rom.replace(/\.(zip|sfc|smc)$/i, "").toUpperCase(),
      system: isSnes ? "snes" : isBrawler ? "cps1" : "neogeo",
      rom,
      mode: isBrawler ? "brawler" : "fighting",
      entryFee: 1000,
      enabled: true,
      ramConfig,
      controls: [],
    };
  });
}
