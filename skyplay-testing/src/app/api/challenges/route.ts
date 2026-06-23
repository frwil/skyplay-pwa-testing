import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * GET /api/challenges
 * Lists active challenges (public).
 * Query params: ?status=active (default) | past | all
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "active";

    const db = await getDb();

    let sql = `
      SELECT c.*, u.username AS created_by_name,
        (SELECT COUNT(*) FROM challenge_submissions cs WHERE cs.challenge_id = c.id) AS submission_count
      FROM challenges c
      LEFT JOIN users u ON c.created_by = u.id
    `;

    const now = new Date().toISOString();
    if (status === "active") {
      sql += ` WHERE c.starts_at <= '${now}' AND c.ends_at > '${now}'`;
    } else if (status === "past") {
      sql += ` WHERE c.ends_at <= '${now}'`;
    }

    sql += ` ORDER BY c.ends_at ASC`;

    const rs = await db.execute(sql);

    const challenges = rs.rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      system: row.system,
      romName: row.rom_name,
      criteria: row.criteria,
      reward: row.reward,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      createdAt: row.created_at,
      createdBy: row.created_by,
      createdByName: row.created_by_name,
      submissionCount: row.submission_count,
    }));

    return NextResponse.json({ challenges });
  } catch (error) {
    console.error("GET /api/challenges error:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
