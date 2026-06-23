import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAuthFromRequest } from "@/lib/auth";

/**
 * POST /api/netplay/signal
 * Send a WebRTC signal (offer, answer, ice_candidate, ready, start) to the peer.
 * Body: { sessionId, toUserId, type, payload }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthFromRequest(request);
    if (!auth) {
      return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
    }

    const { sessionId, toUserId, type, payload } = await request.json();

    if (!sessionId || !toUserId || !type || payload === undefined) {
      return NextResponse.json(
        { error: "sessionId, toUserId, type, et payload sont requis" },
        { status: 400 }
      );
    }

    const validTypes = ["offer", "answer", "ice_candidate", "ready", "start"];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { error: `Type invalide. Types valides : ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Verify user is part of this session
    const sessRs = await db.execute({
      sql: "SELECT player1_id, player2_id FROM netplay_sessions WHERE id = ?",
      args: [sessionId],
    });
    if (sessRs.rows.length === 0) {
      return NextResponse.json({ error: "Session introuvable" }, { status: 404 });
    }

    const sess = sessRs.rows[0];
    if (sess.player1_id !== auth.userId && sess.player2_id !== auth.userId) {
      return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
    }

    // Verify toUserId is the other player
    const expectedTo = sess.player1_id === auth.userId ? sess.player2_id : sess.player1_id;
    if (toUserId !== expectedTo) {
      return NextResponse.json({ error: "Destinataire invalide" }, { status: 400 });
    }

    await db.execute({
      sql: `INSERT INTO netplay_signals (session_id, from_user_id, to_user_id, type, payload)
            VALUES (?, ?, ?, ?, ?)`,
      args: [sessionId, auth.userId, toUserId, type, payload],
    });

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error("POST /api/netplay/signal error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}

/**
 * GET /api/netplay/signal?sessionId=X&since=Y
 * Poll for new signals from the peer since the given signal ID.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthFromRequest(request);
    if (!auth) {
      return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sessionId = parseInt(searchParams.get("sessionId") || "0", 10);
    const since = parseInt(searchParams.get("since") || "0", 10);

    if (!sessionId) {
      return NextResponse.json({ error: "sessionId requis" }, { status: 400 });
    }

    const db = await getDb();

    // Verify user is part of this session
    const sessRs = await db.execute({
      sql: "SELECT player1_id, player2_id FROM netplay_sessions WHERE id = ?",
      args: [sessionId],
    });
    if (sessRs.rows.length === 0) {
      return NextResponse.json({ error: "Session introuvable" }, { status: 404 });
    }
    const sess = sessRs.rows[0];
    if (sess.player1_id !== auth.userId && sess.player2_id !== auth.userId) {
      return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
    }

    // Fetch signals for this user, unconsumed, since the given ID
    const sigRs = await db.execute({
      sql: `SELECT id, from_user_id, type, payload, created_at
            FROM netplay_signals
            WHERE session_id = ? AND to_user_id = ? AND consumed = 0 AND id > ?
            ORDER BY id ASC`,
      args: [sessionId, auth.userId, since],
    });

    const signals = sigRs.rows.map((row) => ({
      id: row.id as number,
      fromUserId: row.from_user_id as number,
      type: row.type as string,
      payload: row.payload as string,
      createdAt: row.created_at as string,
    }));

    // Mark signals as consumed
    const signalIds = signals.map((s) => s.id);
    if (signalIds.length > 0) {
      await db.execute({
        sql: `UPDATE netplay_signals SET consumed = 1 WHERE id IN (${signalIds.map(() => "?").join(",")})`,
        args: signalIds,
      });
    }

    return NextResponse.json({ signals });
  } catch (error) {
    console.error("GET /api/netplay/signal error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}
