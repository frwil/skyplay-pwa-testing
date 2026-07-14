import { getDb } from "@/lib/db";

/**
 * Duel SKY wagering economy.
 *
 * Balance model (no stored column): a player's spendable SKY is the *computed* earned SKY
 * (approved submission rewards + granted participation bonus) PLUS the signed sum of their
 * `sky_transactions` ledger. Seeding, entry fees and payouts are all ledger rows — the earned
 * SKY base is never overwritten, so existing users keep their current values.
 *
 * Escrow is a "honeycomb": one isolated `escrow_rooms` chamber per duel (keyed by session_id).
 * A chamber holds the collected pot while the match is live and is only settled + DELETED once
 * the payout and the bank transfer both succeed (single transaction). The chamber's existence
 * is therefore the idempotency lock: present ⇒ not yet settled; absent ⇒ already settled (no-op).
 *
 * Admins (role admin/superadmin) have an unlimited balance (Infinity): never debited, never
 * credited, always pass the gates. Their stake never enters the pot.
 */

export const DEFAULT_ENTRY_FEE = 1000;
export const WINNER_SHARE = 0.75;

/** Thrown by chargeEntryFees when a non-admin player lacks the entry fee. */
export class InsufficientFunds extends Error {
  constructor(public readonly userId: number) {
    super(`Insufficient SKY balance for user ${userId}`);
    this.name = "InsufficientFunds";
  }
}

export interface PlayerBalance {
  /** Full balance after the operation. Infinity for admins. */
  after: number;
  /** Net movement for this session (−1000 stake, +payout gain). 0 for admins. */
  sessionDelta: number;
  /** True when this player is an admin (unlimited SKY). */
  unlimited: boolean;
}

export interface ChargeResult {
  player1Id: number;
  player2Id: number;
  /** Collected pot = 1000 × number of non-admin players. */
  pot: number;
  balances: Record<number, PlayerBalance>;
}

export interface PayoutResult {
  player1Id: number;
  player2Id: number;
  pot: number;
  payout: number;
  bankAmount: number;
  reason: "commission" | "draw_forfeit" | "admin_win" | "abandon" | "none";
  /** True when this call actually settled the chamber (false = idempotent no-op). */
  settled: boolean;
  balances: Record<number, PlayerBalance>;
}

async function isAdmin(userId: number): Promise<boolean> {
  if (!userId) return false;
  const db = await getDb();
  const rs = await db.execute({ sql: "SELECT role FROM users WHERE id = ?", args: [userId] });
  const role = rs.rows[0]?.role as string | undefined;
  return role === "admin" || role === "superadmin";
}

/** Computed earned SKY + ledger sum for a non-admin; Infinity for an admin. */
export async function getBalance(userId: number): Promise<number> {
  if (await isAdmin(userId)) return Infinity;
  const db = await getDb();
  const rs = await db.execute({
    sql: `
      SELECT
        COALESCE((SELECT SUM(q.reward_amount) FROM submissions s
                  JOIN questions q ON q.id = s.question_id
                  WHERE s.user_id = u.id AND s.status = 'APPROVED'), 0)
        + CASE WHEN u.bonus_status = 'APPROVED' THEN COALESCE(u.participation_bonus, 0) ELSE 0 END
        + COALESCE((SELECT SUM(amount) FROM sky_transactions WHERE user_id = u.id), 0)
        AS balance
      FROM users u WHERE u.id = ?
    `,
    args: [userId],
  });
  if (rs.rows.length === 0) return 0;
  return Number(rs.rows[0]?.balance ?? 0);
}

/**
 * Funds barrier: throws InsufficientFunds if a non-admin player can't cover the entry fee.
 * No writes, no chamber — used at accept time to gate a duel WITHOUT debiting (the real
 * debit happens later, when the fight actually starts). Admins pass (getBalance = Infinity).
 */
export async function assertEntryAffordable(
  playerAId: number,
  playerBId: number,
  entryFee: number = DEFAULT_ENTRY_FEE,
): Promise<void> {
  for (const id of [playerAId, playerBId]) {
    if ((await getBalance(id)) < entryFee) throw new InsufficientFunds(id);
  }
}

/** SKY currently held in open escrow chambers (funds in transit; ~0 outside a live match). */
export async function getOpenEscrowTotal(): Promise<number> {
  const db = await getDb();
  const rs = await db.execute("SELECT COALESCE(SUM(amount), 0) AS total FROM escrow_rooms WHERE status = 'open'");
  return Number(rs.rows[0]?.total ?? 0);
}

/** Total definitive platform revenue banked across all matches. */
export async function getBankTotal(): Promise<number> {
  const db = await getDb();
  const rs = await db.execute("SELECT COALESCE(SUM(amount), 0) AS total FROM platform_bank");
  return Number(rs.rows[0]?.total ?? 0);
}

/** Net ledger movement for a player on a given session (stake + payout). */
async function sessionDelta(userId: number, sessionId: string): Promise<number> {
  const db = await getDb();
  const rs = await db.execute({
    sql: "SELECT COALESCE(SUM(amount), 0) AS d FROM sky_transactions WHERE user_id = ? AND session_id = ?",
    args: [userId, sessionId],
  });
  return Number(rs.rows[0]?.d ?? 0);
}

async function playerBalance(userId: number, sessionId: string, admin: boolean): Promise<PlayerBalance> {
  if (admin) return { after: Infinity, sessionDelta: 0, unlimited: true };
  return { after: await getBalance(userId), sessionDelta: await sessionDelta(userId, sessionId), unlimited: false };
}

/**
 * Open a chamber for a duel and debit each non-admin player's entry fee.
 * Idempotent per session_id (chamber already present ⇒ no-op). Throws InsufficientFunds
 * if a non-admin cannot cover the fee (caller should return HTTP 402).
 */
export async function chargeEntryFees(opts: {
  challengeId: number;
  sessionId: string;
  playerAId: number;
  playerBId: number;
  system?: string;
  rom?: string;
  entryFee?: number;
}): Promise<ChargeResult> {
  const { challengeId, sessionId, playerAId, playerBId, system = "neogeo", rom = "kof98.zip", entryFee = DEFAULT_ENTRY_FEE } = opts;
  const db = await getDb();

  const adminA = await isAdmin(playerAId);
  const adminB = await isAdmin(playerBId);

  // Idempotency: a chamber already exists for this session → the fees were already charged.
  const existing = await db.execute({
    sql: "SELECT amount FROM escrow_rooms WHERE session_id = ?",
    args: [sessionId],
  });
  if (existing.rows.length > 0) {
    return {
      player1Id: playerAId,
      player2Id: playerBId,
      pot: Number(existing.rows[0]?.amount ?? 0),
      balances: {
        [playerAId]: await playerBalance(playerAId, sessionId, adminA),
        [playerBId]: await playerBalance(playerBId, sessionId, adminB),
      },
    };
  }

  // Verify funds for each non-admin BEFORE writing anything.
  if (!adminA && (await getBalance(playerAId)) < entryFee) throw new InsufficientFunds(playerAId);
  if (!adminB && (await getBalance(playerBId)) < entryFee) throw new InsufficientFunds(playerBId);

  const pot = (adminA ? 0 : entryFee) + (adminB ? 0 : entryFee);

  const stmts: { sql: string; args: (string | number)[] }[] = [];
  if (!adminA) {
    stmts.push({
      sql: "INSERT INTO sky_transactions (user_id, amount, kind, challenge_id, session_id) VALUES (?, ?, 'entry_fee', ?, ?)",
      args: [playerAId, -entryFee, challengeId, sessionId],
    });
  }
  if (!adminB) {
    stmts.push({
      sql: "INSERT INTO sky_transactions (user_id, amount, kind, challenge_id, session_id) VALUES (?, ?, 'entry_fee', ?, ?)",
      args: [playerBId, -entryFee, challengeId, sessionId],
    });
  }
  stmts.push({
    sql: `INSERT INTO escrow_rooms (session_id, challenge_id, player1_id, player2_id, amount, status, system, rom)
          VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
    args: [sessionId, challengeId, playerAId, playerBId, pot, system, rom],
  });
  await db.batch(stmts, "write");

  return {
    player1Id: playerAId,
    player2Id: playerBId,
    pot,
    balances: {
      [playerAId]: await playerBalance(playerAId, sessionId, adminA),
      [playerBId]: await playerBalance(playerBId, sessionId, adminB),
    },
  };
}

/**
 * Settle a duel: pay the winner 75% of the pot (non-admin winner only), bank the platform's
 * share with full match trace, then delete the chamber — all in one transaction. Idempotent:
 * if the chamber is already gone, this is a no-op that just reports the current balances.
 *
 * winnerId/loserId of 0 = a draw or an abandon (no payout; platform keeps the whole pot).
 */
export async function payoutWinner(opts: {
  challengeId: number;
  sessionId: string;
  winnerId: number;
  loserId: number;
}): Promise<PayoutResult> {
  const { challengeId, sessionId, winnerId, loserId } = opts;
  const db = await getDb();

  const room = await db.execute({
    sql: "SELECT challenge_id, player1_id, player2_id, amount, system, rom FROM escrow_rooms WHERE session_id = ?",
    args: [sessionId],
  });

  // No chamber → already settled (or never charged). Resolve the two players for balance
  // reporting from the challenge row, and report the current (final) balances.
  if (room.rows.length === 0) {
    const { player1Id, player2Id } = await resolvePlayers(challengeId, winnerId, loserId);
    const a1 = await isAdmin(player1Id);
    const a2 = await isAdmin(player2Id);
    return {
      player1Id, player2Id, pot: 0, payout: 0, bankAmount: 0, reason: "none", settled: false,
      balances: {
        [player1Id]: await playerBalance(player1Id, sessionId, a1),
        [player2Id]: await playerBalance(player2Id, sessionId, a2),
      },
    };
  }

  const r = room.rows[0];
  const player1Id = Number(r.player1_id);
  const player2Id = Number(r.player2_id);
  const pot = Number(r.amount ?? 0);
  const system = (r.system as string) ?? "neogeo";
  const rom = (r.rom as string) ?? "kof98.zip";
  const roomChallengeId = r.challenge_id != null ? Number(r.challenge_id) : challengeId;

  const decisive = winnerId !== 0;
  const winnerAdmin = decisive ? await isAdmin(winnerId) : false;

  let payout = 0;
  let reason: PayoutResult["reason"];
  if (!decisive) {
    reason = "draw_forfeit"; // draw / abandon: platform keeps the whole pot
  } else if (winnerAdmin) {
    reason = "admin_win"; // admin winner takes no credit; platform keeps the pot
  } else {
    payout = Math.floor(pot * WINNER_SHARE);
    reason = "commission";
  }
  const bankAmount = pot - payout;

  const stmts: { sql: string; args: (string | number)[] }[] = [];
  if (payout > 0) {
    stmts.push({
      sql: "INSERT INTO sky_transactions (user_id, amount, kind, challenge_id, session_id) VALUES (?, ?, 'payout', ?, ?)",
      args: [winnerId, payout, roomChallengeId, sessionId],
    });
  }
  stmts.push({
    sql: `INSERT INTO platform_bank (challenge_id, session_id, winner_id, loser_id, pot, payout, amount, reason, system, rom)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [roomChallengeId, sessionId, winnerId, loserId, pot, payout, bankAmount, reason, system, rom],
  });
  stmts.push({ sql: "DELETE FROM escrow_rooms WHERE session_id = ?", args: [sessionId] });
  await db.batch(stmts, "write");

  const a1 = await isAdmin(player1Id);
  const a2 = await isAdmin(player2Id);
  return {
    player1Id, player2Id, pot, payout, bankAmount, reason, settled: true,
    balances: {
      [player1Id]: await playerBalance(player1Id, sessionId, a1),
      [player2Id]: await playerBalance(player2Id, sessionId, a2),
    },
  };
}

/** Resolve the two duel participants, preferring winner/loser when decisive, else the challenge row. */
async function resolvePlayers(
  challengeId: number,
  winnerId: number,
  loserId: number,
): Promise<{ player1Id: number; player2Id: number }> {
  if (winnerId && loserId) return { player1Id: winnerId, player2Id: loserId };
  const db = await getDb();
  const rs = await db.execute({
    sql: "SELECT challenger_id, target_id FROM duel_challenges WHERE id = ?",
    args: [challengeId],
  });
  if (rs.rows.length > 0) {
    return { player1Id: Number(rs.rows[0].challenger_id), player2Id: Number(rs.rows[0].target_id) };
  }
  return { player1Id: winnerId, player2Id: loserId };
}

// ─── Admin: manual SKY adjustment + dispute resolution ───────────────────────────────

export interface AdminAdjustResult {
  userId: number;
  /** Applied amount (0 when the target is an admin — unlimited, nothing to adjust). */
  amount: number;
  /** Balance after; null when the target is an admin (unlimited). */
  balanceAfter: number | null;
}

/**
 * Admin manual SKY adjustment — a signed ledger row (credit >0 / debit <0). Admins are
 * unlimited, so adjusting one is a reported no-op. The change is additive (the computed
 * earned SKY base is never touched).
 */
export async function adminAdjust(userId: number, amount: number, note?: string): Promise<AdminAdjustResult> {
  if (!Number.isFinite(amount) || Math.round(amount) === 0) {
    throw new Error("amount must be a non-zero number");
  }
  if (await isAdmin(userId)) return { userId, amount: 0, balanceAfter: null };
  const db = await getDb();
  await db.execute({
    sql: "INSERT INTO sky_transactions (user_id, amount, kind, note) VALUES (?, ?, 'admin_adjust', ?)",
    args: [userId, Math.round(amount), note ? note.slice(0, 200) : null],
  });
  return { userId, amount: Math.round(amount), balanceAfter: await getBalance(userId) };
}

export interface LedgerEntry {
  amount: number;
  kind: string;
  challengeId: number | null;
  sessionId: string | null;
  note: string | null;
  createdAt: string | null;
}

/** Recent ledger movements for a user (newest first) — for the admin adjustment screen. */
export async function getUserLedger(userId: number, limit = 20): Promise<LedgerEntry[]> {
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT amount, kind, challenge_id, session_id, note, created_at
          FROM sky_transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
    args: [userId, limit],
  });
  return rs.rows.map((r) => ({
    amount: Number(r.amount ?? 0),
    kind: (r.kind as string) ?? "",
    challengeId: r.challenge_id != null ? Number(r.challenge_id) : null,
    sessionId: (r.session_id as string) ?? null,
    note: (r.note as string) ?? null,
    createdAt: (r.created_at as string) ?? null,
  }));
}

export interface DisputeRoom {
  sessionId: string;
  challengeId: number | null;
  player1Id: number;
  player2Id: number;
  player1Name: string | null;
  player2Name: string | null;
  amount: number;
  system: string;
  rom: string;
  createdAt: string | null;
}

/** All open escrow chambers (orphan/unsettled duels = disputes awaiting an admin decision). */
export async function listOpenDisputes(): Promise<DisputeRoom[]> {
  const db = await getDb();
  const rs = await db.execute(`
    SELECT e.session_id, e.challenge_id, e.player1_id, e.player2_id, e.amount, e.system, e.rom, e.created_at,
           p1.username AS p1_name, p2.username AS p2_name
    FROM escrow_rooms e
    LEFT JOIN users p1 ON p1.id = e.player1_id
    LEFT JOIN users p2 ON p2.id = e.player2_id
    WHERE e.status = 'open'
    ORDER BY e.created_at ASC
  `);
  return rs.rows.map((r) => ({
    sessionId: r.session_id as string,
    challengeId: r.challenge_id != null ? Number(r.challenge_id) : null,
    player1Id: Number(r.player1_id),
    player2Id: Number(r.player2_id),
    player1Name: (r.p1_name as string) ?? null,
    player2Name: (r.p2_name as string) ?? null,
    amount: Number(r.amount ?? 0),
    system: (r.system as string) ?? "neogeo",
    rom: (r.rom as string) ?? "kof98.zip",
    createdAt: (r.created_at as string) ?? null,
  }));
}

export type DisputeAction = "refund_both" | "award_winner" | "all_to_bank" | "split";

export interface ResolveDisputeParams {
  /** award_winner: which player wins (must be one of the two participants). */
  winnerId?: number;
  /** split: explicit SKY credited to player1 / player2 (admins are skipped; the rest is banked). */
  p1Amount?: number;
  p2Amount?: number;
  note?: string;
}

export interface ResolveDisputeResult {
  resolved: boolean;
  pot: number;
  payout: number;
  bankAmount: number;
}

/**
 * Resolve a disputed/orphan escrow chamber (admin only). Applies the chosen distribution as
 * `dispute` ledger credits, records one `platform_bank` row (reason 'dispute') with the full
 * match trace, then deletes the chamber — all in one transaction. Idempotent: a chamber that is
 * already gone reports `resolved:false` (no-op). Admin recipients are never credited (unlimited).
 */
export async function resolveDispute(
  sessionId: string,
  action: DisputeAction,
  params: ResolveDisputeParams = {},
): Promise<ResolveDisputeResult> {
  const db = await getDb();
  const roomRs = await db.execute({
    sql: "SELECT challenge_id, player1_id, player2_id, amount, system, rom FROM escrow_rooms WHERE session_id = ? AND status = 'open'",
    args: [sessionId],
  });
  if (roomRs.rows.length === 0) {
    return { resolved: false, pot: 0, payout: 0, bankAmount: 0 };
  }

  const r = roomRs.rows[0];
  const challengeId = r.challenge_id != null ? Number(r.challenge_id) : null;
  const p1 = Number(r.player1_id);
  const p2 = Number(r.player2_id);
  const pot = Number(r.amount ?? 0);
  const system = (r.system as string) ?? "neogeo";
  const rom = (r.rom as string) ?? "kof98.zip";
  const a1 = await isAdmin(p1);
  const a2 = await isAdmin(p2);

  let c1 = 0; // credit to player1
  let c2 = 0; // credit to player2
  let winnerId = 0;
  let loserId = 0;

  if (action === "refund_both") {
    // Return each non-admin's stake; the collected pot equals the sum of non-admin stakes → bank 0.
    // Look up the per-game entry fee, falling back to the default.
    let gameEntryFee = DEFAULT_ENTRY_FEE;
    try {
      const feeRs = await db.execute({ sql: "SELECT entry_fee FROM duel_games WHERE system = ? AND rom = ? LIMIT 1", args: [system, rom] });
      if (feeRs.rows.length > 0) gameEntryFee = Number(feeRs.rows[0].entry_fee ?? DEFAULT_ENTRY_FEE);
    } catch { /* use default */ }
    c1 = a1 ? 0 : gameEntryFee;
    c2 = a2 ? 0 : gameEntryFee;
  } else if (action === "award_winner") {
    winnerId = Number(params.winnerId ?? 0);
    if (winnerId !== p1 && winnerId !== p2) throw new Error("winnerId must be one of the participants");
    loserId = winnerId === p1 ? p2 : p1;
    const winnerAdmin = winnerId === p1 ? a1 : a2;
    const award = winnerAdmin ? 0 : Math.floor(pot * WINNER_SHARE);
    if (winnerId === p1) c1 = award; else c2 = award;
  } else if (action === "all_to_bank") {
    // Whole pot forfeited to the bank; players get nothing.
  } else if (action === "split") {
    c1 = a1 ? 0 : Math.max(0, Math.round(params.p1Amount ?? 0));
    c2 = a2 ? 0 : Math.max(0, Math.round(params.p2Amount ?? 0));
    if (c1 + c2 > pot) throw new Error("split exceeds the pot");
  } else {
    throw new Error(`unknown dispute action: ${action}`);
  }

  const payout = c1 + c2;
  const bankAmount = pot - payout;
  const note = (params.note ? `dispute:${action} — ${params.note}` : `dispute:${action}`).slice(0, 200);

  const stmts: { sql: string; args: (string | number | null)[] }[] = [];
  if (c1 > 0) {
    stmts.push({
      sql: "INSERT INTO sky_transactions (user_id, amount, kind, challenge_id, session_id, note) VALUES (?, ?, 'dispute', ?, ?, ?)",
      args: [p1, c1, challengeId, sessionId, note],
    });
  }
  if (c2 > 0) {
    stmts.push({
      sql: "INSERT INTO sky_transactions (user_id, amount, kind, challenge_id, session_id, note) VALUES (?, ?, 'dispute', ?, ?, ?)",
      args: [p2, c2, challengeId, sessionId, note],
    });
  }
  stmts.push({
    sql: `INSERT INTO platform_bank (challenge_id, session_id, winner_id, loser_id, pot, payout, amount, reason, system, rom)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'dispute', ?, ?)`,
    args: [challengeId, sessionId, winnerId, loserId, pot, payout, bankAmount, system, rom],
  });
  stmts.push({ sql: "DELETE FROM escrow_rooms WHERE session_id = ?", args: [sessionId] });
  await db.batch(stmts, "write");

  return { resolved: true, pot, payout, bankAmount };
}
