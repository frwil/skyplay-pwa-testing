import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";

/**
 * GET /api/admin/duel/recording/[sessionId]
 *
 * Admin-only proxy that streams a duel recording. The mp4 lives in a PRIVATE Vercel Blob store,
 * so it is never exposed directly — we fetch it server-side with the long-lived
 * BLOB_READ_WRITE_TOKEN and pipe the bytes back to the authenticated admin.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const auth = await getAuthFromRequest(req);
  if (!requireAdmin(auth)) {
    return NextResponse.json({ error: "Non autorisé. Authentification admin requise." }, { status: 401 });
  }

  const { sessionId } = await params;
  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const db = await getDb();
  const rs = await db.execute({
    sql: "SELECT url FROM duel_recordings WHERE session_id = ?",
    args: [sessionId],
  });
  if (rs.rows.length === 0) {
    return NextResponse.json({ error: "Recording not found" }, { status: 404 });
  }
  const url = rs.rows[0].url as string;

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Blob storage not configured" }, { status: 500 });
  }

  // Private blobs require the token in the Authorization header (works from Vercel too).
  const range = req.headers.get("range");
  const upstream = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(range ? { Range: range } : {}),
    },
  });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `Blob fetch failed (${upstream.status})` }, { status: 502 });
  }

  const headers = new Headers();
  headers.set("Content-Type", upstream.headers.get("content-type") || "video/mp4");
  headers.set("Cache-Control", "private, no-store");
  headers.set("Accept-Ranges", "bytes");
  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) headers.set("Content-Range", contentRange);

  return new Response(upstream.body, { status: upstream.status, headers });
}
