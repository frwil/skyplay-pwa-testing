import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, questionId, answerText, screenshot } = body;

    // Validation
    if (!userId || !questionId || !answerText || !screenshot) {
      return NextResponse.json(
        { error: "Tous les champs sont requis : userId, questionId, answerText, screenshot" },
        { status: 400 }
      );
    }

    if (typeof userId !== "number" || typeof questionId !== "number") {
      return NextResponse.json(
        { error: "userId et questionId doivent être des nombres" },
        { status: 400 }
      );
    }

    if (typeof answerText !== "string" || answerText.trim().length === 0) {
      return NextResponse.json(
        { error: "La réponse ne peut pas être vide" },
        { status: 400 }
      );
    }

    if (typeof screenshot !== "string" || (!screenshot.startsWith("data:image") && !screenshot.startsWith("data:video"))) {
      return NextResponse.json(
        { error: "La preuve doit être une image ou une vidéo encodée en Base64" },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Vérifier que la campagne est toujours active
    const campaignRs = await db.execute(
      "SELECT deadline FROM campaigns ORDER BY created_at DESC LIMIT 1"
    );
    const activeCampaign = campaignRs.rows[0] as unknown as { deadline: string } | undefined;
    if (activeCampaign) {
      const deadlineMs = Date.parse(activeCampaign.deadline);
      if (Date.now() > deadlineMs) {
        return NextResponse.json(
          { error: "La campagne de test est terminée. Les soumissions sont fermées." },
          { status: 403 }
        );
      }
    }

    // Vérifier que l'utilisateur existe
    const userRs = await db.execute({
      sql: "SELECT id FROM users WHERE id = ?",
      args: [userId],
    });
    if (userRs.rows.length === 0) {
      return NextResponse.json(
        { error: "Utilisateur introuvable" },
        { status: 404 }
      );
    }

    // Vérifier que la question existe et récupérer son step_id
    const qRs = await db.execute({
      sql: "SELECT id, step_id, reward_amount FROM questions WHERE id = ?",
      args: [questionId],
    });
    const question = qRs.rows[0] as unknown as
      | { id: number; step_id: number; reward_amount: number }
      | undefined;

    if (!question) {
      return NextResponse.json(
        { error: "Question introuvable" },
        { status: 404 }
      );
    }

    // Vérifier l'unicité (user_id, question_id)
    const existingRs = await db.execute({
      sql: "SELECT id, status FROM submissions WHERE user_id = ? AND question_id = ?",
      args: [userId, questionId],
    });
    const existing = existingRs.rows[0] as unknown as
      | { id: number; status: string }
      | undefined;

    if (existing) {
      return NextResponse.json(
        {
          error: "Tu as déjà répondu à cette question",
          existingSubmission: { id: existing.id, status: existing.status },
        },
        { status: 409 }
      );
    }

    // Insertion
    const result = await db.execute({
      sql: `INSERT INTO submissions (user_id, step_id, question_id, answer_text, screenshot_base64, status)
            VALUES (?, ?, ?, ?, ?, 'PENDING')`,
      args: [userId, question.step_id, questionId, answerText.trim(), screenshot],
    });

    return NextResponse.json(
      {
        success: true,
        submission: {
          id: Number(result.lastInsertRowid),
          userId,
          questionId,
          stepId: question.step_id,
          reward: question.reward_amount,
          status: "PENDING",
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/submit error:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
