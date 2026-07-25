import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureUser } from "@/lib/db";
import { getAuthFromRequest } from "@/lib/auth";

/**
 * Extract user identity. In production, uses JWT cookie.
 * In local dev (no NORTHFLANK_API_KEY), reads devUserId/devUsername from body or query.
 */
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
    const name = devUsername || "anonymous";
    return { userId: Math.abs(hashCode(name)), username: name };
  }

  return null; // Not authenticated
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/**
 * POST /api/duel/lobby
 * Join or leave the duel lobby.
 * Local dev: body can include { devUserId, devUsername }
 * Body: { action: "join" | "leave", system?: string, rom?: string, devUserId?: number, devUsername?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const user = await getUserId(req, body);
    if (!user) {
      return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
    }

    const action = body.action as string;
    const system = (body.system as string) || "neogeo";
    const rom = (body.rom as string) || "kof98.zip";

    if (action !== "join" && action !== "leave") {
      return NextResponse.json({ error: "action must be 'join' or 'leave'" }, { status: 400 });
    }

    const db = await getDb();

    if (action === "leave") {
      await db.execute({ sql: "DELETE FROM duel_lobby WHERE user_id = ?", args: [user.userId] });
      return NextResponse.json({ success: true, action: "leave" });
    }

    // Join: UPSERT
    const isLocalDev = !process.env.NORTHFLANK_API_KEY && !process.env.VERCEL;
    if (isLocalDev) {
      await ensureUser(user.userId, user.username);
    }
    await db.execute({
      sql: `INSERT INTO duel_lobby (user_id, system, rom, status, last_heartbeat)
            VALUES (?, ?, ?, 'waiting', datetime('now'))
            ON CONFLICT(user_id) DO UPDATE SET
              system = excluded.system, rom = excluded.rom,
              status = 'waiting', created_at = datetime('now'),
              last_heartbeat = datetime('now')`,
      args: [user.userId, system, rom],
    });

    // Clean up any stale challenges for this user — only if the OTHER player
    // is no longer in the lobby (heartbeat > 30s stale). This prevents
    // cancelling active challenges when one player refreshes the page.
    // Covers: pending, accepted, rules_pending.
    const cancelledRs = await db.execute({
      sql: `UPDATE duel_challenges SET status = 'cancelled'
            WHERE id IN (
              SELECT dc.id FROM duel_challenges dc
              WHERE (dc.challenger_id = ? OR dc.target_id = ?)
                AND dc.status IN ('pending', 'accepted', 'rules_pending')
                AND (
                  -- Other player not in lobby (stale or never joined)
                  NOT EXISTS (
                    SELECT 1 FROM duel_lobby dl
                    WHERE dl.user_id = CASE WHEN dc.challenger_id = ? THEN dc.target_id ELSE dc.challenger_id END
                      AND dl.last_heartbeat > datetime('now', '-30 seconds')
                  )
                )
            )
            RETURNING id`,
      args: [user.userId, user.userId, user.userId],
    });
    if (cancelledRs.rows.length > 0) {
      const ids = cancelledRs.rows.map((r: any) => r.id).join(", ");
      console.log(`[duel/lobby][join-cleanup] ❌ Cancelled challenge(s) [${ids}] for user ${user.userId}`);    }

    // Mark stale duel notifications as read on join, but PRESERVE active
    // flow notifications (rules_pending / accepted) so a page refresh doesn't
    // strand a player mid-flow. Only mark terminal notifications as read:
    // duel_challenge (stale incoming), duel_declined, duel_challenge_expired.
    await db.execute("PRAGMA foreign_keys = OFF");
    try {
      await db.execute({
        sql: `UPDATE netplay_notifications SET read = 1
              WHERE user_id = ? AND read = 0
                AND type IN ('duel_challenge', 'duel_declined', 'duel_challenge_expired')`,
        args: [user.userId],
      });
    } finally {
      await db.execute("PRAGMA foreign_keys = ON");
    }

    return NextResponse.json({ success: true, action: "join" });
  } catch (error) {
    console.error("POST /api/duel/lobby error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}

/**
 * GET /api/duel/lobby
 * List players currently in the duel lobby (excluding self).
 * Local dev: ?devUserId=X&devUsername=Y
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getUserId(req);
    if (!user) {
      return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
    }

    const db = await getDb();

    // Update own heartbeat FIRST (before cleanup, so we don't delete ourselves)
    await db.execute({
      sql: "UPDATE duel_lobby SET last_heartbeat = datetime('now') WHERE user_id = ?",
      args: [user.userId],
    });

    // Clean stale lobby entries (no heartbeat for > 30s = disconnected)
    const staleClean = await db.execute({
      sql: `DELETE FROM duel_lobby
            WHERE last_heartbeat IS NULL
               OR last_heartbeat < datetime('now', '-30 seconds')`,
      args: [],
    });
    if (staleClean.rowsAffected > 0) {
      console.log(`[duel/lobby] Cleaned ${staleClean.rowsAffected} stale lobby entr${staleClean.rowsAffected > 1 ? 'ies' : 'y'}`);
    }

    // ── Active cleanup: cancel stale rules_pending challenges (65s grace vs 60s client timeout)
    const staleRules = await db.execute({
      sql: `UPDATE duel_challenges SET status = 'cancelled'
            WHERE status = 'rules_pending'
              AND rules_pending_at IS NOT NULL
              AND rules_pending_at < datetime('now', '-65 seconds')
            RETURNING id`,
      args: [],
    });
    if (staleRules.rows.length > 0) {
      const ids = staleRules.rows.map((r: any) => r.id).join(", ");
      console.log(`[duel/lobby][active-cleanup] ❌ Auto-cancelled stale rules_pending challenge(s) [${ids}]`);
      try { require("fs").appendFileSync("D:/SkyPlay/duel-cancel-debug.log", `[${new Date().toISOString()}] [active-cleanup] challenges=[${ids}]\n`); } catch {}
    }

    const rs = await db.execute({
      sql: `SELECT dl.user_id, dl.system, dl.rom, dl.status, dl.created_at
            FROM duel_lobby dl
            WHERE dl.user_id != ? AND dl.status = 'waiting'
            ORDER BY dl.created_at ASC
            LIMIT 50`,
      args: [user.userId],
    });

    const players = rs.rows.map((row) => ({
      userId: row.user_id as number,
      username: `Player-${row.user_id}`, // fallback
      avatar: null as string | null,
      country: null as string | null,
      system: row.system as string,
      rom: row.rom as string,
      status: row.status as string,
      createdAt: row.created_at as string,
    }));

    // Fetch display names + profile (avatar/country) from users table (works in dev and prod).
    if (players.length > 0) {
      const userIds = players.map((p) => p.userId);
      const placeholders = userIds.map(() => "?").join(", ");
      const userRs = await db.execute({
        sql: `SELECT id, username, avatar_base64, country FROM users WHERE id IN (${placeholders})`,
        args: userIds,
      });
      const userMap = new Map<number, { username: string; avatar: string | null; country: string | null }>();
      for (const row of userRs.rows) {
        userMap.set(row.id as number, {
          username: row.username as string,
          avatar: (row.avatar_base64 as string) ?? null,
          country: (row.country as string) ?? null,
        });
      }
      for (const p of players) {
        const u = userMap.get(p.userId);
        if (u) { p.username = u.username || p.username; p.avatar = u.avatar; p.country = u.country; }
      }
    }

    const meRs = await db.execute({
      sql: "SELECT id FROM duel_lobby WHERE user_id = ?",
      args: [user.userId],
    });
    const inLobby = meRs.rows.length > 0;

    return NextResponse.json({ players, inLobby });
  } catch (error) {
    console.error("GET /api/duel/lobby error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}
