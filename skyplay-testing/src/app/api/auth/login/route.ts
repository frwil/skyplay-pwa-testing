import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyPassword, signToken, setAuthCookie } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: "Nom d'utilisateur et mot de passe requis" },
        { status: 400 }
      );
    }

    const db = await getDb();

    const rs = await db.execute({
      sql: `SELECT id, username, role, password_hash
            FROM users
            WHERE username = ? AND role IN ('admin', 'superadmin', 'user')`,
      args: [username.trim()],
    });

    const user = rs.rows[0] as unknown as
      | { id: number; username: string; role: string; password_hash: string | null }
      | undefined;

    if (!user || !user.password_hash) {
      return NextResponse.json(
        { error: "Identifiants invalides" },
        { status: 401 }
      );
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return NextResponse.json(
        { error: "Identifiants invalides" },
        { status: 401 }
      );
    }

    const token = await signToken({ userId: user.id, role: user.role });

    const response = NextResponse.json({
      success: true,
      user: { id: user.id, username: user.username, role: user.role },
    });

    setAuthCookie(response, token);
    return response;
  } catch (error) {
    console.error("POST /api/auth/login error:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
