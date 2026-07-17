import { createClient } from "@libsql/client";
import fs from "fs";

// Run from skyplay-testing/ (reads .env.local from CWD).
const envContent = fs.readFileSync(".env.local", "utf8");
const env = {};
envContent.split("\n").forEach((line) => {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
});
const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

async function main() {
  // Check duel_games
  let rs = await db.execute("PRAGMA table_info(duel_games)");
  console.log("duel_games columns:");
  for (const r of rs.rows) console.log("  ", r.cid, r.name, r.type);

  // Check duel_game_controls
  rs = await db.execute("PRAGMA table_info(duel_game_controls)");
  console.log("duel_game_controls columns:");
  for (const r of rs.rows) console.log("  ", r.cid, r.name, r.type);

  // Check duel_game_config_versions
  try {
    rs = await db.execute("PRAGMA table_info(duel_game_config_versions)");
    console.log("duel_game_config_versions columns:");
    for (const r of rs.rows) console.log("  ", r.cid, r.name, r.type);
  } catch { console.log("duel_game_config_versions: table does not exist"); }

  // Check data
  const data = await db.execute("SELECT id, label FROM duel_games");
  console.log("duel_games rows:", data.rows.length);
  for (const r of data.rows) console.log("  ", r.id, r.label);
}

main();
