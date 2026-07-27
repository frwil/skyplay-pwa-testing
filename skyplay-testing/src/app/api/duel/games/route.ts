import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export interface DuelGameControl {
  player: number;
  actionKey: string;
  labelKey: string;
  defaultKeys: string;
}

export interface DuelGameModeRules {
  victoryRule: string;
  drawRule: string;
  debitRule: string;
  disputeRule: string;
}

export interface DuelGameMode {
  id: string;
  modeKey: string;
  label: string;
  matchCount: number;
  entryFee: number;
  winnerShare: number | null;
  rules: Record<string, DuelGameModeRules> | null;
}

export interface DuelGameEntry {
  id: string;
  label: string;
  system: string;
  rom: string;
  mode: string;
  entryFee: number;
  winnerShare: number | null;
  ramConfig: Record<string, unknown> | null;
  enabled: boolean;
  controls: DuelGameControl[];
  modes: DuelGameMode[];
  category: string | null;
  coverImage: string | null;
  description: string | null;
}

/**
 * GET /api/duel/games
 *
 * Returns the list of enabled duel games with their control mappings.
 * Prefers the *active version* from duel_game_config_versions (is_active=1);
 * falls back to duel_games.ram_config + duel_game_controls for games without a
 * version snapshot yet.
 *
 * No auth required — public information.
 */
export async function GET() {
  try {
    const db = await getDb();

    const gamesRs = await db.execute(
      "SELECT id, label, system, rom, mode, entry_fee, winner_share, ram_config, enabled, category, cover_image, description FROM duel_games WHERE enabled = 1 ORDER BY id"
    );

    const games: DuelGameEntry[] = [];

    for (const row of gamesRs.rows) {
      const gameId = row.id as string;

      // ── Prefer the active config version snapshot ──
      const activeVersionRs = await db.execute({
        sql: "SELECT ram_config, controls FROM duel_game_config_versions WHERE game_id = ? AND is_active = 1 LIMIT 1",
        args: [gameId],
      });

      let ramConfig: Record<string, unknown> | null = null;
      let controls: DuelGameControl[] = [];

      if (activeVersionRs.rows.length > 0) {
        const v = activeVersionRs.rows[0];
        // Parse ram_config from the active version
        try { ramConfig = JSON.parse((v.ram_config as string) ?? "null"); } catch { ramConfig = null; }
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
        try { ramConfig = JSON.parse((row.ram_config as string) ?? "null"); } catch { ramConfig = null; }

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

      // ── Fetch modes for this game ──
      const modesRs = await db.execute({
        sql: "SELECT id, mode_key, label, match_count, entry_fee, winner_share, rules FROM duel_game_modes WHERE game_id = ? AND enabled = 1 ORDER BY match_count",
        args: [gameId],
      });
      const modes: DuelGameMode[] = modesRs.rows.map((m) => {
        let rules: Record<string, DuelGameModeRules> | null = null;
        try { rules = JSON.parse((m.rules as string) ?? "null"); } catch { rules = null; }
        return {
          id: m.id as string,
          modeKey: m.mode_key as string,
          label: m.label as string,
          matchCount: m.match_count as number,
          entryFee: m.entry_fee as number,
          winnerShare: m.winner_share != null ? Number(m.winner_share) : null,
          rules,
        };
      });

      games.push({
        id: gameId,
        label: row.label as string,
        system: row.system as string,
        rom: row.rom as string,
        mode: row.mode as string,
        entryFee: row.entry_fee as number,
        winnerShare: row.winner_share != null ? Number(row.winner_share) : null,
        ramConfig,
        enabled: (row.enabled as number) === 1,
        controls,
        modes,
        category: (row.category as string) ?? null,
        coverImage: (row.cover_image as string) ?? null,
        description: (row.description as string) ?? null,
      });
    }

    return NextResponse.json({ games });
  } catch (error) {
    console.error("GET /api/duel/games error:", error);
    return NextResponse.json({ games: [] });
  }
}
