/**
 * Injects aggressive fighting inputs for BOTH players during combat.
 * Connects via WebSocket, waits for combat state, then blasts random attacks.
 *
 * SNES RetroArch button mapping (verified):
 *   btn 0 = B, btn 1 = Y, btn 8 = A, btn 9 = X
 *   btn 4 = D-pad Up, btn 5 = Down, btn 6 = Left, btn 7 = Right
 *
 * The "8" value in test-match.mjs is RetroArch joypad button ID:
 *   8 = START (A button on RetroArch retropad, mapped to SNES A)
 *
 * For real fighting, we need:
 *   Attacks: B(0), Y(1), A(8), X(9), L(10), R(11)
 *   Movement: Up(4), Down(5), Left(6), Right(7)
 *   Combined with attacks for special moves
 *
 * Usage: node scripts/inject-fight.mjs [sessionId]
 */

const WS_URL = "ws://localhost:8888";

const ATTACK_BTNS = [0, 1, 8, 9];
const DIR_BTNS = [4, 5, 6, 7];
const ALL_BTNS = [...ATTACK_BTNS, ...DIR_BTNS];

const sessionId = process.argv[2];

if (!sessionId) {
  console.log("Usage: node inject-fight.mjs <sessionId>");
  console.log("Find sessionId from game-server logs.");
  process.exit(1);
}

let ws = null;
let combatStarted = false;
let p1Interval = null;
let p2Interval = null;

function randomBtn(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function pressButton(player, btn, durationMs = 80) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "input", player, button: btn, pressed: true, sessionId }));
  setTimeout(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", player, button: btn, pressed: false, sessionId }));
    }
  }, durationMs);
}

function startFighting() {
  if (combatStarted) return;
  combatStarted = true;
  console.log("🥊 COMBAT! Injecting fighting inputs...");

  // P1: aggressive, random attacks + movement
  p1Interval = setInterval(() => {
    const btn = randomBtn(ALL_BTNS);
    pressButton(1, btn, 50 + Math.floor(Math.random() * 100));
  }, 200 + Math.floor(Math.random() * 300));

  // P2: defensive, some attacks
  p2Interval = setInterval(() => {
    const btn = randomBtn(ATTACK_BTNS);
    pressButton(2, btn, 50 + Math.floor(Math.random() * 100));
  }, 300 + Math.floor(Math.random() * 500));
}

function stopFighting() {
  if (p1Interval) clearInterval(p1Interval);
  if (p2Interval) clearInterval(p2Interval);
  combatStarted = false;
}

function connect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log(`Connected. Watching session ${sessionId}`);
  };

  ws.onmessage = (event) => {
    const data = event.data.toString();
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    switch (msg.type) {
      case "round_result":
        console.log(`🥊 Round: P${msg.winner} beats P${msg.loser}, type=${msg.koType}`);
        break;
      case "match_end":
        console.log(`🏆 MATCH END: P${msg.winner} wins`);
        stopFighting();
        break;
      case "char_select_end":
        console.log("🎯 Char select ended — starting fight inputs");
        // Delay slightly to let FIGHT! appear
        setTimeout(startFighting, 2000);
        break;
    }
  };

  ws.onclose = (event) => {
    stopFighting();
    console.log(`Connection closed (${event.code})`);
  };

  ws.onerror = (err) => {
    console.log(`WS error: ${err.message}`);
  };
}

// Run for 5 minutes max
setTimeout(() => {
  console.log("⏰ Time limit reached");
  stopFighting();
  if (ws) ws.close();
  process.exit(0);
}, 300_000);

connect();
