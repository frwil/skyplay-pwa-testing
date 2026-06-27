import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureUser } from "@/lib/db";
import { getAuthFromRequest } from "@/lib/auth";

async function getUserId(req: NextRequest, body?: Record<string, unknown>): Promise<{ userId: number; username: string } | null> {
  const isLocalDev = !process.env.NORTHFLANK_API_KEY;
  if (isLocalDev) {
    const devUserId = (body?.devUserId as number) || parseInt(req.nextUrl.searchParams.get("devUserId") || "0", 10);
    const devUsername = (body?.devUsername as string) || req.nextUrl.searchParams.get("devUsername") || "dev";
    if (devUserId) return { userId: devUserId, username: devUsername };
    return { userId: Math.abs(hash(devUsername || "anon")), username: devUsername || "anonymous" };
  }
  const auth = await getAuthFromRequest(req);
  if (!auth) return null;
  return { userId: auth.userId, username: "" };
}
function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; } return Math.abs(h); }

/**
 * POST /api/duel/result
 * Save a duel match result and clean up the session.
 * Body: { challengeId, winnerId, loserId, p1Losses, p2Losses, sessionId }
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
    const sessionId = body.sessionId as string;

    if (!challengeId || !winnerId || !loserId) {
      return NextResponse.json({ error: "challengeId, winnerId, loserId requis" }, { status: 400 });
    }

    const db = await getDb();
    const isLocalDev = !process.env.NORTHFLANK_API_KEY;

    if (isLocalDev) {
      await ensureUser(user.userId, user.username);
    }

    // Get system/rom from the challenge
    const chRs = await db.execute({
      sql: "SELECT system, rom FROM duel_challenges WHERE id = ?",
      args: [challengeId],
    });
    const system = (chRs.rows[0]?.system as string) || "neogeo";
    const rom = (chRs.rows[0]?.rom as string) || "kof98.zip";

    // Check if result already saved (idempotent — both players may save on session close)
    const existingRs = await db.execute({
      sql: "SELECT id FROM duel_results WHERE challenge_id = ? LIMIT 1",
      args: [challengeId],
    });
    if (existingRs.rows.length > 0) {
      console.log(`[duel/result] Result already saved for challenge #${challengeId}, skipping insert`);
    } else {
      // Save result
      await db.execute({
        sql: `INSERT INTO duel_results (challenge_id, winner_id, loser_id, p1_losses, p2_losses, system, rom, session_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [challengeId, winnerId, loserId, p1Losses, p2Losses, system, rom, sessionId || null],
      });
    }

    // Mark challenge as completed
    await db.execute({
      sql: "UPDATE duel_challenges SET status = 'completed' WHERE id = ?",
      args: [challengeId],
    });

    // Reset both players' lobby status to waiting
    await db.execute({
      sql: "UPDATE duel_lobby SET status = 'waiting' WHERE user_id IN (?, ?)",
      args: [winnerId, loserId],
    });

    console.log(`[duel/result] Match saved. Challenge #${challengeId}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("POST /api/duel/result error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}
