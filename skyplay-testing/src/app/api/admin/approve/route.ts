import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAuthFromRequest, requireAdmin } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthFromRequest(request);
    if (!requireAdmin(auth)) {
      return NextResponse.json(
        { error: "Non autorisé. Authentification admin requise." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { submissionId, status } = body;

    if (!submissionId || !status) {
      return NextResponse.json(
        { error: "submissionId et status sont requis" },
        { status: 400 }
      );
    }

    if (!["APPROVED", "REJECTED"].includes(status)) {
      return NextResponse.json(
        { error: "Le statut doit être APPROVED ou REJECTED" },
        { status: 400 }
      );
    }

    const db = await getDb();

    const subRs = await db.execute({
      sql: "SELECT id, status, user_id, step_id, question_id FROM submissions WHERE id = ?",
      args: [submissionId],
    });
    const submission = subRs.rows[0] as unknown as
      | { id: number; status: string; user_id: number; step_id: number; question_id: number }
      | undefined;

    if (!submission) {
      return NextResponse.json(
        { error: "Soumission introuvable" },
        { status: 404 }
      );
    }

    if (submission.status !== "PENDING") {
      return NextResponse.json(
        { error: `Cette soumission a déjà été traitée (statut: ${submission.status})` },
        { status: 409 }
      );
    }

    // Mise à jour
    await db.execute({
      sql: "UPDATE submissions SET status = ? WHERE id = ?",
      args: [status, submissionId],
    });

    // Auto-approve participation bonus when Q1 (account creation) is approved
    if (status === "APPROVED" && submission.question_id === 1) {
      await db.execute({
        sql: "UPDATE users SET bonus_status = 'APPROVED' WHERE id = ? AND bonus_status = 'PENDING'",
        args: [submission.user_id],
      });
    }

    // Récupérer la soumission mise à jour
    const updatedRs = await db.execute({
      sql: `SELECT
        s.id, s.status, s.user_id, s.step_id, s.question_id, s.submitted_at,
        u.username,
        st.title as step_title,
        q.question_text,
        q.reward_amount
      FROM submissions s
      JOIN users u ON s.user_id = u.id
      JOIN steps st ON s.step_id = st.id
      JOIN questions q ON s.question_id = q.id
      WHERE s.id = ?`,
      args: [submissionId],
    });

    const updated = updatedRs.rows[0] as unknown as { reward_amount: number };

    return NextResponse.json({
      success: true,
      submission: updated,
      message:
        status === "APPROVED"
          ? `Question approuvée ! ${updated.reward_amount} Sky crédités.`
          : "Soumission rejetée.",
    });
  } catch (error) {
    console.error("POST /api/admin/approve error:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
