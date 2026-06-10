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

    // Per-phase stats
    const phasesRs = await db.execute(
      `SELECT
        st.id,
        st.slug,
        st.title,
        COUNT(DISTINCT q.id) as total_questions,
        COUNT(DISTINCT s.id) as total_submissions,
        COUNT(DISTINCT CASE WHEN s.status = 'APPROVED' THEN s.id END) as approved,
        COUNT(DISTINCT CASE WHEN s.status = 'PENDING' THEN s.id END) as pending,
        COUNT(DISTINCT CASE WHEN s.status = 'REJECTED' THEN s.id END) as rejected,
        COALESCE(SUM(CASE WHEN s.status = 'APPROVED' THEN q.reward_amount ELSE 0 END), 0) as total_rewards
      FROM steps st
      LEFT JOIN questions q ON q.step_id = st.id
      LEFT JOIN submissions s ON s.step_id = st.id
      GROUP BY st.id
      ORDER BY st.id`
    );

    // Per-user stats (testers only — exclude admins)
    const usersRs = await db.execute(
      `SELECT
        u.id,
        u.username,
        u.email,
        COUNT(DISTINCT s.id) as total_submissions,
        COUNT(DISTINCT CASE WHEN s.status = 'APPROVED' THEN s.id END) as approved_submissions,
        COALESCE(SUM(CASE WHEN s.status = 'APPROVED' THEN q.reward_amount ELSE 0 END), 0) as total_rewards,
        GROUP_CONCAT(DISTINCT st.slug) as completed_phases
      FROM users u
      LEFT JOIN submissions s ON s.user_id = u.id
      LEFT JOIN questions q ON q.id = s.question_id
      LEFT JOIN steps st ON st.id = s.step_id
      WHERE u.role = 'user' OR u.role IS NULL
      GROUP BY u.id
      ORDER BY total_rewards DESC`
    );

    // Overview
    const overviewRs = await db.execute(
      `SELECT
        (SELECT COUNT(*) FROM users WHERE role = 'user' OR role IS NULL) as total_users,
        (SELECT COUNT(*) FROM submissions) as total_submissions,
        (SELECT COUNT(*) FROM submissions WHERE status = 'APPROVED') as approved_count,
        (SELECT COUNT(*) FROM submissions WHERE status = 'PENDING') as pending_count,
        (SELECT COUNT(*) FROM submissions WHERE status = 'REJECTED') as rejected_count,
        COALESCE((SELECT SUM(q.reward_amount) FROM submissions s JOIN questions q ON s.question_id = q.id WHERE s.status = 'APPROVED'), 0) as total_sky_distributed`
    );

    return NextResponse.json({
      phases: phasesRs.rows,
      users: usersRs.rows,
      overview: overviewRs.rows[0],
    });
  } catch (error) {
    console.error("GET /api/admin/stats error:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
