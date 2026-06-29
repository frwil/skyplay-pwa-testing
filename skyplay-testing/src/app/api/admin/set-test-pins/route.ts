import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

/**
 * TEMPORARY — one-shot admin endpoint. DELETE after use.
 */
export async function POST(_req: NextRequest) {
  try {
    const db = await getDb();

    // Check current state first
    const before = await db.execute({
      sql: "SELECT id, username, role, password_hash IS NOT NULL as has_pin FROM users WHERE username IN (?, ?)",
      args: ["testplayer1", "testplayer2"],
    });

    const results: string[] = [];
    for (const row of before.rows) {
      const r = row as unknown as { id: number; username: string; role: string; has_pin: number };
      results.push(`BEFORE: ${r.username} id=${r.id} role=${r.role} has_pin=${r.has_pin}`);
    }

    if (before.rows.length === 0) {
      results.push("NO USERS FOUND — creating them now");
    }

    // Ensure users exist
    const pin1 = "1234";
    const pin2 = "5678";
    const [hash1, hash2] = await Promise.all([
      hashPassword(pin1),
      hashPassword(pin2),
    ]);

    // testplayer1: INSERT or UPDATE
    try {
      await db.execute({
        sql: "INSERT INTO users (username, email, role, password_hash) VALUES (?, ?, 'user', ?) ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, role = 'user'",
        args: ["testplayer1", "testplayer1@skyplay.test", hash1],
      });
      results.push("testplayer1: ✅ PIN set to 1234");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push(`testplayer1: ❌ ${msg}`);
      // Try direct UPDATE
      try {
        await db.execute({ sql: "UPDATE users SET password_hash = ?, role = 'user' WHERE username = ?", args: [hash1, "testplayer1"] });
        results.push("testplayer1: ✅ retry UPDATE succeeded");
      } catch (e2: unknown) {
        results.push(`testplayer1: ❌ retry failed: ${e2 instanceof Error ? e2.message : String(e2)}`);
      }
    }

    // testplayer2
    try {
      await db.execute({
        sql: "INSERT INTO users (username, email, role, password_hash) VALUES (?, ?, 'user', ?) ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, role = 'user'",
        args: ["testplayer2", "testplayer2@skyplay.test", hash2],
      });
      results.push("testplayer2: ✅ PIN set to 5678");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push(`testplayer2: ❌ ${msg}`);
      try {
        await db.execute({ sql: "UPDATE users SET password_hash = ?, role = 'user' WHERE username = ?", args: [hash2, "testplayer2"] });
        results.push("testplayer2: ✅ retry UPDATE succeeded");
      } catch (e2: unknown) {
        results.push(`testplayer2: ❌ retry failed: ${e2 instanceof Error ? e2.message : String(e2)}`);
      }
    }

    // Verify after
    const after = await db.execute({
      sql: "SELECT id, username, role, password_hash IS NOT NULL as has_pin, length(password_hash) as hash_len FROM users WHERE username IN (?, ?)",
      args: ["testplayer1", "testplayer2"],
    });
    for (const row of after.rows) {
      const r = row as unknown as { id: number; username: string; role: string; has_pin: number; hash_len: number };
      results.push(`AFTER: ${r.username} id=${r.id} has_pin=${r.has_pin} hash_len=${r.hash_len}`);
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("POST /api/admin/set-test-pins error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur", details: String(error) }, { status: 500 });
  }
}
