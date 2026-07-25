import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAuthFromRequest } from "@/lib/auth";

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

  return null;
}
function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; } return Math.abs(h); }

async function getDisplayName(db: Awaited<ReturnType<typeof getDb>>, userId: number): Promise<string> {
  const rs = await db.execute({ sql: "SELECT username FROM users WHERE id = ?", args: [userId] });
  return rs.rows.length > 0 ? (rs.rows[0].username as string) : `Player-${userId}`;
}

/**
 * POST /api/duel/challenge/cancel
 * Cancel a pending challenge (challenger only, or auto-timeout after 30s).
 * Creates notifications for both players so both return to the lobby.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const user = await getUserId(req, body);
    if (!user) {
      return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
    }

    const challengeId = body.challengeId as number;
    if (!challengeId || typeof challengeId !== "number") {
      return NextResponse.json({ error: "challengeId requis (nombre)" }, { status: 400 });
    }

    const db = await getDb();

    const rs = await db.execute({
      sql: "SELECT * FROM duel_challenges WHERE id = ?", args: [challengeId],
    });
    if (rs.rows.length === 0) {
      return NextResponse.json({ error: "Défi introuvable" }, { status: 404 });
    }

    const row = rs.rows[0];
    // For pending challenges: only the challenger can cancel.
    // For rules_pending / accepted: either player can cancel (session may be dead).
    if (row.status === "pending" && row.challenger_id !== user.userId) {
      return NextResponse.json({ error: "Seul le challenger peut annuler ce défi" }, { status: 403 });
    }
    if (row.status !== "pending" && row.challenger_id !== user.userId && row.target_id !== user.userId) {
      return NextResponse.json({ error: "Vous n'êtes pas participant à ce défi" }, { status: 403 });
    }
    if (!["pending", "rules_pending", "accepted"].includes(row.status as string)) {
      return NextResponse.json({ error: "Ce défi a déjà été traité" }, { status: 400 });
    }

    // Cancel the challenge
    await db.execute({ sql: "UPDATE duel_challenges SET status = 'cancelled' WHERE id = ?", args: [challengeId] });

    // Clean up room code mapping if a session was created
    if (row.session_id) {
      try {
        await db.execute({ sql: "DELETE FROM cloud_rooms WHERE session_id = ?", args: [row.session_id as string] });
      } catch { /* best effort */ }
    }

    // Reset both players' lobby status
    await db.execute({
      sql: "UPDATE duel_lobby SET status = 'waiting' WHERE user_id IN (?, ?)",
      args: [row.challenger_id, row.target_id],
    });

    const cancelerName = await getDisplayName(db, user.userId);
    const targetName = await getDisplayName(db, row.target_id as number);

    // Notify BOTH players — the target that the challenge expired, and the
    // challenger (as confirmation). Both clients return to the lobby.
    await db.execute("PRAGMA foreign_keys = OFF");
    try {
      // Notify the target
      await db.execute({
        sql: `INSERT INTO netplay_notifications (session_id, user_id, from_user_id, from_username, type, challenge_id, message)
              VALUES (?, ?, ?, ?, 'duel_challenge_expired', ?, ?)`,
        args: [challengeId, row.target_id, user.userId, cancelerName, challengeId,
          `Le défi de ${cancelerName} a expiré (pas de réponse après 60 secondes).`],
      });
      // Notify the challenger (confirmation)
      await db.execute({
        sql: `INSERT INTO netplay_notifications (session_id, user_id, from_user_id, from_username, type, challenge_id, message)
              VALUES (?, ?, ?, ?, 'duel_challenge_expired', ?, ?)`,
        args: [challengeId, user.userId, row.target_id, targetName, challengeId,
          `Votre défi à ${targetName} a expiré (pas de réponse après 60 secondes).`],
      });
    } finally {
      await db.execute("PRAGMA foreign_keys = ON");
    }

    console.log("[cancel/route] ❌ Challenge %d cancelled — canceler=%d, target=%d, stack=%s", challengeId, user.userId, row.target_id, new Error().stack?.split("\n").slice(1,4).join(" → "));
    try { require("fs").appendFileSync("D:/SkyPlay/duel-cancel-debug.log", `[${new Date().toISOString()}] [cancel/route] challenge=${challengeId} user=${user.userId}\n`); } catch {}

    return NextResponse.json({ success: true, cancelled: true, challengeId });
  } catch (error) {
    console.error("POST /api/duel/challenge/cancel error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}
