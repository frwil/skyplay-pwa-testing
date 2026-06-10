import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  try {
    const db = await getDb();

    const stepsRs = await db.execute("SELECT * FROM steps ORDER BY id");

    const stepsWithQuestions = await Promise.all(
      stepsRs.rows.map(async (step) => {
        const qRs = await db.execute({
          sql: "SELECT id, question_text, reward_amount, sort_order FROM questions WHERE step_id = ? ORDER BY sort_order",
          args: [step.id],
        });
        return { ...step, questions: qRs.rows };
      })
    );

    return NextResponse.json({ steps: stepsWithQuestions });
  } catch (error) {
    console.error("GET /api/steps error:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
