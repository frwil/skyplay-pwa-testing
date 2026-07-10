import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest } from "@/lib/auth";
import { getDb } from "@/lib/db";

async function getUserId(req: NextRequest): Promise<number | null> {
  const auth = await getAuthFromRequest(req);
  if (auth) return auth.userId;
  const isLocalDev = !process.env.NORTHFLANK_API_KEY && !process.env.VERCEL;
  if (isLocalDev) {
    const devUserId = parseInt(req.nextUrl.searchParams.get("devUserId") || "0", 10);
    if (devUserId) return devUserId;
  }
  return null;
}

/**
 * GET /api/duel/profiles?ids=1,2,3
 * Public duel profiles (username, avatar, country) for the given user ids — used to render
 * PlayerBadges in the end-of-match overlay once players have left the lobby. Auth required.
 */
export async function GET(req: NextRequest) {
  const caller = await getUserId(req);
  if (!caller) return NextResponse.json({ error: "Authentification requise" }, { status: 401 });

  const idsParam = req.nextUrl.searchParams.get("ids") || "";
  const ids = idsParam
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, 20);
  if (ids.length === 0) return NextResponse.json({ profiles: {} });

  const db = await getDb();
  const placeholders = ids.map(() => "?").join(", ");
  const rs = await db.execute({
    sql: `SELECT id, username, avatar_base64, country FROM users WHERE id IN (${placeholders})`,
    args: ids,
  });

  const profiles: Record<number, { username: string; avatar: string | null; country: string | null }> = {};
  for (const row of rs.rows) {
    profiles[Number(row.id)] = {
      username: (row.username as string) ?? "",
      avatar: (row.avatar_base64 as string) ?? null,
      country: (row.country as string) ?? null,
    };
  }
  return NextResponse.json({ profiles });
}
