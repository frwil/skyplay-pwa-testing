/**
 * Test SFA2 character selection with the new cursor-tracking system.
 * Starts a CPU session, navigates to char select, picks a character,
 * and captures screenshots along the way.
 *
 * Usage: node test-char-select.mjs
 */

import WebSocket from "ws";
import { execSync } from "child_process";
import { mkdirSync, statSync } from "fs";
import { join } from "path";

const GAME_SERVER = "ws://127.0.0.1:8888";
const SESSION_ID = `char-test-${Date.now()}`;
const SHOTS_DIR = join(import.meta.dirname, "char-select-shots");

mkdirSync(SHOTS_DIR, { recursive: true });

const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

function screenshot(label) {
  try {
    const hostPath = join(SHOTS_DIR, `${label}.png`);
    execSync(`docker exec -e DISPLAY=:99 game-server-game-server-1 sh -c "import -window root /tmp/shot.png"`, { stdio: "ignore" });
    execSync(`docker cp game-server-game-server-1:/tmp/shot.png "${hostPath}"`, { stdio: "ignore" });
    const size = statSync(hostPath).size;
    log(`  📸 ${label} = ${(size / 1024).toFixed(1)} KB`);
    return hostPath;
  } catch (err) {
    log(`  ❌ ${label} FAILED: ${err.message}`);
    return null;
  }
}

// SNES button indices (matching ws-handler.ts constants)
const SNES_B = 0;
const SNES_START = 3;
const SNES_UP = 4;
const SNES_DOWN = 5;
const SNES_LEFT = 6;
const SNES_RIGHT = 7;

function sendInput(ws, player, button) {
  ws.send(JSON.stringify({ type: "input", player, button, pressed: true }));
  setTimeout(() => {
    ws.send(JSON.stringify({ type: "input", player, button, pressed: false }));
  }, 100);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  log(`Starting SFA2 CPU session: ${SESSION_ID}`);

  const ws = new WebSocket(`${GAME_SERVER}/?sessionId=${SESSION_ID}`);

  ws.on("open", () => {
    log("Connected, sending init (snes SFA2 cpu)");
    ws.send(JSON.stringify({
      type: "init", sessionId: SESSION_ID, token: "",
      system: "snes", rom: "Street Fighter Alpha 2 (Europe).sfc",
      mode: "cpu",
    }));
  });

  ws.on("message", async (data, isBinary) => {
    if (!isBinary) {
      const msg = JSON.parse(data.toString());

      if (msg.type === "ready") {
        log(`Ready! ${msg.width}x${msg.height}`);
        screenshot("01_ready");
      }

      if (msg.type === "char_select_start") {
        log(`🎯 Char select STARTED! timeout=${msg.timeout}ms`);
        screenshot("02_char_select_start");

        // Navigate cursor: RIGHT×3 → Chun-Li (col 2), then DOWN → Birdie row
        // Let's pick Akuma (row 0, col 5 = 5×RIGHT from Ryu)
        log("Moving cursor: RIGHT×5 → Akuma");
        for (let i = 0; i < 5; i++) {
          sendInput(ws, 1, SNES_RIGHT);
          await sleep(250);
        }
        screenshot("03_cursor_on_akuma");

        // Lock in Akuma
        log("Pressing B to lock in Akuma...");
        sendInput(ws, 1, SNES_B);
        await sleep(500);
        screenshot("04_after_b");
      }

      if (msg.type === "char_selected") {
        log(`✅ P${msg.player} selected: ${msg.charName} (0x${msg.charId.toString(16)}) at row=${msg.row} col=${msg.col}`);
      }

      if (msg.type === "match_end") {
        log(`🏁 Match ended: P${msg.winner} wins (P1=${msg.p1CharName ?? "?"} P2=${msg.p2CharName ?? "?"})`);
        screenshot("05_match_end");
      }
    }
  });

  // Keep alive long enough for full game cycle
  setTimeout(() => {
    log("Test timeout — closing");
    ws.close();
    process.exit(0);
  }, 120000);
}

main().catch(err => { console.error(err); process.exit(1); });
