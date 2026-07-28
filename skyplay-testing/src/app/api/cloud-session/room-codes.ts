import { getDb } from "@/lib/db";

/**
 * Durable room code → sessionId store backed by Turso DB.
 *
 * Was an in-memory Map, but Vercel serverless splits requests across
 * Lambda instances — P1's create-session on instance A wasn't visible
 * to P2's join on instance B.
 */

/** Create the cloud_rooms table if it doesn't exist (idempotent). */
async function ensureTable(): Promise<void> {
  const db = await getDb();
  await db.execute(`CREATE TABLE IF NOT EXISTS cloud_rooms (
    code TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  // Add user_id column for gift receiver resolution (idempotent)
  try {
    await db.execute(`ALTER TABLE cloud_rooms ADD COLUMN user_id TEXT`);
  } catch { /* column already exists */ }
}

/** Store a room code → sessionId mapping (expires after 30 min). */
export async function setRoomCode(code: string, sessionId: string, userId?: string): Promise<void> {
  const db = await getDb();
  await ensureTable();
  // Clean up expired entries on every write (lazy GC)
  await db.execute({
    sql: "DELETE FROM cloud_rooms WHERE created_at < ?",
    args: [Math.floor(Date.now() / 1000) - 1800], // 30 min TTL
  });
  await db.execute({
    sql: "INSERT OR REPLACE INTO cloud_rooms (code, session_id, created_at, user_id) VALUES (?, ?, ?, ?)",
    args: [code, sessionId, Math.floor(Date.now() / 1000), userId ?? null],
  });
}

/** Look up the host user ID by session ID. Returns null if not found. */
export async function getHostUserId(sessionId: string): Promise<string | null> {
  const db = await getDb();
  await ensureTable();
  const rs = await db.execute({
    sql: "SELECT user_id FROM cloud_rooms WHERE session_id = ? AND created_at > ?",
    args: [sessionId, Math.floor(Date.now() / 1000) - 1800],
  });
  if (rs.rows.length === 0 || !rs.rows[0].user_id) return null;
  return rs.rows[0].user_id as string;
}

/** Look up a sessionId by room code. Returns null if not found or expired. */
export async function getSessionByRoomCode(code: string): Promise<string | null> {
  const db = await getDb();
  await ensureTable();
  const rs = await db.execute({
    sql: "SELECT session_id FROM cloud_rooms WHERE code = ? AND created_at > ?",
    args: [code, Math.floor(Date.now() / 1000) - 1800],
  });
  if (rs.rows.length === 0) return null;
  return rs.rows[0].session_id as string;
}

/** Generate a 6-char room code (no ambiguous chars O/0/I/1). */
export function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
