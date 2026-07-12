import { NextRequest, NextResponse } from "next/server";
import { getDb, ensureUser } from "@/lib/db";
import { getAuthFromRequest } from "@/lib/auth";
import { getBalance, DEFAULT_ENTRY_FEE, assertEntryAffordable, InsufficientFunds } from "@/lib/duel/wallet";

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
      modeId: row.mode_id as string | null,
      matchCount: (row.match_count as number) ?? 1,
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
 * Auto-accept an existing challenge on behalf of the new challenger.
 * Used to resolve mutual-challenge races: when P1→P2 exists and P2→P1
 * is attempted, we silently accept P1's challenge for P2 instead of
 * creating a second challenge that would deadlock both players.
 */
async function autoAcceptExistingChallenge(
  db: Awaited<ReturnType<typeof getDb>>,
  challengeId: number,
  user: { userId: number; username: string },
  _targetUserId: number,
  matchCount: number,
  entryFee: number,
  modeId: string | null,
  _system: string,
  _rom: string,
): Promise<NextResponse> {
  try {
    // Gate: the auto-accepting player must have enough SKY
    const existingRs = await db.execute({
      sql: "SELECT challenger_id, target_id FROM duel_challenges WHERE id = ?",
      args: [challengeId],
    });
    if (existingRs.rows.length === 0) {
      return NextResponse.json({ error: "Défi introuvable" }, { status: 404 });
    }
    const challengerId = existingRs.rows[0].challenger_id as number;
    const targetId = existingRs.rows[0].target_id as number;

    await assertEntryAffordable(challengerId, user.userId, entryFee);

    // Transition to rules_pending — both players must confirm rules
    await db.execute({
      sql: "UPDATE duel_challenges SET status = 'rules_pending', challenger_rules_accepted = 0, target_rules_accepted = 0 WHERE id = ?",
      args: [challengeId],
    });

    const isLocalDev = !process.env.NORTHFLANK_API_KEY && !process.env.VERCEL;
    const acceptorName = user.username || `Player-${user.userId}`;
    let challengerName = `Player-${challengerId}`;
    try {
      const crs = await db.execute({ sql: "SELECT username FROM users WHERE id = ?", args: [challengerId] });
      if (crs.rows.length > 0) challengerName = crs.rows[0].username as string;
    } catch { /* fallback */ }

    // Notify BOTH players
    await db.execute("PRAGMA foreign_keys = OFF");
    try {
      // Notify original challenger (P1)
      await db.execute({
        sql: `INSERT INTO netplay_notifications (session_id, user_id, from_user_id, from_username, type, challenge_id, message)
              VALUES (?, ?, ?, ?, 'duel_rules_pending', ?, ?)`,
        args: [challengeId, challengerId, user.userId, acceptorName, challengeId,
          `${acceptorName} a accepté votre défi ! Veuillez confirmer les règles du duel.`],
      });
      // Notify auto-accepting player (P2 — the one who sent the second challenge)
      await db.execute({
        sql: `INSERT INTO netplay_notifications (session_id, user_id, from_user_id, from_username, type, challenge_id, message)
              VALUES (?, ?, ?, ?, 'duel_rules_pending', ?, ?)`,
        args: [challengeId, user.userId, challengerId, challengerName, challengeId,
          `Vous avez accepté le défi ! Veuillez confirmer les règles du duel.`],
      });
    } finally {
      await db.execute("PRAGMA foreign_keys = ON");
    }

    console.log("[challenge] 🔄 Mutual challenge resolved: auto-accepted challenge %d for P%d (original challenger: P%d)",
      challengeId, user.userId, challengerId);

    return NextResponse.json({
      success: true,
      autoAccepted: true,
      challengeId,
      modeId,
      matchCount,
      entryFee,
      challengerId,
      targetId,
    });
  } catch (error) {
    if (error instanceof InsufficientFunds) {
      return NextResponse.json(
        { error: `SKY insuffisant pour la participation à ce duel (${entryFee} SKY requis)`, code: "insufficient_sky", userId: error.userId },
        { status: 402 },
      );
    }
    console.error("[challenge] autoAcceptExistingChallenge error:", error);
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
    const modeId = (body.modeId as string) || null;

    if (!targetUserId || typeof targetUserId !== "number") {
      return NextResponse.json({ error: "targetUserId requis (nombre)" }, { status: 400 });
    }
    if (targetUserId === user.userId) {
      return NextResponse.json({ error: "Vous ne pouvez pas vous défier vous-même" }, { status: 400 });
    }

    const db = await getDb();

    // Look up the game label + entry fee + match count for the notification message and stake gate
    let gameLabel = "KOF '98"; // fallback
    let gameEntryFee = DEFAULT_ENTRY_FEE;
    let gameMatchCount = 1;
    let modeLabel = "";
    if (modeId) {
      // Use mode-specific entry fee and match count
      const modeRs = await db.execute({ sql: "SELECT m.entry_fee, m.match_count, m.label, g.label as game_label FROM duel_game_modes m JOIN duel_games g ON m.game_id = g.id WHERE m.id = ? AND m.enabled = 1 LIMIT 1", args: [modeId] });
      if (modeRs.rows.length > 0) {
        gameEntryFee = Number(modeRs.rows[0].entry_fee ?? DEFAULT_ENTRY_FEE);
        gameMatchCount = Number(modeRs.rows[0].match_count ?? 1);
        gameLabel = modeRs.rows[0].game_label as string;
        modeLabel = modeRs.rows[0].label as string;
      }
    } else {
      try {
        const gameRs = await db.execute({ sql: "SELECT label, entry_fee FROM duel_games WHERE rom = ? LIMIT 1", args: [rom] });
        if (gameRs.rows.length > 0) {
          gameLabel = gameRs.rows[0].label as string;
          gameEntryFee = Number(gameRs.rows[0].entry_fee ?? DEFAULT_ENTRY_FEE);
        }
      } catch {}
    }

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

    // ── One-challenge-per-player gate (FIFO) ──────────────────────
    // Each player can only be involved in ONE pending challenge at a time.
    // This query finds all pending challenges involving either the challenger
    // or the target. FIFO: the first request wins, subsequent ones are rejected.
    // Exception: mutual (bi-directional) challenges between the same two players
    // are auto-resolved rather than rejected.
    const existingRs = await db.execute({
      sql: `SELECT id, challenger_id, target_id FROM duel_challenges
            WHERE (challenger_id = ? OR target_id = ? OR challenger_id = ? OR target_id = ?)
            AND status = 'pending'
            ORDER BY id ASC`,
      args: [user.userId, user.userId, targetUserId, targetUserId],
    });

    if (existingRs.rows.length > 0) {
      // ── Mutual challenge: the target already challenged us ──────
      const mutual = existingRs.rows.find(
        (r) => (r.challenger_id as number) === targetUserId && (r.target_id as number) === user.userId,
      );
      if (mutual) {
        return autoAcceptExistingChallenge(
          db, mutual.id as number, user, targetUserId,
          gameMatchCount, gameEntryFee, modeId, system, rom,
        );
      }

      // ── Same-direction duplicate (already challenged this player) ─
      const sameDirection = existingRs.rows.find(
        (r) => (r.challenger_id as number) === user.userId && (r.target_id as number) === targetUserId,
      );
      if (sameDirection) {
        return NextResponse.json(
          { error: "Un défi est déjà en cours avec ce joueur" },
          { status: 409 },
        );
      }

      // ── Non-mutual, different-player conflict ───────────────────
      // FIFO: whichever challenge was created first wins. Determine who is busy.
      const challengerBusy = existingRs.rows.some(
        (r) => (r.challenger_id as number) === user.userId || (r.target_id as number) === user.userId,
      );
      const targetBusy = existingRs.rows.some(
        (r) => (r.challenger_id as number) === targetUserId || (r.target_id as number) === targetUserId,
      );

      if (challengerBusy) {
        return NextResponse.json(
          { error: "Vous avez déjà un défi en cours — attendez qu'il soit résolu" },
          { status: 409 },
        );
      }
      // targetBusy: the target is already dealing with another challenger
      return NextResponse.json(
        { error: "Ce joueur est déjà en négociation avec un autre adversaire" },
        { status: 409 },
      );
    }

    // Ensure dev users exist (FK constraint against users table)
    const isLocalDev = !process.env.NORTHFLANK_API_KEY && !process.env.VERCEL;
    if (isLocalDev) {
      await ensureUser(user.userId, user.username);
      await ensureUser(targetUserId, `Player-${targetUserId}`);
    }

    // ── Duel participation gate: the challenger must hold at least the per-game entry fee ──
    // Admins have unlimited SKY and always pass. The real debit happens on accept (both players).
    const challengerBalance = await getBalance(user.userId);
    if (challengerBalance < gameEntryFee) {
      return NextResponse.json(
        { error: `SKY insuffisant : la participation à un duel ${gameLabel} est de ${gameEntryFee} SKY`, code: "insufficient_sky" },
        { status: 402 },
      );
    }

    const challengerUsername = user.username || `Player-${user.userId}`;
    let targetUsername = `Player-${targetUserId}`;
    // Fetch actual username from users table (works in dev too — ensureUser creates them)
    const tr = await db.execute({ sql: "SELECT username FROM users WHERE id = ?", args: [targetUserId] });
    targetUsername = tr.rows.length > 0 ? (tr.rows[0].username as string) : targetUsername;

    const insertRs = await db.execute({
      sql: `INSERT INTO duel_challenges (challenger_id, target_id, system, rom, status, mode_id, match_count)
            VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      args: [user.userId, targetUserId, system, rom, modeId, gameMatchCount],
    });
    const challengeId = Number(insertRs.lastInsertRowid);

    await db.execute({
      sql: "UPDATE duel_lobby SET status = 'challenging' WHERE user_id = ?",
      args: [user.userId],
    });

    // Notification via netplay_notifications (disable FK — session_id stores duel_challenge id, not a netplay_sessions id)
    const notificationMsg = modeLabel
      ? `${challengerUsername} vous a défié en duel ${gameLabel} — ${modeLabel} (${gameMatchCount} match${gameMatchCount > 1 ? 's' : ''}, ${gameEntryFee} SKY) !`
      : `${challengerUsername} vous a défié en duel ${gameLabel} !`;
    await db.execute("PRAGMA foreign_keys = OFF");
    try {
      await db.execute({
        sql: `INSERT INTO netplay_notifications
                (session_id, user_id, from_user_id, from_username, type, challenge_id, message)
              VALUES (?, ?, ?, ?, 'duel_challenge', ?, ?)`,
        args: [challengeId, targetUserId, user.userId, challengerUsername, challengeId, notificationMsg],
      });
    } finally {
      await db.execute("PRAGMA foreign_keys = ON");
    }

    return NextResponse.json({
      success: true,
      challenge: {
        id: challengeId, challengerId: user.userId, challengerUsername,
        targetId: targetUserId, targetUsername, system, rom, status: "pending",
        modeId, matchCount: gameMatchCount, entryFee: gameEntryFee,
      },
    });
  } catch (error) {
    console.error("POST /api/duel/challenge error:", error);
    const isLocalDev = !process.env.NORTHFLANK_API_KEY && !process.env.VERCEL;
    const message = isLocalDev && error instanceof Error ? `Erreur: ${error.message}` : "Erreur interne du serveur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
