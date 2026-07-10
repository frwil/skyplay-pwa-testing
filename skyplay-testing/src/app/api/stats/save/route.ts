import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

interface RoundInput {
  loser: number;
  winner: number;
  koType: string;
  roundNumber: number;
  matchNumber: number;
}

interface MatchInput {
  winner: number;
  loser: number;
  p1Losses: number;
  p2Losses: number;
  matchNumber: number;
  totalRounds: number;
  perfectKos: number;
  p1Team?: number[];
  p2Team?: number[];
  p1SelectOrder?: number[];
  p2SelectOrder?: number[];
  p1Mode?: string;
  p2Mode?: string;
}

/**
 * POST /api/stats/save
 *
 * Receives accumulated game stats from the game server when a session ends.
 * Protected by STATS_API_TOKEN shared secret.
 */
export async function POST(req: NextRequest) {
  try {
    // Validate shared secret
    const auth = req.headers.get("authorization");
    const expectedToken = process.env.STATS_API_TOKEN || "dev";
    if (!auth || auth !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json() as {
      sessionId: string;
      mode: "cpu" | "pvp";
      system: string;
      rom: string;
      startedAt: number;
      endedAt: number;
      rounds: RoundInput[];
      matches: MatchInput[];
    };

    const { sessionId, mode, system, rom, startedAt, endedAt, rounds, matches } = body;

    if (!sessionId || !matches) {
      return NextResponse.json({ error: "Missing sessionId or matches" }, { status: 400 });
    }

    const db = await getDb();

    // Calculate stats for the session row
    const totalMatches = matches.length;
    // Player is always P1 from the stats perspective
    const playerWins = matches.filter(m => m.winner === 1).length;
    const playerLosses = matches.filter(m => m.winner === 2).length;
    const playerPerfectKos = rounds.filter(r => r.winner === 1 && r.koType === "perfect").length;

    // Get points config
    const pointsRs = await db.execute({
      sql: "SELECT win_points, perfect_ko_bonus FROM game_points_config WHERE system = ? AND rom = ?",
      args: [system, rom],
    });
    const config = pointsRs.rows[0] as unknown as { win_points: number; perfect_ko_bonus: number } | undefined;
    const winPoints = config?.win_points ?? 3;
    const perfectKoBonus = config?.perfect_ko_bonus ?? 1;
    const pointsEarned = (playerWins * winPoints) + (playerPerfectKos * perfectKoBonus);

    // Upsert game_sessions
    await db.execute({
      sql: `INSERT INTO game_sessions (session_id, system, rom, mode, total_matches, player_wins, player_losses, player_perfect_kos, points_earned, started_at, ended_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(?, 'unixepoch'), datetime(?, 'unixepoch'))
            ON CONFLICT(session_id) DO UPDATE SET
              total_matches = excluded.total_matches,
              player_wins = excluded.player_wins,
              player_losses = excluded.player_losses,
              player_perfect_kos = excluded.player_perfect_kos,
              points_earned = excluded.points_earned,
              ended_at = excluded.ended_at`,
      args: [sessionId, system, rom, mode, totalMatches, playerWins, playerLosses, playerPerfectKos, pointsEarned, Math.floor(startedAt / 1000), Math.floor(endedAt / 1000)],
    });

    // Insert rounds
    for (const r of rounds) {
      await db.execute({
        sql: "INSERT INTO game_rounds (session_id, match_number, round_number, loser, winner, ko_type) VALUES (?, ?, ?, ?, ?, ?)",
        args: [sessionId, r.matchNumber, r.roundNumber, r.loser, r.winner, r.koType],
      });
    }

    // Insert matches
    for (const m of matches) {
      await db.execute({
        sql: `INSERT INTO game_matches
                (session_id, match_number, winner, loser, p1_losses, p2_losses, perfect_ko_count,
                 p1_team, p2_team, p1_selection_order, p2_selection_order, p1_gauge_mode, p2_gauge_mode)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          sessionId, m.matchNumber, m.winner, m.loser, m.p1Losses, m.p2Losses, m.perfectKos,
          m.p1Team ? JSON.stringify(m.p1Team) : null,
          m.p2Team ? JSON.stringify(m.p2Team) : null,
          m.p1SelectOrder ? JSON.stringify(m.p1SelectOrder) : null,
          m.p2SelectOrder ? JSON.stringify(m.p2SelectOrder) : null,
          m.p1Mode ?? null,
          m.p2Mode ?? null,
        ],
      });
    }

    console.log(`[stats/save] Saved session ${sessionId}: ${totalMatches} matches, ${rounds.length} rounds, ${pointsEarned} pts`);

    return NextResponse.json({ success: true, pointsEarned });
  } catch (err) {
    console.error("[stats/save] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
