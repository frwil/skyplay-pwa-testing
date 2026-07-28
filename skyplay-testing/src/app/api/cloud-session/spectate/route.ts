import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import { getDb } from "@/lib/db";
import { getHostUserId } from "../room-codes";

/**
 * GET /api/cloud-session/spectate?sessionId=xxx
 *
 * Returns a WebSocket URL + spectator JWT token so a logged-in user can
 * watch a live match as a spectator (read-only, no input allowed).
 *
 * The game-server verifies the spectator token with JWT_SECRET/AUTH_SECRET.
 */
export async function GET(req: NextRequest) {
  try {
    // ── Auth check ────────────────────────────────────────────
    const isLocalDev = !process.env.NORTHFLANK_API_KEY;
    if (!isLocalDev) {
      const { cookies } = await import("next/headers");
      const token = (await cookies()).get("auth_token")?.value;
      if (!token) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { jwtVerify } = await import("jose");
      const secret = new TextEncoder().encode(
        process.env.AUTH_SECRET || "dev-secret"
      );
      try {
        await jwtVerify(token, secret);
      } catch {
        return NextResponse.json(
          { error: "Invalid token" },
          { status: 401 }
        );
      }
    }

    // ── Session ID ────────────────────────────────────────────
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId");
    if (!sessionId) {
      return NextResponse.json(
        { error: "Missing sessionId query parameter" },
        { status: 400 }
      );
    }

    // ── Get username from DB (for display in spectator logs) ──
    let username = "Spectateur";
    try {
      const { getAuthFromRequest } = await import("@/lib/auth");
      const auth = await getAuthFromRequest(req);
      if (auth) {
        const db = await getDb();
        const rs = await db.execute({
          sql: "SELECT username FROM users WHERE id = ?",
          args: [auth.userId],
        });
        const row = rs.rows[0] as unknown as { username: string } | undefined;
        if (row) username = row.username;
      }
    } catch {
      // Non-fatal — use default display name
    }

    // ── Build WebSocket URL (same logic as cloud-session) ─────
    let wsUrl: string;

    if (
      process.env.NORTHFLANK_API_KEY &&
      process.env.NORTHFLANK_GAME_SERVICE_ID
    ) {
      // Production: the game-server runs on Northflank with a fixed domain
      // We use GAME_SERVER_PUBLIC_URL which should be set to the Northflank service URL
      const base = (process.env.GAME_SERVER_PUBLIC_URL || "")
        .replace(/^﻿/, "")
        .replace(/[\r\n]+/g, "")
        .trim();
      wsUrl = `${base}?sessionId=${sessionId}`;
    } else if (process.env.GAME_SERVER_PUBLIC_URL) {
      // Public tunnel (ngrok, localtunnel, cloudflared)
      const base = process.env.GAME_SERVER_PUBLIC_URL
        .replace(/^﻿/, "")
        .replace(/[\r\n]+/g, "")
        .trim();
      wsUrl = `${base}?sessionId=${sessionId}`;
    } else {
      // Development: local Docker
      const localHost = process.env.GAME_SERVER_HOST || "localhost";
      const localPort = process.env.GAME_SERVER_PORT || "8080";
      wsUrl = `ws://${localHost}:${localPort}?sessionId=${sessionId}`;
    }

    // ── Create spectator JWT (short-lived, 1h) ────────────────
    const secret = new TextEncoder().encode(
      process.env.JWT_SECRET ||
        process.env.AUTH_SECRET ||
        "dev-secret"
    );

    const spectatorToken = await new SignJWT({
      sub: username, // game-server uses 'sub' as user identifier
      username,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(secret);

    // ── Resolve host user ID (for gift receiver) ───────────
    const hostUserId = await getHostUserId(sessionId);

    return NextResponse.json({
      wsUrl,
      token: spectatorToken,
      username,
      hostUserId,
    });
  } catch (err) {
    console.error("[spectate] Error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
