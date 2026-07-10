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
    const devUsername = req.nextUrl.searchParams.get("devUsername") || "";
    if (devUsername) return Math.abs(hash(devUsername));
  }
  return null;
}
function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; } return Math.abs(h); }

/**
 * GET /api/duel/history
 * The caller's decisive duel results (as winner or loser), newest first. Built from
 * `duel_results` (game_sessions is only populated by the CPU-stats flow, so /stats/[id]
 * can't resolve a duel session — this is the reliable source). Each row is rendered from
 * the local player's perspective: `won`, KO score, perfect KOs, opponent name, date.
 */
export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
  }

  const db = await getDb();
  const rs = await db.execute({
    sql: `
      SELECT r.session_id, r.winner_id, r.loser_id, r.p1_losses, r.p2_losses,
             r.perfect_ko_count, r.system, r.rom, r.created_at,
             w.username AS winner_name, l.username AS loser_name,
             w.avatar_base64 AS winner_avatar, l.avatar_base64 AS loser_avatar,
             w.country AS winner_country, l.country AS loser_country
      FROM duel_results r
      LEFT JOIN users w ON w.id = r.winner_id
      LEFT JOIN users l ON l.id = r.loser_id
      WHERE r.winner_id = ? OR r.loser_id = ?
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 200
    `,
    args: [userId, userId],
  });

  const results = rs.rows.map((row) => {
    const winnerId = Number(row.winner_id);
    const won = winnerId === userId;
    return {
      sessionId: (row.session_id as string) ?? null,
      opponent: (won ? (row.loser_name as string) : (row.winner_name as string)) ?? "—",
      opponentAvatar: (won ? (row.loser_avatar as string) : (row.winner_avatar as string)) ?? null,
      opponentCountry: (won ? (row.loser_country as string) : (row.winner_country as string)) ?? null,
      won,
      p1Losses: Number(row.p1_losses ?? 0),
      p2Losses: Number(row.p2_losses ?? 0),
      perfectKoCount: Number(row.perfect_ko_count ?? 0),
      system: (row.system as string) ?? "neogeo",
      rom: (row.rom as string) ?? "kof98.zip",
      createdAt: (row.created_at as string) ?? null,
    };
  });

  // Aggregate wins/losses for a lightweight header summary.
  const wins = results.filter((r) => r.won).length;
  const losses = results.length - wins;

  return NextResponse.json({ results, summary: { total: results.length, wins, losses } });
}
