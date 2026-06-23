import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAuthFromRequest } from "@/lib/auth";

/**
 * POST /api/netplay/session/[id]/start
 * Called by either player when the countdown finishes and game enters "playing".
 * Sets session status to IN_PROGRESS so the server knows the match is active.
 * Idempotent — safe to call from both peers.
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
      sql: "SELECT player1_id, player2_id, status FROM netplay_sessions WHERE id = ?",
      args: [sessionId],
    });

    if (rs.rows.length === 0) {
      return NextResponse.json({ error: "Session introuvable" }, { status: 404 });
    }

    const row = rs.rows[0];
    if (row.player1_id !== auth.userId && row.player2_id !== auth.userId) {
      return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
    }

    // Idempotent: only transition from MATCHED → IN_PROGRESS
    if (row.status === "IN_PROGRESS") {
      return NextResponse.json({ success: true, already: true });
    }

    if (row.status !== "MATCHED") {
      return NextResponse.json(
        { error: `La session n'est pas en état MATCHED (actuel: ${row.status})` },
        { status: 400 },
      );
    }

    await db.execute({
      sql: `UPDATE netplay_sessions SET status = 'IN_PROGRESS', started_at = COALESCE(started_at, CURRENT_TIMESTAMP) WHERE id = ? AND status = 'MATCHED'`,
      args: [sessionId],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("POST /api/netplay/session/[id]/start error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}
