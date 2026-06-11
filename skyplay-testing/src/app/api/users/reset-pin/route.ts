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

    // Send new PIN via email (don't return it)
    const { sendPinEmail } = await import("@/lib/email");
    const sent = await sendPinEmail(user.email, user.username, newPin, false);

    if (!sent) {
      console.error("Reset PIN: email failed to send to", user.email);
    }

    return NextResponse.json({
      success: true,
      emailSent: sent,
      message: sent
        ? "Un nouveau PIN a été envoyé à ton adresse email."
        : "PIN réinitialisé mais l'email n'a pas pu être envoyé. Contacte l'admin.",
    });
  } catch (error) {
    console.error("POST /api/users/reset-pin error:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
