import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAuthFromRequest } from "@/lib/auth";

/**
 * PUT /api/netplay/session/[id]/decline
 * Called by P2 to decline a targeted challenge (TARGETED → DECLINED).
 * Creates a declined notification for the challenger (P1).
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
      sql: "SELECT player1_id, player2_id, status, challenge_id FROM netplay_sessions WHERE id = ?",
      args: [sessionId],
    });

    if (rs.rows.length === 0) {
      return NextResponse.json({ error: "Session introuvable" }, { status: 404 });
    }

    const row = rs.rows[0];

    // Only player2 can decline
    if (row.player2_id !== auth.userId) {
      return NextResponse.json({ error: "Ce défi ne vous est pas destiné" }, { status: 403 });
    }

    // Only TARGETED sessions can be declined
    if (row.status !== "TARGETED") {
      return NextResponse.json(
        { error: "Ce défi a déjà été traité" },
        { status: 400 },
      );
    }

    // Atomically update to DECLINED
    await db.execute({
      sql: `UPDATE netplay_sessions SET status = 'DECLINED', finished_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'TARGETED'`,
      args: [sessionId],
    });

    // Fetch decliner username
    const userRs = await db.execute({
      sql: "SELECT username FROM users WHERE id = ?",
      args: [auth.userId],
    });
    const declinerUsername = userRs.rows.length > 0 ? (userRs.rows[0].username as string) : "L'adversaire";

    // Insert declined notification for P1
    await db.execute({
      sql: `INSERT INTO netplay_notifications (session_id, user_id, from_user_id, from_username, type, challenge_id, message)
            VALUES (?, ?, ?, ?, 'declined', ?, ?)`,
      args: [
        sessionId,
        row.player1_id as number,
        auth.userId,
        declinerUsername,
        row.challenge_id as number,
        `${declinerUsername} a refusé votre défi.`,
      ],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("PUT /api/netplay/session/[id]/decline error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}
