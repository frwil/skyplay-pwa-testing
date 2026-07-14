import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";

/**
 * PATCH /api/admin/duel-games/[gameId]/versions/[versionId]
 * Body: { action: "activate" | "set-default" | "delete" }
 *
 * - "activate": sets this version as the active one (game-server + API use it).
 * - "set-default": marks this version as the safe fallback.
 * - "delete": removes this version (refused if it's the ONLY version).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ gameId: string; versionId: string }> },
) {
  const auth = await getAuthFromRequest(req);
  if (!requireAdmin(auth)) {
    return NextResponse.json({ error: "Admin requis." }, { status: 401 });
  }

  const { gameId, versionId } = await params;
  const versionIdNum = parseInt(versionId, 10);
  if (isNaN(versionIdNum)) {
    return NextResponse.json({ error: "versionId invalide." }, { status: 400 });
  }

  let body: { action?: string };
  try { body = await req.json(); } catch { body = {}; }
  const action = body.action;

  try {
    const db = await getDb();

    // Verify the version exists and belongs to this game
    const vRs = await db.execute({
      sql: "SELECT id, version FROM duel_game_config_versions WHERE id = ? AND game_id = ?",
      args: [versionIdNum, gameId],
    });
    if (vRs.rows.length === 0) {
      return NextResponse.json({ error: "Version introuvable." }, { status: 404 });
    }

    switch (action) {
      case "activate": {
        // Deactivate all, then activate the selected one
        await db.execute({ sql: "UPDATE duel_game_config_versions SET is_active = 0 WHERE game_id = ?", args: [gameId] });
        await db.execute({ sql: "UPDATE duel_game_config_versions SET is_active = 1 WHERE id = ?", args: [versionIdNum] });
        return NextResponse.json({ success: true, message: `Version ${versionIdNum} activée.` });
      }

      case "set-default": {
        // Un-default all, then set the selected one as default
        await db.execute({ sql: "UPDATE duel_game_config_versions SET is_default = 0 WHERE game_id = ?", args: [gameId] });
        await db.execute({ sql: "UPDATE duel_game_config_versions SET is_default = 1 WHERE id = ?", args: [versionIdNum] });
        return NextResponse.json({ success: true, message: `Version ${versionIdNum} définie comme défaut.` });
      }

      case "delete": {
        // Refuse if it's the only version
        const countRs = await db.execute({
          sql: "SELECT COUNT(*) AS cnt FROM duel_game_config_versions WHERE game_id = ?",
          args: [gameId],
        });
        const count = (countRs.rows[0] as unknown as { cnt: number }).cnt;
        if (count <= 1) {
          return NextResponse.json({ error: "Impossible de supprimer la seule version." }, { status: 400 });
        }
        await db.execute({ sql: "DELETE FROM duel_game_config_versions WHERE id = ?", args: [versionIdNum] });
        return NextResponse.json({ success: true, message: `Version ${versionIdNum} supprimée.` });
      }

      default:
        return NextResponse.json({ error: `Action inconnue: "${action}". Actions valides: activate, set-default, delete.` }, { status: 400 });
    }
  } catch (error) {
    console.error(`PATCH /api/admin/duel-games/${gameId}/versions/${versionId} error:`, error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
