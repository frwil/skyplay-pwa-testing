import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, email } = body;

    if (!username || !email) {
      return NextResponse.json(
        { error: "username et email sont requis" },
        { status: 400 }
      );
    }

    if (typeof username !== "string" || username.trim().length < 2) {
      return NextResponse.json(
        { error: "Le nom d'utilisateur doit faire au moins 2 caractères" },
        { status: 400 }
      );
    }

    if (typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json(
        { error: "Email invalide" },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Check uniqueness with specific feedback
    const existingUsername = await db.execute({
      sql: "SELECT id FROM users WHERE username = ?",
      args: [username.trim()],
    });
    if (existingUsername.rows.length > 0) {
      return NextResponse.json(
        { error: "Ce nom d'utilisateur est déjà pris. Choisis-en un autre." },
        { status: 409 }
      );
    }

    const existingEmail = await db.execute({
      sql: "SELECT id FROM users WHERE email = ?",
      args: [email.trim()],
    });
    if (existingEmail.rows.length > 0) {
      return NextResponse.json(
        { error: "Cet email est déjà utilisé. Connecte-toi ou utilise un autre email." },
        { status: 409 }
      );
    }

    const result = await db.execute({
      sql: "INSERT INTO users (username, email) VALUES (?, ?)",
      args: [username.trim(), email.trim()],
    });

    return NextResponse.json(
      {
        success: true,
        user: {
          id: Number(result.lastInsertRowid),
          username: username.trim(),
          email: email.trim(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/users/register error:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
