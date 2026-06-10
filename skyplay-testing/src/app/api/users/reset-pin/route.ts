import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { generatePin, hashPassword } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, email } = body;

    if (!username || !email) {
      return NextResponse.json(
        { error: "Nom d'utilisateur et email requis" },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Verify user exists with matching email
    const rs = await db.execute({
      sql: "SELECT id, username, email FROM users WHERE username = ? AND email = ? AND (role = 'user' OR role IS NULL)",
      args: [username.trim(), email.trim()],
    });

    const user = rs.rows[0] as unknown as
      | { id: number; username: string; email: string }
      | undefined;

    if (!user) {
      return NextResponse.json(
        { error: "Aucun compte trouvé avec ces identifiants" },
        { status: 404 }
      );
    }

    // Generate new unique PIN and hash it
    const newPin = generatePin();
    const pinHash = await hashPassword(newPin);

    await db.execute({
      sql: "UPDATE users SET password_hash = ? WHERE id = ?",
      args: [pinHash, user.id],
    });

    return NextResponse.json({
      success: true,
      pin: newPin,
      message: "Nouveau PIN généré. Note-le bien, il ne sera plus affiché.",
    });
  } catch (error) {
    console.error("POST /api/users/reset-pin error:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
