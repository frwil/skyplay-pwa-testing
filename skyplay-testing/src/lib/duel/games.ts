import type { SystemType } from "@/lib/emulator/types";

/** Duel mode — determines HUD, stats collection, and winner detection. */
export type DuelMode = "fighting" | "versus";

export interface DuelGameDef {
  /** Stable slug used in URLs / filtering */
  id: string;
  /** Display label in the selector */
  label: string;
  /** Emulator system */
  system: SystemType;
  /** ROM filename (as stored in public/roms/) */
  rom: string;
  /**
   * Duel mode:
   * - "fighting" → round-based, KOF-style HUD, winner by KO
   * - "versus"   → simple head-to-head (Metal Slug, puzzle games, etc.)
   */
  mode: DuelMode;
  /** Game category for filtering (fighting, versus, sports, puzzle, etc.) */
  category?: string;
  /** Cover image URL (null = CSS gradient placeholder). */
  coverImage?: string | null;
  /** Short description (shown on game card). English fallback; prefer i18n. */
  description?: string;
  /** Player 1 keyboard controls reference */
  p1Controls: { label: string; keys: string }[];
  /** Player 2 keyboard controls reference */
  p2Controls: { label: string; keys: string }[];
}

/**
 * Available duel games.
 * A ROM MUST be explicitly registered here to appear in the selector.
 * This ensures keyboard mapping, HUD, and winner detection are configured
 * before a game is playable in duel mode.
 */
export const DUEL_GAMES: DuelGameDef[] = [
  {
    id: "kof98",
    label: "KOF '98",
    system: "neogeo",
    rom: "kof98.zip",
    mode: "fighting",
    category: "fighting",
    coverImage: "https://upload.wikimedia.org/wikipedia/en/1/18/The_King_of_Fighters_%2798_arcade_flyer.jpg",
    description: "The legendary Neo Geo fighting game. 3v3 team battles, advanced gauge system, and a roster of 38 iconic characters.",
    p1Controls: [
      { label: "ctrlMove", keys: "W A S D" },
      { label: "ctrlAPunch", keys: "Z" },
      { label: "ctrlBKick", keys: "X" },
      { label: "ctrlCStrongPunch", keys: "C" },
      { label: "ctrlDStrongKick", keys: "V" },
      { label: "ctrlCoin", keys: "Space" },
      { label: "ctrlStart", keys: "Enter" },
    ],
    p2Controls: [
      { label: "ctrlMove", keys: "↑ ↓ ← →" },
      { label: "ctrlAPunch", keys: "I" },
      { label: "ctrlBKick", keys: "O" },
      { label: "ctrlCStrongPunch", keys: "K" },
      { label: "ctrlDStrongKick", keys: "L" },
      { label: "ctrlCoin", keys: "Shift" },
      { label: "ctrlStart", keys: "Ctrl" },
    ],
  },
  {
    id: "kof2002",
    label: "KOF 2002",
    system: "neogeo",
    rom: "kof2002.zip",
    mode: "fighting",
    category: "fighting",
    coverImage: "https://upload.wikimedia.org/wikipedia/en/3/3b/The_King_of_Fighters_2002_arcade_flyer.jpg",
    description: "The ultimate KOF dream match. Refined 3v3 mechanics, massive character roster, and the fan-favorite MAX mode system.",
    p1Controls: [
      { label: "ctrlMove", keys: "W A S D" },
      { label: "ctrlAPunch", keys: "Z" },
      { label: "ctrlBKick", keys: "X" },
      { label: "ctrlCStrongPunch", keys: "C" },
      { label: "ctrlDStrongKick", keys: "V" },
      { label: "ctrlCoin", keys: "Space" },
      { label: "ctrlStart", keys: "Enter" },
    ],
    p2Controls: [
      { label: "ctrlMove", keys: "↑ ↓ ← →" },
      { label: "ctrlAPunch", keys: "I" },
      { label: "ctrlBKick", keys: "O" },
      { label: "ctrlCStrongPunch", keys: "K" },
      { label: "ctrlDStrongKick", keys: "L" },
      { label: "ctrlCoin", keys: "Shift" },
      { label: "ctrlStart", keys: "Ctrl" },
    ],
  },
  {
    id: "sf2",
    label: "Street Fighter 2",
    system: "snes",
    rom: "Street Fighter 5 (Hack).smc",
    mode: "fighting",
    category: "fighting",
    coverImage: "https://upload.wikimedia.org/wikipedia/en/1/1d/SF2_JPN_flyer.jpg",
    description: "The classic that defined the genre. Pick your world warrior and fight through 1v1 matches with unique special moves and combos.",
    p1Controls: [
      { label: "ctrlMove", keys: "W A S D" },
      { label: "ctrlLightPunch", keys: "Z" },
      { label: "ctrlMedPunch", keys: "X" },
      { label: "ctrlHeavyPunch", keys: "C" },
      { label: "ctrlLightKick", keys: "A" },
      { label: "ctrlMedKick", keys: "S" },
      { label: "ctrlHeavyKick", keys: "D" },
      { label: "ctrlStart", keys: "Enter" },
    ],
    p2Controls: [
      { label: "ctrlMove", keys: "↑ ↓ ← →" },
      { label: "ctrlLightPunch", keys: "I" },
      { label: "ctrlMedPunch", keys: "O" },
      { label: "ctrlHeavyPunch", keys: "K" },
      { label: "ctrlLightKick", keys: "J" },
      { label: "ctrlMedKick", keys: "L" },
      { label: "ctrlHeavyKick", keys: ";" },
      { label: "ctrlStart", keys: "Ctrl" },
    ],
  },
  {
    id: "sfa2",
    label: "Street Fighter Alpha 2",
    system: "snes",
    rom: "Street Fighter Alpha 2 (Europe).sfc",
    mode: "fighting",
    category: "fighting",
    coverImage: "https://upload.wikimedia.org/wikipedia/en/3/3f/Street_Fighter_Alpha_2_flyer.png",
    description: "The Alpha series on SNES. Expanded roster with custom combos, alpha counters, and a dramatic battle system.",
    p1Controls: [
      { label: "ctrlMove", keys: "W A S D" },
      { label: "ctrlLightPunch", keys: "Z" },
      { label: "ctrlMedPunch", keys: "X" },
      { label: "ctrlHeavyPunch", keys: "C" },
      { label: "ctrlLightKick", keys: "A" },
      { label: "ctrlMedKick", keys: "S" },
      { label: "ctrlHeavyKick", keys: "D" },
      { label: "ctrlStart", keys: "Enter" },
    ],
    p2Controls: [
      { label: "ctrlMove", keys: "↑ ↓ ← →" },
      { label: "ctrlLightPunch", keys: "I" },
      { label: "ctrlMedPunch", keys: "O" },
      { label: "ctrlHeavyPunch", keys: "K" },
      { label: "ctrlLightKick", keys: "J" },
      { label: "ctrlMedKick", keys: "L" },
      { label: "ctrlHeavyKick", keys: ";" },
      { label: "ctrlStart", keys: "Ctrl" },
    ],
  },
];

/** Resolve a game definition by its id. Returns the first game if id is unknown. */
export function getDuelGame(id: string): DuelGameDef {
  return DUEL_GAMES.find((g) => g.id === id) ?? DUEL_GAMES[0];
}
