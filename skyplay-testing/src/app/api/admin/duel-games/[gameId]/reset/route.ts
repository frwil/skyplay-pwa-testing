import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";

/**
 * POST /api/admin/duel-games/[gameId]/reset
 *
 * Resets the active config to the default version:
 * - Deactivates the current active version
 * - Activates the default version (is_default = 1)
 * - If no default is set, activates version 1 (the original seed)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const auth = await getAuthFromRequest(req);
  if (!requireAdmin(auth)) {
    return NextResponse.json({ error: "Admin requis." }, { status: 401 });
  }

  const { gameId } = await params;

  try {
    const db = await getDb();

    // Find the default version, or fall back to version 1
    let defaultRs = await db.execute({
      sql: "SELECT id, version FROM duel_game_config_versions WHERE game_id = ? AND is_default = 1 LIMIT 1",
      args: [gameId],
    });

    if (defaultRs.rows.length === 0) {
      // No default — use version 1
      defaultRs = await db.execute({
        sql: "SELECT id, version FROM duel_game_config_versions WHERE game_id = ? AND version = 1 LIMIT 1",
        args: [gameId],
      });
    }

    if (defaultRs.rows.length === 0) {
      return NextResponse.json({ error: "Aucune version trouvée pour ce jeu." }, { status: 404 });
    }

    const defaultVersion = defaultRs.rows[0] as unknown as { id: number; version: number };

    // Deactivate all, then activate the default
    await db.execute({ sql: "UPDATE duel_game_config_versions SET is_active = 0 WHERE game_id = ?", args: [gameId] });
    await db.execute({ sql: "UPDATE duel_game_config_versions SET is_active = 1 WHERE id = ?", args: [defaultVersion.id] });

    return NextResponse.json({
      success: true,
      message: `Config réinitialisée à la version ${defaultVersion.version} (id=${defaultVersion.id}).`,
      activeVersionId: defaultVersion.id,
      activeVersion: defaultVersion.version,
    });
  } catch (error) {
    console.error(`POST /api/admin/duel-games/${gameId}/reset error:`, error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
