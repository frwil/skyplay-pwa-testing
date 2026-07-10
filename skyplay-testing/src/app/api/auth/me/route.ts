import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getBalance } from "@/lib/duel/wallet";

export async function GET(request: NextRequest) {
  const auth = await getAuthFromRequest(request);

  if (!auth) {
    return NextResponse.json(
      { error: "Non authentifié" },
      { status: 401 }
    );
  }

  try {
    const db = await getDb();
    const rs = await db.execute({
      sql: "SELECT id, username, role, avatar_base64, country FROM users WHERE id = ?",
      args: [auth.userId],
    });
    const row = rs.rows[0] as unknown as
      | { id: number; username: string; role: string; avatar_base64: string | null; country: string | null }
      | undefined;

    if (!row) {
      return NextResponse.json(
        { error: "Utilisateur introuvable" },
        { status: 401 }
      );
    }

    // Duel SKY balance (Infinity for admins → surfaced as unlimitedSky, balance null).
    const balance = await getBalance(row.id);
    const unlimited = !Number.isFinite(balance);

    return NextResponse.json({
      user: {
        id: row.id,
        username: row.username,
        role: row.role,
        balance: unlimited ? null : balance,
        unlimitedSky: unlimited,
        avatar: row.avatar_base64 ?? null,
        country: row.country ?? null,
      },
    });
  } catch {
    // Fallback: return JWT payload if DB lookup fails
    return NextResponse.json({
      user: { id: auth.userId, username: "", role: auth.role },
    });
  }
}
