import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    if (!userId || isNaN(Number(userId))) {
      return NextResponse.json(
        { error: "Paramètre userId requis (nombre)" },
        { status: 400 }
      );
    }

    const db = await getDb();

    const rs = await db.execute({
      sql: `SELECT id, question_id, step_id, status, submitted_at
            FROM submissions
            WHERE user_id = ?
            ORDER BY submitted_at DESC`,
      args: [Number(userId)],
    });

    return NextResponse.json({ submissions: rs.rows });
  } catch (error) {
    console.error("GET /api/users/submissions error:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
