import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAuthFromRequest, requireAdmin } from "@/lib/auth";

/**
 * GET /api/admin/challenges
 * List all challenges (admin).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthFromRequest(request);
    if (!requireAdmin(auth)) {
      return NextResponse.json(
        { error: "Accès non autorisé" },
        { status: 401 }
      );
    }

    const db = await getDb();
    const rs = await db.execute(`
      SELECT c.*, u.username AS created_by_name,
        (SELECT COUNT(*) FROM challenge_submissions cs WHERE cs.challenge_id = c.id) AS submission_count,
        (SELECT COUNT(*) FROM challenge_submissions cs WHERE cs.challenge_id = c.id AND cs.status = 'APPROVED') AS approved_count,
        (SELECT COUNT(*) FROM challenge_submissions cs WHERE cs.challenge_id = c.id AND cs.status = 'PENDING') AS pending_count
      FROM challenges c
      LEFT JOIN users u ON c.created_by = u.id
      ORDER BY c.ends_at DESC
    `);

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
      approvedCount: row.approved_count,
      pendingCount: row.pending_count,
    }));

    return NextResponse.json({ challenges });
  } catch (error) {
    console.error("GET /api/admin/challenges error:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/challenges
 * Create a new challenge (admin).
 * Body: { title, description?, system, romName, criteria, reward?, startsAt, endsAt }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthFromRequest(request);
    if (!requireAdmin(auth)) {
      return NextResponse.json(
        { error: "Accès non autorisé" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { title, description, system, romName, criteria, reward, startsAt, endsAt } = body;

    if (!title || !system || !romName || !criteria || !startsAt || !endsAt) {
      return NextResponse.json(
        { error: "Champs requis manquants : title, system, romName, criteria, startsAt, endsAt" },
        { status: 400 }
      );
    }

    const validCriteria = ["winloss", "score", "time"];
    if (!validCriteria.includes(criteria)) {
      return NextResponse.json(
        { error: `Type de critère invalide. Choisir parmi : ${validCriteria.join(", ")}` },
        { status: 400 }
      );
    }

    const db = await getDb();
    const insert = await db.execute({
      sql: `INSERT INTO challenges (title, description, system, rom_name, criteria, reward, starts_at, ends_at, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        title,
        description || "",
        system,
        romName,
        criteria,
        reward || 500,
        startsAt,
        endsAt,
        auth.userId,
      ],
    });

    return NextResponse.json(
      { success: true, id: Number(insert.lastInsertRowid) },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/admin/challenges error:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
