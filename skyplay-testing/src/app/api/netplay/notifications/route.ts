import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAuthFromRequest } from "@/lib/auth";

/**
 * GET /api/netplay/notifications
 * Returns unread notifications for the authenticated user.
 * Query: ?since=N — only notifications with id > N (for incremental poll).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthFromRequest(request);
    if (!auth) {
      return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const since = parseInt(searchParams.get("since") || "0", 10) || 0;

    const db = await getDb();

    const rs = await db.execute({
      sql: `SELECT nn.id, nn.session_id, nn.from_user_id, nn.from_username,
                   nn.type, nn.challenge_id, nn.message, nn.read, nn.created_at
            FROM netplay_notifications nn
            WHERE nn.user_id = ? AND nn.read = 0 AND nn.id > ?
            ORDER BY nn.id DESC
            LIMIT 20`,
      args: [auth.userId, since],
    });

    const notifications = rs.rows.map((row) => ({
      id: row.id as number,
      sessionId: row.session_id as number,
      fromUserId: row.from_user_id as number,
      fromUsername: (row.from_username as string) || "",
      type: row.type as string,
      challengeId: row.challenge_id as number | null,
      message: (row.message as string) || "",
      read: (row.read as number) === 1,
      createdAt: row.created_at as string,
    }));

    return NextResponse.json({ notifications });
  } catch (error) {
    console.error("GET /api/netplay/notifications error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}

/**
 * POST /api/netplay/notifications
 * Mark notifications as read.
 * Body: { ids: number[] }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthFromRequest(request);
    if (!auth) {
      return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
    }

    const { ids } = await request.json();
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "ids (number[]) requis" }, { status: 400 });
    }

    const db = await getDb();

    // Build IN clause with placeholders
    const placeholders = ids.map(() => "?").join(", ");
    await db.execute({
      sql: `UPDATE netplay_notifications SET read = 1 WHERE user_id = ? AND id IN (${placeholders})`,
      args: [auth.userId, ...ids.map(Number)],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("POST /api/netplay/notifications error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}
