// Targeted backup of specific users' SKY state before an additive reset.
// Dumps each user's current computed balance + ALL their sky_transactions rows
// to a timestamped JSON file. Enough to reverse an additive admin_adjust.
// Network-friendly (few small queries) — for use when a full .dump is impractical.
//
//   node scripts/backup-sky-users.mjs 2493218704 1934220160
//
// Run from skyplay-testing/ (reads .env.local from CWD). Writes to ../db-backups/.
import { createClient } from "@libsql/client";
import fs from "fs";

const userIds = process.argv.filter((a) => /^\d+$/.test(a)).map(Number);
if (userIds.length === 0) { console.error("Usage: node scripts/backup-sky-users.mjs <userId> [userId...]"); process.exit(1); }

const envContent = fs.readFileSync(".env.local", "utf8");
const env = {};
envContent.split("\n").forEach((line) => {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
});
const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

async function getBalance(userId) {
  const rs = await db.execute({
    sql: `SELECT
        COALESCE((SELECT SUM(q.reward_amount) FROM submissions s
                  JOIN questions q ON q.id = s.question_id
                  WHERE s.user_id = u.id AND s.status = 'APPROVED'), 0)
        + CASE WHEN u.bonus_status = 'APPROVED' THEN COALESCE(u.participation_bonus, 0) ELSE 0 END
        + COALESCE((SELECT SUM(amount) FROM sky_transactions WHERE user_id = u.id), 0) AS balance
      FROM users u WHERE u.id = ?`,
    args: [userId],
  });
  return rs.rows.length ? Number(rs.rows[0].balance ?? 0) : null;
}

async function main() {
  const snapshot = { takenAt: new Date().toISOString(), users: [] };
  for (const id of userIds) {
    const u = await db.execute({ sql: "SELECT id, username, role FROM users WHERE id = ?", args: [id] });
    const balance = await getBalance(id);
    const tx = await db.execute({ sql: "SELECT * FROM sky_transactions WHERE user_id = ? ORDER BY id", args: [id] });
    snapshot.users.push({
      id,
      username: u.rows[0]?.username ?? null,
      role: u.rows[0]?.role ?? null,
      balance,
      sky_transactions: tx.rows,
    });
    console.log(`• ${u.rows[0]?.username ?? id} (id=${id}): balance=${balance}, ${tx.rows.length} sky_transactions`);
  }
  const dir = "../db-backups";
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `${dir}/sky-users-backup-${stamp}.json`;
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
  console.log(`\nBackup written: ${file}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
