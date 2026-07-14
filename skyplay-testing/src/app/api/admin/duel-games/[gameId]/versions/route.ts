import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";

export interface ConfigVersion {
  id: number;
  gameId: string;
  version: number;
  ramConfig: Record<string, unknown> | null;
  controls: { player: number; actionKey: string; labelKey: string; defaultKeys: string }[];
  label: string | null;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
}

/**
 * GET /api/admin/duel-games/[gameId]/versions
 * List all config versions for a duel game, newest first.
 */
export async function GET(
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
    const rs = await db.execute({
      sql: "SELECT id, game_id, version, ram_config, controls, label, is_active, is_default, created_at FROM duel_game_config_versions WHERE game_id = ? ORDER BY version DESC",
      args: [gameId],
    });

    const versions: ConfigVersion[] = rs.rows.map((r) => {
      let ramConfig: Record<string, unknown> | null = null;
      try { ramConfig = JSON.parse((r.ram_config as string) ?? "null"); } catch {}
      let controls: ConfigVersion["controls"] = [];
      try {
        const raw = JSON.parse((r.controls as string) ?? "[]");
        if (Array.isArray(raw)) controls = raw;
      } catch {}

      return {
        id: r.id as number,
        gameId: r.game_id as string,
        version: r.version as number,
        ramConfig,
        controls,
        label: r.label as string | null,
        isActive: (r.is_active as number) === 1,
        isDefault: (r.is_default as number) === 1,
        createdAt: (r.created_at as string) ?? "",
      };
    });

    return NextResponse.json({ versions });
  } catch (error) {
    console.error(`GET /api/admin/duel-games/${gameId}/versions error:`, error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}

/**
 * POST /api/admin/duel-games/[gameId]/versions
 * Create a new config version snapshot (does NOT auto-activate).
 * Body: { ramConfig: object | null, controls: array, label?: string, activate?: boolean, setDefault?: boolean }
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
    const body = await req.json();
    const ramConfig = body.ramConfig ?? null;
    const controls = body.controls ?? [];
    const label = body.label ?? null;
    const activate = body.activate === true;
    const setDefault = body.setDefault === true;

    const db = await getDb();

    // Get the next version number
    const maxRs = await db.execute({
      sql: "SELECT COALESCE(MAX(version), 0) AS max_v FROM duel_game_config_versions WHERE game_id = ?",
      args: [gameId],
    });
    const nextVersion = ((maxRs.rows[0] as unknown as { max_v: number }).max_v) + 1;

    // If activating, deactivate all other versions first
    if (activate) {
      await db.execute({
        sql: "UPDATE duel_game_config_versions SET is_active = 0 WHERE game_id = ?",
        args: [gameId],
      });
    }

    // If setting as default, un-default all other versions
    if (setDefault) {
      await db.execute({
        sql: "UPDATE duel_game_config_versions SET is_default = 0 WHERE game_id = ?",
        args: [gameId],
      });
    }

    // Insert the new version
    const insertRs = await db.execute({
      sql: `INSERT INTO duel_game_config_versions (game_id, version, ram_config, controls, label, is_active, is_default)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        gameId,
        nextVersion,
        ramConfig ? JSON.stringify(ramConfig) : null,
        JSON.stringify(controls),
        label,
        activate ? 1 : 0,
        setDefault ? 1 : 0,
      ],
    });

    return NextResponse.json({
      success: true,
      version: {
        id: Number(insertRs.lastInsertRowid),
        gameId,
        version: nextVersion,
        ramConfig,
        controls,
        label,
        isActive: activate,
        isDefault: setDefault,
      },
    });
  } catch (error) {
    console.error(`POST /api/admin/duel-games/${gameId}/versions error:`, error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
