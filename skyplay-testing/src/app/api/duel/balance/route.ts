import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest } from "@/lib/auth";
import { getBalance, DEFAULT_ENTRY_FEE } from "@/lib/duel/wallet";

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
 * GET /api/duel/balance
 * Returns the caller's current duel SKY balance (used for the header badge and to gate the
 * challenge / rematch buttons). Admins report unlimitedSky: true (balance null).
 */
export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
  }
  const balance = await getBalance(userId);
  const unlimited = !Number.isFinite(balance);
  return NextResponse.json({
    balance: unlimited ? null : balance,
    unlimitedSky: unlimited,
    entryFee: DEFAULT_ENTRY_FEE,
    canPlay: unlimited || balance >= DEFAULT_ENTRY_FEE,
  });
}
