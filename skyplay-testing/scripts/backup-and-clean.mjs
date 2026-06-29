import { createClient } from "@libsql/client";
import fs from "fs";

const envContent = fs.readFileSync(".env.local", "utf8");
const env = {};
envContent.split("\n").forEach((line) => {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
});

const url = env.TURSO_DATABASE_URL;
const token = env.TURSO_AUTH_TOKEN;

if (!url || !token) {
  console.error("Missing TURSO credentials");
  process.exit(1);
}

const db = createClient({ url, authToken: token });

const TESTPLAYER1 = 1744147614;
const TESTPLAYER2 = 1744147615;

async function main() {
  // 1. Backup all important tables
  console.log("=== BACKUP ===");
  const tables = [
    "users",
    "duel_lobby",
    "duel_challenges",
    "duel_results",
    "netplay_notifications",
    "netplay_sessions",
  ];
  const backup = [];

  for (const table of tables) {
    try {
      const rs = await db.execute({ sql: `SELECT * FROM ${table}`, args: [] });
      console.log(`${table}: ${rs.rows.length} rows`);
      backup.push(`-- Table: ${table} (${rs.rows.length} rows)`);
      for (const row of rs.rows) {
        const vals = Object.values(row).map((v) =>
          v === null ? "NULL" : typeof v === "string" ? `'${v.replace(/'/g, "''")}'` : v
        );
        backup.push(`INSERT INTO ${table} VALUES(${vals.join(", ")});`);
      }
    } catch (e) {
      console.log(`${table}: SKIPPED (${e.message})`);
    }
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = `backup-${ts}.sql`;
  fs.writeFileSync(backupFile, backup.join("\n"));
  console.log(`Backup saved to: ${backupFile}`);

  // 2. Show current lobby
  console.log("\n=== CURRENT LOBBY ===");
  const lobby = await db.execute("SELECT user_id, status, created_at FROM duel_lobby");
  for (const row of lobby.rows) {
    console.log(`  userId=${row.user_id} status=${row.status} created=${row.created_at}`);
  }

  // 3. Show current challenges
  console.log("\n=== CURRENT CHALLENGES ===");
  const challenges = await db.execute("SELECT id, challenger_id, target_id, status FROM duel_challenges");
  for (const row of challenges.rows) {
    console.log(`  id=${row.id} challenger=${row.challenger_id} target=${row.target_id} status=${row.status}`);
  }

  // 4. Clean lobby — keep only testplayer1 & testplayer2
  console.log("\n=== CLEANUP ===");
  const delLobby = await db.execute({
    sql: "DELETE FROM duel_lobby WHERE user_id NOT IN (?, ?)",
    args: [TESTPLAYER1, TESTPLAYER2],
  });
  console.log(`Removed ${delLobby.rowsAffected} users from duel_lobby`);

  // 5. Cancel challenges not involving testplayer1/testplayer2
  const cancelChallenges = await db.execute({
    sql: "UPDATE duel_challenges SET status = 'cancelled' WHERE challenger_id NOT IN (?, ?) AND target_id NOT IN (?, ?)",
    args: [TESTPLAYER1, TESTPLAYER2, TESTPLAYER1, TESTPLAYER2],
  });
  console.log(`Cancelled ${cancelChallenges.rowsAffected} challenges from other users`);

  // 6. Also clean stale notifications
  const cleanNotifs = await db.execute({
    sql: "UPDATE netplay_notifications SET read = 1 WHERE type LIKE 'duel_%' AND user_id NOT IN (?, ?)",
    args: [TESTPLAYER1, TESTPLAYER2],
  });
  console.log(`Marked ${cleanNotifs.rowsAffected} notifications as read for other users`);

  // 7. Mark past duel results as completed if needed
  const cleanResults = await db.execute({
    sql: "DELETE FROM duel_results WHERE winner_id NOT IN (?, ?) AND loser_id NOT IN (?, ?)",
    args: [TESTPLAYER1, TESTPLAYER2, TESTPLAYER1, TESTPLAYER2],
  });
  console.log(`Removed ${cleanResults.rowsAffected} old duel results from other users`);

  // 8. Verify final state
  console.log("\n=== FINAL LOBBY ===");
  const finalLobby = await db.execute("SELECT user_id, status FROM duel_lobby");
  for (const row of finalLobby.rows) {
    console.log(`  userId=${row.user_id} status=${row.status}`);
  }

  console.log("\n=== FINAL CHALLENGES ===");
  const finalChallenges = await db.execute("SELECT id, challenger_id, target_id, status FROM duel_challenges WHERE status != 'cancelled'");
  for (const row of finalChallenges.rows) {
    console.log(`  id=${row.id} challenger=${row.challenger_id} target=${row.target_id} status=${row.status}`);
  }

  console.log("\n✅ Done.");
}

main().catch(console.error);
