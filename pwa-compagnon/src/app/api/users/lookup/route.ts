import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get("username");

    if (!username || username.trim().length === 0) {
      return NextResponse.json(
        { error: "Paramètre username requis" },
        { status: 400 }
      );
    }

    const db = await getDb();

    const rs = await db.execute({
      sql: "SELECT id, username, email, created_at FROM users WHERE username = ?",
      args: [username.trim()],
    });

    const user = rs.rows[0] as unknown as
      | { id: number; username: string; email: string; created_at: string }
      | undefined;

    if (!user) {
      return NextResponse.json(
        { error: "Utilisateur introuvable" },
        { status: 404 }
      );
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error("GET /api/users/lookup error:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
