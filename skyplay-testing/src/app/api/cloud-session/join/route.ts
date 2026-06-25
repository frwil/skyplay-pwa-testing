import { NextRequest, NextResponse } from "next/server";
import { roomCodeToSession } from "../room-codes";

/**
 * POST /api/cloud-session/join
 *
 * Player 2 joins an existing cloud gaming session by room code.
 *
 * Body: { roomCode: string }
 * Returns: { sessionId: string, wsUrl: string, player: 2 }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { roomCode: string };
    const { roomCode } = body;

    if (!roomCode || typeof roomCode !== "string") {
      return NextResponse.json({ error: "Missing or invalid roomCode" }, { status: 400 });
    }

    const cleanCode = roomCode.toUpperCase().trim();
    const sessionId = roomCodeToSession.get(cleanCode);

    if (!sessionId) {
      return NextResponse.json({ error: "Room not found or session expired" }, { status: 404 });
    }

    // ── Determine WebSocket URL (same logic as session creation) ──
    let wsUrl: string;

    if (process.env.NORTHFLANK_API_KEY && process.env.NORTHFLANK_GAME_SERVICE_ID) {
      // Production: Northflank
      wsUrl = `wss://<northflank-container>?sessionId=${sessionId}`;
    } else if (process.env.GAME_SERVER_PUBLIC_URL) {
      // Public tunnel (cloudflared, ngrok, localtunnel)
      const base = process.env.GAME_SERVER_PUBLIC_URL
        .replace(/^﻿/, "")
        .replace(/[\r\n]+/g, "")
        .trim();
      wsUrl = `${base}?sessionId=${sessionId}`;
    } else {
      // Local dev
      const localHost = process.env.GAME_SERVER_HOST || "localhost";
      const localPort = process.env.GAME_SERVER_PORT || "8080";
      wsUrl = `ws://${localHost}:${localPort}?sessionId=${sessionId}`;
    }

    return NextResponse.json({ sessionId, wsUrl, player: 2 });
  } catch (err) {
    console.error("[cloud-session:join] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
