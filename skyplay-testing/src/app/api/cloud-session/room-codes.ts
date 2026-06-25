/** In-memory room code → sessionId store.
 *  WARNING: Lost on cold starts. For production, use Vercel KV or DB. */
export const roomCodeToSession = new Map<string, string>();

/** Generate a 6-char room code (no ambiguous chars O/0/I/1). */
export function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
