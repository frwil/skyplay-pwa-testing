import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get("username");
    const pin = searchParams.get("pin");

    if (!username || username.trim().length === 0) {
      return NextResponse.json(
        { error: "Paramètre username requis" },
        { status: 400 }
      );
    }

    if (!pin || pin.trim().length === 0) {
      return NextResponse.json(
        { error: "Code PIN requis" },
        { status: 400 }
      );
    }

    const db = await getDb();

    const rs = await db.execute({
      sql: "SELECT id, username, email, password_hash, role, created_at FROM users WHERE username = ? AND (role = 'user' OR role IS NULL)",
      args: [username.trim()],
    });

    const user = rs.rows[0] as unknown as
      | { id: number; username: string; email: string; password_hash: string | null; role: string; created_at: string }
      | undefined;

    if (!user || !user.password_hash) {
      return NextResponse.json(
        { error: "Identifiants invalides" },
        { status: 401 }
      );
    }

    const valid = await verifyPassword(pin.trim(), user.password_hash);
    if (!valid) {
      return NextResponse.json(
        { error: "Code PIN incorrect" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        created_at: user.created_at,
      },
    });
  } catch (error) {
    console.error("GET /api/users/lookup error:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
