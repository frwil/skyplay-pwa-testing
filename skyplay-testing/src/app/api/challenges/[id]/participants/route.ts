import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * GET /api/challenges/[id]/participants
 * List all participants for a challenge, with online status.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const challengeId = parseInt(id, 10);
    if (isNaN(challengeId)) {
      return NextResponse.json({ error: "ID de challenge invalide" }, { status: 400 });
    }

    const db = await getDb();

    const rs = await db.execute({
      sql: `
        SELECT cp.id, cp.user_id, cp.status AS participation_status, cp.created_at,
               u.username,
               p.is_online, p.last_seen
        FROM challenge_participants cp
        JOIN users u ON cp.user_id = u.id
        LEFT JOIN presence p ON p.user_id = u.id
        WHERE cp.challenge_id = ?
        ORDER BY cp.created_at ASC
      `,
      args: [challengeId],
    });

    const participants = rs.rows.map((row) => ({
      id: row.id as number,
      userId: row.user_id as number,
      username: row.username as string,
      status: row.participation_status as string,
      createdAt: row.created_at as string,
      isOnline: (row.is_online as number) === 1,
      lastSeen: row.last_seen as string | null,
    }));

    return NextResponse.json({ participants });
  } catch (error) {
    console.error("GET /api/challenges/[id]/participants error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}
