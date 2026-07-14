import { createClient, type Client } from "@libsql/client";
import bcrypt from "bcryptjs";
import { COUNTRY_CODES } from "@/lib/countries";
import { generateIdenticon, pickFromSeed } from "@/lib/avatar";

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

  // users profile columns: avatar (compressed base64 data URL) + nationality (ISO-3166 alpha-2).
  try { await getClient().execute("ALTER TABLE users ADD COLUMN avatar_base64 TEXT DEFAULT NULL"); } catch { /* column already exists */ }
  try { await getClient().execute("ALTER TABLE users ADD COLUMN country TEXT DEFAULT NULL"); } catch { /* column already exists */ }

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

  // perfect_ko_count column on duel_results (added post-migration)
  try { await getClient().execute("ALTER TABLE duel_results ADD COLUMN perfect_ko_count INTEGER NOT NULL DEFAULT 0"); } catch { /* column already exists */ }

  // ── Duel modes & multi-match columns (added post-migration) ──
  try { await getClient().execute("ALTER TABLE duel_challenges ADD COLUMN mode_id TEXT DEFAULT NULL"); } catch { /* column already exists */ }
  try { await getClient().execute("ALTER TABLE duel_challenges ADD COLUMN match_count INTEGER NOT NULL DEFAULT 1"); } catch { /* column already exists */ }
  try { await getClient().execute("ALTER TABLE duel_challenges ADD COLUMN match_number INTEGER NOT NULL DEFAULT 0"); } catch { /* column already exists */ }
  try { await getClient().execute("ALTER TABLE duel_challenges ADD COLUMN challenger_rules_accepted INTEGER NOT NULL DEFAULT 0"); } catch { /* column already exists */ }
  try { await getClient().execute("ALTER TABLE duel_challenges ADD COLUMN target_rules_accepted INTEGER NOT NULL DEFAULT 0"); } catch { /* column already exists */ }

  // ─── Duel game registry (controls which ROMs are playable in duels) ───
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS duel_games (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      system TEXT NOT NULL,
      rom TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'fighting',
      entry_fee INTEGER NOT NULL DEFAULT 1000,
      ram_config TEXT DEFAULT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
    )
  `);
  // Idempotent ALTER TABLE for columns that may be missing on older DB instances
  try { await getClient().execute("ALTER TABLE duel_games ADD COLUMN entry_fee INTEGER NOT NULL DEFAULT 1000"); } catch {}
  try { await getClient().execute("ALTER TABLE duel_games ADD COLUMN ram_config TEXT DEFAULT NULL"); } catch {}
  try { await getClient().execute("ALTER TABLE duel_games ADD COLUMN category TEXT DEFAULT 'fighting'"); } catch {}
  try { await getClient().execute("ALTER TABLE duel_games ADD COLUMN cover_image TEXT DEFAULT NULL"); } catch {}
  try { await getClient().execute("ALTER TABLE duel_games ADD COLUMN description TEXT DEFAULT NULL"); } catch {}
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS duel_game_controls (
      game_id TEXT NOT NULL REFERENCES duel_games(id),
      player INTEGER NOT NULL CHECK(player IN (1, 2)),
      action_key TEXT NOT NULL,
      label_key TEXT NOT NULL,
      default_keys TEXT NOT NULL,
      PRIMARY KEY (game_id, player, action_key)
    )
  `);
  // ─── Config version history (git-like: every config change creates a new version) ───
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS duel_game_config_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL REFERENCES duel_games(id),
      version INTEGER NOT NULL,
      ram_config TEXT,
      controls TEXT,
      label TEXT,
      is_active INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(game_id, version)
    )
  `);
  // ─── Duel game modes (Standard / XL / Fighter) ───
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS duel_game_modes (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL REFERENCES duel_games(id),
      mode_key TEXT NOT NULL,
      label TEXT NOT NULL,
      match_count INTEGER NOT NULL,
      entry_fee INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      UNIQUE(game_id, mode_key)
    )
  `);
  try { await getClient().execute("ALTER TABLE duel_game_modes ADD COLUMN rules TEXT DEFAULT NULL"); } catch { /* column already exists */ }

  // Seed default duel games (idempotent — INSERT OR IGNORE)
  // category: fighting, versus, puzzle, sports, etc.
  // cover_image: URL or null (CSS gradient fallback used when null)
  // description: short game description (English, used as fallback; i18n preferred)
  try { await getClient().execute("INSERT OR IGNORE INTO duel_games (id, label, system, rom, mode, category, cover_image, description) VALUES ('kof98', 'KOF ''98', 'neogeo', 'kof98.zip', 'fighting', 'fighting', 'https://upload.wikimedia.org/wikipedia/en/1/18/The_King_of_Fighters_%2798_arcade_flyer.jpg', 'The legendary Neo Geo fighting game. 3v3 team battles, advanced gauge system, and a roster of 38 iconic characters.')"); } catch {}
  try { await getClient().execute("INSERT OR IGNORE INTO duel_games (id, label, system, rom, mode, category, cover_image, description) VALUES ('sf2', 'Street Fighter 2', 'snes', 'Street Fighter 5 (Hack).smc', 'fighting', 'fighting', 'https://upload.wikimedia.org/wikipedia/en/1/1d/SF2_JPN_flyer.jpg', 'The classic that defined the genre. Pick your world warrior and fight through 1v1 matches with unique special moves and combos.')"); } catch {}
  try { await getClient().execute("INSERT OR IGNORE INTO duel_games (id, label, system, rom, mode, category, cover_image, description) VALUES ('kof2002', 'KOF 2002', 'neogeo', 'kof2002.zip', 'fighting', 'fighting', 'https://upload.wikimedia.org/wikipedia/en/3/3b/The_King_of_Fighters_2002_arcade_flyer.jpg', 'The ultimate KOF dream match. Refined 3v3 mechanics, massive character roster, and the fan-favorite MAX mode system.')"); } catch {}
  try { await getClient().execute("INSERT OR IGNORE INTO duel_games (id, label, system, rom, mode, category, cover_image, description) VALUES ('sfa2', 'Street Fighter Alpha 2', 'snes', 'Street Fighter Alpha 2 (Europe).sfc', 'fighting', 'fighting', 'https://upload.wikimedia.org/wikipedia/en/3/3f/Street_Fighter_Alpha_2_flyer.png', 'The Alpha series on SNES. Expanded roster with custom combos, alpha counters, and a dramatic battle system.')"); } catch {}

  // Update existing rows that were seeded before category/description/cover_image columns existed
  try { await getClient().execute({ sql: "UPDATE duel_games SET category = 'fighting', cover_image = 'https://upload.wikimedia.org/wikipedia/en/1/18/The_King_of_Fighters_%2798_arcade_flyer.jpg', description = 'The legendary Neo Geo fighting game. 3v3 team battles, advanced gauge system, and a roster of 38 iconic characters.' WHERE id = 'kof98' AND (category IS NULL OR cover_image IS NULL)" }); } catch {}
  try { await getClient().execute({ sql: "UPDATE duel_games SET category = 'fighting', cover_image = 'https://upload.wikimedia.org/wikipedia/en/1/1d/SF2_JPN_flyer.jpg', description = 'The classic that defined the genre. Pick your world warrior and fight through 1v1 matches with unique special moves and combos.' WHERE id = 'sf2' AND (category IS NULL OR cover_image IS NULL)" }); } catch {}
  try { await getClient().execute({ sql: "UPDATE duel_games SET category = 'fighting', cover_image = 'https://upload.wikimedia.org/wikipedia/en/3/3b/The_King_of_Fighters_2002_arcade_flyer.jpg', description = 'The ultimate KOF dream match. Refined 3v3 mechanics, massive character roster, and the fan-favorite MAX mode system.' WHERE id = 'kof2002' AND (category IS NULL OR cover_image IS NULL)" }); } catch {}
  try { await getClient().execute({ sql: "UPDATE duel_games SET category = 'fighting', cover_image = 'https://upload.wikimedia.org/wikipedia/en/3/3f/Street_Fighter_Alpha_2_flyer.png', description = 'The Alpha series on SNES. Expanded roster with custom combos, alpha counters, and a dramatic battle system.' WHERE id = 'sfa2' AND (category IS NULL OR cover_image IS NULL)" }); } catch {}

  // Seed default modes for each game (idempotent)
  const GAME_MODES = [
    { id: "kof98_standard", game_id: "kof98", mode_key: "standard", label: "KOF '98 — Standard", match_count: 1, entry_fee: 1000 },
    { id: "kof98_xl", game_id: "kof98", mode_key: "xl", label: "KOF '98 — XL", match_count: 3, entry_fee: 2500 },
    { id: "kof98_fighter", game_id: "kof98", mode_key: "fighter", label: "KOF '98 — Fighter", match_count: 5, entry_fee: 4000 },
    { id: "sf2_standard", game_id: "sf2", mode_key: "standard", label: "Street Fighter 2 — Standard", match_count: 1, entry_fee: 1000 },
    { id: "sf2_xl", game_id: "sf2", mode_key: "xl", label: "Street Fighter 2 — XL", match_count: 3, entry_fee: 2500 },
    { id: "sf2_fighter", game_id: "sf2", mode_key: "fighter", label: "Street Fighter 2 — Fighter", match_count: 5, entry_fee: 4000 },
    { id: "kof2002_standard", game_id: "kof2002", mode_key: "standard", label: "KOF 2002 — Standard", match_count: 1, entry_fee: 1000 },
    { id: "kof2002_xl", game_id: "kof2002", mode_key: "xl", label: "KOF 2002 — XL", match_count: 3, entry_fee: 2500 },
    { id: "kof2002_fighter", game_id: "kof2002", mode_key: "fighter", label: "KOF 2002 — Fighter", match_count: 5, entry_fee: 4000 },
    { id: "sfa2_standard", game_id: "sfa2", mode_key: "standard", label: "Street Fighter Alpha 2 — Standard", match_count: 1, entry_fee: 1000 },
    { id: "sfa2_xl", game_id: "sfa2", mode_key: "xl", label: "Street Fighter Alpha 2 — XL", match_count: 3, entry_fee: 2500 },
    { id: "sfa2_fighter", game_id: "sfa2", mode_key: "fighter", label: "Street Fighter Alpha 2 — Fighter", match_count: 5, entry_fee: 4000 },
  ];

  // Build multilingual rules JSON for a mode
  function buildModeRules(matchCount: number): string {
    return JSON.stringify({
      fr: {
        victoryRule: `Le gagnant est celui qui remporte le plus de matchs sur ${matchCount}`,
        drawRule: "En cas d'égalité parfaite, les 2 joueurs perdent leur participation",
        debitRule: "La participation est débitée uniquement quand le combat commence réellement",
        disputeRule: "En cas de litige, vous pouvez ouvrir une réclamation depuis l'historique",
      },
      en: {
        victoryRule: `The winner is the one who wins the most matches out of ${matchCount}`,
        drawRule: "In case of a perfect tie, both players lose their entry fee",
        debitRule: "The entry fee is only deducted when the fight actually starts",
        disputeRule: "In case of a dispute, you can open a claim from the history",
      },
    });
  }

  for (const m of GAME_MODES) {
    const rules = buildModeRules(m.match_count);
    try { await getClient().execute({
      sql: "INSERT OR IGNORE INTO duel_game_modes (id, game_id, mode_key, label, match_count, entry_fee, rules) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [m.id, m.game_id, m.mode_key, m.label, m.match_count, m.entry_fee, rules],
    }); } catch {}
    // Update rules for existing rows that were seeded before the column existed
    try { await getClient().execute({ sql: "UPDATE duel_game_modes SET rules = ? WHERE id = ? AND rules IS NULL", args: [rules, m.id] }); } catch {}
  }

  // Set ram_config for KOF98 (idempotent — UPDATE after INSERT OR IGNORE)
  try {
    await getClient().execute({
      sql: "UPDATE duel_games SET ram_config = ? WHERE id = 'kof98' AND ram_config IS NULL",
      args: [JSON.stringify({
        p1: 0x8238, p2: 0x8438, size: 1, maxHealth: 0x67,
        timer: 0xA83A, timerAlt: 0x85D2,
        p1Char: 0x823F, p2Char: 0x843F,
        p1Mode: 0x821E, p2Mode: 0x841E,
        p1TeamBase: 0xA84E, p2TeamBase: 0xA85E,
        p1TeamOffsets: [0, 1, 3], p2TeamOffsets: [0, 2, 3],
        p1Active: 0x8256, p2Active: 0x8456,
        matchFlag: 0xA840,
        p1Lost: 0xA859, p2Lost: 0xA868,
        p1PickOrder: [0x15CB, 0x15CA, 0x15CD],
        p2PickOrder: [0x17CB, 0x17CA, 0x17CD],
      })],
    });
  } catch {}

  // Set ram_config for KOF2002 (idempotent — basic health/timer/mode only, team/loss/pick order TBD)
  try {
    await getClient().execute({
      sql: "UPDATE duel_games SET ram_config = ? WHERE id = 'kof2002' AND ram_config IS NULL",
      args: [JSON.stringify({
        p1: 0x8238, p2: 0x8438, size: 1, maxHealth: 0x67,
        timer: 0xA83A, timerAlt: 0x85D2,
        p1Char: 0x823F, p2Char: 0x843F,
        p1Mode: 0x81F0, p2Mode: 0x83F0,
      })],
    });
  } catch {}
  // KOF98 controls
  const kofControls = [
    ["ctrlMove","W A S D",1],["ctrlAPunch","Z",1],["ctrlBKick","X",1],["ctrlCStrongPunch","C",1],["ctrlDStrongKick","V",1],["ctrlCoin","Space",1],["ctrlStart","Enter",1],
    ["ctrlMove","↑ ↓ ← →",2],["ctrlAPunch","I",2],["ctrlBKick","O",2],["ctrlCStrongPunch","K",2],["ctrlDStrongKick","L",2],["ctrlCoin","Shift",2],["ctrlStart","Ctrl",2],
  ];
  for (const [action, keys, player] of kofControls) {
    try { await getClient().execute({ sql: "INSERT OR IGNORE INTO duel_game_controls (game_id, player, action_key, label_key, default_keys) VALUES (?,?,?,?,?)", args: ["kof98", player, action, action, keys] }); } catch {}
  }
  // SF2 controls
  const sf2Controls = [
    ["ctrlMove","W A S D",1],["ctrlLightPunch","Z",1],["ctrlMedPunch","X",1],["ctrlHeavyPunch","C",1],["ctrlLightKick","A",1],["ctrlMedKick","S",1],["ctrlHeavyKick","D",1],["ctrlStart","Enter",1],
    ["ctrlMove","↑ ↓ ← →",2],["ctrlLightPunch","I",2],["ctrlMedPunch","O",2],["ctrlHeavyPunch","K",2],["ctrlLightKick","J",2],["ctrlMedKick","L",2],["ctrlHeavyKick",";",2],["ctrlStart","Ctrl",2],
  ];
  for (const [action, keys, player] of sf2Controls) {
    try { await getClient().execute({ sql: "INSERT OR IGNORE INTO duel_game_controls (game_id, player, action_key, label_key, default_keys) VALUES (?,?,?,?,?)", args: ["sf2", player, action, action, keys] }); } catch {}
  }

  // ─── Seed config version 1 for each game (idempotent) ───
  // Each game gets v1 as both active and default, capturing the initial ram_config + controls.
  const seedVersion1 = async (gameId: string, label: string, ramConfig: unknown, controls: unknown[]) => {
    try {
      const existing = await getClient().execute({
        sql: "SELECT id FROM duel_game_config_versions WHERE game_id = ? AND version = 1",
        args: [gameId],
      });
      if (existing.rows.length === 0) {
        await getClient().execute({
          sql: `INSERT INTO duel_game_config_versions (game_id, version, ram_config, controls, label, is_active, is_default)
                VALUES (?, 1, ?, ?, ?, 1, 1)`,
          args: [gameId, JSON.stringify(ramConfig), JSON.stringify(controls), label],
        });
        console.log(`[db] Seeded config v1 for ${gameId}`);
      }
    } catch (err) {
      console.warn(`[db] Failed to seed config v1 for ${gameId}:`, err);
    }
  };

  // KOF98 v1: full RAM config + controls
  const kof98RamConfig = {
    p1: 0x8238, p2: 0x8438, size: 1, maxHealth: 0x67,
    timer: 0xA83A, timerAlt: 0x85D2,
    p1Char: 0x823F, p2Char: 0x843F,
    p1Mode: 0x821E, p2Mode: 0x841E,
    p1TeamBase: 0xA84E, p2TeamBase: 0xA85E,
    p1TeamOffsets: [0, 1, 3], p2TeamOffsets: [0, 2, 3],
    p1Active: 0x8256, p2Active: 0x8456,
    matchFlag: 0xA840,
    p1Lost: 0xA859, p2Lost: 0xA868,
    p1PickOrder: [0x15CB, 0x15CA, 0x15CD],
    p2PickOrder: [0x17CB, 0x17CA, 0x17CD],
  };
  await seedVersion1("kof98", "v1 — RAM + contrôles initiaux", kof98RamConfig, kofControls.map(([action, keys, player]) => ({ player, actionKey: action, labelKey: action, defaultKeys: keys })));

  // KOF2002 v1: basic health/timer/mode (team/loss/pick order TBD via RAM scan)
  const kof2002RamConfig = {
    p1: 0x8238, p2: 0x8438, size: 1, maxHealth: 0x67,
    timer: 0xA83A, timerAlt: 0x85D2,
    p1Char: 0x823F, p2Char: 0x843F,
    p1Mode: 0x81F0, p2Mode: 0x83F0,
  };
  await seedVersion1("kof2002", "v1 — santé + timer + mode (détection basique)", kof2002RamConfig, kofControls.map(([action, keys, player]) => ({ player, actionKey: action, labelKey: action, defaultKeys: keys })));

  // SF2 v1: no RAM config yet (pixel-based detection), controls only
  await seedVersion1("sf2", "v1 — contrôles uniquement (détection pixel)", null, sf2Controls.map(([action, keys, player]) => ({ player, actionKey: action, labelKey: action, defaultKeys: keys })));

  // ─── Duel SKY economy (wagering) ───
  // Player ledger: every movement that affects a player's spendable balance.
  // A player's balance = computed earned SKY (approved rewards + bonus) + SUM(amount here).
  // Funds "in transit" during a live match are NOT here — they sit in an escrow room below.
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS sky_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      kind TEXT NOT NULL,
      challenge_id INTEGER,
      session_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Escrow "honeycomb": one isolated chamber per duel (keyed by session_id). Holds the
  // collected pot while the match is live; only settled + deleted once payout + bank
  // transfer both succeed. An orphan 'open' room = a duel to reconcile after a bug.
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS escrow_rooms (
      session_id TEXT PRIMARY KEY,
      challenge_id INTEGER,
      player1_id INTEGER,
      player2_id INTEGER,
      amount INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      system TEXT,
      rom TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Bank: definitive platform revenue, traced per match (origin of funds).
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS platform_bank (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      challenge_id INTEGER,
      session_id TEXT,
      winner_id INTEGER,
      loser_id INTEGER,
      pot INTEGER NOT NULL,
      payout INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      system TEXT,
      rom TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  try { await getClient().execute("CREATE INDEX IF NOT EXISTS idx_sky_tx_user ON sky_transactions(user_id)"); } catch {}
  try { await getClient().execute("CREATE INDEX IF NOT EXISTS idx_sky_tx_session ON sky_transactions(session_id, kind)"); } catch {}
  try { await getClient().execute("CREATE INDEX IF NOT EXISTS idx_platform_bank_session ON platform_bank(session_id)"); } catch {}

  // Optional free-text note on a ledger row (admin adjustments / dispute resolutions).
  try { await getClient().execute("ALTER TABLE sky_transactions ADD COLUMN note TEXT"); } catch { /* column already exists */ }

  // Plan A: duel match recordings uploaded to Vercel Blob (private). One row per session; the
  // blob URL is served to admins through an authenticated proxy (never exposed publicly).
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS duel_recordings (
      session_id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      pathname TEXT,
      size INTEGER,
      system TEXT,
      rom TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ─── Game Statistics (round/match/session tracking) ───
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS game_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT UNIQUE NOT NULL,
      user_id INTEGER REFERENCES users(id),
      opponent_type TEXT NOT NULL DEFAULT 'cpu',
      system TEXT NOT NULL DEFAULT 'neogeo',
      rom TEXT NOT NULL DEFAULT 'kof98.zip',
      mode TEXT NOT NULL DEFAULT 'cpu',
      total_matches INTEGER NOT NULL DEFAULT 0,
      player_wins INTEGER NOT NULL DEFAULT 0,
      player_losses INTEGER NOT NULL DEFAULT 0,
      player_perfect_kos INTEGER NOT NULL DEFAULT 0,
      points_earned INTEGER NOT NULL DEFAULT 0,
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ended_at TIMESTAMP
    );
  `);

  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS game_rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      match_number INTEGER NOT NULL,
      round_number INTEGER NOT NULL,
      loser INTEGER NOT NULL,
      winner INTEGER NOT NULL,
      ko_type TEXT NOT NULL DEFAULT 'normal',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS game_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      match_number INTEGER NOT NULL,
      winner INTEGER NOT NULL,
      loser INTEGER NOT NULL,
      p1_losses INTEGER NOT NULL DEFAULT 0,
      p2_losses INTEGER NOT NULL DEFAULT 0,
      perfect_ko_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS game_points_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      system TEXT NOT NULL DEFAULT 'neogeo',
      rom TEXT NOT NULL DEFAULT 'kof98.zip',
      win_points INTEGER NOT NULL DEFAULT 3,
      perfect_ko_bonus INTEGER NOT NULL DEFAULT 1,
      UNIQUE(system, rom)
    );
  `);

  // Seed default points config
  try {
    await getClient().execute(
      "INSERT OR IGNORE INTO game_points_config (system, rom, win_points, perfect_ko_bonus) VALUES ('neogeo', 'kof98.zip', 3, 1)"
    );
  } catch { /* already exists */ }

  // Game stats indexes
  try { await getClient().execute("CREATE INDEX IF NOT EXISTS idx_game_sessions_id ON game_sessions(session_id)"); } catch {}
  try { await getClient().execute("CREATE INDEX IF NOT EXISTS idx_game_rounds_session ON game_rounds(session_id)"); } catch {}
  try { await getClient().execute("CREATE INDEX IF NOT EXISTS idx_game_matches_session ON game_matches(session_id)"); } catch {}

  // Character metadata columns on game_matches (added post-hoc; libSQL throws if the column
  // already exists, so each ALTER is guarded). Arrays are stored as JSON TEXT of character IDs.
  for (const col of [
    "p1_team TEXT",
    "p2_team TEXT",
    "p1_selection_order TEXT",
    "p2_selection_order TEXT",
    "p1_gauge_mode TEXT",
    "p2_gauge_mode TEXT",
  ]) {
    try { await getClient().execute(`ALTER TABLE game_matches ADD COLUMN ${col}`); } catch { /* column already exists */ }
  }

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

  // ─── Seed duel-economy SKY balances for the 3 named test accounts ───
  // Idempotent: an account is seeded at most once (guarded by an existing 'seed' tx).
  // Brings each to exactly 10000 SKY WITHOUT overwriting anyone else's computed value —
  // seed = 10000 − current balance (current = computed earned SKY + any prior ledger).
  const SEED_TARGET_BALANCE = 10000;
  for (const uname of ["testplayer1", "testplayer2", "raimundo"]) {
    try {
      const u = await client.execute({
        sql: "SELECT id FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1",
        args: [uname],
      });
      if (u.rows.length === 0) continue;
      const uid = u.rows[0].id as number;

      const seeded = await client.execute({
        sql: "SELECT COUNT(*) as cnt FROM sky_transactions WHERE user_id = ? AND kind = 'seed'",
        args: [uid],
      });
      if ((seeded.rows[0]?.cnt as number) > 0) continue;

      // Current balance = approved rewards + (approved bonus) + existing ledger sum.
      const balRs = await client.execute({
        sql: `
          SELECT
            COALESCE((SELECT SUM(q.reward_amount) FROM submissions s
                      JOIN questions q ON q.id = s.question_id
                      WHERE s.user_id = u.id AND s.status = 'APPROVED'), 0)
            + CASE WHEN u.bonus_status = 'APPROVED' THEN COALESCE(u.participation_bonus, 0) ELSE 0 END
            + COALESCE((SELECT SUM(amount) FROM sky_transactions WHERE user_id = u.id), 0)
            AS balance
          FROM users u WHERE u.id = ?
        `,
        args: [uid],
      });
      const current = Number(balRs.rows[0]?.balance ?? 0);
      const seed = SEED_TARGET_BALANCE - current;
      if (seed === 0) continue;

      await client.execute({
        sql: "INSERT INTO sky_transactions (user_id, amount, kind) VALUES (?, ?, 'seed')",
        args: [uid, seed],
      });
    } catch { /* account absent or seed already applied — safe to skip */ }
  }

  // ─── Backfill random-but-stable profiles (avatar + nationality) ───
  // Gives every player who never set a profile a generated identicon photo + a random
  // country, so the duel Cage / overlays / stats never show a faceless, flag-less user.
  // Idempotent & non-destructive: COALESCE only fills NULL columns — a user-set avatar or
  // country is never overwritten. Runs per-row (safe to re-run on every boot).
  try {
    const missing = await client.execute(
      "SELECT id, username FROM users WHERE country IS NULL OR avatar_base64 IS NULL",
    );
    for (const row of missing.rows) {
      const uid = row.id as number;
      const uname = (row.username as string) || String(uid);
      const seedKey = `${uid}:${uname}`;
      const country = pickFromSeed(seedKey, COUNTRY_CODES);
      const avatar = generateIdenticon(seedKey);
      await client.execute({
        sql: "UPDATE users SET country = COALESCE(country, ?), avatar_base64 = COALESCE(avatar_base64, ?) WHERE id = ?",
        args: [country, avatar, uid],
      });
    }
    if (missing.rows.length > 0) {
      console.log(`[db] Backfilled ${missing.rows.length} player profile(s) (avatar + country)`);
    }
  } catch (e) {
    console.error("Profile backfill error (non-fatal):", e);
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
