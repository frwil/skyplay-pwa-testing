import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureUser } from "@/lib/db";
import { getAuthFromRequest } from "@/lib/auth";
import { setRoomCode, generateRoomCode } from "@/app/api/cloud-session/room-codes";
import { assertEntryAffordable, InsufficientFunds, DEFAULT_ENTRY_FEE } from "@/lib/duel/wallet";

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

async function getDisplayName(db: Awaited<ReturnType<typeof getDb>>, userId: number, _isLocalDev: boolean): Promise<string> {
  // Always fetch from users table (ensureUser creates dev users too)
  const rs = await db.execute({ sql: "SELECT username FROM users WHERE id = ?", args: [userId] });
  return rs.rows.length > 0 ? (rs.rows[0].username as string) : `Player-${userId}`;
}

/**
 * POST /api/duel/challenge/respond
 * Accept or decline a duel challenge.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const user = await getUserId(req, body);
    if (!user) {
      return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
    }

    const challengeId = body.challengeId as number;
    const accept = body.accept as boolean;

    if (!challengeId || typeof challengeId !== "number") {
      return NextResponse.json({ error: "challengeId requis (nombre)" }, { status: 400 });
    }

    const db = await getDb();
    const isLocalDev = !process.env.NORTHFLANK_API_KEY && !process.env.VERCEL;

    // Ensure dev users exist (FK constraint against users table)
    if (isLocalDev) {
      await ensureUser(user.userId, user.username);
    }

    const rs = await db.execute({
      sql: "SELECT * FROM duel_challenges WHERE id = ?", args: [challengeId],
    });
    if (rs.rows.length === 0) {
      return NextResponse.json({ error: "Défi introuvable" }, { status: 404 });
    }

    const row = rs.rows[0];
    if (row.target_id !== user.userId) {
      return NextResponse.json({ error: "Ce défi ne vous est pas destiné" }, { status: 403 });
    }
    if (row.status !== "pending") {
      return NextResponse.json({ error: "Ce défi a déjà été traité" }, { status: 400 });
    }

    if (!accept) {
      try { await db.execute({ sql: "UPDATE duel_challenges SET status = 'declined' WHERE id = ?", args: [challengeId] }); }
      catch (e) { console.error("[respond] ❌ UPDATE duel_challenges (decline):", e); throw e; }
      try { await db.execute({ sql: "UPDATE duel_lobby SET status = 'waiting' WHERE user_id IN (?, ?)", args: [row.challenger_id, row.target_id] }); }
      catch (e) { console.error("[respond] ❌ UPDATE duel_lobby (decline):", e); throw e; }
      const declinerName = await getDisplayName(db, user.userId, isLocalDev);
      try { await db.execute("PRAGMA foreign_keys = OFF"); } catch (e) { console.error("[respond] ❌ PRAGMA OFF (decline):", e); throw e; }
      try {
        await db.execute({
          sql: `INSERT INTO netplay_notifications (session_id, user_id, from_user_id, from_username, type, challenge_id, message)
                VALUES (?, ?, ?, ?, 'duel_declined', ?, ?)`,
          args: [challengeId, row.challenger_id, user.userId, declinerName, challengeId,
            `${declinerName} a refusé votre défi.`],
        });
      } catch (e) { console.error("[respond] ❌ INSERT notification (decline):", e); throw e; }
      finally {
        try { await db.execute("PRAGMA foreign_keys = ON"); } catch (e) { console.error("[respond] ❌ PRAGMA ON (decline):", e); }
      }
      return NextResponse.json({ success: true, accepted: false });
    }

    // ── Accept: Rules confirmation flow ──────────────────────────
    // Instead of creating the session immediately, we set status to "rules_pending"
    // and notify BOTH players. Each must confirm the rules via
    // POST /api/duel/challenge/confirm-rules. Only when both have confirmed does
    // the cloud session get created and the match begin.

    // ── Duel participation gate: funds barrier ONLY — no debit here ──
    let respondEntryFee = DEFAULT_ENTRY_FEE;
    let respondMatchCount = 1;
    try {
      if (row.mode_id) {
        const modeRs = await db.execute({ sql: "SELECT entry_fee, match_count FROM duel_game_modes WHERE id = ? LIMIT 1", args: [row.mode_id] });
        if (modeRs.rows.length > 0) {
          respondEntryFee = Number(modeRs.rows[0].entry_fee ?? DEFAULT_ENTRY_FEE);
          respondMatchCount = Number(modeRs.rows[0].match_count ?? 1);
        }
      } else {
        const feeRs = await db.execute({ sql: "SELECT entry_fee FROM duel_games WHERE system = ? AND rom = ? LIMIT 1", args: [row.system, row.rom] });
        if (feeRs.rows.length > 0) respondEntryFee = Number(feeRs.rows[0].entry_fee ?? DEFAULT_ENTRY_FEE);
      }
    } catch { /* fall back to default */ }
    try {
      await assertEntryAffordable(Number(row.challenger_id), user.userId, respondEntryFee);
    } catch (e) {
      if (e instanceof InsufficientFunds) {
        return NextResponse.json(
          { error: `SKY insuffisant pour la participation à ce duel (${respondEntryFee} SKY requis)`, code: "insufficient_sky", userId: e.userId },
          { status: 402 },
        );
      }
      console.error("[respond] ❌ assertEntryAffordable (accept):", e);
      throw e;
    }

    console.log("[respond] rules_pending: challengeId=%d modeId=%s matchCount=%d", challengeId, row.mode_id, respondMatchCount);
    try { await db.execute({ sql: `UPDATE duel_challenges SET status = 'rules_pending', challenger_rules_accepted = 0, target_rules_accepted = 0 WHERE id = ?`, args: [challengeId] }); }
    catch (e) { console.error("[respond] ❌ UPDATE duel_challenges (rules_pending):", e); throw e; }

    // We do NOT update duel_lobby yet — players stay visible but marked as "in negotiation"

    const acceptorName = await getDisplayName(db, user.userId, isLocalDev);
    // Notify BOTH players that rules are pending
    try { await db.execute("PRAGMA foreign_keys = OFF"); } catch {}
    try {
      // Notify challenger
      await db.execute({
        sql: `INSERT INTO netplay_notifications (session_id, user_id, from_user_id, from_username, type, challenge_id, message)
              VALUES (?, ?, ?, ?, 'duel_rules_pending', ?, ?)`,
        args: [challengeId, row.challenger_id, user.userId, acceptorName, challengeId,
          `${acceptorName} a accepté votre défi ! Veuillez confirmer les règles du duel.`],
      });
      // Notify target (acceptor) themselves
      await db.execute({
        sql: `INSERT INTO netplay_notifications (session_id, user_id, from_user_id, from_username, type, challenge_id, message)
              VALUES (?, ?, ?, ?, 'duel_rules_pending', ?, ?)`,
        args: [challengeId, user.userId, row.challenger_id, acceptorName, challengeId,
          `Vous avez accepté le défi ! Veuillez confirmer les règles du duel.`],
      });
    } catch (e) { console.error("[respond] ❌ INSERT notifications (rules_pending):", e); }
    finally {
      try { await db.execute("PRAGMA foreign_keys = ON"); } catch {}
    }

    return NextResponse.json({
      success: true, accepted: true,
      rulesPending: true,
      challengeId,
      modeId: row.mode_id as string | null,
      matchCount: respondMatchCount,
      entryFee: respondEntryFee,
      challengerId: row.challenger_id as number,
      targetId: user.userId,
    });
  } catch (error) {
    console.error("POST /api/duel/challenge/respond error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}
