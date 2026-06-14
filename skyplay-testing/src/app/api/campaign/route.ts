import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  try {
    const db = await getDb();
    const rs = await db.execute(
      `SELECT id, name, deadline, created_at
       FROM campaigns
       ORDER BY created_at DESC
       LIMIT 1`
    );
    const campaign = rs.rows[0] as unknown as
      | { id: number; name: string; deadline: string; created_at: string }
      | undefined;

    if (!campaign) {
      return NextResponse.json({ campaign: null });
    }

    const deadlineMs = Date.parse(campaign.deadline);
    const now = Date.now();
    const expired = now > deadlineMs;

    return NextResponse.json({
      campaign: {
        id: campaign.id,
        name: campaign.name,
        deadline: campaign.deadline,
        createdAt: campaign.created_at,
        expired,
        remainingMs: Math.max(0, deadlineMs - now),
      },
    });
  } catch (error) {
    console.error("GET /api/campaign error:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
