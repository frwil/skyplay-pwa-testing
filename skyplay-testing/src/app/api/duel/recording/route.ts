import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * POST /api/duel/recording
 *
 * Ingest endpoint for the game-server (Plan A): registers a duel recording after the mp4 has
 * been uploaded to Vercel Blob. Protected by the same STATS_API_TOKEN shared secret as
 * /api/stats/save. Upserts one row per session_id (a re-upload overwrites the metadata).
 */
export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get("authorization");
    const expectedToken = process.env.STATS_API_TOKEN || "dev";
    if (!auth || auth !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as {
      sessionId?: string;
      url?: string;
      pathname?: string;
      size?: number;
      system?: string;
      rom?: string;
    };

    const sessionId = body.sessionId?.trim();
    const url = body.url?.trim();
    if (!sessionId || !url) {
      return NextResponse.json({ error: "Missing sessionId or url" }, { status: 400 });
    }

    const db = await getDb();
    await db.execute({
      sql: `INSERT INTO duel_recordings (session_id, url, pathname, size, system, rom)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
              url = excluded.url,
              pathname = excluded.pathname,
              size = excluded.size,
              system = excluded.system,
              rom = excluded.rom`,
      args: [
        sessionId,
        url,
        body.pathname ?? null,
        typeof body.size === "number" ? body.size : null,
        body.system ?? null,
        body.rom ?? null,
      ],
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[duel/recording] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
