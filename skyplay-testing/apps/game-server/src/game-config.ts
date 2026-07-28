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
  /** Per-player "characters lost" counter (P1, 0→3). */
  p1Lost?: number;
  /** Per-player "characters lost" counter (P2, 0→3). */
  p2Lost?: number;
  /** Pick-order buffer absolute addresses [1st, 2nd, 3rd] for P1. */
  p1PickOrder?: number[];
  /** Pick-order buffer absolute addresses [1st, 2nd, 3rd] for P2. */
  p2PickOrder?: number[];
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
  //   Discovered 2026-07-26 via Manual→Auto diff (4-match controlled experiment).
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
  return Object.entries(FALLBACK_RAM_CONFIGS).map(([rom, ramConfig]) => ({
    id: rom.replace(/\.zip$/i, ""),
    label: rom.replace(/\.zip$/i, "").toUpperCase(),
    system: "neogeo",
    rom,
    mode: "fighting",
    entryFee: 1000,
    enabled: true,
    ramConfig,
    controls: [],
  }));
}
