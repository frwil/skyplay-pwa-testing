/**
 * Seed script: creates the first Street Fighter challenge.
 * Run: node scripts/seed-challenge.mjs
 */
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Street Fighter challenge config
const challenge = {
  title: "Street Fighter II Turbo — Tournoi #1",
  description:
    "Lance la ROM Street Fighter, joue un combat et soumets ton résultat (Victoire/Défaite/Match nul). À la fin du délai, le joueur avec le plus de victoires gagne !",
  system: "snes",
  romName: "Street Fighter 5 (Hack).smc",
  criteria: "winloss",
  reward: 500,
  startsAt: new Date().toISOString(),
  endsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(), // 7 days
};

async function main() {
  console.log("🔍 Checking for existing Street Fighter challenges...");
  const existing = await db.execute({
    sql: "SELECT id, title FROM challenges WHERE rom_name = ?",
    args: [challenge.romName],
  });

  if (existing.rows.length > 0) {
    console.log("⚠️  Challenge already exists for this ROM:");
    for (const row of existing.rows) {
      console.log(`   #${row.id} — ${row.title}`);
    }
    console.log("   Skipping insert.");
    return;
  }

  console.log("➕ Creating Street Fighter challenge...");
  const insert = await db.execute({
    sql: `INSERT INTO challenges (title, description, system, rom_name, criteria, reward, starts_at, ends_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      challenge.title,
      challenge.description,
      challenge.system,
      challenge.romName,
      challenge.criteria,
      challenge.reward,
      challenge.startsAt,
      challenge.endsAt,
    ],
  });

  console.log(`✅ Challenge créé — ID: ${Number(insert.lastInsertRowid)}`);
  console.log(`   Titre : ${challenge.title}`);
  console.log(`   ROM   : ${challenge.romName}`);
  console.log(`   Début : ${challenge.startsAt}`);
  console.log(`   Fin   : ${challenge.endsAt}`);
  console.log(`   Gain  : ${challenge.reward} Sky`);
}

main().catch((err) => {
  console.error("❌ Erreur:", err);
  process.exit(1);
});
