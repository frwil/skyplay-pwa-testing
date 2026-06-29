import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/** TEMPORARY — DELETE after use. Dumps raw duel_lobby table. */
export async function GET(_req: NextRequest) {
  try {
    const db = await getDb();
    const rs = await db.execute({
      sql: `SELECT dl.*, datetime(dl.last_heartbeat) as hb_fmt
            FROM duel_lobby dl ORDER BY dl.created_at DESC LIMIT 20`,
      args: [],
    });
    return NextResponse.json({ rows: rs.rows });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
