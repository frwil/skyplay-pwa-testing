import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAuthFromRequest, requireAdmin } from "@/lib/auth";
import { adminAdjust, getBalance, getUserLedger } from "@/lib/duel/wallet";

/** Resolve a user by numeric id or (case-insensitive) username. */
async function findUser(idOrName: string): Promise<{ id: number; username: string; role: string } | null> {
  const db = await getDb();
  const asId = parseInt(idOrName, 10);
  const rs = await db.execute({
    sql: "SELECT id, username, role FROM users WHERE id = ? OR LOWER(username) = LOWER(?) LIMIT 1",
    args: [Number.isFinite(asId) ? asId : -1, idOrName],
  });
  if (rs.rows.length === 0) return null;
  const r = rs.rows[0];
  return { id: Number(r.id), username: (r.username as string) ?? "", role: (r.role as string) ?? "user" };
}

function serializeBalance(balance: number) {
  const unlimited = !Number.isFinite(balance);
  return { balance: unlimited ? null : balance, unlimitedSky: unlimited };
}

/**
 * GET /api/admin/sky/adjust?query=<id|username>
 * Look up a user's current SKY balance + recent ledger (for the admin adjustment screen).
 */
export async function GET(req: NextRequest) {
  const auth = await getAuthFromRequest(req);
  if (!requireAdmin(auth)) {
    return NextResponse.json({ error: "Non autorisé. Authentification admin requise." }, { status: 401 });
  }
  const query = req.nextUrl.searchParams.get("query")?.trim();
  if (!query) return NextResponse.json({ error: "query requis" }, { status: 400 });

  const user = await findUser(query);
  if (!user) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });

  const balance = await getBalance(user.id);
  const ledger = await getUserLedger(user.id, 20);
  return NextResponse.json({ user, ...serializeBalance(balance), ledger });
}

/**
 * POST /api/admin/sky/adjust  { query (id|username), amount (signed), note? }
 * Credit (amount>0) or debit (amount<0) a user's SKY via an additive ledger row.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthFromRequest(req);
    if (!requireAdmin(auth)) {
      return NextResponse.json({ error: "Non autorisé. Authentification admin requise." }, { status: 401 });
    }

    const body = (await req.json()) as { query?: string; userId?: number; amount?: number; note?: string };
    const query = (body.query ?? (body.userId != null ? String(body.userId) : ""))?.toString().trim();
    const amount = Number(body.amount);
    if (!query) return NextResponse.json({ error: "query requis" }, { status: 400 });
    if (!Number.isFinite(amount) || Math.round(amount) === 0) {
      return NextResponse.json({ error: "amount doit être un entier non nul" }, { status: 400 });
    }

    const user = await findUser(query);
    if (!user) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });

    const result = await adminAdjust(user.id, amount, body.note);
    const balance = await getBalance(user.id);
    const ledger = await getUserLedger(user.id, 20);
    return NextResponse.json({ success: true, user, applied: result.amount, ...serializeBalance(balance), ledger });
  } catch (error) {
    console.error("POST /api/admin/sky/adjust error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}
