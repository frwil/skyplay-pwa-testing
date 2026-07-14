import { createClient, type Client } from "@libsql/client";

let client: Client | null = null;

/**
 * Returns a singleton Turso/libsql client.
 *
 * Uses the same TURSO_DATABASE_URL / TURSO_AUTH_TOKEN env vars as the Next.js app.
 * The client is lazily initialised and reused for the lifetime of the process.
 */
export function getDb(): Client {
  if (client) return client;

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url || !authToken) {
    throw new Error(
      "TURSO_DATABASE_URL and TURSO_AUTH_TOKEN environment variables are required."
    );
  }

  client = createClient({ url, authToken });
  console.log("[db] Turso client initialised");
  return client;
}

/** Test the connection — logs success or failure, never throws. */
export async function testDbConnection(): Promise<boolean> {
  try {
    const db = getDb();
    const rs = await db.execute("SELECT 1");
    console.log("[db] Connection OK");
    return true;
  } catch (err) {
    console.warn("[db] Connection failed:", err);
    return false;
  }
}
