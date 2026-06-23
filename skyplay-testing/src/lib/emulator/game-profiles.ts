/**
 * Game Profiles — Memory address mappings for auto-detecting results.
 *
 * Each profile maps a ROM name to a set of memory watches.
 * When all conditions in a profile are met, a result is auto-detected.
 *
 * Addresses are system-relative:
 *   NES:  CPU RAM ($0000–$07FF, 2048 bytes accessible via jsnes toJSON().cpu.mem)
 *   SNES: WRAM ($7E0000–$7FFFFF accessible via retro_get_memory_data(0))
 *         Buffer offset = SNES address - 0x7E0000
 *   GB:   WRAM ($C000–$DFFF accessible via retro_get_memory_data(0))
 *   GBA:  EWRAM ($02000000–$0203FFFF accessible via retro_get_memory_data(0))
 *
 * To find addresses for a new game:
 *   1. Play the game and take save states before/after the result screen
 *   2. Diff the RAM to find addresses that change
 *   3. Add a profile below
 *
 * Reference: https://retroachievements.org (game-specific memory maps)
 *            https://almarsguides.com  (Pro Action Replay code databases)
 */

export type SystemCategory = "nes" | "snes" | "gb" | "gba";

export interface MemoryCondition {
  /** Address in the emulated system's memory space */
  address: number;
  /** Comparison operator */
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "changed";
  /** Value to compare against (ignored for "changed" op) */
  value?: number;
  /** Size of the value in bytes (1, 2, or 4) */
  size?: 1 | 2 | 4;
}

export interface MemoryTrigger {
  /** Unique trigger ID (e.g. "p1_win", "round_end") */
  id: string;
  /** Human-readable label for this event */
  label: string;
  /** Result value to submit ("win", "loss", "draw", or a custom string) */
  result: string;
  /** Conditions: ALL must be satisfied for the trigger to fire */
  conditions: MemoryCondition[];
}

export interface GameProfile {
  /** ROM filename (exact match or starts-with) */
  romName: string;
  /** Display name */
  label: string;
  /** Which system this profile is for (auto-detected from ROM extension) */
  system: SystemCategory;
  /** Memory triggers to monitor */
  triggers: MemoryTrigger[];
  /** Poll interval in ms (default 500) */
  pollIntervalMs?: number;
  /** Minimum time before triggers activate (ms after ROM load, default 5000) */
  warmupMs?: number;
}

/**
 * Read a multi-byte value from a Uint8Array at the given address.
 * Handles little-endian (standard for NES/SNES/GB/GBA).
 */
export function readMemory(
  ram: Uint8Array,
  address: number,
  size: 1 | 2 | 4 = 1,
): number {
  if (size === 1) return ram[address] ?? 0;
  if (size === 2) {
    return ((ram[address + 1] ?? 0) << 8) | (ram[address] ?? 0);
  }
  // size === 4
  return (
    ((ram[address + 3] ?? 0) << 24) |
    ((ram[address + 2] ?? 0) << 16) |
    ((ram[address + 1] ?? 0) << 8) |
    (ram[address] ?? 0)
  );
}

/**
 * Evaluate a single condition against current and previous memory values.
 */
export function checkCondition(
  condition: MemoryCondition,
  ram: Uint8Array,
  prevRam: Uint8Array | null,
): boolean {
  const current = readMemory(ram, condition.address, condition.size ?? 1);

  if (condition.op === "changed") {
    if (!prevRam) return false;
    const previous = readMemory(prevRam, condition.address, condition.size ?? 1);
    return current !== previous;
  }

  const target = condition.value ?? 0;
  switch (condition.op) {
    case "eq":  return current === target;
    case "neq": return current !== target;
    case "gt":  return current > target;
    case "gte": return current >= target;
    case "lt":  return current < target;
    case "lte": return current <= target;
    default:    return false;
  }
}

/**
 * Check if all conditions for a trigger are met.
 */
export function checkTrigger(
  trigger: MemoryTrigger,
  ram: Uint8Array,
  prevRam: Uint8Array | null,
): boolean {
  return trigger.conditions.every((c) => checkCondition(c, ram, prevRam));
}

// ─── ROM Name Matching ────────────────────────────────────────────

function matchRom(profileRomName: string, actualRomName: string): boolean {
  // Exact match
  if (profileRomName === actualRomName) return true;
  // Starts-with match (e.g., "Street Fighter" matches all SF variants)
  if (actualRomName.toLowerCase().startsWith(profileRomName.toLowerCase())) return true;
  // Contains match for short names
  if (profileRomName.length > 5 && actualRomName.toLowerCase().includes(profileRomName.toLowerCase())) return true;
  return false;
}

export function findProfile(
  romName: string,
  system: SystemCategory,
): GameProfile | null {
  return PROFILES.find(
    (p) => p.system === system && matchRom(p.romName, romName),
  ) ?? null;
}

export function getActiveTrigger(
  profile: GameProfile,
  ram: Uint8Array,
  prevRam: Uint8Array | null,
): MemoryTrigger | null {
  for (const trigger of profile.triggers) {
    if (checkTrigger(trigger, ram, prevRam)) {
      return trigger;
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
//  GAME PROFILES DATABASE
// ═══════════════════════════════════════════════════════════════════
//
// Add profiles below. Each profile maps a ROM to memory watches.
//
// HOW TO FIND ADDRESSES:
//   1. Use the Memory Explorer (coming soon) or a RAM viewer
//   2. Take a save state before the result screen
//   3. Advance to the result screen
//   4. Diff the save states to find changed addresses
//   5. The result value is typically a small integer (0=loss, 1=win, 2=draw)
//
// For now, known addresses are sourced from RetroAchievements.org,
// almarsguides.com Pro Action Replay databases, and community docs.
// ═══════════════════════════════════════════════════════════════════

const PROFILES: GameProfile[] = [
  // ─── SNES Games ──────────────────────────────────────────
  {
    romName: "Street Fighter",
    label: "Street Fighter II / Turbo / Super",
    system: "snes",
    pollIntervalMs: 300,   // Fast polling during fights (health changes rapidly)
    warmupMs: 15000,       // 15s: time to get past menus → char select → VS screen
    triggers: [
      {
        id: "p1_wins_round",
        label: "🥊 Player 1 Wins Round!",
        result: "win",
        conditions: [
          // P1 health > 0 (still alive) AND P2 health = 0 (KO'd)
          //
          // Addresses verified via Pro Action Replay codes (SF2 Turbo USA):
          //   P1 health:      0x7E0530  (PAR: 7E053063 = set to 99/176 mid-round)
          //   P1 max energy:  0x7E0636  (PAR: 7E0636B0 = 176 = full energy)
          //   P2 health:      0x7E0730  (P1 + 0x200, standard SF2 P2 offset)
          //   P1 hyper mode:  0x7E0517  (PAR: 7E051701)
          //   P2 hyper mode:  0x7E0717  (PAR: 7E071701)
          //   Timer:          0x7E18F3  (PAR: 7E18F399 = set to 99)
          //
          // In libretro buffer: offset = SNES_addr - 0x7E0000
          // Health range: 0-176 (0xB0 = full), 0 = KO
          { address: 0x0530, op: "gt", value: 0, size: 1 },
          { address: 0x0730, op: "eq", value: 0, size: 1 },
        ],
      },
      {
        id: "p1_loses_round",
        label: "💀 Player 1 KO'd! (P2 Wins Round)",
        result: "loss",
        conditions: [
          // P1 health = 0 (KO'd) AND P2 health > 0 (still alive)
          { address: 0x0530, op: "eq", value: 0, size: 1 },
          { address: 0x0730, op: "gt", value: 0, size: 1 },
        ],
      },
    ],
  },

  // ─── NES Games ───────────────────────────────────────────
  {
    romName: "Super Mario",
    label: "Super Mario Bros.",
    system: "nes",
    pollIntervalMs: 300,
    warmupMs: 5000,
    triggers: [
      {
        id: "level_complete",
        label: "Level Complete!",
        result: "win",
        conditions: [
          // Flagpole grab: $000E game state (0=title, 1=playing, 2=dying, 3=level complete)
          { address: 0x000E, op: "eq", value: 0x03, size: 1 },
        ],
      },
      {
        id: "player_died",
        label: "Player Died",
        result: "loss",
        conditions: [
          { address: 0x000E, op: "eq", value: 0x02, size: 1 },
        ],
      },
    ],
  },
  {
    romName: "Contra",
    label: "Contra",
    system: "nes",
    pollIntervalMs: 300,
    warmupMs: 5000,
    triggers: [
      {
        id: "player_died",
        label: "Player Died",
        result: "loss",
        conditions: [
          // Lives counter
          { address: 0x0032, op: "lt", value: 3, size: 1 },
        ],
      },
    ],
  },
  {
    romName: "Mega Man",
    label: "Mega Man (series)",
    system: "nes",
    pollIntervalMs: 300,
    warmupMs: 8000,
    triggers: [
      {
        id: "boss_defeated",
        label: "Boss Defeated!",
        result: "win",
        conditions: [
          // Game state transition on boss defeat
          { address: 0x0040, op: "changed", size: 1 },
        ],
      },
    ],
  },

  // ─── GB/GBC Games ────────────────────────────────────────
  {
    romName: "Pokémon",
    label: "Pokémon (series)",
    system: "gb",
    pollIntervalMs: 500,
    warmupMs: 8000,
    triggers: [
      {
        id: "battle_won",
        label: "Battle Won!",
        result: "win",
        conditions: [
          // Battle state transition (GB WRAM $C000-$DFFF)
          { address: 0xC000, op: "changed", size: 1 },
        ],
      },
    ],
  },
  {
    romName: "Tetris",
    label: "Tetris (Game Boy)",
    system: "gb",
    pollIntervalMs: 300,
    warmupMs: 5000,
    triggers: [
      {
        id: "game_over",
        label: "Game Over",
        result: "loss",
        conditions: [
          // Top-out detection: game over flag
          { address: 0xC0A0, op: "changed", size: 1 },
        ],
      },
    ],
  },

  // ─── GBA Games ───────────────────────────────────────────
  {
    romName: "Mario Kart",
    label: "Mario Kart (GBA)",
    system: "gba",
    pollIntervalMs: 300,
    warmupMs: 10000,
    triggers: [
      {
        id: "race_finished",
        label: "Race Finished!",
        result: "win",
        conditions: [
          // Race completion flag (GBA EWRAM $02000000-$0203FFFF)
          { address: 0x02000000, op: "changed", size: 1 },
        ],
      },
    ],
  },
];

/** Get all profiles for a given system */
export function getProfilesForSystem(system: SystemCategory): GameProfile[] {
  return PROFILES.filter((p) => p.system === system);
}

/** Check if a profile exists for a given ROM */
export function hasProfile(romName: string, system: SystemCategory): boolean {
  return findProfile(romName, system) !== null;
}
