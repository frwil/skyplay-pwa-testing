import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function main() {
  // 1. Delete all pending challenges
  const del = await db.execute({
    sql: "DELETE FROM duel_challenges WHERE status = ?",
    args: ["pending"],
  });
  console.log("Deleted pending challenges:", del.rowsAffected);

  // 2. Reset stuck lobby statuses (challenging -> waiting)
  const reset = await db.execute(
    "UPDATE duel_lobby SET status = 'waiting' WHERE status = 'challenging'"
  );
  console.log("Reset lobby entries:", reset.rowsAffected);

  // Verify
  const pending = await db.execute({
    sql: "SELECT COUNT(*) as cnt FROM duel_challenges WHERE status = ?",
    args: ["pending"],
  });
  console.log("Pending remaining:", pending.rows[0].cnt);

  const lobby = await db.execute(
    "SELECT user_id, status FROM duel_lobby WHERE status != 'waiting'"
  );
  console.log("Non-waiting lobby entries:", lobby.rows.length);
  for (const r of lobby.rows) {
    console.log(JSON.stringify(r));
  }
}

main().catch((e) => console.error(e.message));
