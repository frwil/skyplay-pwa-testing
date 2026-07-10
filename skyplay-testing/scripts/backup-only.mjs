// Read-only logical backup — dumps every table's schema + rows to db-backups/.
// NO mutations (no DELETE/UPDATE/DROP). Safe to run before an additive migration.
import { createClient } from "@libsql/client";
import fs from "fs";

const envContent = fs.readFileSync(".env.local", "utf8");
const env = {};
envContent.split("\n").forEach((line) => {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
});

const url = env.TURSO_DATABASE_URL;
const token = env.TURSO_AUTH_TOKEN;
if (!url || !token) {
  console.error("Missing TURSO credentials");
  process.exit(1);
}

const db = createClient({ url, authToken: token });

function sqlVal(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array) return `X'${Buffer.from(v).toString("hex")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function main() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const out = [`-- SkyPlay logical backup ${ts}`, "PRAGMA foreign_keys=OFF;", "BEGIN TRANSACTION;"];

  const tablesRs = await db.execute(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  let totalRows = 0;
  for (const t of tablesRs.rows) {
    const name = t.name;
    if (t.sql) out.push(`${t.sql};`);
    const rs = await db.execute(`SELECT * FROM "${name}"`);
    const cols = rs.columns;
    for (const row of rs.rows) {
      const vals = cols.map((c) => sqlVal(row[c]));
      out.push(`INSERT INTO "${name}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES(${vals.join(",")});`);
    }
    totalRows += rs.rows.length;
    console.log(`${name}: ${rs.rows.length} rows`);
  }
  out.push("COMMIT;");

  const dir = "../db-backups";
  fs.mkdirSync(dir, { recursive: true });
  const file = `${dir}/backup-${ts}.sql`;
  fs.writeFileSync(file, out.join("\n"));
  console.log(`\n✅ Backup: ${file} (${tablesRs.rows.length} tables, ${totalRows} rows)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
