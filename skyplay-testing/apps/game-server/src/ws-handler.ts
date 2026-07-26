import { WebSocket } from "ws";
import {
  createSession, addConnection, removeConnection, getSession,
  sendToSession, sendBinaryToSession, sendBinaryToConnection, resetIdleTimer, removeSession,
  getPlayerInfo, hasActiveConnections, getConnections, getAllSessions, type Session,
} from "./session-manager.js";
import { GameRunner } from "./game-runner.js";
import type { ClientMessage } from "./types.js";
import { FRAME_MAGIC, AUDIO_MAGIC, CODEC_CONFIG_MAGIC } from "./types.js";
import { getGameConfig } from "./game-config.js";
import { writeFile, mkdir, readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

/** Map sessionId → GameRunner for lifecycle management. */
const sessionRunners = new Map<string, GameRunner>();

// ── Stats accumulation ─────────────────────────────────────────────
interface RoundRecord {
  loser: number; winner: number; koType: string; roundNumber: number; matchNumber: number;
}
interface MatchRecord {
  winner: number; loser: number; p1Losses: number; p2Losses: number;
  matchNumber: number; totalRounds: number; perfectKos: number;
  perfectKoDetails?: { round: number; player: number }[];
  /** Post-match character metadata (character-ID arrays; names resolved on display). */
  p1Team?: number[]; p2Team?: number[];
  p1SelectOrder?: number[]; p2SelectOrder?: number[];
  p1Mode?: string; p2Mode?: string;
}
interface AccumulatedStats {
  sessionId: string; mode: "cpu" | "pvp"; system: string; rom: string;
  rounds: RoundRecord[];
  matches: MatchRecord[];
  startedAt: number;
  matchCounter: number;
}
const sessionStats = new Map<string, AccumulatedStats>();

/**
 * Sessions whose match has ended — input is locked so no client can keep playing
 * (even by bypassing the UI). Set on matchEnd, cleared when the session is torn down.
 * A rematch always uses a fresh session, so the flag never needs to be reset in place.
 */
const matchInputLocked = new Set<string>();

/**
 * Loser side (1 or 2) of the last finished match per session. On a same-session
 * rematch the winner stays credited/active; only the loser must re-join (coin +
 * START), and the loser can be P1 or P2. Set on matchEnd, used by handleRematchAccept.
 */
const matchLoserSide = new Map<string, number>();

/**
 * Post-match countdown timers. After matchEnd, a 30s countdown starts. If no
 * rematch_request arrives before it expires, the session is killed. Set on
 * matchEnd, cancelled by rematch_request/rematch_accept.
 */
const matchEndTimers = new Map<string, ReturnType<typeof setTimeout>>();
const MATCH_END_COUNTDOWN_MS = 30_000;

// ── Stats buffering for offline resilience ──────────────────────────
const PENDING_STATS_DIR = process.env.PENDING_STATS_DIR || "/data/pending-stats";

/** Flush any buffered stats files that failed to reach the API earlier. */
async function flushPendingStats(): Promise<void> {
  const apiUrl = process.env.STATS_API_URL || "http://localhost:3000";
  const apiToken = process.env.STATS_API_TOKEN || "dev";

  let files: string[] = [];
  try {
    await mkdir(PENDING_STATS_DIR, { recursive: true });
    files = await readdir(PENDING_STATS_DIR);
  } catch {
    // Directory doesn't exist or is unreadable — nothing to flush
    return;
  }

  if (files.length === 0) return;

  const jsonFiles = files.filter(f => f.endsWith(".json"));
  if (jsonFiles.length === 0) return;

  console.log(`[ws] 📦 Flushing ${jsonFiles.length} pending stats file(s)...`);

  for (const file of jsonFiles) {
    const filePath = join(PENDING_STATS_DIR, file);
    try {
      const raw = await readFile(filePath, "utf-8");
      const payload = JSON.parse(raw);
      const res = await fetch(`${apiUrl}/api/stats/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiToken}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        console.warn(`[ws] ⚠️  Pending stats flush failed for ${file}: ${res.status} ${await res.text().catch(() => "")}`);
        // Stop processing remaining — if the API is down, all will fail
        return;
      }
      await unlink(filePath);
      console.log(`[ws] ✅ Flushed pending stats: ${file}`);
    } catch (err) {
      console.warn(`[ws] ⚠️  Pending stats flush error for ${file}:`, (err as Error)?.message ?? err);
      // Stop on first failure — if the API is unreachable, retry later
      return;
    }
  }
}

// Flush buffered stats at startup (non-blocking — sessions can start immediately)
void flushPendingStats();

// Retry every 2 minutes
setInterval(() => { void flushPendingStats(); }, 120_000);

function getStats(sessionId: string): AccumulatedStats | undefined {
  return sessionStats.get(sessionId);
}

export function handleConnection(ws: WebSocket, sessionId: string): void {
  console.log(`[ws] New connection: ${sessionId}`);

  ws.on("message", (raw: Buffer) => {
    try {
      if (typeof raw === "string" || raw[0] === 0x7b) {
        const text = typeof raw === "string" ? raw : raw.toString();
        const msg: ClientMessage = JSON.parse(text);
        handleMessage(ws, msg, sessionId);
      }
    } catch (err) {
      console.error(`[ws] Failed to parse message:`, err);
    }
  });

  ws.on("close", (code, reason) => {
    const info = getPlayerInfo(ws);
    const playerLabel = info ? `P${info.player}` : "?";
    console.log(`[ws] ${playerLabel} disconnected: ${sessionId} (${code})`);

    // Remove this specific connection
    if (info) {
      removeConnection(info.sessionId, info.player);
      const session = getSession(info.sessionId);
      if (session && hasActiveConnections(session)) {
        // One player remains — notify them
        sendToSession(session, { type: "player_disconnected", player: info.player });
        resetIdleTimer(session);
      } else {
        // No connections left — cleanup entirely
        stopSession(sessionId);
      }
    }
  });

  ws.on("error", (err) => {
    console.error(`[ws] WebSocket error for ${sessionId}:`, err);
    // close handler will fire after error
  });
}

// 🔍 DEBUG: throttle logging to avoid spam
const msgCounts = new Map<string, number>();
function logMsg(label: string, extra?: string): void {
  const count = (msgCounts.get(label) || 0) + 1;
  msgCounts.set(label, count);
  if (count <= 5 || count % 50 === 0) {
    console.log(`[ws] 📩 ${label} (#${count})${extra ? " " + extra : ""}`);
  }
}

function handleMessage(ws: WebSocket, msg: ClientMessage, sessionId: string): void {
  // Reset idle timer on ANY message from ANY connection
  const info = getPlayerInfo(ws);
  if (info) {
    const session = getSession(info.sessionId);
    if (session) resetIdleTimer(session);
  }

  switch (msg.type) {
    case "init":
      logMsg("init", `system=${(msg as { system?: string }).system || "?"}`);
      void handleInit(ws, msg, sessionId);
      break;

    case "join":
      logMsg("join");
      handleJoin(ws, msg, sessionId);
      break;

    case "input":
      logMsg("input", `P${msg.player} btn=${msg.button} ${msg.pressed ? "dn" : "up"}`);
      handleInput(ws, msg);
      break;

    case "pause":
    case "resume":
      logMsg("control", msg.type);
      handleControl(msg.type, sessionId, ws);
      break;

    case "stop":
      logMsg("stop");
      stopSession(sessionId);
      break;

    case "rematch_request":
      logMsg("rematch_request");
      handleRematchRequest(sessionId);
      break;

    case "rematch_accept":
      logMsg("rematch_accept");
      void handleRematchAccept(sessionId);
      break;

    case "rematch_decline":
      logMsg("rematch_decline");
      handleRematchDecline(sessionId);
      break;

    case "auto_rematch":
      logMsg("auto_rematch");
      void handleAutoRematch(sessionId, (msg as any).matchNumber ?? 0, (msg as any).totalMatches ?? 0);
      break;

    case "stop_duel":
      logMsg("stop_duel");
      stopSession(sessionId);
      break;

    case "client_ready":
      logMsg("client_ready", `session=${sessionId}`);
      handleClientReady(sessionId, ws);
      break;

    case "ping":
      // Too frequent to log
      handlePing(ws, msg.t);
      break;

    default:
      console.warn(`[ws] Unknown message type from ${sessionId}:`, (msg as { type: string }).type);
  }
}

async function handleInit(
  ws: WebSocket,
  msg: { type: "init"; sessionId: string; token: string; system: string; rom: string; mode?: "cpu" | "pvp"; rtmpUrl?: string },
  sessionId: string,
): Promise<void> {
  const { system, rom } = msg;

  // Validate token
  const expectedToken = process.env.SESSION_TOKEN_SECRET;
  if (expectedToken && msg.token !== expectedToken) {
    ws.send(JSON.stringify({ type: "error", message: "Invalid session token" }));
    ws.close(4001, "Unauthorized");
    return;
  }

  // ── Zombie session cleanup ──────────────────────────────────────
  // Before starting a new game, kill any sessions that are stopped, idle,
  // or whose runners have exited — they would leave orphan RetroArch/Xvfb
  // processes that starve the shared display.
  for (const s of getAllSessions()) {
    if (s.status === "stopped" || !hasActiveConnections(s)) {
      console.log(`[ws] 🧹 Cleaning up zombie session ${s.id} (status=${s.status})`);
      stopSession(s.id);
    }
  }

  // Check if session already exists (P1 reconnecting or P2 already waiting)
  let session = getSession(msg.sessionId);
  if (session) {
    if (session.status === "reserved") {
      // P2 joined first — claim the reserved session and start the game
      console.log(`[ws] P1 claiming reserved session ${msg.sessionId}`);
      session.system = system;
      session.rom = rom;
      session.status = "loading";
    } else {
      // Reconnection: just add the WS to existing session
      addConnection(msg.sessionId, ws, 1);
      if (session.videoWidth && session.videoHeight) {
        ws.send(JSON.stringify({ type: "ready", width: session.videoWidth, height: session.videoHeight }));
      }
      return;
    }
  } else {
    // ── New session (P1 first connection, no P2 yet) ──
    const mode = msg.mode ?? "cpu";
    session = createSession(msg.sessionId, system, rom, mode);
    session.status = "loading";
  }

  addConnection(msg.sessionId, ws, 1);

  // ── Load game config from DB (RAM addresses, controls) ──
  let gameConfig = null;
  try {
    gameConfig = await getGameConfig(rom);
  } catch (err) {
    console.warn(`[ws] Failed to load game config for ${rom}:`, err);
  }

  // Start game runner
  const mode = session.mode;
  const runner = new GameRunner(
    system, rom, msg.sessionId, mode, msg.rtmpUrl ?? null,
    gameConfig?.ramConfig ?? null,
  );
  if (gameConfig) {
    console.log(`[ws] 🎮 Game config loaded for ${rom}: mode=${gameConfig.mode}, ramConfig=${gameConfig.ramConfig ? "yes" : "no"}, controls=${gameConfig.controls.length}`);
  }
  sessionRunners.set(msg.sessionId, runner);

  // ── Initialize stats accumulator ──
  sessionStats.set(msg.sessionId, {
    sessionId: msg.sessionId, mode, system, rom,
    rounds: [], matches: [], startedAt: Date.now(), matchCounter: 0,
  });

  // ── Video frame (H.264 NAL unit) ──
  // Header: magic(1) + width(u16) + height(u16) + frameId(u32) + nalLength(u32) = 13 bytes
  runner.on("frame", (nalUnit: Buffer, width: number, height: number) => {
    session.frameCount++;
    // Keep session alive during CPU matches (no client messages after init)
    resetIdleTimer(session);
    if (!nalUnit || nalUnit.length === 0) return;

    const header = Buffer.alloc(13);
    header.writeUInt8(FRAME_MAGIC, 0);
    header.writeUInt16LE(width, 1);
    header.writeUInt16LE(height, 3);
    header.writeUInt32LE(session.frameCount, 5);
    header.writeUInt32LE(nalUnit.length, 9); // 32-bit NAL length — handles large keyframes

    try {
      sendBinaryToSession(session, Buffer.concat([header, nalUnit]));
    } catch {
      // WebSocket may be closed
    }
  });

  // ── Audio frame (raw s16le PCM from GameRunner) ──
  runner.on("audio", (pcmData: Buffer) => {
    if (!pcmData || pcmData.length === 0) return;

    const header = Buffer.alloc(5);
    header.writeUInt8(AUDIO_MAGIC, 0);
    header.writeUInt32LE(pcmData.length, 1);

    try {
      const payload = Buffer.concat([header, pcmData]);
      sendBinaryToSession(session, payload);
    } catch {
      // ok
    }
  });

  // ── Codec configuration (H.264 + Opus descriptors) ──
  runner.on("codecConfig", (videoDesc: Uint8Array, audioDesc: Uint8Array) => {
    // Cache descriptors so late-joining P2 can receive them
    session.codecVideoDesc = videoDesc;
    session.codecAudioDesc = audioDesc;

    const videoLen = Buffer.alloc(2);
    videoLen.writeUInt16LE(videoDesc.length, 0);
    const payload = Buffer.concat([videoLen, Buffer.from(videoDesc), Buffer.from(audioDesc)]);

    const header = Buffer.alloc(3);
    header.writeUInt8(CODEC_CONFIG_MAGIC, 0);
    header.writeUInt16LE(payload.length, 1);

    try {
      sendBinaryToSession(session, Buffer.concat([header, payload]));
    } catch {
      // ok
    }
  });

  runner.on("error", (err: Error) => {
    console.error(`[ws] Game runner error for ${msg.sessionId}:`, err);
    sendToSession(session, { type: "error", message: err.message });
  });

  runner.on("exit", (code: number | null) => {
    console.log(`[ws] Game runner exited for ${msg.sessionId} (code ${code})`);
    // RetroArch crashed or exited unexpectedly — clean up to prevent leaked UDP readers,
    // orphaned timers, and stale session state. stopSession is idempotent.
    stopSession(msg.sessionId);
  });

  // ── Match started (RAM-based detection) ──
  runner.on("matchStarted", (data: { p1Health?: number; p2Health?: number; timerValue?: number; p1Char?: string; p2Char?: string }) => {
    // Resolve character names: prefer cursor-tracked (char select), fall back to RAM-based
    const p1Name = data.p1Char || undefined;
    const p2Name = data.p2Char || undefined;

    console.log(
      `[ws] 🎬 MATCH STARTED — ` +
      `P1 = ${p1Name ?? "?"} | ` +
      `P2 = ${p2Name ?? "?"} | ` +
      `mode=${session.mode} system=${session.system}`
    );

    // Forward to client so the frontend can show character names
    sendToSession(session, {
      type: "match_started",
      p1CharName: p1Name,
      p2CharName: p2Name,
      p1Health: data.p1Health,
      p2Health: data.p2Health,
    });
  });

  // ── Round win/loss detection (memory watcher) ──
  runner.on("roundResult", (data: { loser: number; winner: number; p1Losses: number; p2Losses: number; koType?: string }) => {
    console.log(`[ws] 🏆 Round result: P${data.winner} wins round! Losses: P1=${data.p1Losses} P2=${data.p2Losses} koType=${data.koType || "normal"}`);
    sendToSession(session, {
      type: "round_result",
      loser: data.loser,
      winner: data.winner,
      p1Losses: data.p1Losses,
      p2Losses: data.p2Losses,
      koType: data.koType as "normal" | "perfect" | "timeout" | "draw" | undefined,
    });
    // Accumulate stats
    const stats = sessionStats.get(msg.sessionId);
    if (stats) {
      stats.rounds.push({
        loser: data.loser, winner: data.winner, koType: data.koType || "normal",
        roundNumber: stats.rounds.length + 1, matchNumber: stats.matchCounter + 1,
      });
    }
  });

  runner.on("matchEnd", (data: { winner: number; loser: number; p1Losses: number; p2Losses: number; matchNumber?: number; totalRounds?: number; perfectKos?: number; perfectKoDetails?: { round: number; player: number }[]; p1TeamIds?: number[]; p2TeamIds?: number[]; p1SelectOrder?: number[]; p2SelectOrder?: number[]; p1Mode?: string; p2Mode?: string; p1PlayMode?: string; p2PlayMode?: string; p1CharWins?: Record<number, number>; p2CharWins?: Record<number, number>; p1Char?: string; p2Char?: string }) => {
    const OVERLAY_DELAY_MS = 8000;
    const resultLabel = data.winner === 0 ? "DRAW!" : `P${data.winner} wins!`;
    console.log(`[ws] 🏁 MATCH OVER! ${resultLabel} Losses: P1=${data.p1Losses} P2=${data.p2Losses} (overlay in ${OVERLAY_DELAY_MS}ms)`);
    if (data.perfectKoDetails && data.perfectKoDetails.length > 0) {
      const details = data.perfectKoDetails.map(d => `R${d.round}:P${d.player}`).join(", ");
      console.log(`[ws] 👑 Perfect KOs: ${details}`);
    }

    // Delay post-match actions so the victory animation plays before the game freezes
    setTimeout(() => {

    sendToSession(session, {
      type: "match_end",
      winner: data.winner,
      loser: data.loser,
      p1Losses: data.p1Losses,
      p2Losses: data.p2Losses,
      matchNumber: data.matchNumber,
      totalRounds: data.totalRounds,
      perfectKos: data.perfectKos,
      perfectKoDetails: data.perfectKoDetails,
      p1TeamIds: data.p1TeamIds,
      p2TeamIds: data.p2TeamIds,
      p1SelectOrder: data.p1SelectOrder,
      p2SelectOrder: data.p2SelectOrder,
      p1Mode: data.p1Mode as "ADVANCED" | "EXTRA" | undefined,
      p2Mode: data.p2Mode as "ADVANCED" | "EXTRA" | undefined,
      p1PlayMode: data.p1PlayMode as "Auto" | "Manual" | undefined,
      p2PlayMode: data.p2PlayMode as "Auto" | "Manual" | undefined,
      p1CharWins: data.p1CharWins,
      p2CharWins: data.p2CharWins,
      p1CharName: data.p1Char,
      p2CharName: data.p2Char,
    });
    // Accumulate match stats
    const stats = sessionStats.get(msg.sessionId);
    if (stats) {
      stats.matchCounter++;
      stats.matches.push({
        winner: data.winner, loser: data.loser,
        p1Losses: data.p1Losses, p2Losses: data.p2Losses,
        matchNumber: data.matchNumber || stats.matchCounter,
        totalRounds: data.totalRounds || 0,
        perfectKos: data.perfectKos || 0,
        perfectKoDetails: data.perfectKoDetails || [],
        p1Team: data.p1TeamIds, p2Team: data.p2TeamIds,
        p1SelectOrder: data.p1SelectOrder, p2SelectOrder: data.p2SelectOrder,
        p1Mode: data.p1Mode, p2Mode: data.p2Mode,
      });
    }
    // Lock input for this session: the match is over, no more playing until a rematch.
    // Prevents continuing via a hacked client.
    matchInputLocked.add(msg.sessionId);
    // Freeze the emulator on the final frame so KOF98 never falls into its attract/DEMO
    // mode (CPU vs CPU) behind the end-match overlay — that demo would otherwise be scored
    // as a phantom match. beginRematch() resumes it on a real rematch.
    runner.pause();
    // Remember who lost — only the loser re-joins on a same-session rematch.
    if (data.loser === 1 || data.loser === 2) matchLoserSide.set(msg.sessionId, data.loser);
    // ── Post-match countdown: auto-stop session if no rematch within 30s ──
    // Cancelled by rematch_request (the client handlers clear this timer).
    const existing = matchEndTimers.get(msg.sessionId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      console.log(`[ws] ⏰ Post-match countdown expired for ${msg.sessionId} — stopping session`);
      matchEndTimers.delete(msg.sessionId);
      stopSession(msg.sessionId);
    }, MATCH_END_COUNTDOWN_MS);
    matchEndTimers.set(msg.sessionId, timer);

    }, OVERLAY_DELAY_MS);
  });

  // ── Live in-match state (teams / active char / gauge mode) ──
  runner.on("matchState", (data) => {
    sendToSession(session, { type: "match_state", ...data });
  });

  // Start the game (text detector always runs, auto-resumes health analysis on FIGHT!)
  runner.start().then(({ width, height }) => {
    // Guard: if stop() was called during async setup (player disconnected while
    // waiting for RetroArch), this runner is stopped — don't proceed.
    if (!runner.isRunning) {
      console.log(`[ws] Runner for ${msg.sessionId} was stopped during setup — ignoring late start completion`);
      return;
    }
    session.videoWidth = width;
    session.videoHeight = height;
    session.status = "running";
    sendToSession(session, { type: "ready", width, height });

    // ── Auto coin + start ──────────────────────────────────────────
    // Button indices vary per system (Neo Geo: 4=SELECT/coin, 5=START;
    // SNES: 2=SELECT, 3=START, no coin). We auto-detect the right mapping.
    const startButton = system === "snes" ? 3 : system === "ps1" ? 9 : 5;
    const coinButton = system === "snes" ? null : system === "ps1" ? 8 : 4; // SNES has no coin
    const coinDelay = system === "snes" ? 0 : 15000; // skip coin for SNES
    const startDelay = system === "snes" ? 30000 : 20000;
    const needCoins = coinButton != null;

    if (session.mode === "pvp") {
      // ── 10s dual-client ready guard ──
      // Don't start the game until both clients confirm they're ready.
      // If one side doesn't load within 10s, cancel the session.
      session.clientReadyTimer = setTimeout(() => {
        console.log(`[ws] ⏰ Dual-client ready timeout for session ${msg.sessionId}`);
        sendToSession(session, { type: "session_cancelled", reason: "One player did not load in time" });
        stopSession(msg.sessionId);
      }, 10000);
      console.log(`[ws] ⏱️ 10s ready guard started for PvP session ${msg.sessionId}`);
      checkBothClientsReady(session, runner, system, msg.rom, msg.sessionId);
    } else {
      // ── CPU mode ──
      if (needCoins) {
        // CPU mode: insert 1 coin
        setTimeout(() => {
          if (session.status !== "running") return;
          console.log(`[ws] 🪙 Inserting 1 coin for CPU session ${msg.sessionId}`);
          runner.ensureFocus();
          runner.injectInput(1, coinButton, true);
          setTimeout(() => { runner.injectInput(1, coinButton, false); }, 200);
        }, coinDelay);
      }

      // For SNES: auto-start sequence.
      // SFA2 flow: START at T+30s → skip intro; START at T+48s → select
      // game mode (first option = ARCADE); backup START at T+63s if the
      // menu animation took longer. Then the game enters char select
      // automatically. In char select, A (key 'x') confirms each choice.
      if (system === "snes") {
        const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

        const tap = (player: number, btn: number, holdMs = 200) => {
          if (session.status !== "running") return;
          runner.ensureFocus();
          runner.injectInput(player, btn, true);
          setTimeout(() => runner.injectInput(player, btn, false), holdMs);
        };

        // Everything before combat (title screen, ATTRACT DEMO, menus, char
        // select) must NOT be analyzed: the attract demo is a real CPU-vs-CPU
        // fight with a live timer and draining bars — it fabricates KOs.
        // Text detector is always running; roundActive guard prevents
        // attract-mode KOs from fabricating rounds (FIGHT! never seen).

        setTimeout(async () => {
          if (session.status !== "running") return;
          // Lock player input during auto-start sequence — prevents players
          // from interfering with menu navigation (START ×2, DOWN, START).
          session.inputLocked = true;
          // 1) T+30s: START → skip intro, reach main menu
          console.log(`[ws] ▶️  SFA2 CPU T+30s: START → skip intro for ${msg.sessionId}`);
          tap(1, startButton, 300);
          await sleep(18000);

          if (session.status !== "running") return;
          // 2) T+48s: START → select game mode (ARCADE, first option)
          console.log(`[ws] ▶️  SFA2 CPU T+48s: START → select game mode for ${msg.sessionId}`);
          tap(1, startButton, 300);
          await sleep(15000);

          if (session.status !== "running") return;
          // 3) T+63s: backup START — in case main menu animation took longer
          console.log(`[ws] ▶️  SFA2 CPU T+63s: backup START for ${msg.sessionId}`);
          tap(1, startButton, 300);
          await sleep(10000);

          if (session.status !== "running") return;
          // 4) T+73s: Character select reached — unlock input. The player can
          // move the on-screen cursor with D-pad. After a delay, inject A to
          // confirm P1's character (default: Ryu). RAM-based detection at
          // 0x1C07/0x1C08 picks up the character ID when the match starts.
          console.log(`[ws] 🎮 SFA2 CPU: char select reached — unlocking input for ${msg.sessionId}`);
          session.inputLocked = false;
          // Inject A to confirm character after 4s (player can move cursor before then)
          setTimeout(() => {
            if (session.status !== "running") return;
            console.log(`[ws] 🎮 SFA2 CPU: confirming character for ${msg.sessionId}`);
            tap(1, 8, 200); // A button
          }, 4000);
          // Follow-up A presses to skip Speed/Stage select screens
          [7000, 10000, 13000].forEach(ms => {
            setTimeout(() => {
              if (session.status !== "running") return;
              tap(1, 8, 200);
            }, ms);
          });
        }, startDelay);
      }

      // Start round detection after a delay
      setTimeout(() => {
        if (session.status === "running") {
          console.log(`[ws] 🧠 Starting round detection for ${system} session ${msg.sessionId}`);
          runner.startMemoryWatcher();
        }
      }, system === "snes" ? 70000 : 25000);
    }

    let lastFrameCount = 0;
    const fpsInterval = setInterval(() => {
      if (session.status === "stopped") {
        clearInterval(fpsInterval);
        return;
      }
      session.fps = session.frameCount - lastFrameCount;
      lastFrameCount = session.frameCount;
      sendToSession(session, { type: "status", fps: session.fps, frames: session.frameCount });
    }, 1000);
  }).catch((err) => {
    console.error(`[ws] Failed to start game runner:`, err);
    sendToSession(session, { type: "error", message: String(err) });
    session.status = "stopped";
  });
}

function handleJoin(
  ws: WebSocket,
  msg: { type: "join"; sessionId: string; token: string },
  _sessionId: string,
): void {
  console.log(`[ws] 👤 P2 join request for session ${msg.sessionId}`);

  // Validate token
  const expectedToken = process.env.SESSION_TOKEN_SECRET;
  if (expectedToken && msg.token !== expectedToken) {
    ws.send(JSON.stringify({ type: "error", message: "Invalid session token" }));
    ws.close(4001, "Unauthorized");
    return;
  }

  let session = getSession(msg.sessionId);
  console.log(`[ws] 👤 P2 join: session=${session ? `found (status=${session.status}, conns=${session.connections.length})` : "NOT FOUND"}`);

  if (!session) {
    // P2 joined before P1 — reserve the session and wait for P1's init
    console.log(`[ws] P2 joined before P1 — reserving session ${msg.sessionId}`);
    session = createSession(msg.sessionId, "pending", "pending", "pvp");
    session.status = "reserved";
  }

  // Add P2 connection
  addConnection(msg.sessionId, ws, 2);

  // P2 joining means this is a PvP session
  session.mode = "pvp";

  if (session.status === "reserved") {
    // P1 hasn't connected yet — tell P2 to wait
    console.log(`[ws] P2 waiting for P1 to start session ${msg.sessionId}`);
    ws.send(JSON.stringify({ type: "waiting", message: "Waiting for host to start the game..." }));
    return;
  }

  // Session is already running (P1 connected first) — normal flow
  // Notify P1 that P2 joined
  sendToSession(session, { type: "player_joined", player: 2 });

  // Re-send codec config to P2 if it was already sent (P2 joined after game start)
  console.log(`[ws] 👤 P2 join: codecVideoDesc=${session.codecVideoDesc ? "cached" : "NOT YET"} videoWidth=${session.videoWidth} videoHeight=${session.videoHeight}`);
  if (session.codecVideoDesc && session.codecAudioDesc) {
    const videoLen = Buffer.alloc(2);
    videoLen.writeUInt16LE(session.codecVideoDesc.length, 0);
    const payload = Buffer.concat([videoLen, Buffer.from(session.codecVideoDesc), Buffer.from(session.codecAudioDesc)]);

    const header = Buffer.alloc(3);
    header.writeUInt8(CODEC_CONFIG_MAGIC, 0);
    header.writeUInt16LE(payload.length, 1);

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(Buffer.concat([header, payload]));
      console.log(`[ws] 📡 Re-sent codec config to P2 for session ${msg.sessionId}`);
    }
  } else if (session.status === "running" || session.status === "loading") {
    console.log(`[ws] ⚠️ P2 joined but codec config not cached yet — frames may not decode!`);
  }

  // Send ready to P2 with current video dimensions
  ws.send(JSON.stringify({
    type: "ready",
    width: session.videoWidth,
    height: session.videoHeight,
  }));
}

function handleInput(
  ws: WebSocket,
  msg: { player: number; button: number; pressed: boolean },
): void {
  // 🔍 DEBUG: Log every input message (disabled — too verbose)
  // console.log(`[ws] 🎮 INPUT P${msg.player} btn=${msg.button} ${msg.pressed ? "DOWN" : "UP"}`);

  // Route input to the correct session's runner
  const info = getPlayerInfo(ws);
  if (!info) {
    console.warn(`[ws] ⚠️ INPUT dropped: no player info for WebSocket`);
    return;
  }

  const runner = sessionRunners.get(info.sessionId);
  if (!runner) {
    console.warn(`[ws] ⚠️ INPUT dropped: no runner for session ${info.sessionId}`);
    return;
  }

  // Match over → input locked. Drop silently so a hacked client cannot keep playing.
  if (matchInputLocked.has(info.sessionId)) {
    return;
  }

  // ── Block manual coin + START for NeoGeo/arcade PvP sessions ──
  // The server injects both automatically (2 coins at 15s, START at 20s).
  // Letting clients send button 4 (SELECT = coin) or button 5 (START) would
  // let players insert extra credits or interfere with the auto-start sequencer.
  // Pause is a separate "control" message (not input), so blocking START does
  // not affect the pause/resume functionality.
  const session = getSession(info.sessionId);

  // ── Input lock during auto-start sequence ──
  // All player input is dropped while the server is navigating menus
  // (START ×2, DOWN, START for SFA2 PvP). This prevents players from
  // interfering with the auto-sequence.
  if (session && session.inputLocked) {
    // Silent drop — auto-sequence is in progress
    return;
  }

  if (session && session.mode === "pvp" && session.system === "neogeo" && (msg.button === 4 || msg.button === 5)) {
    console.log(`[ws] 🚫 BLOCKED manual ${msg.button === 4 ? "coin" : "START"} (btn ${msg.button}) from P${msg.player} in PvP session ${info.sessionId}`);
    return;
  }

  // Pass the declared player number (from client) to injectInput
  // console.log(`[ws] ✅ Routing P${msg.player} input to session ${info.sessionId} runner`);
  runner.injectInput(msg.player, msg.button, msg.pressed);
}

/** Which player sent the pause/resume message — resolved from the WebSocket connection. */
function handleControl(action: "pause" | "resume", sessionId: string, initiatorWs?: WebSocket): void {
  const session = getSession(sessionId);
  const runner = sessionRunners.get(sessionId);
  if (!session || !runner) return;

  // Resolve which player sent the control message
  let initiator: 1 | 2 | undefined;
  if (initiatorWs) {
    const info = getPlayerInfo(initiatorWs);
    if (info) initiator = info.player as 1 | 2;
  }

  if (action === "pause") {
    // Clear any existing pause timer (shouldn't happen, but safe)
    if (session.pauseTimer) { clearTimeout(session.pauseTimer); session.pauseTimer = null; }

    session.status = "paused";
    session.pauseInitiator = initiator;
    runner.pause();

    // Broadcast pause to both players with 30s countdown
    const COUNTDOWN = 30;
    sendToSession(session, { type: "paused", player: initiator ?? 1, countdown: COUNTDOWN });
    console.log(`[ws] ⏸ Pause by P${initiator} for ${sessionId} — ${COUNTDOWN}s countdown`);

    // Auto-resume after countdown
    session.pauseTimer = setTimeout(() => {
      console.log(`[ws] ⏯ Auto-resume (timeout) for ${sessionId}`);
      session.pauseTimer = null;
      if (session.status === "paused") {
        session.status = "running";
        runner.resume();
        sendToSession(session, { type: "resumed", initiator: 0 });
      }
    }, COUNTDOWN * 1000);
  } else {
    // Resume — clear the timer and notify both players
    if (session.pauseTimer) { clearTimeout(session.pauseTimer); session.pauseTimer = null; }

    if (session.status !== "paused") return; // Already running
    session.status = "running";
    runner.resume();
    sendToSession(session, { type: "resumed", initiator: initiator ?? 0 });
    console.log(`[ws] ▶ Resume by P${initiator} for ${sessionId}`);
  }
}

function handlePing(ws: WebSocket, t: number): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "pong", t }));
  }
}

/** Track sessions currently being stopped to prevent double-cleanup races
 *  (e.g. runner exit + WebSocket close firing simultaneously). */
const stoppingSessions = new Set<string>();

function stopSession(sessionId: string): void {
  // Guard: prevent double-stop races
  if (stoppingSessions.has(sessionId)) {
    console.log(`[ws] stopSession already in progress for ${sessionId} — skipping duplicate`);
    return;
  }
  stoppingSessions.add(sessionId);

  // Clear post-match countdown timer (if any)
  const endTimer = matchEndTimers.get(sessionId);
  if (endTimer) { clearTimeout(endTimer); matchEndTimers.delete(sessionId); }

  const session = getSession(sessionId);
  if (session) {
    // Clear any active pause timer
    if (session.pauseTimer) { clearTimeout(session.pauseTimer); session.pauseTimer = null; }
    // Notify ALL connected players that the session is closing
    sendToSession(session, { type: "session_closed" });
  }

  // ── Flush accumulated stats to Next.js API ──
  const stats = sessionStats.get(sessionId);
  if (stats && stats.matches.length > 0) {
    const apiUrl = process.env.STATS_API_URL || "http://localhost:3000";
    const apiToken = process.env.STATS_API_TOKEN || "dev";
    const payload = {
      sessionId: stats.sessionId, mode: stats.mode, system: stats.system, rom: stats.rom,
      startedAt: stats.startedAt, endedAt: Date.now(),
      rounds: stats.rounds, matches: stats.matches,
    };
    console.log(`[ws] 📊 Flushing stats for ${sessionId}: ${stats.matches.length} matches, ${stats.rounds.length} rounds`);
    fetch(`${apiUrl}/api/stats/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiToken}` },
      body: JSON.stringify(payload),
    }).then(async (res) => {
      if (!res.ok) console.error(`[ws] Stats flush failed: ${res.status} ${await res.text().catch(() => "")}`);
      else console.log(`[ws] ✅ Stats flushed for ${sessionId}`);
    }).catch(async (err) => {
      console.error("[ws] Failed to flush stats:", (err as Error)?.message ?? err);
      // Buffer to local disk for later retry
      try {
        await mkdir(PENDING_STATS_DIR, { recursive: true });
        const fname = `${sessionId}-${Date.now()}.json`;
        await writeFile(join(PENDING_STATS_DIR, fname), JSON.stringify(payload), "utf-8");
        console.log(`[ws] 💾 Stats buffered to disk: ${fname}`);
      } catch (diskErr) {
        console.error("[ws] Failed to buffer stats to disk:", (diskErr as Error)?.message ?? diskErr);
      }
    });
  }
  sessionStats.delete(sessionId);
  matchInputLocked.delete(sessionId);
  matchLoserSide.delete(sessionId);

  // Small delay to ensure the message is flushed before cleanup
  setTimeout(() => {
    const runner = sessionRunners.get(sessionId);
    if (runner) {
      runner.stop();
      sessionRunners.delete(sessionId);
    }
    removeSession(sessionId);
    stoppingSessions.delete(sessionId);
  }, 200);
}

/** P1 requests a rematch — relay to P2. */
function handleRematchRequest(sessionId: string): void {
  const session = getSession(sessionId);
  if (!session) return;
  // Cancel the post-match auto-stop countdown — a rematch is starting
  const timer = matchEndTimers.get(sessionId);
  if (timer) { clearTimeout(timer); matchEndTimers.delete(sessionId); }
  console.log(`[ws] 🔄 Rematch REQUESTED for ${sessionId} — relaying to P2`);
  sendToSession(session, { type: "rematch_requested" });
}

/**
 * A player accepted the rematch. Same-session rematch: unlock input (the game is
 * back at character select, so both players can re-pick their teams) and tell all
 * clients the rematch is starting in place.
 */
async function handleRematchAccept(sessionId: string): Promise<void> {
  const session = getSession(sessionId);
  if (!session) return;
  // The winner stays credited/active after a match; only the loser drops out and
  // must re-join, and the loser can be P1 or P2. Insert one coin for the loser,
  // then press START for the loser only.
  const loser = matchLoserSide.get(sessionId) === 1 ? 1 : 2;
  console.log(`[ws] ✅ Rematch ACCEPTED for ${sessionId} — same session, P${loser} (loser) re-joining`);
  matchInputLocked.delete(sessionId);
  const runner = sessionRunners.get(sessionId);
  if (runner) {
    try {
      // Resume the (paused-on-match-end) emulator and re-arm scoring. beginRematch() awaits
      // pause convergence, so once it resolves the emulator is *confirmed running*.
      await runner.beginRematch();
      // Bring the loser back from the arcade CONTINUE screen. The win animation replays for a
      // few seconds after resume before CONTINUE appears, so the coin/START must be paced
      // across the whole ~10s continue window — continueLoser() does that and stops on the
      // return to char-select. Fire-and-forget so we don't block clients for the window.
      void runner.continueLoser(loser);
    } catch { /* ok */ }
  }
  sendToSession(session, { type: "rematch_starting" });

  // For SNES: unlock input after the continue screen (~12s) so players
  // can select characters naturally (RAM detection at 0x1C07/0x1C08 picks up IDs)
  if (session.system === "snes") {
    setTimeout(() => {
      if (session.status === "running") {
        console.log(`[ws] 🎯 Rematch — unlocking input for ${sessionId}`);
        session.inputLocked = false;
      }
    }, 12000);
  }
}

/** P2 declined the rematch — relay to P1. */
function handleRematchDecline(sessionId: string): void {
  const session = getSession(sessionId);
  if (!session) return;
  console.log(`[ws] ❌ Rematch DECLINED for ${sessionId}`);
  sendToSession(session, { type: "rematch_declined" });
}

/**
 * Auto-rematch for multi-match modes (XL/Fighter). Same as handleRematchAccept but
 * sends `auto_rematch` instead of `rematch_starting` so clients skip the stats overlay
 * and roll directly into the next match. Called by either client after match_end when
 * the series isn't over yet. matchNumber = the NEXT match (1-based), totalMatches = the
 * full series length (3 or 5).
 */
async function handleAutoRematch(sessionId: string, matchNumber: number, totalMatches: number): Promise<void> {
  const session = getSession(sessionId);
  if (!session) return;
  // Guard: only allow auto-rematch when the match is over (input locked). Prevents
  // a rogue client from restarting mid-match.
  if (!matchInputLocked.has(sessionId)) {
    console.log(`[ws] ⚠️ Auto-rematch ignored for ${sessionId} — match is still in progress`);
    return;
  }
  const loser = matchLoserSide.get(sessionId) === 1 ? 1 : 2;
  console.log(`[ws] 🔄 Auto-rematch for ${sessionId} — match ${matchNumber}/${totalMatches}, P${loser} (loser) re-joining`);
  matchInputLocked.delete(sessionId);
  const runner = sessionRunners.get(sessionId);
  if (runner) {
    try {
      await runner.beginRematch();
      void runner.continueLoser(loser);
    } catch { /* ok */ }
  }
  sendToSession(session, { type: "auto_rematch", matchNumber, totalMatches });

  // For SNES: unlock input after the continue screen (~12s)
  if (session.system === "snes") {
    setTimeout(() => {
      if (session.status === "running") {
        session.inputLocked = false;
      }
    }, 12000);
  }
}

// ── Dual-client ready guard ─────────────────────────────────────────────

/**
 * Start the PvP auto-coin/START sequence after both clients have signalled
 * they are ready. This is the code that was previously executed immediately
 * after the "ready" message; now it only runs once both sides ack.
 */
function startGameAutoSequence(
  session: Session,
  runner: GameRunner,
  system: string,
  rom: string,
  sessionId: string,
): void {
  // Guard: prevent double-execution when checkBothClientsReady fires more
  // than once (e.g. reconnection, race between client-ready and timer).
  if ((session as any)._autoSequenceStarted) return;
  (session as any)._autoSequenceStarted = true;

  const startButton = system === "snes" ? 3 : system === "ps1" ? 9 : 5;
  const coinButton = system === "snes" ? null : system === "ps1" ? 8 : 4;
  const coinDelay = system === "snes" ? 0 : 15000;
  const startDelay = system === "snes" ? 18000 : 20000;
  const needCoins = coinButton != null;

  console.log(`[ws] 🚀 Starting PvP auto-sequence for session ${sessionId}`);

  // Lock player input during auto-start sequence
  session.inputLocked = true;

  if (needCoins) {
    // Insert 2 coins via P1 (Neo Geo / PS1)
    setTimeout(() => {
      if (session.status !== "running") return;
      console.log(`[ws] 🪙 Inserting coins via P1 for session ${sessionId}`);
      runner.ensureFocus();
      runner.injectInput(1, coinButton!, true);
      setTimeout(() => { runner.injectInput(1, coinButton!, false); }, 200);
      setTimeout(() => { runner.injectInput(1, coinButton!, true); }, 400);
      setTimeout(() => {
        runner.injectInput(1, coinButton!, false);
        console.log(`[ws] ✅ 2 coins inserted for session ${sessionId}`);
      }, 600);
    }, coinDelay);
  }

  // Start game for both players
  setTimeout(() => {
    if (session.status !== "running") return;
    console.log(`[ws] ▶️  Starting game for P1+P2 in session ${sessionId} (system=${system}, startBtn=${startButton})`);
    runner.ensureFocus();
    runner.injectInput(1, startButton, true);
    setTimeout(() => { runner.injectInput(2, startButton, true); }, 100);
    setTimeout(() => {
      runner.injectInput(1, startButton, false);
      runner.injectInput(2, startButton, false);
      console.log(`[ws] ✅ Auto-start complete for session ${sessionId}`);

      // For non-SNES systems (NeoGeo/PS1): game is now at char select /
      // attract mode — unlock player input immediately.
      // For SNES: input stays locked during the menu nav sequence below;
      // startCharSelectPhase will unlock it when char select begins.
      if (system !== "snes") {
        session.inputLocked = false;
      }

      // ── SNES menu navigation (SFA2) ──
      if (system === "snes") {
        const confirmBtn = 8;     // SNES A (SFA2: confirm/advance, keyboard 'x')
        const downBtn = 5;     // SNES DOWN
        const HOLD_MS = 300;
        const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

        const tap = (player: number, btn: number, holdMs = HOLD_MS) => {
          runner.ensureFocus();
          runner.injectInput(player, btn, true);
          setTimeout(() => runner.injectInput(player, btn, false), holdMs);
        };

        // ── START spam DISABLED: pressing START during intros can PAUSE the
        //     game on SNES instead of skipping them. Let the intro play out;
        //     Timer-based detection spots combat start (99→decrement).
        //     No button presses needed for intro skip.
        // const startPhases = [1500, 3500, 5500, 7500, 9500];
        // for (const delay of startPhases) { ... }

        // Text detector always runs — auto-resumes health analysis on FIGHT! detection.
        const navDelay = 6000;
        setTimeout(async () => {
          if (session.status !== "running") return;

          if (session.mode === "pvp") {
            // Manual verification: 2×START, DOWN, START to reach VS MODE char select
            // START #2: title screen → main menu (cursor on ARCADE)
            console.log(`[ws] 🎮 SNES PvP: START #2 → main menu for ${sessionId}`);
            tap(1, startButton, 150);
            await sleep(1500);

            console.log(`[ws] 🎮 SNES PvP: DOWN → select VS MODE for ${sessionId}`);
            tap(1, downBtn, 250);
            await sleep(800);

            console.log(`[ws] 🎮 SNES PvP: START #3 → confirm VS MODE for ${sessionId}`);
            tap(1, startButton, 200);
            await sleep(3000);

            if (session.status !== "running") return;
            // Unlock input so players can select characters naturally
            session.inputLocked = false;
            console.log(`[ws] 🎮 SNES PvP: input unlocked for char select (${sessionId})`);
            await sleep(1500);
            if (session.status !== "running") return;
            console.log(`[ws] 🎮 SNES: START → begin match for ${sessionId}`);
            tap(1, startButton);
            await sleep(200);
            tap(2, startButton);
            // Auto-sequence done, unlock player input
            session.inputLocked = false;
          }
        }, navDelay);

        const rdDelay = navDelay + 14000;
        setTimeout(() => {
          if (session.status === "running") {
            console.log(`[ws] 🧠 Starting round detection for ${system} session ${sessionId}`);
            runner.startMemoryWatcher();
          }
        }, rdDelay);
      } else {
        setTimeout(() => {
          if (session.status === "running") {
            console.log(`[ws] 🧠 Starting round detection for session ${sessionId}`);
            runner.startMemoryWatcher();
          }
        }, 5000);
      }
    }, 300);
  }, startDelay);
}

/** Handle a client_ready message: mark the player as ready and check if both are. */
function handleClientReady(sessionId: string, ws: WebSocket): void {
  const info = getPlayerInfo(ws);
  if (!info) return;
  const session = getSession(sessionId);
  if (!session) return;

  if (info.player === 1) {
    session.p1ClientReady = true;
  } else if (info.player === 2) {
    session.p2ClientReady = true;
  }
  console.log(`[ws] ✅ P${info.player} client_ready for session ${sessionId}`);

  const runner = sessionRunners.get(sessionId);
  if (!runner) return;

  checkBothClientsReady(session, runner, session.system, session.rom, sessionId);
}

/** If both clients are ready, cancel the 10s timeout and start the game. */
function checkBothClientsReady(
  session: Session,
  runner: GameRunner,
  system: string,
  rom: string,
  sessionId: string,
): void {
  if (session.p1ClientReady && session.p2ClientReady) {
    if (session.clientReadyTimer) {
      clearTimeout(session.clientReadyTimer);
      session.clientReadyTimer = null;
    }
    console.log(`[ws] ✅ Both clients ready for session ${sessionId} — starting auto-sequence`);
    startGameAutoSequence(session, runner, system, rom, sessionId);
  }
}
