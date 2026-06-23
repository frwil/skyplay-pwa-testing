import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAuthFromRequest } from "@/lib/auth";

/**
 * POST /api/netplay/session
 * Create a new netplay session or join an existing WAITING one.
 * Body: { challengeId: number }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthFromRequest(request);
    if (!auth) {
      return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
    }

    const { challengeId } = await request.json();
    if (!challengeId || typeof challengeId !== "number") {
      return NextResponse.json({ error: "challengeId requis (nombre)" }, { status: 400 });
    }

    const db = await getDb();

    // Verify user is a participant
    const partRs = await db.execute({
      sql: "SELECT id FROM challenge_participants WHERE challenge_id = ? AND user_id = ?",
      args: [challengeId, auth.userId],
    });
    if (partRs.rows.length === 0) {
      return NextResponse.json(
        { error: "Vous devez d'abord participer à ce challenge" },
        { status: 403 }
      );
    }

    // Look for an existing WAITING session (not created by this user)
    const waitingRs = await db.execute({
      sql: `SELECT ns.id, ns.player1_id, u.username AS player1_username
            FROM netplay_sessions ns
            JOIN users u ON ns.player1_id = u.id
            WHERE ns.challenge_id = ? AND ns.status = 'WAITING' AND ns.player1_id != ?
            LIMIT 1`,
      args: [challengeId, auth.userId],
    });

    if (waitingRs.rows.length > 0) {
      // Join existing session
      const session = waitingRs.rows[0];
      await db.execute({
        sql: "UPDATE netplay_sessions SET player2_id = ?, status = 'MATCHED', started_at = CURRENT_TIMESTAMP WHERE id = ?",
        args: [auth.userId, session.id],
      });

      return NextResponse.json({
        session: {
          id: session.id,
          challengeId,
          status: "MATCHED",
          player1Id: session.player1_id,
          player2Id: auth.userId,
          opponent: { id: session.player1_id as number, username: session.player1_username as string },
        },
      });
    }

    // Create a new WAITING session
    const insert = await db.execute({
      sql: "INSERT INTO netplay_sessions (challenge_id, player1_id, status) VALUES (?, ?, 'WAITING')",
      args: [challengeId, auth.userId],
    });

    return NextResponse.json({
      session: {
        id: Number(insert.lastInsertRowid),
        challengeId,
        status: "WAITING",
        player1Id: auth.userId,
        player2Id: null,
        opponent: null,
      },
    }, { status: 201 });
  } catch (error) {
    console.error("POST /api/netplay/session error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}

/**
 * GET /api/netplay/session?id=X or ?challengeId=X
 * Get session details or check for waiting sessions.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthFromRequest(request);
    if (!auth) {
      return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("id");
    const challengeIdParam = searchParams.get("challengeId");

    const db = await getDb();

    if (sessionId) {
      // Get specific session
      const rs = await db.execute({
        sql: `SELECT ns.*, u1.username AS player1_username, u2.username AS player2_username
              FROM netplay_sessions ns
              JOIN users u1 ON ns.player1_id = u1.id
              LEFT JOIN users u2 ON ns.player2_id = u2.id
              WHERE ns.id = ?`,
        args: [parseInt(sessionId, 10)],
      });

      if (rs.rows.length === 0) {
        return NextResponse.json({ error: "Session introuvable" }, { status: 404 });
      }

      const row = rs.rows[0];
      const isPlayer1 = row.player1_id === auth.userId;
      const isPlayer2 = row.player2_id === auth.userId;
      if (!isPlayer1 && !isPlayer2) {
        return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
      }

      const opponent = isPlayer1
        ? (row.player2_id ? { id: row.player2_id as number, username: row.player2_username as string } : null)
        : { id: row.player1_id as number, username: row.player1_username as string };

      return NextResponse.json({
        session: {
          id: row.id,
          challengeId: row.challenge_id,
          status: row.status,
          player1Id: row.player1_id,
          player2Id: row.player2_id,
          opponent,
          startedAt: row.started_at,
        },
      });
    }

    if (challengeIdParam) {
      // Check for WAITING sessions for this challenge (matchmaking poll)
      const rs = await db.execute({
        sql: `SELECT ns.id, ns.player1_id, u.username AS player1_username
              FROM netplay_sessions ns
              JOIN users u ON ns.player1_id = u.id
              WHERE ns.challenge_id = ? AND ns.status = 'WAITING' AND ns.player1_id != ?
              ORDER BY ns.created_at ASC
              LIMIT 1`,
        args: [parseInt(challengeIdParam, 10), auth.userId],
      });

      if (rs.rows.length === 0) {
        return NextResponse.json({ session: null });
      }

      const row = rs.rows[0];
      return NextResponse.json({
        session: {
          id: row.id,
          player1Id: row.player1_id,
          opponent: { id: row.player1_id as number, username: row.player1_username as string },
        },
      });
    }

    return NextResponse.json({ error: "Paramètre id ou challengeId requis" }, { status: 400 });
  } catch (error) {
    console.error("GET /api/netplay/session error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}

/**
 * DELETE /api/netplay/session
 * Cancel a session.
 * Body: { sessionId: number }
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await getAuthFromRequest(request);
    if (!auth) {
      return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
    }

    const { sessionId } = await request.json();
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId requis" }, { status: 400 });
    }

    const db = await getDb();

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

    if (row.status === "IN_PROGRESS") {
      return NextResponse.json({ error: "Impossible d'annuler une session en cours" }, { status: 400 });
    }

    await db.execute({
      sql: "UPDATE netplay_sessions SET status = 'CANCELLED' WHERE id = ?",
      args: [sessionId],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/netplay/session error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}
