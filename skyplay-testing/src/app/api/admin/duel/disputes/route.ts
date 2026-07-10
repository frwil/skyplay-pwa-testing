import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAdmin } from "@/lib/auth";
import { listOpenDisputes, getOpenEscrowTotal, getBankTotal } from "@/lib/duel/wallet";
import { getDb } from "@/lib/db";

/**
 * GET /api/admin/duel/disputes
 * List open escrow chambers (unsettled/orphan duels = disputes awaiting an admin decision),
 * plus the totals currently in transit (open escrow) and definitively banked. Each dispute
 * gets a `recordingUrl` (admin proxy link) when a Plan A recording exists for its session.
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

  // Attach a recording link where one exists (one lookup for all disputed sessions).
  let withRecordings = disputes as (typeof disputes[number] & { recordingUrl?: string })[];
  if (disputes.length > 0) {
    try {
      const db = await getDb();
      const placeholders = disputes.map(() => "?").join(",");
      const rs = await db.execute({
        sql: `SELECT session_id FROM duel_recordings WHERE session_id IN (${placeholders})`,
        args: disputes.map((d) => d.sessionId),
      });
      const have = new Set(rs.rows.map((r) => r.session_id as string));
      withRecordings = disputes.map((d) => ({
        ...d,
        recordingUrl: have.has(d.sessionId) ? `/api/admin/duel/recording/${d.sessionId}` : undefined,
      }));
    } catch { /* recordings table may not exist yet — degrade gracefully */ }
  }

  return NextResponse.json({ disputes: withRecordings, totals: { openEscrow: escrowTotal, bank: bankTotal } });
}
