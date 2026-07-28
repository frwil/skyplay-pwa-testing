import { NextRequest, NextResponse } from "next/server";
import { proxyToPlatform } from "@/lib/gifts-proxy";

/**
 * GET /api/gifts/catalog?category=xxx
 * Public proxy to Platform-main GET /gifts/catalog
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category") || "";

    const path = category
      ? `/gifts/catalog?category=${encodeURIComponent(category)}`
      : "/gifts/catalog";

    const res = await proxyToPlatform("GET", path);

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Upstream error" }));
      return NextResponse.json(err, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("[api/gifts/catalog] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch gift catalog" },
      { status: 500 },
    );
  }
}
