import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  try {
    const db = await getDb();

    const rs = await db.execute(
      `SELECT
        s.id, s.slug, s.title,
        COALESCE(
          json_group_array(
            json_object('id', q.id, 'question_text', q.question_text, 'reward_amount', q.reward_amount, 'sort_order', q.sort_order, 'requires_screenshot', q.requires_screenshot, 'answer_type', q.answer_type, 'answer_options', q.answer_options, 'reference_link', q.reference_link, 'parts', q.parts)
          ),
          '[]'
        ) as questions_json
      FROM steps s
      LEFT JOIN questions q ON q.step_id = s.id
      GROUP BY s.id
      ORDER BY s.id`
    );

    const stepsWithQuestions = (
      rs.rows as unknown as {
        id: number;
        slug: string;
        title: string;
        questions_json: string;
      }[]
    ).map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      questions: JSON.parse(row.questions_json),
    }));

    return NextResponse.json({ steps: stepsWithQuestions });
  } catch (error) {
    console.error("GET /api/steps error:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
