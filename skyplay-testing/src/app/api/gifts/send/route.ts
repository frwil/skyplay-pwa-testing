import { NextRequest, NextResponse } from "next/server";
import { proxyToPlatform, createPlatformJwt, getUserFromRequest } from "@/lib/gifts-proxy";

/**
 * POST /api/gifts/send
 * Authenticated proxy to Platform-main POST /gifts/send
 * Body: { giftId, receiverId, quantity?, message?, sessionId? }
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Auth check
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Parse body
    const body = await req.json() as {
      giftId: string;
      receiverId: string;
      quantity?: number;
      message?: string;
      sessionId?: string;
    };

    if (!body.giftId || !body.receiverId) {
      return NextResponse.json(
        { error: "Missing giftId or receiverId" },
        { status: 400 },
      );
    }

    // 3. Create Platform JWT
    const jwt = await createPlatformJwt(user.userId, user.username);

    // 4. Proxy to Platform-main
    const res = await proxyToPlatform("POST", "/gifts/send", body, jwt);

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: "Upstream error" }));
      return NextResponse.json(
        { error: err.message || "Failed to send gift" },
        { status: res.status },
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("[api/gifts/send] Error:", err);
    return NextResponse.json(
      { error: (err as Error).message || "Internal error" },
      { status: 500 },
    );
  }
}
