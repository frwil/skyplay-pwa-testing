import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureUser } from "@/lib/db";
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

  return null; // Not authenticated
}
function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; } return Math.abs(h); }

/**
 * GET /api/duel/challenge?challengeId=X
 * Returns a duel challenge with session info (P1 polls this after P2 accepts).
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getUserId(req);
    if (!user) {
      return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
    }

    const challengeId = parseInt(req.nextUrl.searchParams.get("challengeId") || "0", 10);
    if (!challengeId) {
      return NextResponse.json({ error: "challengeId requis (query param)" }, { status: 400 });
    }

    const db = await getDb();
    const rs = await db.execute({
      sql: "SELECT * FROM duel_challenges WHERE id = ?", args: [challengeId],
    });
    if (rs.rows.length === 0) {
      return NextResponse.json({ error: "Défi introuvable" }, { status: 404 });
    }

    const row = rs.rows[0];
    if (row.challenger_id !== user.userId && row.target_id !== user.userId) {
      return NextResponse.json({ error: "Accès non autorisé" }, { status: 403 });
    }

    const challenge: Record<string, unknown> = {
      id: row.id as number,
      challengerId: row.challenger_id as number,
      targetId: row.target_id as number,
      system: row.system as string,
      rom: row.rom as string,
      status: row.status as string,
      createdAt: row.created_at as string,
    };

    // Include session info if accepted
    if (row.status === "accepted" && row.session_id) {
      challenge.session = {
        sessionId: row.session_id as string,
        wsUrl: row.ws_url as string,
        roomCode: row.room_code as string,
        player1Id: row.challenger_id as number,
        player2Id: row.target_id as number,
        challengeId: row.id as number,
      };
    }

    return NextResponse.json({ challenge });
  } catch (error) {
    console.error("GET /api/duel/challenge error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}

/**
 * POST /api/duel/challenge
 * Send a duel challenge to a target player.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const user = await getUserId(req, body);
    if (!user) {
      return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
    }

    const targetUserId = body.targetUserId as number;
    const system = (body.system as string) || "neogeo";
    const rom = (body.rom as string) || "kof98.zip";

    if (!targetUserId || typeof targetUserId !== "number") {
      return NextResponse.json({ error: "targetUserId requis (nombre)" }, { status: 400 });
    }
    if (targetUserId === user.userId) {
      return NextResponse.json({ error: "Vous ne pouvez pas vous défier vous-même" }, { status: 400 });
    }

    const db = await getDb();

    const challengerRs = await db.execute({
      sql: "SELECT id FROM duel_lobby WHERE user_id = ?", args: [user.userId],
    });
    if (challengerRs.rows.length === 0) {
      return NextResponse.json({ error: "Vous devez d'abord rejoindre le lobby" }, { status: 400 });
    }

    const targetRs = await db.execute({
      sql: "SELECT id FROM duel_lobby WHERE user_id = ? AND status = 'waiting'", args: [targetUserId],
    });
    if (targetRs.rows.length === 0) {
      return NextResponse.json({ error: "Ce joueur n'est plus dans le lobby" }, { status: 400 });
    }

    const existingRs = await db.execute({
      sql: `SELECT id FROM duel_challenges
            WHERE ((challenger_id = ? AND target_id = ?) OR (challenger_id = ? AND target_id = ?))
            AND status = 'pending'`,
      args: [user.userId, targetUserId, targetUserId, user.userId],
    });
    if (existingRs.rows.length > 0) {
      return NextResponse.json({ error: "Un défi est déjà en cours avec ce joueur" }, { status: 409 });
    }

    // Ensure dev users exist (FK constraint against users table)
    const isLocalDev = !process.env.NORTHFLANK_API_KEY && !process.env.VERCEL;
    if (isLocalDev) {
      await ensureUser(user.userId, user.username);
      await ensureUser(targetUserId, `Player-${targetUserId}`);
    }

    const challengerUsername = user.username || `Player-${user.userId}`;
    let targetUsername = `Player-${targetUserId}`;
    // Fetch actual username from users table (works in dev too — ensureUser creates them)
    const tr = await db.execute({ sql: "SELECT username FROM users WHERE id = ?", args: [targetUserId] });
    targetUsername = tr.rows.length > 0 ? (tr.rows[0].username as string) : targetUsername;

    const insertRs = await db.execute({
      sql: `INSERT INTO duel_challenges (challenger_id, target_id, system, rom, status)
            VALUES (?, ?, ?, ?, 'pending')`,
      args: [user.userId, targetUserId, system, rom],
    });
    const challengeId = Number(insertRs.lastInsertRowid);

    await db.execute({
      sql: "UPDATE duel_lobby SET status = 'challenging' WHERE user_id = ?",
      args: [user.userId],
    });

    // Notification via netplay_notifications (disable FK — session_id stores duel_challenge id, not a netplay_sessions id)
    await db.execute("PRAGMA foreign_keys = OFF");
    try {
      await db.execute({
        sql: `INSERT INTO netplay_notifications
                (session_id, user_id, from_user_id, from_username, type, challenge_id, message)
              VALUES (?, ?, ?, ?, 'duel_challenge', ?, ?)`,
        args: [challengeId, targetUserId, user.userId, challengerUsername, challengeId,
          `${challengerUsername} vous a défié en duel KOF '98 !`],
      });
    } finally {
      await db.execute("PRAGMA foreign_keys = ON");
    }

    return NextResponse.json({
      success: true,
      challenge: {
        id: challengeId, challengerId: user.userId, challengerUsername,
        targetId: targetUserId, targetUsername, system, rom, status: "pending",
      },
    });
  } catch (error) {
    console.error("POST /api/duel/challenge error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}
