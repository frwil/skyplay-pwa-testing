// SFA2 CPU match loop tester — runs N matches, collects round results, reports stats
const SESSION_PREFIX = `loop-${Date.now()}`;
const WS_URL = "ws://localhost:8888";
const ROM = "Street Fighter Alpha 2 (Europe).sfc";
const MATCH_COUNT = 1;           // number of full matches to run
const MATCH_TIMEOUT = 480_000;  // max ms per match (8 min)
const POST_MATCH_DELAY = 5_000; // wait between matches
// A-press sequence DISABLED — server auto-navigation handles char select.
// Set to true to enable manual A-press injection during char select.
const ENABLE_A_PRESS = true;
const SNES_A = 8;                // confirm/advance (keyboard 'x')

let matchIndex = 0;
let results = [];                // { match, rounds: [], matchEnd, code }
let currentRoundResults = [];
let currentMatchEnd = null;
let matchTimer = null;
let sessionId = null;
let charSelectActive = false;
let aPressTimer = null;
let ws = null;

function log(tag, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${tag}: ${msg}`);
}

function startAButtonPresses() {
  if (aPressTimer) return;
  log("🎯", "Starting A-press sequence for char select");
  // Press A alternately for P1 and P2 every 600ms
  let toggle = 0;
  aPressTimer = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !charSelectActive) {
      stopAButtonPresses();
      return;
    }
    const player = (toggle % 2) + 1; // alternate P1, P2
    toggle++;
    const input = { type: "input", player, button: SNES_A, pressed: true, sessionId };
    ws.send(JSON.stringify(input));
    setTimeout(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ ...input, pressed: false }));
      }
    }, 80);
  }, 600);
}

function stopAButtonPresses() {
  if (aPressTimer) {
    clearInterval(aPressTimer);
    aPressTimer = null;
  }
}

function startMatch() {
  if (matchIndex >= MATCH_COUNT) {
    printSummary();
    process.exit(0);
  }

  matchIndex++;
  currentRoundResults = [];
  currentMatchEnd = null;
  charSelectActive = false;
  stopAButtonPresses();
  sessionId = `${SESSION_PREFIX}-m${matchIndex}`;

  log("🏁", `=== Match ${matchIndex}/${MATCH_COUNT} (${sessionId}) ===`);

  if (ws) {
    try { ws.close(); } catch {}
  }
  ws = new WebSocket(WS_URL);

  matchTimer = setTimeout(() => {
    log("⏰", `Match ${matchIndex} timeout — forcing stop`);
    try { ws.send(JSON.stringify({ type: "stop", sessionId })); } catch {}
    setTimeout(() => { try { ws.close(); } catch {} }, 2000);
  }, MATCH_TIMEOUT);

  ws.onopen = () => {
    log("init", `Starting CPU match: ${ROM}`);
    ws.send(JSON.stringify({
      type: "init",
      sessionId,
      token: "",
      system: "snes",
      rom: ROM,
      mode: "cpu"
    }));
  };

  ws.onmessage = (event) => {
    const data = event.data.toString();
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    switch (msg.type) {
      case "ready":
        log("ready", `${msg.width}x${msg.height}`);
        break;

      case "char_select_start":
        charSelectActive = true;
        if (ENABLE_A_PRESS) startAButtonPresses();
        break;

      case "char_select_end":
        charSelectActive = false;
        stopAButtonPresses();
        log("🎯", "Char select ended");
        break;

      case "char_selected":
        log("👤", `P${msg.player} selected char ${msg.charId}`);
        break;

      case "round_result":
        currentRoundResults.push({
          winner: msg.winner, loser: msg.loser, koType: msg.koType,
          p1Losses: msg.p1Losses, p2Losses: msg.p2Losses,
        });
        log("🥊", `Round: P${msg.winner} beats P${msg.loser}, type=${msg.koType}, score=${msg.p1Losses}-${msg.p2Losses}`);
        break;

      case "match_end":
        currentMatchEnd = {
          winner: msg.winner, loser: msg.loser,
          p1Losses: msg.p1Losses, p2Losses: msg.p2Losses,
          totalRounds: msg.totalRounds, perfectKos: msg.perfectKos,
        };
        log("🏆", `MATCH END: P${msg.winner} wins, score=${msg.p1Losses}-${msg.p2Losses}, rounds=${msg.totalRounds}, perfects=${msg.perfectKos}`);
        break;

      case "match_state":
        break; // silent

      case "error":
        log("❌", msg.message);
        break;

      case "duel_started":
      case "duel_ready":
        log("⚔️", msg.type);
        break;
    }
  };

  ws.onerror = (err) => {
    log("ERROR", err.message || "websocket error");
  };

  ws.onclose = (event) => {
    stopAButtonPresses();
    clearTimeout(matchTimer);
    charSelectActive = false;

    results.push({
      match: matchIndex,
      sessionId,
      rounds: [...currentRoundResults],
      matchEnd: currentMatchEnd,
      code: event.code,
    });

    const rCount = currentRoundResults.length;
    const hasEnd = currentMatchEnd !== null;
    log("close", `Match ${matchIndex} done — code=${event.code}, rounds=${rCount}, matchEnd=${hasEnd}`);

    setTimeout(() => startMatch(), POST_MATCH_DELAY);
  };
}

function printSummary() {
  console.log("\n" + "=".repeat(60));
  console.log("LOOP TEST SUMMARY");
  console.log("=".repeat(60));

  let totalRounds = 0, totalPerfects = 0;
  let matchesWithEnd = 0, matchesWithoutEnd = 0;
  let draws = 0, normalKOs = 0, perfectKOs = 0, timeouts = 0;

  for (const r of results) {
    console.log(`\nMatch ${r.match} (${r.sessionId}):`);
    console.log(`  Rounds: ${r.rounds.length}, Match end: ${r.matchEnd ? `P${r.matchEnd.winner} wins (${r.matchEnd.p1Losses}-${r.matchEnd.p2Losses}, ${r.matchEnd.totalRounds}r)` : "NONE ❌"}`);

    for (const rr of r.rounds) {
      console.log(`    P${rr.winner} beats P${rr.loser} — ${rr.koType} (${rr.p1Losses}-${rr.p2Losses})`);
    }

    if (r.matchEnd) { matchesWithEnd++; totalPerfects += r.matchEnd.perfectKos || 0; }
    else { matchesWithoutEnd++; }

    totalRounds += r.rounds.length;
    for (const rr of r.rounds) {
      if (rr.koType === "draw") draws++;
      else if (rr.koType === "perfect") perfectKOs++;
      else if (rr.koType === "timeout") timeouts++;
      else normalKOs++;
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`TOTALS: ${results.length} matches, ${totalRounds} rounds`);
  console.log(`  Match end fired: ${matchesWithEnd}/${results.length}`);
  console.log(`  Match end MISSING: ${matchesWithoutEnd}/${results.length}`);
  console.log(`  KOs: ${normalKOs} normal, ${perfectKOs} perfect, ${timeouts} timeout, ${draws} draw`);
  console.log(`  Perfects (matchEnd): ${totalPerfects}`);

  const issues = [];
  if (matchesWithoutEnd > 0) issues.push(`${matchesWithoutEnd} matches without MATCH_END`);
  if (totalRounds === 0) issues.push("ZERO rounds detected");

  if (issues.length === 0) console.log(`\n✅ All matches completed with MATCH_END`);
  else console.log(`\n⚠️  Issues: ${issues.join(", ")}`);
}

// Global safety timeout
setTimeout(() => {
  console.log("\n⏰ Global timeout — printing partial summary");
  printSummary();
  process.exit(1);
}, MATCH_COUNT * (MATCH_TIMEOUT + POST_MATCH_DELAY) + 60_000);

startMatch();
