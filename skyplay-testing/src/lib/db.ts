import { createClient, type Client } from "@libsql/client";
import bcrypt from "bcryptjs";

let db: Client | null = null;

function getClient(): Client {
  if (!db) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (!url || !authToken) {
      throw new Error(
        "TURSO_DATABASE_URL and TURSO_AUTH_TOKEN environment variables are required. " +
        "Copy .env.example to .env.local and set your Turso credentials."
      );
    }
    db = createClient({ url, authToken });
  }
  return db;
}

export async function getDb(): Promise<Client> {
  const client = getClient();
  await ensureDb();
  return client;
}

async function initializeSchema(): Promise<void> {
  // Fast-path: skip main tables if users already exists (avoids SQL parsing overhead)
  const tableCheck = await getClient().execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
  );
  const usersExist = tableCheck.rows.length > 0;

  if (!usersExist) {
    // Create all tables in one batch
    await getClient().executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username VARCHAR(50) UNIQUE NOT NULL,
      email VARCHAR(100) UNIQUE NOT NULL,
      role TEXT DEFAULT 'user',
      password_hash TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug VARCHAR(20) UNIQUE NOT NULL,
      title VARCHAR(100) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      step_id INTEGER NOT NULL,
      question_text TEXT NOT NULL,
      reward_amount INTEGER NOT NULL DEFAULT 200,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (step_id) REFERENCES steps(id)
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      step_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      answer_text TEXT NOT NULL,
      screenshot_base64 TEXT NOT NULL,
      status VARCHAR(20) DEFAULT 'PENDING',
      submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (step_id) REFERENCES steps(id),
      FOREIGN KEY (question_id) REFERENCES questions(id),
      UNIQUE(user_id, question_id)
    );
    `);
  }

  // Migrate existing databases that may lack the new columns
  try {
    await getClient().execute(
      "ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'"
    );
  } catch { /* column already exists */ }
  try {
    await getClient().execute(
      "ALTER TABLE users ADD COLUMN password_hash TEXT"
    );
  } catch { /* column already exists */ }

  // Campaigns table — always ensure it exists (even on older DBs)
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT 'Campagne de test',
      deadline TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function seedData(): Promise<void> {
  const client = getClient();

  // Seed steps & questions
  const rs = await client.execute("SELECT COUNT(*) as cnt FROM steps");
  const cnt = rs.rows[0]?.cnt as number;

  if (cnt === 0) {
    await client.executeMultiple(`
      BEGIN TRANSACTION;

      -- Jalon 1: Inscription & Onboarding
      INSERT INTO steps (slug, title) VALUES ('jalon_1', 'Inscription & Onboarding');
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order) VALUES (1, 'Crée un compte sur skyplay.cloud. Une fois inscrit, donne ton nom d''utilisateur et envoie une capture de ta page de profil.', 200, 1);
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order) VALUES (1, 'Dans les paramètres de ton profil, l''option ''Mode sombre'' existe-t-elle ? Active-la si possible et envoie une capture.', 150, 2);
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order) VALUES (1, 'Sur la page d''accueil, dans la section ''Jeux supportés'', combien de jeux sont affichés ? Liste-les et envoie une capture.', 150, 3);
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order) VALUES (1, 'Clique sur ''Rejoindre gratuitement'' ou ''Créer mon compte''. Décris la page où tu arrives et envoie une capture.', 200, 4);

      -- Jalon 2: Exploration des Compétitions
      INSERT INTO steps (slug, title) VALUES ('jalon_2', 'Exploration des Compétitions');
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order) VALUES (2, 'Dans la section ''Formats disponibles'', liste les 4 formats de compétition proposés et envoie une capture.', 250, 1);
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order) VALUES (2, 'Trouve une compétition FIFA. Quel est son statut (en cours / terminée) ? Combien de joueurs y participent ? Envoie une capture.', 300, 2);
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order) VALUES (2, 'Clique sur ''Voir les compétitions''. La page se charge-t-elle correctement ? Décris ce que tu vois et envoie une capture.', 250, 3);
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order) VALUES (2, 'Peux-tu filtrer ou trier les compétitions par jeu ou par type ? Si oui, comment ? Si non, trouves-tu cela gênant ? Envoie une capture.', 200, 4);

      -- Jalon 3: Social & Live
      INSERT INTO steps (slug, title) VALUES ('jalon_3', 'Social & Live');
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order) VALUES (3, 'Trouve la section ''LIVE'' ou ''Regarde les matchs''. Y a-t-il des streams en direct actuellement ? Décris ce que tu vois et envoie une capture.', 300, 1);
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order) VALUES (3, 'Cherche un autre joueur (via la barre de recherche si elle existe). Peux-tu voir son profil ? Décris l''expérience et envoie une capture.', 300, 2);
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order) VALUES (3, 'Y a-t-il un classement ou leaderboard visible ? Si oui, quel est ton rang actuel ? Si non, aimerais-tu en avoir un ? Envoie une capture.', 300, 3);
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order) VALUES (3, 'Essaie de partager un lien de compétition ou ton profil (bouton de partage, copier le lien…). L''option est-elle disponible ? Envoie une capture.', 250, 4);

      -- Jalon 4: Feedback Final & Suggestions
      INSERT INTO steps (slug, title) VALUES ('jalon_4', 'Feedback Final & Suggestions');
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order) VALUES (4, 'Sur une échelle de 1 à 10, quelle note donnes-tu à l''expérience globale de skyplay.cloud ? Justifie ta note en 2-3 phrases.', 300, 1);
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order) VALUES (4, 'As-tu rencontré un bug ou un comportement inattendu ? Décris-le avec le plus de détails possible (où, quand, comment).', 400, 2);
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order) VALUES (4, 'Quelle fonctionnalité aimerais-tu voir ajoutée en priorité sur skyplay.cloud ? Décris-la brièvement.', 300, 3);
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order) VALUES (4, 'Recommanderais-tu skyplay.cloud à un ami ? Pourquoi ?', 300, 4);

      COMMIT;
    `);
  }

  // Seed admin accounts from environment variables (only if none exist yet)
  const adminRs = await client.execute(
    "SELECT COUNT(*) as cnt FROM users WHERE role IN ('admin', 'superadmin')"
  );
  const adminCnt = adminRs.rows[0]?.cnt as number;

  if (adminCnt === 0) {
    const superadminUser = process.env.ADMIN_SUPER_USER || "admin";
    const superadminPass = process.env.ADMIN_SUPER_PASS;
    const superadminEmail = process.env.ADMIN_SUPER_EMAIL || "admin@skyplay.cloud";

    const adminUser = process.env.ADMIN_USER || "moderateur";
    const adminPass = process.env.ADMIN_PASS;
    const adminEmail = process.env.ADMIN_EMAIL || "moderateur@skyplay.cloud";

    if (superadminPass) {
      const hash = await bcrypt.hash(superadminPass, 12);
      await client.execute({
        sql: "INSERT OR IGNORE INTO users (username, email, role, password_hash) VALUES (?, ?, ?, ?)",
        args: [superadminUser, superadminEmail, "superadmin", hash],
      });
    }

    if (adminPass) {
      const hash = await bcrypt.hash(adminPass, 12);
      await client.execute({
        sql: "INSERT OR IGNORE INTO users (username, email, role, password_hash) VALUES (?, ?, ?, ?)",
        args: [adminUser, adminEmail, "admin", hash],
      });
    }
  }

  // Seed default campaign (if none exists) — starts tomorrow, 7 days
  const campaignRs = await client.execute("SELECT COUNT(*) as cnt FROM campaigns");
  const campaignCnt = campaignRs.rows[0]?.cnt as number;

  if (campaignCnt === 0) {
    await client.execute({
      sql: "INSERT INTO campaigns (name, deadline) VALUES (?, ?)",
      args: ["Campagne de test #1", "2026-06-22T00:00:00Z"],
    });
  }
}

// Initialize DB on first import
let initialized = false;
export async function ensureDb(): Promise<void> {
  if (!initialized) {
    await initializeSchema();
    await seedData();
    initialized = true;
  }
}
