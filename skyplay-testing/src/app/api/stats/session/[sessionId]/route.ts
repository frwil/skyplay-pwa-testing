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

    // Resolve player identities for nominative display (real names + avatars/flags instead of a
    // bare "P1"/"P2"). PvP duels: challenger = P1 (host/side 1), target = P2 (guest/side 2),
    // cross-referenced by session_id. CPU sessions have no duel row → players stay null and the
    // client shows the signed-in viewer as P1 with a CPU label for P2.
    type Ident = { id: number; username: string; avatar: string | null; country: string | null } | null;
    let p1: Ident = null;
    let p2: Ident = null;
    try {
      const chRs = await db.execute({
        sql: "SELECT challenger_id, target_id FROM duel_challenges WHERE session_id = ? ORDER BY id DESC LIMIT 1",
        args: [sessionId],
      });
      if (chRs.rows.length > 0) {
        const p1Id = Number(chRs.rows[0].challenger_id);
        const p2Id = Number(chRs.rows[0].target_id);
        const uRs = await db.execute({
          sql: "SELECT id, username, avatar_base64, country FROM users WHERE id IN (?, ?)",
          args: [p1Id, p2Id],
        });
        const byId = new Map<number, Ident>();
        for (const r of uRs.rows) {
          byId.set(Number(r.id), {
            id: Number(r.id),
            username: (r.username as string) ?? "",
            avatar: (r.avatar_base64 as string) ?? null,
            country: (r.country as string) ?? null,
          });
        }
        p1 = byId.get(p1Id) ?? null;
        p2 = byId.get(p2Id) ?? null;
      }
    } catch { /* no duel row — CPU session, players resolved client-side */ }

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
      players: { p1, p2 },
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
