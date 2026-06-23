// Script to create test users for netplay testing
import { createClient } from "@libsql/client";
import bcrypt from "bcryptjs";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env manually
const envPath = resolve(__dirname, "..", ".env.local");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
} catch {
  console.error("Could not read .env file at", envPath);
  process.exit(1);
}

const dbUrl = process.env.TURSO_DATABASE_URL;
const dbToken = process.env.TURSO_AUTH_TOKEN;

if (!dbUrl || !dbToken) {
  console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN");
  process.exit(1);
}

const db = createClient({ url: dbUrl, authToken: dbToken });

async function main() {
  const hash1 = await bcrypt.hash("1234", 12);
  const hash2 = await bcrypt.hash("5678", 12);

  // testplayer1
  try {
    await db.execute({
      sql: "INSERT INTO users (username, email, role, password_hash) VALUES (?, ?, ?, ?)",
      args: ["testplayer1", "testplayer1@skyplay.test", "user", hash1],
    });
    console.log("✓ testplayer1 created");
  } catch (e) {
    if (e.message?.includes("UNIQUE")) {
      await db.execute({
        sql: "UPDATE users SET password_hash = ? WHERE username = ?",
        args: [hash1, "testplayer1"],
      });
      console.log("✓ testplayer1 PIN updated to 1234");
    } else {
      console.error("✗ testplayer1 error:", e.message);
    }
  }

  // testplayer2
  try {
    await db.execute({
      sql: "INSERT INTO users (username, email, role, password_hash) VALUES (?, ?, ?, ?)",
      args: ["testplayer2", "testplayer2@skyplay.test", "user", hash2],
    });
    console.log("✓ testplayer2 created");
  } catch (e) {
    if (e.message?.includes("UNIQUE")) {
      await db.execute({
        sql: "UPDATE users SET password_hash = ? WHERE username = ?",
        args: [hash2, "testplayer2"],
      });
      console.log("✓ testplayer2 PIN updated to 5678");
    } else {
      console.error("✗ testplayer2 error:", e.message);
    }
  }

  // Verify
  const result = await db.execute({
    sql: "SELECT id, username, email, role FROM users WHERE username LIKE ?",
    args: ["testplayer%"],
  });

  console.log("\n═══ Test Users ═══");
  for (const row of result.rows) {
    const pin = row.username === "testplayer1" ? "1234" : "5678";
    console.log(`  ${row.username}`);
    console.log(`    ID: ${row.id}`);
    console.log(`    Email: ${row.email}`);
    console.log(`    Role: ${row.role}`);
    console.log(`    PIN: ${pin}`);
  }
  console.log("═══════════════════");
}

main().catch(console.error);
