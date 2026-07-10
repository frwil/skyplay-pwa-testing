import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAdmin } from "@/lib/auth";
import { resolveDispute, type DisputeAction, type ResolveDisputeParams } from "@/lib/duel/wallet";

const ACTIONS: DisputeAction[] = ["refund_both", "award_winner", "all_to_bank", "split"];

/**
 * POST /api/admin/duel/dispute/resolve  { sessionId, action, params? }
 * Resolve a disputed/orphan escrow chamber (refund both, award a winner, forfeit to bank, or
 * split). Idempotent — a chamber already resolved reports resolved:false.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthFromRequest(req);
    if (!requireAdmin(auth)) {
      return NextResponse.json({ error: "Non autorisé. Authentification admin requise." }, { status: 401 });
    }

    const body = (await req.json()) as { sessionId?: string; action?: string; params?: ResolveDisputeParams };
    const sessionId = body.sessionId?.trim();
    const action = body.action as DisputeAction | undefined;

    if (!sessionId) return NextResponse.json({ error: "sessionId requis" }, { status: 400 });
    if (!action || !ACTIONS.includes(action)) {
      return NextResponse.json({ error: `action invalide (${ACTIONS.join(", ")})` }, { status: 400 });
    }

    const result = await resolveDispute(sessionId, action, body.params ?? {});
    if (!result.resolved) {
      return NextResponse.json({ success: false, message: "Litige déjà résolu (chambre absente).", ...result });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur interne du serveur";
    console.error("POST /api/admin/duel/dispute/resolve error:", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
