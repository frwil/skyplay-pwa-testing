import { createClient, type Client } from "@libsql/client";

let client: Client | null = null;
let syncInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Returns a singleton Turso/libsql client using an EMBEDDED REPLICA.
 *
 * A local SQLite file at LOCAL_DB_PATH (default /data/local.db) acts as a
 * read replica of the remote Turso database. Reads are always local (fast,
 * offline-capable). The replica syncs with the remote on startup and every
 * 5 minutes thereafter.
 *
 * Uses the same TURSO_DATABASE_URL / TURSO_AUTH_TOKEN env vars as the Next.js app.
 */
export function getDb(): Client {
  if (client) return client;

  const syncUrl = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!syncUrl || !authToken) {
    throw new Error(
      "TURSO_DATABASE_URL and TURSO_AUTH_TOKEN environment variables are required."
    );
  }

  const localPath = process.env.LOCAL_DB_PATH || "/data/local.db";
  client = createClient({
    url: `file:${localPath}`,
    syncUrl,
    authToken,
  });
  console.log(`[db] Turso embedded replica initialised — local: ${localPath} remote: ${syncUrl.replace(/\/\/.*@/, "//***@")}`);

  // Initial sync (non-blocking — reads work from the local file immediately)
  client.sync().then(() => {
    console.log("[db] ✅ Initial sync completed");
  }).catch((err: unknown) => {
    console.warn("[db] ⚠️  Initial sync failed (will retry in 5min):", (err as Error)?.message ?? err);
  });

  // Periodic sync every 5 minutes
  syncInterval = setInterval(() => {
    if (client) {
      client.sync().then(() => {
        console.log("[db] 🔄 Periodic sync OK");
      }).catch((err: unknown) => {
        console.warn("[db] ⚠️  Periodic sync failed:", (err as Error)?.message ?? err);
      });
    }
  }, 300_000);

  return client;
}

/** Force an immediate sync. Useful after config changes. */
export async function syncNow(): Promise<void> {
  if (!client) return;
  try {
    await client.sync();
    console.log("[db] 🔄 Force sync OK");
  } catch (err) {
    console.warn("[db] ⚠️  Force sync failed:", (err as Error)?.message ?? err);
  }
}

/** Test the connection — logs success or failure, never throws. */
export async function testDbConnection(): Promise<boolean> {
  try {
    const db = getDb();
    const rs = await db.execute("SELECT 1");
    console.log("[db] Connection OK (local replica)");
    return true;
  } catch (err) {
    console.warn("[db] Connection failed:", err);
    return false;
  }
}

/** Clean shutdown: stop sync interval. */
export function closeDb(): void {
  if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
  if (client) { client.close(); client = null; }
}
