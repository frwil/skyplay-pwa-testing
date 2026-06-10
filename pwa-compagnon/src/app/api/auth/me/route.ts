import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAdmin } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const auth = await getAuthFromRequest(request);

  if (!requireAdmin(auth)) {
    return NextResponse.json(
      { error: "Non authentifié" },
      { status: 401 }
    );
  }

  return NextResponse.json({
    user: { userId: auth.userId, role: auth.role },
  });
}
