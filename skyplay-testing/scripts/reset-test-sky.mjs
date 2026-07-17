// Reset the test players' spendable SKY to a target (default 10000).
// Balance model = computed earned SKY + SUM(sky_transactions). We never touch the
// earned base; we insert ONE additive `admin_adjust` row = target - currentBalance.
// Additive/idempotent-ish: re-running just tops back up to the target.
//
//   node scripts/reset-test-sky.mjs            # dry-run (prints balances + planned deltas)
//   node scripts/reset-test-sky.mjs --apply    # writes the adjustments
//
// Run from skyplay-testing/ (reads .env.local from CWD). Backup first (CLAUDE.md).
import { createClient } from "@libsql/client";
import fs from "fs";

const TARGET = 10000;
const DEFAULT_PLAYERS = ["testplayer1", "testplayer2", "Raimundo"];
const APPLY = process.argv.includes("--apply");
const players = process.argv.filter((a) => !a.startsWith("--") && !a.endsWith(".mjs") && !a.includes("node"));
const USERNAMES = players.length ? players : DEFAULT_PLAYERS;

const envContent = fs.readFileSync(".env.local", "utf8");
const env = {};
envContent.split("\n").forEach((line) => {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
});
const url = env.TURSO_DATABASE_URL, token = env.TURSO_AUTH_TOKEN;
if (!url || !token) { console.error("Missing TURSO credentials in .env.local"); process.exit(1); }
const db = createClient({ url, authToken: token });

// Same formula as src/lib/duel/wallet.ts getBalance().
async function getBalance(userId) {
  const rs = await db.execute({
    sql: `
      SELECT
        COALESCE((SELECT SUM(q.reward_amount) FROM submissions s
                  JOIN questions q ON q.id = s.question_id
                  WHERE s.user_id = u.id AND s.status = 'APPROVED'), 0)
        + CASE WHEN u.bonus_status = 'APPROVED' THEN COALESCE(u.participation_bonus, 0) ELSE 0 END
        + COALESCE((SELECT SUM(amount) FROM sky_transactions WHERE user_id = u.id), 0)
        AS balance
      FROM users u WHERE u.id = ?`,
    args: [userId],
  });
  return rs.rows.length ? Number(rs.rows[0].balance ?? 0) : 0;
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)"} | target=${TARGET}`);
  console.log(`Players: ${USERNAMES.join(", ")}\n`);

  for (const username of USERNAMES) {
    const u = await db.execute({ sql: "SELECT id, role FROM users WHERE username = ?", args: [username] });
    if (u.rows.length === 0) { console.log(`⚠️  ${username}: NOT FOUND — skipped`); continue; }
    const id = Number(u.rows[0].id);
    const role = u.rows[0].role;
    if (role === "admin" || role === "superadmin") {
      console.log(`ℹ️  ${username} (id=${id}): role=${role} → unlimited SKY, skipped`);
      continue;
    }
    const before = await getBalance(id);
    const delta = TARGET - before;
    if (delta === 0) { console.log(`✓ ${username} (id=${id}): already ${before} — no change`); continue; }
    if (!APPLY) {
      console.log(`• ${username} (id=${id}): ${before} → ${TARGET}  (would insert admin_adjust ${delta > 0 ? "+" : ""}${delta})`);
      continue;
    }
    await db.execute({
      sql: "INSERT INTO sky_transactions (user_id, amount, kind, note) VALUES (?, ?, 'admin_adjust', ?)",
      args: [id, delta, `reset test balance to ${TARGET}`],
    });
    const after = await getBalance(id);
    const ok = after === TARGET ? "✅" : "❌";
    console.log(`${ok} ${username} (id=${id}): ${before} → ${after} (adjust ${delta > 0 ? "+" : ""}${delta})`);
  }
  console.log(APPLY ? "\nDone." : "\nDry-run only. Re-run with --apply to write.");
}
main().catch((e) => { console.error(e); process.exit(1); });
