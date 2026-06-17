import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAuthFromRequest, requireAdmin } from "@/lib/auth";

// GET — Fetch the screenshot for a single submission (lazy-loaded on demand).
// This avoids pulling potentially MBs of base64 data in the submissions list.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthFromRequest(request);
    if (!requireAdmin(auth)) {
      return NextResponse.json(
        { error: "Non autorisé. Authentification admin requise." },
        { status: 401 }
      );
    }

    const { id } = await params;
    const submissionId = parseInt(id, 10);
    if (isNaN(submissionId)) {
      return NextResponse.json(
        { error: "ID de soumission invalide" },
        { status: 400 }
      );
    }

    const db = await getDb();
    const rs = await db.execute({
      sql: "SELECT screenshot_base64 FROM submissions WHERE id = ?",
      args: [submissionId],
    });

    const row = rs.rows[0] as unknown as
      | { screenshot_base64: string }
      | undefined;
    if (!row) {
      return NextResponse.json(
        { error: "Soumission introuvable" },
        { status: 404 }
      );
    }

    return NextResponse.json({ screenshot_base64: row.screenshot_base64 });
  } catch (error) {
    console.error("GET /api/admin/submissions/[id]/screenshot error:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
