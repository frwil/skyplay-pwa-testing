import { NextRequest, NextResponse } from "next/server";
import { proxyToPlatform } from "@/lib/gifts-proxy";

/**
 * GET /api/gifts/leaderboard?period=daily|weekly|alltime&limit=20
 * Public proxy to Platform-main GET /gifts/leaderboard
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const period = searchParams.get("period") || "alltime";
    const limit = searchParams.get("limit") || "20";

    const path = `/gifts/leaderboard?period=${encodeURIComponent(period)}&limit=${encodeURIComponent(limit)}`;

    const res = await proxyToPlatform("GET", path);

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Upstream error" }));
      return NextResponse.json(err, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("[api/gifts/leaderboard] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch leaderboard" },
      { status: 500 },
    );
  }
}
