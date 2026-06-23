import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAuthFromRequest } from "@/lib/auth";

/**
 * PUT /api/netplay/session/[id]/accept
 * Called by P2 to accept a targeted challenge (TARGETED → MATCHED).
 * Creates an accepted notification for the challenger (P1).
 */
export async function PUT(
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

    // Fetch session
    const rs = await db.execute({
      sql: `SELECT ns.*, u.username AS player1_username
            FROM netplay_sessions ns
            JOIN users u ON ns.player1_id = u.id
            WHERE ns.id = ?`,
      args: [sessionId],
    });

    if (rs.rows.length === 0) {
      return NextResponse.json({ error: "Session introuvable" }, { status: 404 });
    }

    const row = rs.rows[0];

    // Only player2 can accept
    if (row.player2_id !== auth.userId) {
      return NextResponse.json({ error: "Ce défi ne vous est pas destiné" }, { status: 403 });
    }

    // Only TARGETED sessions can be accepted
    if (row.status !== "TARGETED") {
      return NextResponse.json(
        { error: "Ce défi a déjà été traité" },
        { status: 400 },
      );
    }

    // Atomically update to MATCHED
    await db.execute({
      sql: `UPDATE netplay_sessions SET status = 'MATCHED', started_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'TARGETED'`,
      args: [sessionId],
    });

    // Fetch acceptor username
    const userRs = await db.execute({
      sql: "SELECT username FROM users WHERE id = ?",
      args: [auth.userId],
    });
    const acceptorUsername = userRs.rows.length > 0 ? (userRs.rows[0].username as string) : "L'adversaire";

    // Insert accepted notification for P1
    await db.execute({
      sql: `INSERT INTO netplay_notifications (session_id, user_id, from_user_id, from_username, type, challenge_id, message)
            VALUES (?, ?, ?, ?, 'accepted', ?, ?)`,
      args: [
        sessionId,
        row.player1_id,
        auth.userId,
        acceptorUsername,
        row.challenge_id as number,
        `${acceptorUsername} a accepté votre défi !`,
      ],
    });

    return NextResponse.json({
      success: true,
      session: {
        id: sessionId,
        challengeId: row.challenge_id,
        status: "MATCHED",
        player1Id: row.player1_id,
        player2Id: auth.userId,
        opponent: {
          id: row.player1_id as number,
          username: row.player1_username as string,
        },
      },
    });
  } catch (error) {
    console.error("PUT /api/netplay/session/[id]/accept error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}
