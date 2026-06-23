import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAuthFromRequest } from "@/lib/auth";

/**
 * POST /api/presence/heartbeat
 * Mark the current user as online.
 * Body (optional): { challengeId?: number, isOnline?: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthFromRequest(request);
    if (!auth) {
      return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
    }

    let challengeId: number | null = null;
    let isOnline = true;

    try {
      const body = await request.json();
      challengeId = body.challengeId ?? null;
      isOnline = body.isOnline ?? true;
    } catch {
      // Body is optional
    }

    const db = await getDb();

    await db.execute({
      sql: `INSERT INTO presence (user_id, is_online, last_seen, current_challenge_id)
            VALUES (?, ?, CURRENT_TIMESTAMP, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              is_online = excluded.is_online,
              last_seen = CURRENT_TIMESTAMP,
              current_challenge_id = COALESCE(excluded.current_challenge_id, presence.current_challenge_id)`,
      args: [auth.userId, isOnline ? 1 : 0, challengeId],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("POST /api/presence/heartbeat error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}
