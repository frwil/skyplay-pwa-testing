import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAuthFromRequest } from "@/lib/auth";
import { setRoomCode, generateRoomCode } from "@/app/api/cloud-session/room-codes";

async function getUserId(req: NextRequest, body?: Record<string, unknown>): Promise<{ userId: number; username: string } | null> {
  const auth = await getAuthFromRequest(req);
  if (auth) return { userId: auth.userId, username: "" };
  const isLocalDev = !process.env.NORTHFLANK_API_KEY && !process.env.VERCEL;
  if (isLocalDev) {
    const devUserId = (body?.devUserId as number) || parseInt(req.nextUrl.searchParams.get("devUserId") || "0", 10);
    const devUsername = (body?.devUsername as string) || req.nextUrl.searchParams.get("devUsername") || "dev";
    if (devUserId) return { userId: devUserId, username: devUsername };
    return { userId: Math.abs(hash(devUsername || "anon")), username: devUsername || "anonymous" };
  }
  return null;
}
function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; } return Math.abs(h); }

/**
 * POST /api/duel/challenge/confirm-rules
 *
 * Confirm or decline the duel rules after both players have reached the rules_pending state.
 * When both players confirm, the cloud session is created and the match begins.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const user = await getUserId(req, body);
    if (!user) {
      return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
    }

    const challengeId = body.challengeId as number;
    const accept = body.accept as boolean;

    if (!challengeId || typeof challengeId !== "number") {
      return NextResponse.json({ error: "challengeId requis (nombre)" }, { status: 400 });
    }

    const db = await getDb();

    const rs = await db.execute({
      sql: "SELECT * FROM duel_challenges WHERE id = ?", args: [challengeId],
    });
    if (rs.rows.length === 0) {
      return NextResponse.json({ error: "Défi introuvable" }, { status: 404 });
    }

    const row = rs.rows[0];
    if (row.status !== "rules_pending") {
      return NextResponse.json({ error: "Ce défi n'est pas en attente de confirmation des règles" }, { status: 400 });
    }
    const isChallenger = row.challenger_id === user.userId;
    const isTarget = row.target_id === user.userId;
    if (!isChallenger && !isTarget) {
      return NextResponse.json({ error: "Vous n'êtes pas participant à ce défi" }, { status: 403 });
    }

    if (!accept) {
      // Player declined the rules — cancel the challenge entirely
      await db.execute({ sql: "UPDATE duel_challenges SET status = 'declined' WHERE id = ?", args: [challengeId] });
      await db.execute({ sql: "UPDATE duel_lobby SET status = 'waiting' WHERE user_id IN (?, ?)", args: [row.challenger_id, row.target_id] });

      const otherId = isChallenger ? row.target_id : row.challenger_id;
      // Notify the other player
      try { await db.execute("PRAGMA foreign_keys = OFF"); } catch {}
      try {
        await db.execute({
          sql: `INSERT INTO netplay_notifications (session_id, user_id, from_user_id, type, challenge_id, message)
                VALUES (?, ?, ?, 'duel_declined', ?, ?)`,
          args: [challengeId, otherId, user.userId, challengeId, `Le duel a été annulé — les règles n'ont pas été acceptées.`],
        });
      } finally {
        try { await db.execute("PRAGMA foreign_keys = ON"); } catch {}
      }

      return NextResponse.json({ success: true, accepted: false });
    }

    // ── Accept: record confirmation for this player ──
    if (isChallenger) {
      await db.execute({ sql: "UPDATE duel_challenges SET challenger_rules_accepted = 1 WHERE id = ?", args: [challengeId] });
    } else {
      await db.execute({ sql: "UPDATE duel_challenges SET target_rules_accepted = 1 WHERE id = ?", args: [challengeId] });
    }

    // Check if both have accepted
    const checkRs = await db.execute({
      sql: "SELECT challenger_rules_accepted, target_rules_accepted, challenger_id, target_id, system, rom FROM duel_challenges WHERE id = ?",
      args: [challengeId],
    });
    const c = checkRs.rows[0];
    const bothAccepted = (c.challenger_rules_accepted as number) === 1 && (c.target_rules_accepted as number) === 1;

    if (!bothAccepted) {
      // Still waiting for the other player
      return NextResponse.json({ success: true, accepted: true, waiting: true });
    }

    // ── Both accepted: create the cloud session ──
    const sessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    let wsUrl: string;
    if (process.env.NORTHFLANK_API_KEY && process.env.NORTHFLANK_GAME_SERVICE_ID) {
      wsUrl = `wss://<northflank>?sessionId=${sessionId}`;
    } else if (process.env.GAME_SERVER_PUBLIC_URL) {
      const base = process.env.GAME_SERVER_PUBLIC_URL.replace(/^﻿/, "").replace(/[\r\n]+/g, "").trim();
      wsUrl = `${base}?sessionId=${sessionId}`;
    } else {
      const localHost = process.env.GAME_SERVER_HOST || "localhost";
      const localPort = process.env.GAME_SERVER_PORT || "8080";
      wsUrl = `ws://${localHost}:${localPort}?sessionId=${sessionId}`;
    }

    const roomCode = generateRoomCode();
    await setRoomCode(roomCode, sessionId);

    console.log("[confirm-rules] both accepted: challengeId=%d sessionId=%s roomCode=%s", challengeId, sessionId, roomCode);
    await db.execute({
      sql: `UPDATE duel_challenges SET status = 'accepted', session_id = ?, room_code = ?, ws_url = ? WHERE id = ?`,
      args: [sessionId, roomCode, wsUrl, challengeId],
    });
    await db.execute({ sql: "UPDATE duel_lobby SET status = 'in_game' WHERE user_id IN (?, ?)", args: [c.challenger_id, c.target_id] });

    // Notify both players that the duel is starting (so the one who confirmed first gets the session)
    try { await db.execute("PRAGMA foreign_keys = OFF"); } catch {}
    try {
      // Notify challenger (P1)
      await db.execute({
        sql: `INSERT INTO netplay_notifications (session_id, user_id, from_user_id, type, challenge_id, message)
              VALUES (?, ?, ?, 'duel_accepted', ?, ?)`,
        args: [challengeId, c.challenger_id, c.target_id, challengeId, "Les règles sont confirmées ! Le combat commence !"],
      });
      // Notify target (P2)
      await db.execute({
        sql: `INSERT INTO netplay_notifications (session_id, user_id, from_user_id, type, challenge_id, message)
              VALUES (?, ?, ?, 'duel_accepted', ?, ?)`,
        args: [challengeId, c.target_id, c.challenger_id, challengeId, "Les règles sont confirmées ! Le combat commence !"],
      });
    } finally {
      try { await db.execute("PRAGMA foreign_keys = ON"); } catch {}
    }

    return NextResponse.json({
      success: true, accepted: true, waiting: false,
      session: { sessionId, wsUrl, roomCode, player1Id: c.challenger_id as number, player2Id: c.target_id as number, challengeId },
    });
  } catch (error) {
    console.error("POST /api/duel/challenge/confirm-rules error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}
