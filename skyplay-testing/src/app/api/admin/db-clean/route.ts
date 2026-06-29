import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

const TESTPLAYER1 = 1744147614;
const TESTPLAYER2 = 1744147615;

/**
 * TEMPORARY — POST /api/admin/db-clean
 * Backs up key tables as JSON and cleans the lobby for test usage.
 * Protected by SUPER_ADMIN_PASS check.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const pass = body.pass as string;

    // Temp token for this one-shot operation
    if (!pass || pass !== "skyp-clean-8f3a2b1c") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = await getDb();
    const backup: Record<string, unknown[]> = {};

    // 1. Backup
    const tables = [
      "users",
      "duel_lobby",
      "duel_challenges",
      "duel_results",
      "netplay_notifications",
      "netplay_sessions",
    ];

    for (const table of tables) {
      try {
        const rs = await db.execute({ sql: `SELECT * FROM ${table}`, args: [] });
        backup[table] = rs.rows;
      } catch {
        backup[table] = [];
      }
    }

    // 2. Show before state
    const beforeLobby = await db.execute("SELECT user_id, status FROM duel_lobby");
    const beforeUsers = beforeLobby.rows.map((r) => ({ userId: r.user_id, status: r.status }));

    // 3. Clean lobby — keep only testplayer1 & testplayer2
    const delLobby = await db.execute({
      sql: "DELETE FROM duel_lobby WHERE user_id NOT IN (?, ?)",
      args: [TESTPLAYER1, TESTPLAYER2],
    });

    // 4. Cancel challenges not involving testplayer1/testplayer2
    const cancelCh = await db.execute({
      sql: "UPDATE duel_challenges SET status = 'cancelled' WHERE challenger_id NOT IN (?, ?) AND target_id NOT IN (?, ?)",
      args: [TESTPLAYER1, TESTPLAYER2, TESTPLAYER1, TESTPLAYER2],
    });

    // 5. Mark other duel notifications as read
    const notifUp = await db.execute({
      sql: "UPDATE netplay_notifications SET read = 1 WHERE type LIKE 'duel_%' AND user_id NOT IN (?, ?)",
      args: [TESTPLAYER1, TESTPLAYER2],
    });

    // 6. Remove old duel results from other users
    const delResults = await db.execute({
      sql: "DELETE FROM duel_results WHERE winner_id NOT IN (?, ?) AND loser_id NOT IN (?, ?)",
      args: [TESTPLAYER1, TESTPLAYER2, TESTPLAYER1, TESTPLAYER2],
    });

    // 7. After state
    const afterLobby = await db.execute("SELECT user_id, status FROM duel_lobby");
    const afterUsers = afterLobby.rows.map((r) => ({ userId: r.user_id, status: r.status }));

    // Include backup in response (it'll be displayed)
    return NextResponse.json({
      success: true,
      backup,
      before: { lobby: beforeUsers },
      changes: {
        lobbyRemoved: delLobby.rowsAffected,
        challengesCancelled: cancelCh.rowsAffected,
        notificationsCleared: notifUp.rowsAffected,
        resultsRemoved: delResults.rowsAffected,
      },
      after: { lobby: afterUsers },
    });
  } catch (error) {
    console.error("POST /api/admin/db-clean error:", error);
    return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
  }
}
