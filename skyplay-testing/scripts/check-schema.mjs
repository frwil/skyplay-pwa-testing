import { createClient } from "@libsql/client";

const db = createClient({
  url: "libsql://skyplay-pwa-frwil.aws-us-west-2.turso.io",
  authToken: "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODM3MTczMjEsImlkIjoiMDE5ZWIxNjYtZDEwMS03MWQ1LWEwOTItMWY0YTI4NzVhM2UzIiwia2lkIjoiZ0RWcHlKWW4wLWwzZTF2QUZHSERha1R5UWZFdXJBVmFJR0VTR1dwRHlBayIsInJpZCI6ImI1MmFkMGQ5LTlmOGItNGM3Ny05YjUxLWY2YzViN2EyNGNlNiJ9.hQn6YetR-MpqPt0yMHLTXcV8Rx75y5P-K1akoEUkfLI7LRUmN5GhQvWNNPVFLjGDhrj0eq53BYGNepm9hmz1Bw",
});

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
