import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureUser } from "@/lib/db";
import { getAuthFromRequest } from "@/lib/auth";
import { payoutWinner, type PlayerBalance } from "@/lib/duel/wallet";

/** Serialize balances for JSON: Infinity (admin) → null, flagged by `unlimited`. */
function serializeBalances(balances: Record<number, PlayerBalance>) {
  const out: Record<number, { after: number | null; sessionDelta: number; unlimited: boolean }> = {};
  for (const [id, b] of Object.entries(balances)) {
    out[Number(id)] = { after: b.unlimited ? null : b.after, sessionDelta: b.sessionDelta, unlimited: b.unlimited };
  }
  return out;
}

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
    const winnerId = (body.winnerId as number) || 0;
    const loserId = (body.loserId as number) || 0;
    const p1Losses = (body.p1Losses as number) ?? 0;
    const p2Losses = (body.p2Losses as number) ?? 0;
    const perfectKoCount = (body.perfectKoCount as number) ?? 0;
    const sessionId = body.sessionId as string | undefined;
    // Draw / manual stop: winnerId or loserId is 0 (no decisive win/loss).
    const isDraw = winnerId === 0 || loserId === 0;

    if (!challengeId) {
      return NextResponse.json({ error: "challengeId requis" }, { status: 400 });
    }

    const db = await getDb();
    const isLocalDev = !process.env.NORTHFLANK_API_KEY && !process.env.VERCEL;

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

    // Record a win/loss row only for a decisive match (real winner + loser). A draw or a
    // manual stop (winnerId/loserId = 0) is not a win/loss row — it is still settled
    // economically below (platform keeps the pot) but not counted in the win/loss history.
    if (!isDraw) {
      await db.execute({
        sql: `INSERT INTO duel_results (challenge_id, winner_id, loser_id, p1_losses, p2_losses, system, rom, session_id, perfect_ko_count)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [challengeId, winnerId, loserId, p1Losses, p2Losses, system, rom, sessionId || null, perfectKoCount],
      });
      console.log(`[duel/result] Saved result: challenge=${challengeId} winner=${winnerId} perfectKOs=${perfectKoCount} (P1=${p1Losses}-P2=${p2Losses})`);
    } else {
      console.log(`[duel/result] Draw/stop challenge=${challengeId} (P1=${p1Losses}-P2=${p2Losses}) — no win/loss row`);
    }

    // ── Settle the escrow chamber for this match ──
    // Decisive → pay the winner 75% of the pot + bank the rest. Draw/stop → platform keeps the
    // whole pot. Idempotent per session (the chamber is deleted on the first settlement).
    let settlement: Awaited<ReturnType<typeof payoutWinner>> | null = null;
    if (sessionId) {
      settlement = await payoutWinner({ challengeId, sessionId, winnerId, loserId });
    }

    // Mark challenge as completed only when the session is explicitly stopped
    // (not on every match — continuous play means N matches per challenge)
    if (body.markCompleted) {
      await db.execute({
        sql: "UPDATE duel_challenges SET status = 'completed' WHERE id = ?",
        args: [challengeId],
      });
    }

    // Reset both players' lobby status to waiting (use the settled player ids — reliable even
    // on a draw where winnerId/loserId are 0).
    const p1 = settlement?.player1Id ?? winnerId;
    const p2 = settlement?.player2Id ?? loserId;
    if (p1 && p2) {
      await db.execute({
        sql: "UPDATE duel_lobby SET status = 'waiting' WHERE user_id IN (?, ?)",
        args: [p1, p2],
      });
    }

    console.log(`[duel/result] Match saved. Challenge #${challengeId}`);

    return NextResponse.json({
      success: true,
      settlement: settlement
        ? {
            pot: settlement.pot,
            payout: settlement.payout,
            bankAmount: settlement.bankAmount,
            reason: settlement.reason,
            settled: settlement.settled,
            player1Id: settlement.player1Id,
            player2Id: settlement.player2Id,
            balances: serializeBalances(settlement.balances),
          }
        : null,
    });
  } catch (error) {
    console.error("POST /api/duel/result error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}
