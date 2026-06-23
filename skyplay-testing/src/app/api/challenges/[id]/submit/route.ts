import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAuthFromRequest } from "@/lib/auth";

/**
 * POST /api/challenges/[id]/submit
 * Submit a challenge result (authenticated).
 * Body: { result: string, screenshot?: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await getAuthFromRequest(request);
    if (!auth) {
      return NextResponse.json(
        { error: "Vous devez être connecté pour participer à un challenge" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { result, screenshot } = body;

    if (!result) {
      return NextResponse.json(
        { error: "Le résultat est requis (win, loss, score…)" },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Check challenge exists and is active
    const crs = await db.execute({
      sql: "SELECT * FROM challenges WHERE id = ?",
      args: [Number(id)],
    });

    if (crs.rows.length === 0) {
      return NextResponse.json(
        { error: "Challenge introuvable" },
        { status: 404 }
      );
    }

    const challenge = crs.rows[0];
    const now = new Date().toISOString();
    const startsAt = challenge.starts_at as string;
    const endsAt = challenge.ends_at as string;

    if (startsAt > now) {
      return NextResponse.json(
        { error: "Ce challenge n'a pas encore commencé" },
        { status: 403 }
      );
    }

    if (endsAt <= now) {
      return NextResponse.json(
        { error: "Ce challenge est terminé" },
        { status: 403 }
      );
    }

    // Check for existing submission (one per user per challenge)
    const existing = await db.execute({
      sql: "SELECT id FROM challenge_submissions WHERE challenge_id = ? AND user_id = ?",
      args: [Number(id), auth.userId],
    });

    if (existing.rows.length > 0) {
      return NextResponse.json(
        { error: "Tu as déjà soumis un résultat pour ce challenge" },
        { status: 409 }
      );
    }

    // Validate screenshot
    if (screenshot && !screenshot.startsWith("data:image")) {
      return NextResponse.json(
        { error: "Format de capture d'écran invalide" },
        { status: 400 }
      );
    }

    // Insert submission
    const insert = await db.execute({
      sql: `INSERT INTO challenge_submissions (challenge_id, user_id, result, screenshot_base64, status)
            VALUES (?, ?, ?, ?, 'PENDING')`,
      args: [Number(id), auth.userId, result, screenshot || null],
    });

    return NextResponse.json(
      {
        success: true,
        submission: {
          id: Number(insert.lastInsertRowid),
          challengeId: Number(id),
          result,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/challenges/[id]/submit error:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
