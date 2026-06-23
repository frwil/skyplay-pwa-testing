import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAuthFromRequest } from "@/lib/auth";

/**
 * POST /api/challenges/[id]/participate
 * Join a challenge as a participant (auth required).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthFromRequest(request);
    if (!auth) {
      return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
    }

    const { id } = await params;
    const challengeId = parseInt(id, 10);
    if (isNaN(challengeId)) {
      return NextResponse.json({ error: "ID de challenge invalide" }, { status: 400 });
    }

    const db = await getDb();

    // Verify challenge exists and is active
    const challengeRs = await db.execute({
      sql: "SELECT id, starts_at, ends_at FROM challenges WHERE id = ?",
      args: [challengeId],
    });
    if (challengeRs.rows.length === 0) {
      return NextResponse.json({ error: "Challenge introuvable" }, { status: 404 });
    }

    // Insert or ignore (idempotent)
    await db.execute({
      sql: "INSERT OR IGNORE INTO challenge_participants (challenge_id, user_id, status) VALUES (?, ?, 'READY')",
      args: [challengeId, auth.userId],
    });

    // Fetch the participant record
    const partRs = await db.execute({
      sql: "SELECT id, challenge_id, user_id, status, created_at FROM challenge_participants WHERE challenge_id = ? AND user_id = ?",
      args: [challengeId, auth.userId],
    });

    const row = partRs.rows[0];
    return NextResponse.json({
      success: true,
      participant: {
        id: row.id,
        challengeId: row.challenge_id,
        userId: row.user_id,
        status: row.status,
        createdAt: row.created_at,
      },
    }, { status: 201 });
  } catch (error) {
    console.error("POST /api/challenges/[id]/participate error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}

/**
 * DELETE /api/challenges/[id]/participate
 * Leave a challenge (auth required).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthFromRequest(request);
    if (!auth) {
      return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
    }

    const { id } = await params;
    const challengeId = parseInt(id, 10);
    if (isNaN(challengeId)) {
      return NextResponse.json({ error: "ID de challenge invalide" }, { status: 400 });
    }

    const db = await getDb();
    await db.execute({
      sql: "DELETE FROM challenge_participants WHERE challenge_id = ? AND user_id = ?",
      args: [challengeId, auth.userId],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/challenges/[id]/participate error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}
