/**
 * Test SFA2 PvP character selection with two players.
 * P1 initiates the duel, P2 joins. Both navigate char select independently.
 *
 * Usage: node test-char-select-pvp.mjs
 */

import WebSocket from "ws";
import { execSync } from "child_process";
import { mkdirSync, statSync } from "fs";
import { join } from "path";

const GAME_SERVER = "ws://127.0.0.1:8888";
const SESSION_ID = `char-pvp-${Date.now()}`;
const SHOTS_DIR = join(import.meta.dirname, "char-select-shots");

mkdirSync(SHOTS_DIR, { recursive: true });

const log = (prefix, msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${prefix} ${msg}`);

function screenshot(label) {
  try {
    const hostPath = join(SHOTS_DIR, `${label}.png`);
    execSync(`docker exec -e DISPLAY=:99 game-server-game-server-1 sh -c "import -window root /tmp/shot.png"`, { stdio: "ignore" });
    execSync(`docker cp game-server-game-server-1:/tmp/shot.png "${hostPath}"`, { stdio: "ignore" });
    const size = statSync(hostPath).size;
    log("📸", `${label} = ${(size / 1024).toFixed(1)} KB`);
    return hostPath;
  } catch (err) {
    log("❌", `${label} FAILED: ${err.message}`);
    return null;
  }
}

const B = 0, START = 3, UP = 4, DOWN = 5, LEFT = 6, RIGHT = 7;

function sendInput(ws, player, button) {
  ws.send(JSON.stringify({ type: "input", player, button, pressed: true }));
  setTimeout(() => ws.send(JSON.stringify({ type: "input", player, button, pressed: false })), 100);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  log("====", `PvP Char Select Test: ${SESSION_ID} ====`);

  // ── P1 connects and inits ──
  const p1 = new WebSocket(`${GAME_SERVER}/?sessionId=${SESSION_ID}`);
  await new Promise((resolve, reject) => {
    p1.on("open", () => { log("P1", "Connected, sending init"); resolve(); });
    p1.on("error", reject);
    setTimeout(() => reject(new Error("P1 connect timeout")), 5000);
  });
  p1.send(JSON.stringify({
    type: "init", sessionId: SESSION_ID, token: "",
    system: "snes", rom: "Street Fighter Alpha 2 (Europe).sfc",
    mode: "pvp",
  }));

  // ── P2 connects and joins ──
  const p2 = new WebSocket(`${GAME_SERVER}/?sessionId=${SESSION_ID}`);
  await new Promise((resolve, reject) => {
    p2.on("open", () => { log("P2", "Connected, sending join"); resolve(); });
    p2.on("error", reject);
    setTimeout(() => reject(new Error("P2 connect timeout")), 5000);
  });
  p2.send(JSON.stringify({ type: "join", sessionId: SESSION_ID, token: "" }));

  // ── State tracking ──
  let p1Selected = null, p2Selected = null;
  let charSelectStarted = false;
  let done = false;

  // Resolve when char select starts
  const waitForCharSelect = new Promise(resolve => {
    const check = (msg, ws) => {
      if (msg.type === "char_select_start" && !charSelectStarted) {
        charSelectStarted = true;
        resolve();
      }
      return true;
    };

    p1.on("message", (data, isBinary) => {
      if (isBinary || done) return;
      const msg = JSON.parse(data.toString());
      if (msg.type === "ready") log("P1", `Ready ${msg.width}x${msg.height}`);
      if (msg.type === "char_select_start") {
        log("P1", `🎯 Char select STARTED! timeout=${msg.timeout}ms`);
        if (!charSelectStarted) { charSelectStarted = true; resolve(); }
      }
      if (msg.type === "char_selected") {
        log("P1", `✅ P${msg.player}=${msg.charName} (0x${msg.charId.toString(16)})`);
        if (msg.player === 1) p1Selected = msg;
        if (msg.player === 2) p2Selected = msg;
      }
      if (msg.type === "match_end") {
        log("P1", `🏁 Match end: P${msg.winner} wins P1=${msg.p1CharName} P2=${msg.p2CharName}`);
        screenshot("pvp_05_match_end");
      }
    });

    p2.on("message", (data, isBinary) => {
      if (isBinary || done) return;
      const msg = JSON.parse(data.toString());
      if (msg.type === "ready") log("P2", `Ready ${msg.width}x${msg.height}`);
      if (msg.type === "char_select_start") {
        log("P2", `🎯 Char select STARTED! timeout=${msg.timeout}ms`);
        if (!charSelectStarted) { charSelectStarted = true; resolve(); }
      }
      if (msg.type === "char_selected") {
        log("P2", `✅ P${msg.player}=${msg.charName} (0x${msg.charId.toString(16)})`);
        if (msg.player === 1) p1Selected = msg;
        if (msg.player === 2) p2Selected = msg;
      }
      if (msg.type === "match_end") {
        log("P2", `🏁 Match end: P${msg.winner} wins P1=${msg.p1CharName} P2=${msg.p2CharName}`);
      }
    });
  });

  // Wait for char select to start (with timeout)
  const SELECT_TIMEOUT = 65000; // generous timeout
  await Promise.race([
    waitForCharSelect,
    sleep(SELECT_TIMEOUT).then(() => { log("⚠️", "Timeout waiting for char select"); }),
  ]);

  if (!charSelectStarted) {
    log("❌", "Char select never started — aborting");
    p1.close(); p2.close();
    process.exit(1);
  }

  screenshot("pvp_01_char_select");

  // ── P1 navigates: RIGHT×2 → Chun-Li (row 0, col 2) ──
  (async () => {
    await sleep(500);
    log("P1", "Moving: RIGHT×2 → Chun-Li");
    for (let i = 0; i < 2; i++) {
      sendInput(p1, 1, RIGHT);
      await sleep(250);
    }
    screenshot("pvp_03_p1_cursor");
    log("P1", "Pressing B to lock Chun-Li...");
    sendInput(p1, 1, B);
  })();

  // ── P2 navigates: DOWN → RIGHT×3 → Dan (row 1, col 3) ──
  (async () => {
    await sleep(1200); // slightly after P1 starts
    log("P2", "Moving: DOWN → RIGHT×3 → Dan");
    sendInput(p2, 2, DOWN);
    await sleep(300);
    for (let i = 0; i < 3; i++) {
      sendInput(p2, 2, RIGHT);
      await sleep(250);
    }
    screenshot("pvp_02_p2_cursor");
    log("P2", "Pressing B to lock Dan...");
    sendInput(p2, 2, B);
    await sleep(600);
    screenshot("pvp_04_both_selected");
  })();

  // ── Wait for match to play out ──
  await sleep(50000);

  // ── Summary ──
  log("====", "RESULTS ====");
  log("P1", `Selected: ${p1Selected?.charName ?? "NONE"} (id=0x${p1Selected?.charId?.toString(16) ?? "?"})`);
  log("P2", `Selected: ${p2Selected?.charName ?? "NONE"} (id=0x${p2Selected?.charId?.toString(16) ?? "?"})`);

  done = true;
  p1.close();
  p2.close();
  log("====", "Done! Screenshots in char-select-shots/");
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
