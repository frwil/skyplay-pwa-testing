import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAuthFromRequest, requireAdmin } from "@/lib/auth";

/**
 * POST /api/admin/challenge-submissions/approve
 * Approve or reject a challenge submission (admin).
 * Body: { submissionId: number, status: "APPROVED" | "REJECTED" }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthFromRequest(request);
    if (!requireAdmin(auth)) {
      return NextResponse.json({ error: "Accès non autorisé" }, { status: 401 });
    }

    const body = await request.json();
    const { submissionId, status: newStatus } = body;

    if (!submissionId || !newStatus) {
      return NextResponse.json(
        { error: "submissionId et status sont requis" },
        { status: 400 }
      );
    }

    if (newStatus !== "APPROVED" && newStatus !== "REJECTED") {
      return NextResponse.json(
        { error: "Le status doit être APPROVED ou REJECTED" },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Fetch submission + challenge
    const srs = await db.execute({
      sql: `SELECT cs.*, c.criteria, c.reward, c.title AS challenge_title
            FROM challenge_submissions cs
            JOIN challenges c ON cs.challenge_id = c.id
            WHERE cs.id = ?`,
      args: [submissionId],
    });

    if (srs.rows.length === 0) {
      return NextResponse.json(
        { error: "Soumission introuvable" },
        { status: 404 }
      );
    }

    const sub = srs.rows[0];

    if (sub.status !== "PENDING") {
      return NextResponse.json(
        { error: "Cette soumission a déjà été traitée" },
        { status: 409 }
      );
    }

    await db.execute({
      sql: "UPDATE challenge_submissions SET status = ? WHERE id = ?",
      args: [newStatus, submissionId],
    });

    return NextResponse.json({
      success: true,
      submission: {
        id: submissionId,
        status: newStatus,
        challengeTitle: sub.challenge_title,
        reward: sub.reward,
      },
    });
  } catch (error) {
    console.error("POST /api/admin/challenge-submissions/approve error:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
