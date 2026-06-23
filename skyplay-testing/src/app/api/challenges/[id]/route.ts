import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAuthFromRequest } from "@/lib/auth";

/**
 * GET /api/challenges/[id]
 * Returns challenge details + submissions + leaderboard.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    // Fetch challenge
    const crs = await db.execute({
      sql: `SELECT c.*, u.username AS created_by_name
            FROM challenges c
            LEFT JOIN users u ON c.created_by = u.id
            WHERE c.id = ?`,
      args: [Number(id)],
    });

    if (crs.rows.length === 0) {
      return NextResponse.json(
        { error: "Challenge introuvable" },
        { status: 404 }
      );
    }

    const row = crs.rows[0];
    const challenge = {
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
    };

    // Fetch approved submissions (leaderboard)
    const srs = await db.execute({
      sql: `SELECT cs.id, cs.user_id, cs.result, cs.status, cs.submitted_at, u.username
            FROM challenge_submissions cs
            JOIN users u ON cs.user_id = u.id
            WHERE cs.challenge_id = ?
            ORDER BY cs.submitted_at ASC`,
      args: [Number(id)],
    });

    const submissions = srs.rows.map((s) => ({
      id: s.id,
      userId: s.user_id,
      username: s.username,
      result: s.result,
      status: s.status,
      submittedAt: s.submitted_at,
    }));

    // Check if current user has submitted
    const auth = await getAuthFromRequest(request);
    let userSubmission = null;
    if (auth) {
      const us = await db.execute({
        sql: "SELECT * FROM challenge_submissions WHERE challenge_id = ? AND user_id = ?",
        args: [Number(id), auth.userId],
      });
      if (us.rows.length > 0) {
        const s = us.rows[0];
        userSubmission = {
          id: s.id,
          result: s.result,
          status: s.status,
          submittedAt: s.submitted_at,
        };
      }
    }

    return NextResponse.json({ challenge, submissions, userSubmission });
  } catch (error) {
    console.error("GET /api/challenges/[id] error:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
