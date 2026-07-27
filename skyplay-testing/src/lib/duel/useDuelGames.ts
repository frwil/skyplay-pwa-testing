"use client";

import { useState, useEffect } from "react";
/** Duel mode — determines HUD, stats collection, and winner detection. */
export type DuelMode = "fighting" | "versus";

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
  mode: DuelMode;
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
    mode: entry.mode as DuelMode,
    entryFee: entry.entryFee,
    p1Controls,
    p2Controls,
    modes: entry.modes || [],
    category: entry.category ?? null,
    coverImage: entry.coverImage ?? null,
    description: entry.description ?? null,
  };
}

/** Minimal empty fallback — games are fetched from the DB-backed API. */

/**
 * Fetch enabled duel games from the DB-backed API.
 * Starts empty — games populate when the API responds.
 */
export function useDuelGames() {
  const [games, setGames] = useState<ResolvedDuelGame[]>([]);
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
        // API unreachable — stay empty, will retry on next navigation
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
