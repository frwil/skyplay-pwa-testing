import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureUser } from "@/lib/db";
import { getAuthFromRequest } from "@/lib/auth";
import { roomCodeToSession, generateRoomCode } from "@/app/api/cloud-session/room-codes";

async function getUserId(req: NextRequest, body?: Record<string, unknown>): Promise<{ userId: number; username: string } | null> {
  // Try JWT first (works in all environments — production AND local dev)
  const auth = await getAuthFromRequest(req);
  if (auth) return { userId: auth.userId, username: "" };

  // Fallback: dev mode only when NOT on Vercel AND no Northflank key
  const isLocalDev = !process.env.NORTHFLANK_API_KEY && !process.env.VERCEL;
  if (isLocalDev) {
    const devUserId = (body?.devUserId as number) || parseInt(req.nextUrl.searchParams.get("devUserId") || "0", 10);
    const devUsername = (body?.devUsername as string) || req.nextUrl.searchParams.get("devUsername") || "dev";
    if (devUserId) return { userId: devUserId, username: devUsername };
    return { userId: Math.abs(hash(devUsername || "anon")), username: devUsername || "anonymous" };
  }

  return null; // Not authenticated
}
function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; } return Math.abs(h); }

/**
 * POST /api/duel/rematch
 * Save previous match result and create a NEW duel session with the same two players.
 * Body: { challengeId, winnerId, loserId, p1Losses, p2Losses, player1Id, player2Id, sessionId?, system?, rom? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const user = await getUserId(req, body);
    if (!user) {
      return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
    }

    const challengeId = body.challengeId as number;
    const winnerId = body.winnerId as number;
    const loserId = body.loserId as number;
    const p1Losses = (body.p1Losses as number) ?? 0;
    const p2Losses = (body.p2Losses as number) ?? 0;
    const oldSessionId = body.sessionId as string | undefined;
    const player1Id = body.player1Id as number;
    const player2Id = body.player2Id as number;
    const system = (body.system as string) || "neogeo";
    const rom = (body.rom as string) || "kof98.zip";

    if (!challengeId || !winnerId || !loserId || !player1Id || !player2Id) {
      return NextResponse.json({ error: "challengeId, winnerId, loserId, player1Id, player2Id requis" }, { status: 400 });
    }

    const db = await getDb();
    const isLocalDev = !process.env.NORTHFLANK_API_KEY && !process.env.VERCEL;

    if (isLocalDev) {
      await ensureUser(user.userId, user.username);
    }

    // 1. Save old match result (if not already saved)
    const existingRs = await db.execute({
      sql: "SELECT id FROM duel_results WHERE challenge_id = ? LIMIT 1",
      args: [challengeId],
    });
    if (existingRs.rows.length === 0) {
      await db.execute({
        sql: `INSERT INTO duel_results (challenge_id, winner_id, loser_id, p1_losses, p2_losses, system, rom, session_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [challengeId, winnerId, loserId, p1Losses, p2Losses, system, rom, oldSessionId || null],
      });
    }

    // 2. Mark old challenge as completed
    await db.execute({
      sql: "UPDATE duel_challenges SET status = 'completed' WHERE id = ?",
      args: [challengeId],
    });

    // 3. Create NEW challenge (same players, same system/rom)
    const newChallengeRs = await db.execute({
      sql: `INSERT INTO duel_challenges (challenger_id, target_id, system, rom, status)
            VALUES (?, ?, ?, ?, 'accepted')`,
      args: [player1Id, player2Id, system, rom],
    });
    const newChallengeId = Number(newChallengeRs.lastInsertRowid);

    // 4. Create NEW cloud session
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

    // Update challenge with session info
    await db.execute({
      sql: `UPDATE duel_challenges SET session_id = ?, room_code = ?, ws_url = ? WHERE id = ?`,
      args: [sessionId, roomCode, wsUrl, newChallengeId],
    });

    // 5. Reset both players' lobby status to in_game
    await db.execute({
      sql: "UPDATE duel_lobby SET status = 'in_game' WHERE user_id IN (?, ?)",
      args: [player1Id, player2Id],
    });

    console.log(`[duel/rematch] New rematch session: challengeId=${newChallengeId} sessionId=${sessionId} roomCode=${roomCode}`);

    return NextResponse.json({
      success: true,
      newChallengeId,
      session: {
        sessionId,
        wsUrl,
        roomCode,
        player1Id,
        player2Id,
        challengeId: newChallengeId,
      },
    });
  } catch (error) {
    console.error("POST /api/duel/rematch error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}
