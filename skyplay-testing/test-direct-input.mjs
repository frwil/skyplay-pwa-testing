/**
 * Direct game-server test: P1 + P2 WebSocket connections + input injection.
 * Bypasses Vercel API, connects directly to game-server WebSocket.
 *
 * Usage: node test-direct-input.mjs [wsUrl]
 *   Default: ws://localhost:8888
 */

const WS_BASE = process.argv[2] || "ws://localhost:8888";
const SYSTEM = process.env.SYSTEM || "neogeo";
const ROM = process.env.ROM || "kof98.zip";

console.log("═══════════════════════════════════════════════");
console.log("  Direct Game-Server Input Test");
console.log("═══════════════════════════════════════════════");
console.log(`  WS:   ${WS_BASE}`);
console.log(`  Game: ${SYSTEM} / ${ROM}`);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function makeSessionId() {
  return `test-sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function connectWs(wsUrl, label) {
  return new Promise((resolve, reject) => {
    console.log(`  [${label}] Connecting to ${wsUrl}...`);
    const ws = new WebSocket(wsUrl);

    const timeout = setTimeout(() => {
      reject(new Error(`[${label}] Connection timeout`));
    }, 15000);

    ws.onopen = () => {
      clearTimeout(timeout);
      console.log(`  [${label}] ✅ Connected`);
      resolve(ws);
    };

    ws.onerror = (err) => {
      clearTimeout(timeout);
      console.error(`  [${label}] ❌ Error`);
      reject(err);
    };

    ws.onclose = (evt) => {
      console.log(`  [${label}] 🔌 Closed: code=${evt.code}`);
    };

    ws.onmessage = (evt) => {
      if (typeof evt.data === "string") {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type !== "status" && msg.type !== "pong") {
            console.log(`  [${label}] 📩 ${msg.type}${msg.width ? ` ${msg.width}x${msg.height}` : ""}${msg.message ? " " + msg.message : ""}`);
          }
          if (msg.type === "ready") ws._ready = true;
          if (msg.type === "error") ws._error = msg.message;
        } catch {}
      }
      // Binary data (video/audio) — ignored in tests
      ws._msgCount = (ws._msgCount || 0) + 1;
      if (ws._msgCount === 1) {
        console.log(`  [${label}] 🎬 Receiving binary data (video/audio)...`);
      }
    };
  });
}

function send(ws, msg, label) {
  const json = JSON.stringify(msg);
  const short = `${msg.type}${msg.player !== undefined ? ` P${msg.player}` : ""}${msg.button !== undefined ? ` btn=${msg.button}` : ""}${msg.pressed !== undefined ? (msg.pressed ? " dn" : " up") : ""}`;
  console.log(`  [${label}] 📤 ${short}`);
  ws.send(json);
}

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await sleep(500);
  }
  console.log(`  [${label}] ⚠️ Timeout waiting`);
  return false;
}

async function run() {
  const sessionId = makeSessionId();
  console.log(`  Session: ${sessionId}\n`);

  // ── Connect P1 ──────────────────────────────────────────────────
  console.log("── Connect P1 ──");
  const p1Ws = await connectWs(`${WS_BASE}?sessionId=${sessionId}`, "P1");

  // ── P1 sends init ───────────────────────────────────────────────
  console.log("\n── P1 sends init ──");
  send(p1Ws, {
    type: "init",
    sessionId,
    token: "",
    system: SYSTEM,
    rom: ROM,
  }, "P1");

  // ── Wait for ready on P1 ────────────────────────────────────────
  console.log("\n── Wait for P1 ready ──");
  const p1Ready = await waitFor(() => p1Ws._ready, 30000, "P1");
  if (p1Ws._error) {
    console.error(`  Server error: ${p1Ws._error}`);
    p1Ws.close();
    process.exit(1);
  }
  if (!p1Ready) {
    console.error("  P1 never got 'ready'");
    p1Ws.close();
    process.exit(1);
  }
  console.log("  ✅ P1 ready!");

  // ── Connect P2 ──────────────────────────────────────────────────
  console.log("\n── Connect P2 ──");
  const p2Ws = await connectWs(`${WS_BASE}?sessionId=${sessionId}`, "P2");

  // ── P2 sends join ───────────────────────────────────────────────
  console.log("\n── P2 sends join ──");
  send(p2Ws, {
    type: "join",
    sessionId,
    token: "",
  }, "P2");

  // ── Wait for ready on P2 ────────────────────────────────────────
  console.log("\n── Wait for P2 ready ──");
  const p2Ready = await waitFor(() => p2Ws._ready, 15000, "P2");
  if (!p2Ready) {
    console.error("  P2 never got 'ready'");
  } else {
    console.log("  ✅ P2 ready!");
  }

  // Give RetroArch time to initialize
  await sleep(3000);

  // ── P2 sends inputs ─────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════");
  console.log("  P2 INPUT TEST");
  console.log("═══════════════════════════════════════════════\n");

  // Test all P2 buttons (Neo Geo: A=0,B=1,C=2,D=3,SELECT=4,START=5,UP=6,DOWN=7,LEFT=8,RIGHT=9)
  // These should map to xdotool keys: i,k,o,l,m,n,t,g,f,r
  const p2Tests = [
    { btn: 6, name: "UP (T key)" },
    { btn: 7, name: "DOWN (G key)" },
    { btn: 8, name: "LEFT (F key)" },
    { btn: 9, name: "RIGHT (R key)" },
    { btn: 0, name: "A (I key)" },
    { btn: 1, name: "B (K key)" },
    { btn: 2, name: "C (O key)" },
    { btn: 3, name: "D (L key)" },
    { btn: 5, name: "START (N key)" },
    { btn: 4, name: "SELECT (M key)" },
  ];

  let passed = 0;
  let failed = 0;

  for (const { btn, name } of p2Tests) {
    console.log(`  Testing P2 ${name}:`);

    // Press
    send(p2Ws, { type: "input", player: 2, button: btn, pressed: true }, "P2");
    await sleep(150);
    // Release
    send(p2Ws, { type: "input", player: 2, button: btn, pressed: false }, "P2");
    await sleep(150);

    console.log(`    ✅ Sent`);
    passed++;
  }

  // ── P1 sends inputs (control) ───────────────────────────────────
  console.log("\n  P1 CONTROL TEST:");
  const p1Tests = [
    { btn: 6, name: "UP (Arrow)" },
    { btn: 0, name: "A (X key)" },
  ];
  for (const { btn, name } of p1Tests) {
    send(p1Ws, { type: "input", player: 1, button: btn, pressed: true }, "P1");
    await sleep(150);
    send(p1Ws, { type: "input", player: 1, button: btn, pressed: false }, "P1");
    await sleep(150);
    console.log(`    ✅ P1 ${name} sent`);
    passed++;
  }

  await sleep(1000);

  console.log("\n═══════════════════════════════════════════════");
  console.log(`  ✅ ${passed} inputs sent successfully`);
  console.log("═══════════════════════════════════════════════");

  p1Ws.close();
  p2Ws.close();
  console.log("  Connections closed.\n");
}

run();
