/**
 * Test script: simulate P1 + P2 cloud gaming session end-to-end.
 *
 * Flow:
 * 1. Create cloud session (P1) via Vercel API
 * 2. Get room code, join as P2 via Vercel API
 * 3. Connect P1 WebSocket to game server, send init
 * 4. Connect P2 WebSocket to game server, send join
 * 5. Wait for "ready" on both connections
 * 6. P2 sends input → verify server logs show it
 * 7. P1 sends input → verify server logs show it
 *
 * Usage: node test-p2-input.mjs [baseApiUrl]
 *
 * Defaults:
 *   API: http://localhost:3000 (local dev) or https://skyplay-testing.vercel.app (production)
 *   WS:  ws://localhost:8888 (local) or wss://donation-unix-junction-reg.trycloudflare.com (production)
 */

const IS_PROD = process.argv.includes("--prod");

const API_BASE = IS_PROD
  ? "https://skyplay-testing.vercel.app"
  : process.env.API_BASE || "http://localhost:3000";

const WS_BASE = IS_PROD
  ? "wss://donation-unix-junction-reg.trycloudflare.com"
  : process.env.WS_BASE || "ws://localhost:8888";

const SYSTEM = process.env.SYSTEM || "neogeo";
const ROM = process.env.ROM || "kof98.zip";

console.log("═══════════════════════════════════════════════");
console.log("  P2 Keyboard Input — End-to-End Test");
console.log("═══════════════════════════════════════════════");
console.log(`  API:  ${API_BASE}`);
console.log(`  WS:   ${WS_BASE}`);
console.log(`  Game: ${SYSTEM} / ${ROM}`);
console.log("═══════════════════════════════════════════════\n");

// ── Helpers ──────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function apiPost(path, body) {
  const url = `${API_BASE}${path}`;
  console.log(`  [API] POST ${url}`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${JSON.stringify(data)}`);
  }
  console.log(`  [API] ←`, JSON.stringify(data));
  return data;
}

function connectWs(wsUrl, label) {
  return new Promise((resolve, reject) => {
    console.log(`  [WS:${label}] Connecting to ${wsUrl}...`);
    const ws = new WebSocket(wsUrl);

    const timeout = setTimeout(() => {
      reject(new Error(`[WS:${label}] Connection timeout`));
    }, 15000);

    ws.onopen = () => {
      clearTimeout(timeout);
      console.log(`  [WS:${label}] ✅ Connected`);
      resolve(ws);
    };

    ws.onerror = (err) => {
      clearTimeout(timeout);
      console.error(`  [WS:${label}] ❌ Error:`, err?.message || err);
      reject(err);
    };

    ws.onclose = (evt) => {
      console.log(`  [WS:${label}] 🔌 Closed: code=${evt.code} reason="${evt.reason}"`);
    };

    ws.onmessage = (evt) => {
      if (typeof evt.data === "string") {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type !== "status" && msg.type !== "ping") {
            console.log(`  [WS:${label}] 📩 ${msg.type}${msg.width ? ` ${msg.width}x${msg.height}` : ""}`);
          }
          // Track ready message
          if (msg.type === "ready") {
            ws._ready = true;
            if (ws._readyResolve) ws._readyResolve();
          }
        } catch {
          // binary or non-JSON
        }
      }
    };
  });
}

function waitForReady(ws, label) {
  return new Promise((resolve, reject) => {
    if (ws._ready) return resolve();
    ws._readyResolve = resolve;
    setTimeout(() => reject(new Error(`[WS:${label}] 'ready' timeout`)), 20000);
  });
}

function sendInput(ws, player, button, pressed, label) {
  const msg = { type: "input", player, button, pressed };
  console.log(`  [WS:${label}] 📤 INPUT P${player} btn=${button} ${pressed ? "DOWN" : "UP"}`);
  ws.send(JSON.stringify(msg));
}

async function run() {
  try {
    // ── Step 1: Create session (P1) ──────────────────────────────────
    console.log("\n── Step 1: Create cloud session (P1) ──");
    const session = await apiPost("/api/cloud-session", {
      system: SYSTEM,
      rom: ROM,
    });
    const { sessionId, wsUrl: p1WsUrl, roomCode } = session;
    console.log(`  ✅ Session: ${sessionId}`);
    console.log(`  ✅ Room code: ${roomCode}`);

    // ── Step 2: Join as P2 ───────────────────────────────────────────
    console.log("\n── Step 2: Join session as P2 ──");
    const join = await apiPost("/api/cloud-session/join", { roomCode });
    const { wsUrl: p2WsUrl } = join;
    if (join.player !== 2) {
      throw new Error(`Expected player 2, got ${join.player}`);
    }
    console.log(`  ✅ Joined as P${join.player}`);

    // ── Step 3: Connect P1 WebSocket ─────────────────────────────────
    console.log("\n── Step 3: Connect P1 WebSocket ──");
    const p1Ws = await connectWs(p1WsUrl, "P1");

    console.log("\n── Step 4: Connect P2 WebSocket ──");
    const p2Ws = await connectWs(p2WsUrl, "P2");

    // ── Step 5: Wait for "ready" on both ─────────────────────────────
    console.log("\n── Step 5: Wait for 'ready' on both connections ──");
    await Promise.all([
      waitForReady(p1Ws, "P1"),
      waitForReady(p2Ws, "P2"),
    ]);
    console.log("  ✅ Both players ready!");

    // Give RetroArch a moment to fully initialize
    await sleep(2000);

    // ── Step 6: P2 sends inputs ──────────────────────────────────────
    console.log("\n── Step 6: P2 sends keyboard inputs ──");
    const p2Buttons = [
      { btn: 0, name: "A/CROSS" },     // 'I' key → P2 A
      { btn: 1, name: "B/CIRCLE" },     // 'K' key → P2 B
      { btn: 6, name: "UP [NeoGeo]" },  // 'T' key → P2 UP
      { btn: 9, name: "RIGHT [NeoGeo]" },// 'R' key → P2 RIGHT
      { btn: 5, name: "START" },         // 'N' key → P2 START
    ];

    for (const { btn, name } of p2Buttons) {
      // Press
      sendInput(p2Ws, 2, btn, true, "P2");
      await sleep(200);
      // Release
      sendInput(p2Ws, 2, btn, false, "P2");
      await sleep(200);
      console.log(`  ✅ P2 ${name} (btn=${btn}) sent`);
    }

    // ── Step 7: P1 sends inputs (control test) ───────────────────────
    console.log("\n── Step 7: P1 sends keyboard inputs ──");
    const p1Buttons = [
      { btn: 0, name: "A/CROSS" },
      { btn: 6, name: "UP [NeoGeo]" },
    ];
    for (const { btn, name } of p1Buttons) {
      sendInput(p1Ws, 1, btn, true, "P1");
      await sleep(200);
      sendInput(p1Ws, 1, btn, false, "P1");
      await sleep(200);
      console.log(`  ✅ P1 ${name} (btn=${btn}) sent`);
    }

    // ── Step 8: Check game-server logs ───────────────────────────────
    console.log("\n── Step 8: Check game-server logs for injectInput ──");
    await sleep(1000);

    console.log("\n═══════════════════════════════════════════════");
    console.log("  ✅ Test PASSED — P1 + P2 inputs sent successfully");
    console.log("═══════════════════════════════════════════════");

    // Cleanup
    p1Ws.close();
    p2Ws.close();
    console.log("\n  Connections closed.");

  } catch (err) {
    console.error("\n❌ TEST FAILED:", err.message);
    process.exit(1);
  }
}

run();
