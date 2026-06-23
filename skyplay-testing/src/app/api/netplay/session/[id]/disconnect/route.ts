import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAuthFromRequest } from "@/lib/auth";

/**
 * POST /api/netplay/session/[id]/disconnect
 * Called by the surviving player when WebRTC drops during a match.
 * Atomically declares the caller as winner.
 *
 * Race-condition safety: uses a conditional UPDATE that only succeeds
 * if the session is IN_PROGRESS and no winner has been set yet.
 * First caller wins; second gets 409.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthFromRequest(request);
    if (!auth) {
      return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
    }

    const { id } = await params;
    const sessionId = parseInt(id, 10);
    if (isNaN(sessionId)) {
      return NextResponse.json({ error: "ID de session invalide" }, { status: 400 });
    }

    const db = await getDb();

    // Verify caller is a participant
    const rs = await db.execute({
      sql: "SELECT player1_id, player2_id, status, winner_id FROM netplay_sessions WHERE id = ?",
      args: [sessionId],
    });

    if (rs.rows.length === 0) {
      return NextResponse.json({ error: "Session introuvable" }, { status: 404 });
    }

    const row = rs.rows[0];
    if (row.player1_id !== auth.userId && row.player2_id !== auth.userId) {
      return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
    }

    // Can only claim disconnect win if game was in progress
    if (row.status !== "IN_PROGRESS") {
      return NextResponse.json(
        { error: `La session n'est pas en cours (statut: ${row.status})` },
        { status: 400 },
      );
    }

    // Atomic update: only the first caller succeeds
    const result = await db.execute({
      sql: `UPDATE netplay_sessions
            SET status = 'FINISHED', winner_id = ?, result = 'disconnect', finished_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'IN_PROGRESS' AND winner_id IS NULL`,
      args: [auth.userId, sessionId],
    });

    if (result.rowsAffected === 0) {
      // Already claimed — check who won
      const check = await db.execute({
        sql: "SELECT winner_id FROM netplay_sessions WHERE id = ?",
        args: [sessionId],
      });
      if (check.rows.length > 0 && check.rows[0].winner_id === auth.userId) {
        return NextResponse.json({ winner: "me", already: true });
      }
      return NextResponse.json(
        { error: "Partie déjà terminée", winner: "other" },
        { status: 409 },
      );
    }

    // Insert disconnect-win notification for the winner
    await db.execute({
      sql: `INSERT INTO netplay_notifications (session_id, user_id, from_user_id, from_username, type, challenge_id, message)
            VALUES (?, ?, ?, '', 'disconnect_win', (SELECT challenge_id FROM netplay_sessions WHERE id = ?), ?)`,
      args: [
        sessionId,
        auth.userId,
        auth.userId,
        sessionId,
        "Vous avez gagné — l'adversaire s'est déconnecté.",
      ],
    });

    // Determine the loser and insert notification for them
    const loserId = row.player1_id === auth.userId ? row.player2_id : row.player1_id;
    if (loserId) {
      await db.execute({
        sql: `INSERT INTO netplay_notifications (session_id, user_id, from_user_id, from_username, type, challenge_id, message)
              VALUES (?, ?, ?, '', 'disconnect_loss', (SELECT challenge_id FROM netplay_sessions WHERE id = ?), ?)`,
        args: [
          sessionId,
          loserId as number,
          auth.userId,
          sessionId,
          "Vous avez perdu — vous vous êtes déconnecté.",
        ],
      });
    }

    return NextResponse.json({ winner: "me", sessionId });
  } catch (error) {
    console.error("POST /api/netplay/session/[id]/disconnect error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}
