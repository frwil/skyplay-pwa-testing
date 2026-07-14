"use client";

import { useState, useEffect } from "react";
import { DUEL_GAMES, type DuelGameDef } from "./games";

interface DuelGameControl {
  player: number;
  actionKey: string;
  labelKey: string;
  defaultKeys: string;
}

interface DuelGameModeRules {
  victoryRule: string;
  drawRule: string;
  debitRule: string;
  disputeRule: string;
}

interface DuelGameMode {
  id: string;
  modeKey: string;
  label: string;
  matchCount: number;
  entryFee: number;
  rules: Record<string, DuelGameModeRules> | null;
}

interface DuelGameEntry {
  id: string;
  label: string;
  system: string;
  rom: string;
  mode: string;
  entryFee: number;
  enabled: boolean;
  controls: DuelGameControl[];
  modes: DuelGameMode[];
  category?: string | null;
  coverImage?: string | null;
  description?: string | null;
}

export interface ResolvedDuelGame {
  id: string;
  label: string;
  system: string;
  rom: string;
  mode: DuelGameDef["mode"];
  entryFee: number;
  p1Controls: { label: string; keys: string }[];
  p2Controls: { label: string; keys: string }[];
  modes: DuelGameMode[];
  category: string | null;
  coverImage: string | null;
  description: string | null;
}

function apiEntryToGame(entry: DuelGameEntry): ResolvedDuelGame {
  const p1Controls = entry.controls
    .filter((c) => c.player === 1)
    .map((c) => ({ label: c.labelKey, keys: c.defaultKeys }));
  const p2Controls = entry.controls
    .filter((c) => c.player === 2)
    .map((c) => ({ label: c.labelKey, keys: c.defaultKeys }));
  return {
    id: entry.id,
    label: entry.label,
    system: entry.system,
    rom: entry.rom,
    mode: entry.mode as DuelGameDef["mode"],
    entryFee: entry.entryFee,
    p1Controls,
    p2Controls,
    modes: entry.modes || [],
    category: entry.category ?? null,
    coverImage: entry.coverImage ?? null,
    description: entry.description ?? null,
  };
}

/** Fallback: use the static config from games.ts when the API is unreachable. */
function fallbackGames(): ResolvedDuelGame[] {
  return DUEL_GAMES.map((g) => ({
    id: g.id,
    label: g.label,
    system: g.system,
    rom: g.rom,
    mode: g.mode,
    entryFee: 1000,
    p1Controls: g.p1Controls,
    p2Controls: g.p2Controls,
    category: g.category ?? null,
    coverImage: g.coverImage ?? null,
    description: g.description ?? null,
    modes: [
      { id: `${g.id}_standard`, modeKey: "standard", label: `${g.label} — Standard`, matchCount: 1, entryFee: 1000, rules: null },
      { id: `${g.id}_xl`, modeKey: "xl", label: `${g.label} — XL`, matchCount: 3, entryFee: 2500, rules: null },
      { id: `${g.id}_fighter`, modeKey: "fighter", label: `${g.label} — Fighter`, matchCount: 5, entryFee: 4000, rules: null },
    ],
  }));
}

/**
 * Fetch enabled duel games from the API.
 * Falls back to the static DUEL_GAMES config if the API fails.
 */
export function useDuelGames() {
  const [games, setGames] = useState<ResolvedDuelGame[]>(fallbackGames);
  const [loading, setLoading] = useState(true);
  const [entryFee, setEntryFee] = useState(1000);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/duel/games")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.games?.length > 0) {
          const resolved = (data.games as DuelGameEntry[]).map(apiEntryToGame);
          setGames(resolved);
          // Use the entry fee from the first game (or default)
          if (resolved.length > 0) setEntryFee(resolved[0].entryFee);
        }
      })
      .catch(() => {
        // API down — keep fallback
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  /** Get entry fee for a specific game by id (defaults to the standard mode fee). */
  const getEntryFee = (gameId: string): number => {
    const g = games.find((g) => g.id === gameId);
    return g?.entryFee ?? entryFee;
  };

  /** Get entry fee for a specific mode by mode id. */
  const getModeEntryFee = (modeId: string): number => {
    for (const g of games) {
      const m = g.modes.find((m) => m.id === modeId);
      if (m) return m.entryFee;
    }
    return entryFee; // fallback to default
  };

  /** Get the full mode object by mode id. */
  const getMode = (modeId: string): DuelGameMode | undefined => {
    for (const g of games) {
      const m = g.modes.find((m) => m.id === modeId);
      if (m) return m;
    }
    return undefined;
  };

  return { games, loading, getEntryFee, getModeEntryFee, getMode };
}
