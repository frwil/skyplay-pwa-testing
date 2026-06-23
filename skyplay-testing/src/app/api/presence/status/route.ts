import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * GET /api/presence/status?userIds=1,2,3
 * Get online status for a list of user IDs.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userIdsParam = searchParams.get("userIds");

    if (!userIdsParam) {
      return NextResponse.json({ error: "userIds requis (ex: ?userIds=1,2,3)" }, { status: 400 });
    }

    const userIds = userIdsParam.split(",").map((id) => parseInt(id.trim(), 10)).filter((n) => !isNaN(n));

    if (userIds.length === 0) {
      return NextResponse.json({ users: {} });
    }

    const db = await getDb();

    // Online = heartbeat within last 30 seconds
    const placeholders = userIds.map(() => "?").join(",");
    const rs = await db.execute({
      sql: `SELECT user_id, is_online, last_seen
            FROM presence
            WHERE user_id IN (${placeholders})`,
      args: userIds,
    });

    const users: Record<number, { isOnline: boolean; lastSeen: string | null }> = {};
    for (const id of userIds) {
      users[id] = { isOnline: false, lastSeen: null };
    }

    for (const row of rs.rows) {
      const userId = row.user_id as number;
      const online = row.is_online as number;
      const lastSeen = row.last_seen as string | null;

      // Check if heartbeat is still fresh (within 30 seconds)
      let isActuallyOnline = online === 1 && lastSeen !== null;
      if (isActuallyOnline && lastSeen) {
        const lastSeenTime = new Date(lastSeen).getTime();
        const now = Date.now();
        isActuallyOnline = (now - lastSeenTime) < 30000;
      }

      users[userId] = {
        isOnline: isActuallyOnline,
        lastSeen,
      };
    }

    return NextResponse.json({ users });
  } catch (error) {
    console.error("GET /api/presence/status error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}
