import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAuthFromRequest } from "@/lib/auth";

async function getUserId(req: NextRequest, body?: Record<string, unknown>): Promise<{ userId: number } | null> {
  // devUserId param works in all environments (for testing with ?name=)
  const devUserId = (body?.devUserId as number) || parseInt(req.nextUrl.searchParams.get("devUserId") || "0", 10);
  if (devUserId) return { userId: devUserId };

  const isLocalDev = !process.env.NORTHFLANK_API_KEY;
  if (isLocalDev) return { userId: 0 }; // fallback

  const auth = await getAuthFromRequest(req);
  if (!auth) return null;
  return { userId: auth.userId };
}

/**
 * GET /api/duel/notifications
 * Poll for unread duel notifications.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getUserId(req);
    if (!user) {
      return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const since = parseInt(searchParams.get("since") || "0", 10) || 0;

    const db = await getDb();

    const rs = await db.execute({
      sql: `SELECT nn.id, nn.session_id, nn.from_user_id, nn.from_username,
                   nn.type, nn.challenge_id, nn.message, nn.read, nn.created_at
            FROM netplay_notifications nn
            WHERE nn.user_id = ? AND nn.read = 0 AND nn.id > ?
              AND nn.type LIKE 'duel_%'
            ORDER BY nn.id DESC
            LIMIT 20`,
      args: [user.userId, since],
    });

    const notifications = rs.rows.map((row) => ({
      id: row.id as number,
      duelChallengeId: row.session_id as number,
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
    console.error("GET /api/duel/notifications error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}

/**
 * POST /api/duel/notifications
 * Mark notifications as read.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const user = await getUserId(req, body);
    if (!user) {
      return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
    }

    const ids = body.ids as number[];
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "ids (number[]) requis" }, { status: 400 });
    }

    const db = await getDb();
    const placeholders = ids.map(() => "?").join(", ");
    await db.execute({
      sql: `UPDATE netplay_notifications SET read = 1 WHERE user_id = ? AND id IN (${placeholders})`,
      args: [user.userId, ...ids.map(Number)],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("POST /api/duel/notifications error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}
