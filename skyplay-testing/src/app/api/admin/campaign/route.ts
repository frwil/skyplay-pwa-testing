import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAuthFromRequest, requireAdmin } from "@/lib/auth";

// POST — Créer une nouvelle campagne (superadmin uniquement)
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthFromRequest(request);
    if (!requireAdmin(auth)) {
      return NextResponse.json(
        { error: "Non autorisé. Authentification admin requise." },
        { status: 401 }
      );
    }
    if (auth.role !== "superadmin") {
      return NextResponse.json(
        { error: "Seul un superadmin peut créer une nouvelle campagne." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { name, deadline } = body;

    if (!deadline) {
      return NextResponse.json(
        { error: "La date limite est requise." },
        { status: 400 }
      );
    }

    const deadlineDate = new Date(deadline);
    if (isNaN(deadlineDate.getTime())) {
      return NextResponse.json(
        { error: "Format de date invalide." },
        { status: 400 }
      );
    }

    // Minimum 7 jours
    const minDeadline = new Date();
    minDeadline.setDate(minDeadline.getDate() + 7);
    if (deadlineDate < minDeadline) {
      return NextResponse.json(
        { error: "La campagne doit durer au moins 7 jours." },
        { status: 400 }
      );
    }

    const db = await getDb();
    const result = await db.execute({
      sql: "INSERT INTO campaigns (name, deadline) VALUES (?, ?)",
      args: [name || "Campagne de test", deadlineDate.toISOString()],
    });

    const newRs = await db.execute({
      sql: "SELECT id, name, deadline, created_at FROM campaigns WHERE id = ?",
      args: [Number(result.lastInsertRowid)],
    });

    return NextResponse.json(
      { campaign: newRs.rows[0] },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/admin/campaign error:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}

// PATCH — Prolonger la deadline de la campagne active (admin/superadmin)
export async function PATCH(request: NextRequest) {
  try {
    const auth = await getAuthFromRequest(request);
    if (!requireAdmin(auth)) {
      return NextResponse.json(
        { error: "Non autorisé. Authentification admin requise." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { deadline } = body;

    if (!deadline) {
      return NextResponse.json(
        { error: "La nouvelle date limite est requise." },
        { status: 400 }
      );
    }

    const newDeadline = new Date(deadline);
    if (isNaN(newDeadline.getTime())) {
      return NextResponse.json(
        { error: "Format de date invalide." },
        { status: 400 }
      );
    }

    if (newDeadline <= new Date()) {
      return NextResponse.json(
        { error: "La nouvelle date limite doit être dans le futur." },
        { status: 400 }
      );
    }

    const db = await getDb();

    const activeRs = await db.execute(
      "SELECT id, deadline FROM campaigns ORDER BY created_at DESC LIMIT 1"
    );
    const active = activeRs.rows[0] as unknown as
      | { id: number; deadline: string }
      | undefined;

    if (!active) {
      return NextResponse.json(
        { error: "Aucune campagne active." },
        { status: 404 }
      );
    }

    const currentDeadline = new Date(active.deadline);
    if (newDeadline <= currentDeadline) {
      return NextResponse.json(
        { error: "La nouvelle date doit être postérieure à la date limite actuelle." },
        { status: 400 }
      );
    }

    await db.execute({
      sql: "UPDATE campaigns SET deadline = ? WHERE id = ?",
      args: [newDeadline.toISOString(), active.id],
    });

    const updatedRs = await db.execute({
      sql: "SELECT id, name, deadline, created_at FROM campaigns WHERE id = ?",
      args: [active.id],
    });

    return NextResponse.json({ campaign: updatedRs.rows[0] });
  } catch (error) {
    console.error("PATCH /api/admin/campaign error:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
