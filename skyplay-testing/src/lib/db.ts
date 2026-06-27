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
      requires_screenshot INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (step_id) REFERENCES steps(id)
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      step_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      answer_text TEXT NOT NULL,
      screenshot_base64 TEXT,
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

  // requires_screenshot flag (migration for existing DBs)
  try {
    await getClient().execute(
      "ALTER TABLE questions ADD COLUMN requires_screenshot INTEGER NOT NULL DEFAULT 1"
    );
  } catch { /* column already exists */ }

  // Answer type system columns (migration for existing DBs)
  try {
    await getClient().execute(
      "ALTER TABLE questions ADD COLUMN answer_type TEXT NOT NULL DEFAULT 'text'"
    );
  } catch { /* column already exists */ }
  try {
    await getClient().execute(
      "ALTER TABLE questions ADD COLUMN answer_options TEXT DEFAULT NULL"
    );
  } catch { /* column already exists */ }
  try {
    await getClient().execute(
      "ALTER TABLE questions ADD COLUMN reference_link TEXT DEFAULT NULL"
    );
  } catch { /* column already exists */ }
  try {
    await getClient().execute(
      "ALTER TABLE questions ADD COLUMN parts TEXT DEFAULT NULL"
    );
  } catch { /* column already exists */ }

  // Participation bonus columns (migration for existing DBs)
  try {
    await getClient().execute(
      "ALTER TABLE users ADD COLUMN participation_bonus INTEGER NOT NULL DEFAULT 0"
    );
  } catch { /* column already exists */ }
  try {
    await getClient().execute(
      "ALTER TABLE users ADD COLUMN bonus_status TEXT DEFAULT NULL"
    );
  } catch { /* column already exists */ }

  // users.last_seen column (migration for presence tracking)
  try {
    await getClient().execute(
      "ALTER TABLE users ADD COLUMN last_seen TIMESTAMP DEFAULT NULL"
    );
  } catch { /* column already exists */ }

  // Data migration: update existing questions with correct answer types / parts
  // Idempotent — only touches rows that still have the default 'text' type or NULL parts
  try {
    await getClient().executeMultiple(`
      -- Q2: radio Oui/Non
      UPDATE questions SET answer_type = 'radio', answer_options = '["Oui","Non"]' WHERE id = 2 AND answer_type = 'text';
      -- Q5: checkbox (4 formats)
      UPDATE questions SET answer_type = 'checkbox', answer_options = '["1v1","2v2","FFA","Tournoi"]' WHERE id = 5 AND answer_type = 'text';
      -- Q6: parts radio + text
      UPDATE questions SET parts = '[{"label":"Statut de la compétition","type":"radio","options":["En cours","Terminée"]},{"label":"Nombre de joueurs participants","type":"text"}]' WHERE id = 6 AND parts IS NULL;
      -- Q7: parts radio + text
      UPDATE questions SET parts = '[{"label":"La page se charge-t-elle correctement ?","type":"radio","options":["Oui","Non"]},{"label":"Décris ce que tu vois","type":"text"}]' WHERE id = 7 AND parts IS NULL;
      -- Q8: parts radio + text
      UPDATE questions SET parts = '[{"label":"Peux-tu filtrer ou trier les compétitions ?","type":"radio","options":["Oui","Non"]},{"label":"Si oui, comment ? Si non, trouves-tu cela gênant ?","type":"text"}]' WHERE id = 8 AND parts IS NULL;
      -- Q9: parts radio + text
      UPDATE questions SET parts = '[{"label":"Y a-t-il des diffusions en direct ?","type":"radio","options":["Oui","Non"]},{"label":"Décris ce que tu vois","type":"text"}]' WHERE id = 9 AND parts IS NULL;
      -- Q11: parts radio + text
      UPDATE questions SET parts = '[{"label":"Un classement ou leaderboard est-il visible ?","type":"radio","options":["Oui","Non"]},{"label":"Si oui, quel est ton rang ? Si non, aimerais-tu en avoir un ?","type":"text"}]' WHERE id = 11 AND parts IS NULL;
      -- Q12: parts radio + text
      UPDATE questions SET parts = '[{"label":"L''option de partage est-elle disponible ?","type":"radio","options":["Oui","Non"]},{"label":"Décris ton expérience","type":"text"}]' WHERE id = 12 AND parts IS NULL;
      -- Q13: dropdown note 1-10
      UPDATE questions SET answer_type = 'dropdown', answer_options = '["1","2","3","4","5","6","7","8","9","10"]' WHERE id = 13 AND answer_type = 'text';
      -- Q16: parts radio + text
      UPDATE questions SET parts = '[{"label":"Recommanderais-tu skyplay.cloud à un ami ?","type":"radio","options":["Oui","Non"]},{"label":"Pourquoi ?","type":"text"}]' WHERE id = 16 AND parts IS NULL;
      -- Q14, Q15: add reference_link
      UPDATE questions SET reference_link = 'https://skyplay.cloud/' WHERE id IN (14, 15) AND reference_link IS NULL;
    `);
  } catch (e) {
    console.error("Question type migration error (non-fatal):", e);
  }

  // Campaigns table — always ensure it exists (even on older DBs)
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT 'Campagne de test',
      deadline TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ——— Challenge System ———
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS challenges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      system TEXT NOT NULL DEFAULT 'snes',
      rom_name TEXT NOT NULL,
      criteria TEXT NOT NULL DEFAULT 'winloss',
      reward INTEGER NOT NULL DEFAULT 500,
      starts_at TIMESTAMP NOT NULL,
      ends_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER REFERENCES users(id)
    );
  `);

  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS challenge_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      challenge_id INTEGER NOT NULL REFERENCES challenges(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      result TEXT NOT NULL DEFAULT '',
      screenshot_base64 TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(challenge_id, user_id)
    );
  `);

  // Challenge indexes
  try { await getClient().execute("CREATE INDEX IF NOT EXISTS idx_challenge_submissions_challenge ON challenge_submissions(challenge_id)"); } catch {}
  try { await getClient().execute("CREATE INDEX IF NOT EXISTS idx_challenge_submissions_user ON challenge_submissions(user_id)"); } catch {}
  try { await getClient().execute("CREATE INDEX IF NOT EXISTS idx_challenge_submissions_status ON challenge_submissions(status)"); } catch {}

  // ——— Netplay / P2P System ———
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS challenge_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      challenge_id INTEGER NOT NULL REFERENCES challenges(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(challenge_id, user_id)
    );
  `);

  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS netplay_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      challenge_id INTEGER NOT NULL REFERENCES challenges(id),
      player1_id INTEGER NOT NULL REFERENCES users(id),
      player2_id INTEGER REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'WAITING',
      winner_id INTEGER REFERENCES users(id),
      result TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      started_at TIMESTAMP,
      finished_at TIMESTAMP
    );
  `);

  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS netplay_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES netplay_sessions(id),
      from_user_id INTEGER NOT NULL REFERENCES users(id),
      to_user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      consumed INTEGER DEFAULT 0
    );
  `);

  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS presence (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      is_online INTEGER NOT NULL DEFAULT 0,
      last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      current_challenge_id INTEGER REFERENCES challenges(id),
      current_session_id INTEGER REFERENCES netplay_sessions(id)
    );
  `);

  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS netplay_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES netplay_sessions(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      from_user_id INTEGER NOT NULL REFERENCES users(id),
      from_username TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'challenge',
      challenge_id INTEGER REFERENCES challenges(id),
      message TEXT DEFAULT '',
      read INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ——— Duel System (Cloud Gaming Matchmaking) ———
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS duel_lobby (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      system TEXT NOT NULL DEFAULT 'neogeo',
      rom TEXT NOT NULL DEFAULT 'kof98.zip',
      status TEXT NOT NULL DEFAULT 'waiting',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id)
    );
  `);

  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS duel_challenges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      challenger_id INTEGER NOT NULL REFERENCES users(id),
      target_id INTEGER NOT NULL REFERENCES users(id),
      system TEXT NOT NULL DEFAULT 'neogeo',
      rom TEXT NOT NULL DEFAULT 'kof98.zip',
      status TEXT NOT NULL DEFAULT 'pending',
      session_id TEXT,
      room_code TEXT,
      ws_url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS duel_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      challenge_id INTEGER REFERENCES duel_challenges(id),
      winner_id INTEGER NOT NULL REFERENCES users(id),
      loser_id INTEGER NOT NULL REFERENCES users(id),
      p1_losses INTEGER NOT NULL DEFAULT 0,
      p2_losses INTEGER NOT NULL DEFAULT 0,
      system TEXT NOT NULL DEFAULT 'neogeo',
      rom TEXT NOT NULL DEFAULT 'kof98.zip',
      session_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Duel indexes
  try { await getClient().execute("CREATE INDEX IF NOT EXISTS idx_duel_lobby_user ON duel_lobby(user_id)"); } catch {}
  try { await getClient().execute("CREATE INDEX IF NOT EXISTS idx_duel_lobby_status ON duel_lobby(status)"); } catch {}
  try { await getClient().execute("CREATE INDEX IF NOT EXISTS idx_duel_challenges_target ON duel_challenges(target_id, status)"); } catch {}
  try { await getClient().execute("CREATE INDEX IF NOT EXISTS idx_duel_challenges_challenger ON duel_challenges(challenger_id, status)"); } catch {}
  try { await getClient().execute("CREATE INDEX IF NOT EXISTS idx_duel_results_winner ON duel_results(winner_id)"); } catch {}
  try { await getClient().execute("CREATE INDEX IF NOT EXISTS idx_duel_results_loser ON duel_results(loser_id)"); } catch {}

  // Duel lobby heartbeat column (added post-migration)
  try { await getClient().execute("ALTER TABLE duel_lobby ADD COLUMN last_heartbeat TIMESTAMP DEFAULT NULL"); } catch { /* column already exists */ }

  // Netplay indexes
  try { await getClient().execute("CREATE INDEX IF NOT EXISTS idx_challenge_participants_challenge ON challenge_participants(challenge_id)"); } catch {}
  try { await getClient().execute("CREATE INDEX IF NOT EXISTS idx_challenge_participants_user ON challenge_participants(user_id)"); } catch {}
  try { await getClient().execute("CREATE INDEX IF NOT EXISTS idx_netplay_sessions_status ON netplay_sessions(status)"); } catch {}
  try { await getClient().execute("CREATE INDEX IF NOT EXISTS idx_netplay_sessions_challenge ON netplay_sessions(challenge_id)"); } catch {}
  try { await getClient().execute("CREATE INDEX IF NOT EXISTS idx_netplay_signals_session ON netplay_signals(session_id, consumed)"); } catch {}
  try { await getClient().execute("CREATE INDEX IF NOT EXISTS idx_netplay_signals_to ON netplay_signals(to_user_id, consumed)"); } catch {}
  try { await getClient().execute("CREATE INDEX IF NOT EXISTS idx_netplay_notifications_user ON netplay_notifications(user_id, read)"); } catch {}
  try { await getClient().execute("CREATE INDEX IF NOT EXISTS idx_netplay_notifications_session ON netplay_notifications(session_id)"); } catch {}

  // Performance indexes — harmless if already exist (IF NOT EXISTS from SQLite 3.25+,
  // but Turso/libsql supports it; wrapped in try/catch for safety)
  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status)",
    "CREATE INDEX IF NOT EXISTS idx_submissions_step_id ON submissions(step_id)",
    "CREATE INDEX IF NOT EXISTS idx_submissions_user_id ON submissions(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_submissions_question_id ON submissions(question_id)",
    "CREATE INDEX IF NOT EXISTS idx_questions_step_id ON questions(step_id)",
  ];
  for (const idx of indexes) {
    try {
      await getClient().execute(idx);
    } catch {
      // index may already exist — ignore
    }
  }
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
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order, answer_type, answer_options, reference_link, parts) VALUES (1, 'Crée un compte sur **skyplay.cloud** (le site web, pas l''application mobile). Une fois inscrit, donne ton nom d''utilisateur et envoie une capture de ta page de profil.', 200, 1, 'text', NULL, 'https://skyplay.cloud/register', NULL);
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order, answer_type, answer_options, reference_link, parts) VALUES (1, 'Dans les paramètres de ton profil, l''option ''Mode sombre'' existe-t-elle ? Active-la si possible et envoie une capture.', 150, 2, 'radio', '["Oui","Non"]', 'https://skyplay.cloud/profile/settings', NULL);
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order, answer_type, answer_options, reference_link, parts) VALUES (1, 'Sur la page d''accueil de **skyplay.cloud**, dans la section ''Jeux supportés'', combien de jeux sont affichés ? Liste-les et envoie une capture.', 150, 3, 'text', NULL, 'https://skyplay.cloud/', NULL);
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order, answer_type, answer_options, reference_link, parts) VALUES (1, 'Sur **skyplay.cloud**, clique sur ''Rejoindre gratuitement'' ou ''Créer mon compte''. Décris la page où tu arrives et envoie une capture.', 200, 4, 'text', NULL, 'https://skyplay.cloud/register', NULL);

      -- Jalon 2: Exploration des Compétitions
      INSERT INTO steps (slug, title) VALUES ('jalon_2', 'Exploration des Compétitions');
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order, answer_type, answer_options, reference_link, parts) VALUES (2, 'Dans la section ''Formats disponibles'', liste les 4 formats de compétition proposés et envoie une capture.', 250, 1, 'checkbox', '["1v1","2v2","FFA","Tournoi"]', 'https://skyplay.cloud/competitions', NULL);
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order, answer_type, answer_options, reference_link, parts) VALUES (2, 'Trouve une compétition FIFA. Quel est son statut ? Combien de joueurs y participent ? Envoie une capture.', 300, 2, 'text', NULL, 'https://skyplay.cloud/competitions', '[{"label":"Statut de la compétition","type":"radio","options":["En cours","Terminée"]},{"label":"Nombre de joueurs participants","type":"text"}]');
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order, answer_type, answer_options, reference_link, parts) VALUES (2, 'Sur **skyplay.cloud**, clique sur ''Voir les compétitions''. La page se charge-t-elle correctement ? Décris ce que tu vois et envoie une capture.', 250, 3, 'text', NULL, 'https://skyplay.cloud/competitions', '[{"label":"La page se charge-t-elle correctement ?","type":"radio","options":["Oui","Non"]},{"label":"Décris ce que tu vois","type":"text"}]');
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order, answer_type, answer_options, reference_link, parts) VALUES (2, 'Peux-tu filtrer ou trier les compétitions ? Si oui, comment ? Si non, trouves-tu cela gênant ? Envoie une capture.', 200, 4, 'text', NULL, 'https://skyplay.cloud/competitions', '[{"label":"Peux-tu filtrer ou trier les compétitions ?","type":"radio","options":["Oui","Non"]},{"label":"Si oui, comment ? Si non, trouves-tu cela gênant ?","type":"text"}]');

      -- Jalon 3: Social & Live
      INSERT INTO steps (slug, title) VALUES ('jalon_3', 'Social & Live');
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order, answer_type, answer_options, reference_link, parts) VALUES (3, 'Sur **skyplay.cloud**, clique sur l''onglet LIVE. Y a-t-il des diffusions en direct ? Décris ce que tu vois et envoie une capture.', 300, 1, 'text', NULL, 'https://skyplay.cloud/live', '[{"label":"Y a-t-il des diffusions en direct ?","type":"radio","options":["Oui","Non"]},{"label":"Décris ce que tu vois","type":"text"}]');
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order, answer_type, answer_options, reference_link, parts) VALUES (3, 'Depuis la page d''accueil de **skyplay.cloud**, peux-tu trouver la liste des joueurs ? Décris le chemin et envoie une capture.', 300, 2, 'text', NULL, 'https://skyplay.cloud/players', NULL);
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order, answer_type, answer_options, reference_link, parts) VALUES (3, 'Y a-t-il un classement ou leaderboard visible ? Si oui, quel est ton rang ? Si non, aimerais-tu en avoir un ? Envoie une capture.', 300, 3, 'text', NULL, 'https://skyplay.cloud/leaderboard', '[{"label":"Un classement ou leaderboard est-il visible ?","type":"radio","options":["Oui","Non"]},{"label":"Si oui, quel est ton rang ? Si non, aimerais-tu en avoir un ?","type":"text"}]');
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order, answer_type, answer_options, reference_link, parts) VALUES (3, 'Essaie de partager un lien de compétition ou ton profil (bouton de partage, copier le lien…). L''option est-elle disponible ? Envoie une capture.', 250, 4, 'text', NULL, 'https://skyplay.cloud/competitions', '[{"label":"L''option de partage est-elle disponible ?","type":"radio","options":["Oui","Non"]},{"label":"Décris ton expérience","type":"text"}]');

      -- Jalon 4: Feedback Final & Suggestions (pas de capture nécessaire)
      INSERT INTO steps (slug, title) VALUES ('jalon_4', 'Feedback Final & Suggestions');
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order, requires_screenshot, answer_type, answer_options, reference_link, parts) VALUES (4, 'Sur une échelle de 1 à 10, quelle note donnes-tu à l''expérience globale de la plateforme **skyplay.cloud** ? Justifie ta note en 2-3 phrases.', 300, 1, 0, 'dropdown', '["1","2","3","4","5","6","7","8","9","10"]', 'https://skyplay.cloud/', NULL);
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order, requires_screenshot, answer_type, answer_options, reference_link, parts) VALUES (4, 'As-tu rencontré un bug ou un comportement inattendu ? Décris-le avec le plus de détails possible (où, quand, comment).', 400, 2, 0, 'text', NULL, 'https://skyplay.cloud/', NULL);
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order, requires_screenshot, answer_type, answer_options, reference_link, parts) VALUES (4, 'Quelle fonctionnalité aimerais-tu voir ajoutée en priorité sur skyplay.cloud ? Décris-la brièvement.', 300, 3, 0, 'text', NULL, 'https://skyplay.cloud/', NULL);
      INSERT INTO questions (step_id, question_text, reward_amount, sort_order, requires_screenshot, answer_type, answer_options, reference_link, parts) VALUES (4, 'Recommanderais-tu skyplay.cloud à un ami ? Pourquoi ?', 300, 4, 0, 'text', NULL, 'https://skyplay.cloud/', '[{"label":"Recommanderais-tu skyplay.cloud à un ami ?","type":"radio","options":["Oui","Non"]},{"label":"Pourquoi ?","type":"text"}]');

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

/**
 * Ensure a user exists with the given ID. Used in local dev mode
 * where arbitrary user IDs are passed by the frontend without a real sign-up.
 *
 * Strategy:
 * 1. User exists by our ID → no-op
 * 2. Username exists with a DIFFERENT ID → rename old user to free the
 *    username (keeping their ID for existing FK references), then create
 *    a fresh row with our desired ID.
 * 3. Neither exists → create fresh row
 */
export async function ensureUser(userId: number, username: string): Promise<void> {
  const client = getClient();

  // Already exists with the correct ID?
  const byId = await client.execute({ sql: "SELECT id FROM users WHERE id = ?", args: [userId] });
  if (byId.rows.length > 0) return;

  // Username taken by a different ID? Rename that old user to free the username.
  const byName = await client.execute({ sql: "SELECT id FROM users WHERE username = ? AND id != ?", args: [username, userId] });
  if (byName.rows.length > 0) {
    const oldId = byName.rows[0].id as number;
    // Keep the old ID (FKs in other tables still point to it) but rename
    // so we can claim the desired username for our new ID.
    await client.execute({
      sql: "UPDATE users SET username = ?, email = ? WHERE id = ?",
      args: [`${username}-${oldId}`, `${username}-${oldId}@local.dev`, oldId],
    });
  }

  // Now create the fresh row with our desired ID + username
  await client.execute({
    sql: "INSERT OR IGNORE INTO users (id, username, email, role) VALUES (?, ?, ?, 'user')",
    args: [userId, username, `${username}@local.dev`],
  });
}
