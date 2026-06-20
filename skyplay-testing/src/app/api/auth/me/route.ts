import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET(request: NextRequest) {
  const auth = await getAuthFromRequest(request);

  if (!requireAdmin(auth)) {
    return NextResponse.json(
      { error: "Non authentifié" },
      { status: 401 }
    );
  }

  try {
    const db = await getDb();
    const rs = await db.execute({
      sql: "SELECT id, username, role FROM users WHERE id = ?",
      args: [auth.userId],
    });
    const row = rs.rows[0] as unknown as
      | { id: number; username: string; role: string }
      | undefined;

    if (!row) {
      return NextResponse.json(
        { error: "Utilisateur introuvable" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      user: { id: row.id, username: row.username, role: row.role },
    });
  } catch {
    // Fallback: return JWT payload if DB lookup fails
    return NextResponse.json({
      user: { id: auth.userId, username: "", role: auth.role },
    });
  }
}
