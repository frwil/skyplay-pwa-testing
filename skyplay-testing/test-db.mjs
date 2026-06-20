import { getDb } from "./src/lib/db";

async function main() {
  console.time("turso-connect");
  try {
    const db = await getDb();
    const r = await db.execute("SELECT 1 as ok");
    console.timeEnd("turso-connect");
    console.log("Turso OK:", JSON.stringify(r.rows[0]));
  } catch (e) {
    console.timeEnd("turso-connect");
    console.error("Turso FAIL:", e);
  }
}

main();
