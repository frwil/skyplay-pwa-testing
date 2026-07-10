import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * GET /api/stats/session/[sessionId]
 *
 * Returns full session statistics: metadata, match-by-match breakdown
 * with round details, and points summary.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }

    const db = await getDb();

    // Fetch session
    const sessionRs = await db.execute({
      sql: "SELECT * FROM game_sessions WHERE session_id = ?",
      args: [sessionId],
    });
    if (sessionRs.rows.length === 0) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const session = sessionRs.rows[0] as Record<string, unknown>;

    // Fetch matches
    const matchesRs = await db.execute({
      sql: "SELECT * FROM game_matches WHERE session_id = ? ORDER BY match_number ASC",
      args: [sessionId],
    });
    const matches = matchesRs.rows as Record<string, unknown>[];

    // Fetch rounds
    const roundsRs = await db.execute({
      sql: "SELECT * FROM game_rounds WHERE session_id = ? ORDER BY match_number ASC, round_number ASC",
      args: [sessionId],
    });
    const rounds = roundsRs.rows as Record<string, unknown>[];

    // Group rounds by match, and parse the character-metadata JSON columns into arrays.
    const parseIds = (v: unknown): number[] | null => {
      if (typeof v !== "string" || v.length === 0) return null;
      try {
        const arr = JSON.parse(v);
        return Array.isArray(arr) ? arr.filter((n) => typeof n === "number") : null;
      } catch {
        return null;
      }
    };
    const matchesWithRounds = matches.map(m => ({
      ...m,
      p1Team: parseIds(m.p1_team),
      p2Team: parseIds(m.p2_team),
      p1SelectionOrder: parseIds(m.p1_selection_order),
      p2SelectionOrder: parseIds(m.p2_selection_order),
      p1GaugeMode: (m.p1_gauge_mode as string | null) ?? null,
      p2GaugeMode: (m.p2_gauge_mode as string | null) ?? null,
      rounds: rounds.filter(r => r.match_number === m.match_number),
    }));

    return NextResponse.json({
      session: {
        sessionId: session.session_id,
        mode: session.mode,
        system: session.system,
        rom: session.rom,
        totalMatches: session.total_matches,
        playerWins: session.player_wins,
        playerLosses: session.player_losses,
        playerPerfectKos: session.player_perfect_kos,
        pointsEarned: session.points_earned,
        startedAt: session.started_at,
        endedAt: session.ended_at,
      },
      matches: matchesWithRounds,
      rounds,
    });
  } catch (err) {
    console.error("[stats/session] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
