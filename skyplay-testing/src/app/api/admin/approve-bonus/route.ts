import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAuthFromRequest, requireAdmin } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthFromRequest(request);
    if (!requireAdmin(auth)) {
      return NextResponse.json(
        { error: "Non autorisé. Authentification admin requise." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { error: "userId est requis" },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Check user exists and has a PENDING bonus
    const userRs = await db.execute({
      sql: "SELECT id, username, participation_bonus, bonus_status FROM users WHERE id = ?",
      args: [userId],
    });
    const user = userRs.rows[0] as unknown as
      | { id: number; username: string; participation_bonus: number; bonus_status: string | null }
      | undefined;

    if (!user) {
      return NextResponse.json(
        { error: "Utilisateur introuvable" },
        { status: 404 }
      );
    }

    if (user.bonus_status !== "PENDING") {
      return NextResponse.json(
        { error: `Le bonus de cet utilisateur n'est pas en attente (statut: ${user.bonus_status ?? "aucun"})` },
        { status: 409 }
      );
    }

    // Approve the bonus
    await db.execute({
      sql: "UPDATE users SET bonus_status = 'APPROVED' WHERE id = ?",
      args: [userId],
    });

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        participation_bonus: user.participation_bonus,
        bonus_status: "APPROVED",
      },
      message: `Bonus de ${user.participation_bonus} Sky approuvé pour ${user.username}.`,
    });
  } catch (error) {
    console.error("POST /api/admin/approve-bonus error:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
