import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const start = Date.now();
  try {
    const db = await getDb();
    const r = await db.execute("SELECT 1 as ok");
    return NextResponse.json({
      ok: true,
      latency: Date.now() - start,
      result: r.rows[0],
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { ok: false, latency: Date.now() - start, error: msg },
      { status: 500 }
    );
  }
}
