import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { chargeEntryFees, InsufficientFunds, DEFAULT_ENTRY_FEE, DEFAULT_WINNER_SHARE, type PlayerBalance } from "@/lib/duel/wallet";

async function getUserId(req: NextRequest, body?: Record<string, unknown>): Promise<{ userId: number } | null> {
  const auth = await getAuthFromRequest(req);
  if (auth) return { userId: auth.userId };
  const isLocalDev = !process.env.NORTHFLANK_API_KEY && !process.env.VERCEL;
  if (isLocalDev) {
    const devUserId = (body?.devUserId as number) || parseInt(req.nextUrl.searchParams.get("devUserId") || "0", 10);
    const devUsername = (body?.devUsername as string) || req.nextUrl.searchParams.get("devUsername") || "dev";
    if (devUserId) return { userId: devUserId };
    return { userId: Math.abs(hash(devUsername || "anon")) };
  }
  return null;
}
function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; } return Math.abs(h); }

function serializeBalances(balances: Record<number, PlayerBalance>) {
  const out: Record<number, { after: number | null; sessionDelta: number; unlimited: boolean }> = {};
  for (const [id, b] of Object.entries(balances)) {
    out[Number(id)] = { after: b.unlimited ? null : b.after, sessionDelta: b.sessionDelta, unlimited: b.unlimited };
  }
  return out;
}

/**
 * POST /api/duel/wager/charge
 * Debit both players' entry fee for a REMATCH into that duel's escrow chamber.
 *
 * The rematch handshake is WebSocket-only (game server ↔ CloudAdapter), so the initial-match
 * debit path (challenge/respond) doesn't run. Instead both clients call this on the
 * `rematch_accepted` event with the freshly-created session id. Idempotent per session_id
 * (the escrow chamber is the lock), so the second client's call is a no-op.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const user = await getUserId(req, body);
    if (!user) {
      return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
    }

    const challengeId = body.challengeId as number;
    const sessionId = body.sessionId as string;
    const player1Id = body.player1Id as number;
    const player2Id = body.player2Id as number;

    if (!challengeId || !sessionId || !player1Id || !player2Id) {
      return NextResponse.json({ error: "challengeId, sessionId, player1Id, player2Id requis" }, { status: 400 });
    }
    // Only a participant may trigger the charge.
    if (user.userId !== player1Id && user.userId !== player2Id) {
      return NextResponse.json({ error: "Non participant à ce duel" }, { status: 403 });
    }

    // Look up game-specific entry fee + winner share from the challenge → mode → game fallback
    let wagerEntryFee = DEFAULT_ENTRY_FEE;
    let wagerWinnerShare = DEFAULT_WINNER_SHARE;
    let wagerSystem = "neogeo";
    let wagerRom = "kof98.zip";
    let wagerMatchCount = 1;
    try {
      const db = await getDb();
      const chalRs = await db.execute({ sql: "SELECT system, rom, mode_id, match_count FROM duel_challenges WHERE id = ?", args: [challengeId] });
      if (chalRs.rows.length > 0) {
        wagerSystem = (chalRs.rows[0].system as string) ?? "neogeo";
        wagerRom = (chalRs.rows[0].rom as string) ?? "kof98.zip";
        wagerMatchCount = (chalRs.rows[0].match_count as number) ?? 1;
        const modeId = chalRs.rows[0].mode_id as string | null;
        if (modeId) {
          const modeRs = await db.execute({ sql: "SELECT entry_fee, winner_share FROM duel_game_modes WHERE id = ? LIMIT 1", args: [modeId] });
          if (modeRs.rows.length > 0) {
            wagerEntryFee = Number(modeRs.rows[0].entry_fee ?? DEFAULT_ENTRY_FEE);
            // Mode-level override takes priority if explicitly set (non-null)
            const modeWs = modeRs.rows[0].winner_share;
            if (modeWs != null) {
              wagerWinnerShare = Number(modeWs);
            } else {
              // No mode-level override → fall back to game-level
              const gameRs = await db.execute({ sql: "SELECT winner_share FROM duel_games WHERE system = ? AND rom = ? LIMIT 1", args: [wagerSystem, wagerRom] });
              if (gameRs.rows.length > 0 && gameRs.rows[0].winner_share != null) {
                wagerWinnerShare = Number(gameRs.rows[0].winner_share);
              }
            }
          }
        } else {
          const gameRs = await db.execute({ sql: "SELECT entry_fee, winner_share FROM duel_games WHERE system = ? AND rom = ? LIMIT 1", args: [wagerSystem, wagerRom] });
          if (gameRs.rows.length > 0) {
            wagerEntryFee = Number(gameRs.rows[0].entry_fee ?? DEFAULT_ENTRY_FEE);
            wagerWinnerShare = gameRs.rows[0].winner_share != null ? Number(gameRs.rows[0].winner_share) : DEFAULT_WINNER_SHARE;
          }
        }
      }
    } catch { /* fall back to default */ }

    try {
      const result = await chargeEntryFees({
        challengeId,
        sessionId,
        playerAId: player1Id,
        playerBId: player2Id,
        system: wagerSystem,
        rom: wagerRom,
        entryFee: wagerEntryFee,
      });
      return NextResponse.json({
        success: true,
        pot: result.pot,
        winnerShare: wagerWinnerShare,
        balances: serializeBalances(result.balances),
      });
    } catch (e) {
      if (e instanceof InsufficientFunds) {
        return NextResponse.json(
          { error: "SKY insuffisant pour la participation à la revanche", code: "insufficient_sky", userId: e.userId },
          { status: 402 },
        );
      }
      throw e;
    }
  } catch (error) {
    console.error("POST /api/duel/wager/charge error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}
