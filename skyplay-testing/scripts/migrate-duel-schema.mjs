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

const KOF98_RAM_CONFIG = {
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

const KOF2002_RAM_CONFIG = {
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

const SF2_RAM_CONFIG = {
  p1: 0x0530, p2: 0x0730, size: 1, maxHealth: 0xB0,
  timer: 0x18F3, timerAlt: 0x18F3,
  p1Char: 0x0530, p2Char: 0x0730,
  p1Mode: 0x0530, p2Mode: 0x0730,
};

const KOF98_CONTROLS = [
  { player: 1, actionKey: "ctrlMove", labelKey: "ctrlMove", defaultKeys: "W A S D" },
  { player: 1, actionKey: "ctrlAPunch", labelKey: "ctrlAPunch", defaultKeys: "Z" },
  { player: 1, actionKey: "ctrlBKick", labelKey: "ctrlBKick", defaultKeys: "X" },
  { player: 1, actionKey: "ctrlCStrongPunch", labelKey: "ctrlCStrongPunch", defaultKeys: "C" },
  { player: 1, actionKey: "ctrlDStrongKick", labelKey: "ctrlDStrongKick", defaultKeys: "V" },
  { player: 1, actionKey: "ctrlCoin", labelKey: "ctrlCoin", defaultKeys: "Space" },
  { player: 1, actionKey: "ctrlStart", labelKey: "ctrlStart", defaultKeys: "Enter" },
  { player: 2, actionKey: "ctrlMove", labelKey: "ctrlMove", defaultKeys: "↑ ↓ ← →" },
  { player: 2, actionKey: "ctrlAPunch", labelKey: "ctrlAPunch", defaultKeys: "I" },
  { player: 2, actionKey: "ctrlBKick", labelKey: "ctrlBKick", defaultKeys: "O" },
  { player: 2, actionKey: "ctrlCStrongPunch", labelKey: "ctrlCStrongPunch", defaultKeys: "K" },
  { player: 2, actionKey: "ctrlDStrongKick", labelKey: "ctrlDStrongKick", defaultKeys: "L" },
  { player: 2, actionKey: "ctrlCoin", labelKey: "ctrlCoin", defaultKeys: "Shift" },
  { player: 2, actionKey: "ctrlStart", labelKey: "ctrlStart", defaultKeys: "Ctrl" },
];

async function main() {
  // 1. Add missing columns to duel_games
  console.log("🔧 Adding missing columns...");
  try { await db.execute("ALTER TABLE duel_games ADD COLUMN entry_fee INTEGER NOT NULL DEFAULT 1000"); console.log("  ✓ entry_fee"); } catch (e) { console.log("  ⏭ entry_fee:", e.message); }
  try { await db.execute("ALTER TABLE duel_games ADD COLUMN ram_config TEXT DEFAULT NULL"); console.log("  ✓ ram_config"); } catch (e) { console.log("  ⏭ ram_config:", e.message); }

  // 2. Add PK constraint to duel_game_controls (SQLite doesn't support ALTER ADD PK, skip if exists)
  console.log("🔧 Checking duel_game_controls PK...");

  // 3. Set ram_config for existing games
  console.log("🔧 Setting ram_config for KOF98...");
  await db.execute({
    sql: "UPDATE duel_games SET ram_config = ?, entry_fee = 1000 WHERE id = 'kof98' AND ram_config IS NULL",
    args: [JSON.stringify(KOF98_RAM_CONFIG)],
  });
  console.log("  ✓ KOF98 ram_config set");

  console.log("🔧 Setting ram_config for KOF2002...");
  await db.execute({
    sql: "UPDATE duel_games SET ram_config = ?, entry_fee = 1000 WHERE id = 'kof2002' AND ram_config IS NULL",
    args: [JSON.stringify(KOF2002_RAM_CONFIG)],
  });
  console.log("  ✓ KOF2002 ram_config set");

  // 4. Set entry_fee + ram_config for SF2
  await db.execute({ sql: "UPDATE duel_games SET entry_fee = 1000 WHERE id = 'sf2' AND entry_fee IS NULL" });
  await db.execute({
    sql: "UPDATE duel_games SET ram_config = ? WHERE id = 'sf2' AND ram_config IS NULL",
    args: [JSON.stringify(SF2_RAM_CONFIG)],
  });
  console.log("  ✓ SF2 ram_config set");

  // 5. Seed version 1 snapshots (idempotent)
  console.log("🔧 Seeding config versions...");
  const seeds = [
    ["kof98", KOF98_RAM_CONFIG, "v1 — RAM + contrôles initiaux", KOF98_CONTROLS],
    ["kof2002", KOF2002_RAM_CONFIG, "v1 — full RAM config (same engine as KOF98, addresses need live verification)", KOF98_CONTROLS],
    ["sf2", SF2_RAM_CONFIG, "v1 — RAM basique (PAR-based, needs live verification)", []],
  ];
  for (const seed of seeds) {
    const gameId = seed[0];
    const ramConfig = seed[1];
    const label = seed[2];
    const controls = seed[3];
    const existing = await db.execute({ sql: "SELECT id FROM duel_game_config_versions WHERE game_id = ? AND version = 1", args: [gameId] });
    if (existing.rows.length === 0) {
      await db.execute({
        sql: `INSERT INTO duel_game_config_versions (game_id, version, ram_config, controls, label, is_active, is_default)
              VALUES (?, 1, ?, ?, ?, 1, 1)`,
        args: [gameId, ramConfig ? JSON.stringify(ramConfig) : null, JSON.stringify(controls), label],
      });
      console.log(`  ✓ ${gameId} v1 created`);
    } else {
      // Update existing v1 with latest controls + ram_config
      await db.execute({
        sql: `UPDATE duel_game_config_versions SET ram_config = ?, controls = ?, label = ? WHERE game_id = ? AND version = 1`,
        args: [ramConfig ? JSON.stringify(ramConfig) : null, JSON.stringify(controls), label, gameId],
      });
      console.log(`  ✓ ${gameId} v1 updated`);
    }
  }

  // 6. Verify
  console.log("\n🔍 Verification:");
  const rs = await db.execute("SELECT id, label, entry_fee, ram_config IS NOT NULL as has_ram FROM duel_games");
  for (const r of rs.rows) console.log(`  ${r.id}: entryFee=${r.entry_fee} hasRam=${r.has_ram}`);
  const vrs = await db.execute("SELECT game_id, version, is_active, is_default FROM duel_game_config_versions");
  for (const r of vrs.rows) console.log(`  version: ${r.game_id} v${r.version} active=${r.is_active} default=${r.is_default}`);
}

main().catch(console.error);
