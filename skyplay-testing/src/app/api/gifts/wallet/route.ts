import { NextRequest, NextResponse } from "next/server";
import { proxyToPlatform, createPlatformJwt, getUserFromRequest } from "@/lib/gifts-proxy";

/**
 * GET /api/gifts/wallet
 * Authenticated proxy to Platform-main GET /gifts/wallet
 */
export async function GET(req: NextRequest) {
  try {
    // 1. Auth check
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Create Platform JWT
    const jwt = await createPlatformJwt(user.userId, user.username);

    // 3. Proxy to Platform-main
    const res = await proxyToPlatform("GET", "/gifts/wallet", undefined, jwt);

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: "Upstream error" }));
      return NextResponse.json(
        { error: err.message || "Failed to fetch wallet" },
        { status: res.status },
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("[api/gifts/wallet] Error:", err);
    return NextResponse.json(
      { error: (err as Error).message || "Internal error" },
      { status: 500 },
    );
  }
}
