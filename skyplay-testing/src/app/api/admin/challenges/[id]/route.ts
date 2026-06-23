import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAuthFromRequest, requireAdmin } from "@/lib/auth";

/**
 * GET /api/admin/challenges/[id]
 * Returns challenge + all submissions (admin view).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthFromRequest(request);
    if (!requireAdmin(auth)) {
      return NextResponse.json({ error: "Accès non autorisé" }, { status: 401 });
    }

    const { id } = await params;
    const db = await getDb();

    const crs = await db.execute({
      sql: "SELECT * FROM challenges WHERE id = ?",
      args: [Number(id)],
    });
    if (crs.rows.length === 0) {
      return NextResponse.json({ error: "Challenge introuvable" }, { status: 404 });
    }

    const srs = await db.execute({
      sql: `SELECT cs.id, cs.user_id, cs.result, cs.screenshot_base64, cs.status, cs.submitted_at, u.username
            FROM challenge_submissions cs
            JOIN users u ON cs.user_id = u.id
            WHERE cs.challenge_id = ?
            ORDER BY cs.submitted_at ASC`,
      args: [Number(id)],
    });

    return NextResponse.json({
      challenge: crs.rows[0],
      submissions: srs.rows.map((s) => ({
        id: s.id,
        userId: s.user_id,
        username: s.username,
        result: s.result,
        screenshotBase64: s.screenshot_base64,
        status: s.status,
        submittedAt: s.submitted_at,
      })),
    });
  } catch (error) {
    console.error("GET /api/admin/challenges/[id] error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/challenges/[id]
 * Update a challenge (end early, change deadline, etc.).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthFromRequest(request);
    if (!requireAdmin(auth)) {
      return NextResponse.json({ error: "Accès non autorisé" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const db = await getDb();

    const existing = await db.execute({
      sql: "SELECT id FROM challenges WHERE id = ?",
      args: [Number(id)],
    });
    if (existing.rows.length === 0) {
      return NextResponse.json({ error: "Challenge introuvable" }, { status: 404 });
    }

    // Build dynamic SET clause
    const updates: string[] = [];
    const args: (string | number)[] = [];

    if (body.title !== undefined) { updates.push("title = ?"); args.push(body.title); }
    if (body.description !== undefined) { updates.push("description = ?"); args.push(body.description); }
    if (body.reward !== undefined) { updates.push("reward = ?"); args.push(body.reward); }
    if (body.endsAt !== undefined) { updates.push("ends_at = ?"); args.push(body.endsAt); }
    if (body.startsAt !== undefined) { updates.push("starts_at = ?"); args.push(body.startsAt); }

    if (updates.length === 0) {
      return NextResponse.json({ error: "Aucun champ à mettre à jour" }, { status: 400 });
    }

    args.push(Number(id));
    await db.execute({
      sql: `UPDATE challenges SET ${updates.join(", ")} WHERE id = ?`,
      args,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("PATCH /api/admin/challenges/[id] error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}
