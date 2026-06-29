import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureUser } from "@/lib/db";
import { getAuthFromRequest } from "@/lib/auth";
import { roomCodeToSession, generateRoomCode } from "@/app/api/cloud-session/room-codes";

async function getUserId(req: NextRequest, body?: Record<string, unknown>): Promise<{ userId: number; username: string } | null> {
  // devUserId/devUsername params work in all environments (for testing with ?name=)
  const devUserId = (body?.devUserId as number) || parseInt(req.nextUrl.searchParams.get("devUserId") || "0", 10);
  const devUsername = (body?.devUsername as string) || req.nextUrl.searchParams.get("devUsername") || "";
  if (devUserId && devUsername) return { userId: devUserId, username: devUsername };

  const isLocalDev = !process.env.NORTHFLANK_API_KEY;
  if (isLocalDev) {
    return { userId: Math.abs(hash(devUsername || "anon")), username: devUsername || "anonymous" };
  }
  const auth = await getAuthFromRequest(req);
  if (!auth) return null;
  return { userId: auth.userId, username: "" };
}
function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; } return Math.abs(h); }

async function getDisplayName(db: Awaited<ReturnType<typeof getDb>>, userId: number, _isLocalDev: boolean): Promise<string> {
  // Always fetch from users table (ensureUser creates dev users too)
  const rs = await db.execute({ sql: "SELECT username FROM users WHERE id = ?", args: [userId] });
  return rs.rows.length > 0 ? (rs.rows[0].username as string) : `Player-${userId}`;
}

/**
 * POST /api/duel/challenge/respond
 * Accept or decline a duel challenge.
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
    const isLocalDev = !process.env.NORTHFLANK_API_KEY;

    // Ensure dev users exist (FK constraint against users table)
    if (isLocalDev) {
      await ensureUser(user.userId, user.username);
    }

    const rs = await db.execute({
      sql: "SELECT * FROM duel_challenges WHERE id = ?", args: [challengeId],
    });
    if (rs.rows.length === 0) {
      return NextResponse.json({ error: "Défi introuvable" }, { status: 404 });
    }

    const row = rs.rows[0];
    if (row.target_id !== user.userId) {
      return NextResponse.json({ error: "Ce défi ne vous est pas destiné" }, { status: 403 });
    }
    if (row.status !== "pending") {
      return NextResponse.json({ error: "Ce défi a déjà été traité" }, { status: 400 });
    }

    if (!accept) {
      try { await db.execute({ sql: "UPDATE duel_challenges SET status = 'declined' WHERE id = ?", args: [challengeId] }); }
      catch (e) { console.error("[respond] ❌ UPDATE duel_challenges (decline):", e); throw e; }
      try { await db.execute({ sql: "UPDATE duel_lobby SET status = 'waiting' WHERE user_id IN (?, ?)", args: [row.challenger_id, row.target_id] }); }
      catch (e) { console.error("[respond] ❌ UPDATE duel_lobby (decline):", e); throw e; }
      const declinerName = await getDisplayName(db, user.userId, isLocalDev);
      try { await db.execute("PRAGMA foreign_keys = OFF"); } catch (e) { console.error("[respond] ❌ PRAGMA OFF (decline):", e); throw e; }
      try {
        await db.execute({
          sql: `INSERT INTO netplay_notifications (session_id, user_id, from_user_id, from_username, type, challenge_id, message)
                VALUES (?, ?, ?, ?, 'duel_declined', ?, ?)`,
          args: [challengeId, row.challenger_id, user.userId, declinerName, challengeId,
            `${declinerName} a refusé votre défi.`],
        });
      } catch (e) { console.error("[respond] ❌ INSERT notification (decline):", e); throw e; }
      finally {
        try { await db.execute("PRAGMA foreign_keys = ON"); } catch (e) { console.error("[respond] ❌ PRAGMA ON (decline):", e); }
      }
      return NextResponse.json({ success: true, accepted: false });
    }

    // ── Accept: Create cloud session ──────────────────────────
    const system = (row.system as string) || "neogeo";
    const rom = (row.rom as string) || "kof98.zip";
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
    roomCodeToSession.set(roomCode, sessionId);

    console.log("[respond] accept: challengeId=%d sessionId=%s roomCode=%s wsUrl=%s", challengeId, sessionId, roomCode, wsUrl);
    try { await db.execute({ sql: `UPDATE duel_challenges SET status = 'accepted', session_id = ?, room_code = ?, ws_url = ? WHERE id = ?`, args: [sessionId, roomCode, wsUrl, challengeId] }); }
    catch (e) { console.error("[respond] ❌ UPDATE duel_challenges (accept):", e); throw e; }
    try { await db.execute({ sql: "UPDATE duel_lobby SET status = 'in_game' WHERE user_id IN (?, ?)", args: [row.challenger_id, row.target_id] }); }
    catch (e) { console.error("[respond] ❌ UPDATE duel_lobby (accept):", e); throw e; }

    const acceptorName = await getDisplayName(db, user.userId, isLocalDev);
    try { await db.execute("PRAGMA foreign_keys = OFF"); } catch (e) { console.error("[respond] ❌ PRAGMA OFF (accept):", e); throw e; }
    try {
      await db.execute({
        sql: `INSERT INTO netplay_notifications (session_id, user_id, from_user_id, from_username, type, challenge_id, message)
              VALUES (?, ?, ?, ?, 'duel_accepted', ?, ?)`,
        args: [challengeId, row.challenger_id, user.userId, acceptorName, challengeId,
          `${acceptorName} a accepté votre défi ! Le combat commence !`],
      });
    } catch (e) { console.error("[respond] ❌ INSERT notification (accept):", e); throw e; }
    finally {
      try { await db.execute("PRAGMA foreign_keys = ON"); } catch (e) { console.error("[respond] ❌ PRAGMA ON (accept):", e); }
    }

    return NextResponse.json({
      success: true, accepted: true,
      session: { sessionId, wsUrl, roomCode, player1Id: row.challenger_id, player2Id: user.userId, challengeId },
    });
  } catch (error) {
    console.error("POST /api/duel/challenge/respond error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}
