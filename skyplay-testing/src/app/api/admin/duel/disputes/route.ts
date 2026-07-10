import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAdmin } from "@/lib/auth";
import { listOpenDisputes, getOpenEscrowTotal, getBankTotal } from "@/lib/duel/wallet";

/**
 * GET /api/admin/duel/disputes
 * List open escrow chambers (unsettled/orphan duels = disputes awaiting an admin decision),
 * plus the totals currently in transit (open escrow) and definitively banked.
 */
export async function GET(req: NextRequest) {
  const auth = await getAuthFromRequest(req);
  if (!requireAdmin(auth)) {
    return NextResponse.json({ error: "Non autorisé. Authentification admin requise." }, { status: 401 });
  }

  const [disputes, escrowTotal, bankTotal] = await Promise.all([
    listOpenDisputes(),
    getOpenEscrowTotal(),
    getBankTotal(),
  ]);

  return NextResponse.json({ disputes, totals: { openEscrow: escrowTotal, bank: bankTotal } });
}
