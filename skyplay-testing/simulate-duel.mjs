/**
 * Simulate a P1 vs P2 duel on the local game server.
 *
 * Usage: node simulate-duel.mjs [wsUrl]
 *   Default: ws://localhost:8888
 *   DURATION=20 (seconds)  ROM=kof98.zip  SYSTEM=neogeo
 */
const WS_BASE = process.argv[2] || "ws://localhost:8888";
const SYSTEM = process.env.SYSTEM || "neogeo";
const ROM = process.env.ROM || "kof98.zip";
const DURATION_SEC = parseInt(process.env.DURATION || "15", 10);

console.log("═══════════════════════════════════════════════");
console.log("  ⚔️  P1 vs P2 DUEL ⚔️");
console.log("═══════════════════════════════════════════════");
console.log(`  WS: ${WS_BASE}  |  Game: ${SYSTEM}/${ROM}  |  ${DURATION_SEC}s`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ── Neo Geo buttons ──────────────────────────────────────────────────
const B = { A: 0, B: 1, C: 2, D: 3, COIN: 4, START: 5, UP: 6, DOWN: 7, LEFT: 8, RIGHT: 9 };

// ── WebSocket ────────────────────────────────────────────────────────
function connect(wsUrl, label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const t = setTimeout(() => reject(new Error(`${label} timeout`)), 15000);
    ws.onopen = () => { clearTimeout(t); resolve(ws); };
    ws.onerror = () => { clearTimeout(t); reject(new Error(`${label} error`)); };
    ws.onclose = (e) => console.log(`  [${label}] 🔌 code=${e.code}`);
    ws.onmessage = (evt) => {
      if (typeof evt.data !== "string") return;
      try {
        const m = JSON.parse(evt.data);
        if (m.type === "ready") { ws._ready = true; console.log(`  [${label}] ✅ ready ${m.width}x${m.height}`); }
        if (m.type === "error") console.error(`  [${label}] ❌ ${m.message}`);
        if (m.type === "player_joined") console.log(`  👥 P2 joined`);
      } catch {}
    };
  });
}

// ── Input helpers ────────────────────────────────────────────────────
function down(ws, p, btn) { ws.send(JSON.stringify({ type: "input", player: p, button: btn, pressed: true })); }
function up(ws, p, btn) { ws.send(JSON.stringify({ type: "input", player: p, button: btn, pressed: false })); }

async function tap(ws, p, btn, ms = 80) { down(ws, p, btn); await sleep(ms); up(ws, p, btn); }
async function hold(ws, p, btn, ms) { down(ws, p, btn); await sleep(ms); up(ws, p, btn); }

// Compound moves
async function moveLeft(ws, p)  { await tap(ws, p, B.LEFT, 60); }
async function moveRight(ws, p) { await tap(ws, p, B.RIGHT, 60); }
async function crouch(ws, p)    { await hold(ws, p, B.DOWN, 250); }
async function jumpUp(ws, p)    { await hold(ws, p, B.UP, 120); }

async function jumpFwd(ws, p) {
  const dir = p === 1 ? B.RIGHT : B.LEFT; // P1 faces right, P2 faces left
  down(ws, p, B.UP); down(ws, p, dir);
  await sleep(120);
  up(ws, p, B.UP); up(ws, p, dir);
}

async function jumpBack(ws, p) {
  const dir = p === 1 ? B.LEFT : B.RIGHT;
  down(ws, p, B.UP); down(ws, p, dir);
  await sleep(120);
  up(ws, p, B.UP); up(ws, p, dir);
}

// Attacks
const punchA = (ws, p) => tap(ws, p, B.A, 70);
const punchC = (ws, p) => tap(ws, p, B.C, 70);
const kickB  = (ws, p) => tap(ws, p, B.B, 70);
const kickD  = (ws, p) => tap(ws, p, B.D, 70);

// Special: hadouken (↓ ↘ → + A)
async function fireball(ws, p) {
  down(ws, p, B.DOWN); await sleep(40);
  down(ws, p, B.RIGHT); await sleep(40);
  up(ws, p, B.DOWN);
  down(ws, p, B.A); await sleep(50);
  up(ws, p, B.RIGHT); up(ws, p, B.A);
}

// Special: shoryuken (→ ↓ ↘ + A)
async function dragonPunch(ws, p) {
  down(ws, p, B.RIGHT); await sleep(40);
  up(ws, p, B.RIGHT); down(ws, p, B.DOWN); await sleep(40);
  down(ws, p, B.RIGHT);
  down(ws, p, B.A); await sleep(50);
  up(ws, p, B.DOWN); up(ws, p, B.RIGHT); up(ws, p, B.A);
}

// 3-hit combo
async function combo3(ws, p) { await punchA(ws, p); await sleep(50); await punchA(ws, p); await sleep(50); await kickD(ws, p); }

// ── Player AI ────────────────────────────────────────────────────────
const p1Moves = [
  (ws) => { console.log("  P1: ⬅️  avance");     return moveRight(ws, 1); },
  (ws) => { console.log("  P1: 👊 jab");          return punchA(ws, 1); },
  (ws) => { console.log("  P1: 💪 strong punch"); return punchC(ws, 1); },
  (ws) => { console.log("  P1: 🦵 low kick");     return kickB(ws, 1); },
  (ws) => { console.log("  P1: 🦵🔼 high kick");   return kickD(ws, 1); },
  (ws) => { console.log("  P1: ⬆️↗  jump in");    return jumpFwd(ws, 1); },
  (ws) => { console.log("  P1: ⬆️↖  jump back");  return jumpBack(ws, 1); },
  (ws) => { console.log("  P1: ⬇️  crouch");      return crouch(ws, 1); },
  (ws) => { console.log("  P1: 🔥 FIREBALL!");    return fireball(ws, 1); },
  (ws) => { console.log("  P1: 🐉 DRAGON PUNCH!"); return dragonPunch(ws, 1); },
  (ws) => { console.log("  P1: 🥊 3-hit COMBO!"); return combo3(ws, 1); },
];

const p2Moves = [
  (ws) => { console.log("  P2: ➡️  recule");      return moveLeft(ws, 2); },
  (ws) => { console.log("  P2: 👊 counter");       return punchA(ws, 2); },
  (ws) => { console.log("  P2: 💪 heavy punch");   return punchC(ws, 2); },
  (ws) => { console.log("  P2: 🦵 sweep");         return kickB(ws, 2); },
  (ws) => { console.log("  P2: 🦵🔼 roundhouse");   return kickD(ws, 2); },
  (ws) => { console.log("  P2: ⬆️↖  jump back");   return jumpBack(ws, 2); },
  (ws) => { console.log("  P2: ⬆️  jump up");      return jumpUp(ws, 2); },
  (ws) => { console.log("  P2: ⬇️  crouch");       return crouch(ws, 2); },
  (ws) => { console.log("  P2: 🔥 FIREBALL!");     return fireball(ws, 2); },
  (ws) => { console.log("  P2: 🐉 DRAGON PUNCH!"); return dragonPunch(ws, 2); },
  (ws) => { console.log("  P2: 🥊 3-hit COMBO!");  return combo3(ws, 2); },
];

// ── Main ────────────────────────────────────────────────────────────
async function run() {
  const sid = `duel-${Date.now()}`;

  // P1 starts game
  console.log("\n── 🎮 P1 starts game ──");
  const p1 = await connect(`${WS_BASE}?sessionId=${sid}`, "P1");
  p1.send(JSON.stringify({ type: "init", sessionId: sid, token: "", system: SYSTEM, rom: ROM }));
  await new Promise((r) => { const c = () => p1._ready ? r() : setTimeout(c, 100); c(); });

  // P2 joins
  console.log("\n── 🎮 P2 joins ──");
  const p2 = await connect(`${WS_BASE}?sessionId=${sid}`, "P2");
  p2.send(JSON.stringify({ type: "join", sessionId: sid, token: "" }));
  await new Promise((r) => { const c = () => p2._ready ? r() : setTimeout(c, 100); c(); });

  // Insert coins + START for both
  console.log("\n── 🪙 INSERT COINS ──");
  await tap(p1, 1, B.COIN, 80); await sleep(150);
  await tap(p1, 1, B.START, 80); await sleep(300);
  await tap(p2, 2, B.COIN, 80); await sleep(150);
  await tap(p2, 2, B.START, 80);
  console.log("  ✅ FIGHT!\n");

  await sleep(2500);

  // ── DUEL LOOP ────────────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════");
  console.log("  ⚔️  FIGHT! ⚔️");
  console.log("═══════════════════════════════════════════════\n");

  const end = Date.now() + DURATION_SEC * 1000;
  let count = 0;

  while (Date.now() < end) {
    const elapsed = Math.round((Date.now() - (end - DURATION_SEC * 1000)) / 1000);
    process.stdout.write(`\r  [${String(elapsed).padStart(2)}s] `);

    if (Math.random() > 0.5) {
      await pick(p1Moves)(p1); process.stdout.write("| ");
      await sleep(pick([40, 60, 80, 100]));
      await pick(p2Moves)(p2);
    } else {
      await pick(p2Moves)(p2); process.stdout.write("| ");
      await sleep(pick([40, 60, 80, 100]));
      await pick(p1Moves)(p1);
    }
    count += 2;
    await sleep(pick([80, 120, 160, 200]));
  }

  console.log(`\n\n  🏆 K.O.! — ${count} actions en ${DURATION_SEC}s`);

  p1.close(); p2.close();
  await sleep(500);

  console.log("\n═══════════════════════════════════════════════");
  console.log("  ✅ Duel terminé — inputs injectés avec succès");
  console.log("═══════════════════════════════════════════════\n");
}

run().catch(err => { console.error("\n❌", err.message); process.exit(1); });
