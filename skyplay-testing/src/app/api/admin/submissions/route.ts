import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAuthFromRequest, requireAdmin } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthFromRequest(request);
    if (!requireAdmin(auth)) {
      return NextResponse.json(
        { error: "Non autorisé. Authentification admin requise." },
        { status: 401 }
      );
    }

    const db = await getDb();

    // NOTE: screenshot_base64 is intentionally excluded from the list query.
    // Screenshots can be 500KB-2MB+ each; fetching them all at once was the #1
    // cause of admin page slowness. Use GET /api/admin/submissions/[id]/screenshot
    // to load a single screenshot on demand.
    const submissionsRs = await db.execute(
      `SELECT
        s.id,
        s.user_id,
        s.step_id,
        s.question_id,
        s.answer_text,
        s.status,
        s.submitted_at,
        u.username,
        u.email,
        st.slug as step_slug,
        st.title as step_title,
        q.question_text,
        q.reward_amount as question_reward
      FROM submissions s
      LEFT JOIN users u ON s.user_id = u.id
      LEFT JOIN steps st ON s.step_id = st.id
      LEFT JOIN questions q ON s.question_id = q.id
      ORDER BY s.submitted_at DESC`
    );

    const statsRs = await db.execute(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) as rejected
      FROM submissions`
    );

    return NextResponse.json({
      submissions: submissionsRs.rows,
      stats: statsRs.rows[0],
    });
  } catch (error) {
    console.error("GET /api/admin/submissions error:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
