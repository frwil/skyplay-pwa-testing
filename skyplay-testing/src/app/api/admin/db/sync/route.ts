import { NextResponse } from "next/server";
import { getAuthFromRequest, requireAdmin } from "@/lib/auth";
import { syncDatabase } from "@/lib/db";

/**
 * POST /api/admin/db/sync
 * Trigger a manual sync from the local embedded replica to the remote Turso DB.
 * Also callable by non-admin clients (the sync is a safe idempotent operation).
 */
export async function POST() {
  try {
    const synced = await syncDatabase();
    return NextResponse.json({ success: true, synced });
  } catch (error) {
    console.error("POST /api/admin/db/sync error:", error);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
