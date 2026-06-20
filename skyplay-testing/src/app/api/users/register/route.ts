import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { generatePin, hashPassword } from "@/lib/auth";

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

    // Validate username: no spaces, no special characters
    const usernameRegex = /^[a-zA-Z0-9._]+$/;
    if (!usernameRegex.test(username)) {
      return NextResponse.json(
        { error: "Le nom d'utilisateur ne doit contenir que des lettres, chiffres, points et underscores (pas d'espaces ni de caractères spéciaux)" },
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

    // Check uniqueness
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

    // Generate PIN, hash it, and send via email
    const pin = generatePin();
    const pinHash = await hashPassword(pin);

    const result = await db.execute({
      sql: "INSERT INTO users (username, email, role, password_hash, participation_bonus, bonus_status) VALUES (?, ?, 'user', ?, 250, 'PENDING')",
      args: [username.trim(), email.trim(), pinHash],
    });

    // Send PIN via email (don't return it in the response)
    const { sendPinEmail } = await import("@/lib/email");
    const sent = await sendPinEmail(email.trim(), username.trim(), pin, true);

    if (!sent) {
      console.error("Register: email failed to send to", email.trim());
    }

    return NextResponse.json(
      {
        success: true,
        emailSent: sent,
        user: {
          id: Number(result.lastInsertRowid),
          username: username.trim(),
          email: email.trim(),
        },
        message: sent
          ? "Compte créé ! Vérifie tes emails pour ton code PIN."
          : "Compte créé ! Contacte l'admin pour récupérer ton PIN.",
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
