import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

/**
 * TEMPORARY — one-shot admin endpoint to set PINs for test users.
 * DELETE after use.
 *
 * POST /api/admin/set-test-pins
 * Sets testplayer1 PIN to 1234, testplayer2 PIN to 5678.
 */
export async function POST(_req: NextRequest) {
  try {
    const db = await getDb();

    const pin1 = "1234";
    const pin2 = "5678";

    const [hash1, hash2] = await Promise.all([
      hashPassword(pin1),
      hashPassword(pin2),
    ]);

    const results: string[] = [];

    // testplayer1
    const u1 = await db.execute({
      sql: "SELECT id FROM users WHERE username = ?",
      args: ["testplayer1"],
    });
    if (u1.rows.length === 0) {
      results.push("testplayer1: NOT FOUND");
    } else {
      await db.execute({
        sql: "UPDATE users SET password_hash = ?, role = 'user' WHERE username = ?",
        args: [hash1, "testplayer1"],
      });
      results.push("testplayer1: PIN set to 1234");
    }

    // testplayer2
    const u2 = await db.execute({
      sql: "SELECT id FROM users WHERE username = ?",
      args: ["testplayer2"],
    });
    if (u2.rows.length === 0) {
      results.push("testplayer2: NOT FOUND");
    } else {
      await db.execute({
        sql: "UPDATE users SET password_hash = ?, role = 'user' WHERE username = ?",
        args: [hash2, "testplayer2"],
      });
      results.push("testplayer2: PIN set to 5678");
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("POST /api/admin/set-test-pins error:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
