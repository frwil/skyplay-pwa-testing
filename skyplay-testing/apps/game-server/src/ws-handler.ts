import { WebSocket } from "ws";
import {
  createSession, addConnection, removeConnection, getSession,
  sendToSession, sendBinaryToSession, sendBinaryToConnection, resetIdleTimer, removeSession,
  getPlayerInfo, hasActiveConnections, getConnections,
} from "./session-manager.js";
import { GameRunner } from "./game-runner.js";
import type { ClientMessage } from "./types.js";
import { FRAME_MAGIC, AUDIO_MAGIC, CODEC_CONFIG_MAGIC } from "./types.js";

/** Map sessionId → GameRunner for lifecycle management. */
const sessionRunners = new Map<string, GameRunner>();

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
      handleInit(ws, msg, sessionId);
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
      handleControl(msg.type, sessionId);
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
      handleRematchAccept(sessionId, msg as { type: "rematch_accept"; newSessionId: string; newWsUrl: string; newRoomCode: string });
      break;

    case "rematch_decline":
      logMsg("rematch_decline");
      handleRematchDecline(sessionId);
      break;

    case "stop_duel":
      logMsg("stop_duel");
      stopSession(sessionId);
      break;

    case "ping":
      // Too frequent to log
      handlePing(ws, msg.t);
      break;

    default:
      console.warn(`[ws] Unknown message type from ${sessionId}:`, (msg as { type: string }).type);
  }
}

function handleInit(
  ws: WebSocket,
  msg: { type: "init"; sessionId: string; token: string; system: string; rom: string },
  sessionId: string,
): void {
  const { system, rom } = msg;

  // Validate token
  const expectedToken = process.env.SESSION_TOKEN_SECRET;
  if (expectedToken && msg.token !== expectedToken) {
    ws.send(JSON.stringify({ type: "error", message: "Invalid session token" }));
    ws.close(4001, "Unauthorized");
    return;
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
    session = createSession(msg.sessionId, system, rom);
    session.status = "loading";
  }

  addConnection(msg.sessionId, ws, 1);

  // Start game runner
  const runner = new GameRunner(system, rom, msg.sessionId);
  sessionRunners.set(msg.sessionId, runner);

  // ── Video frame (H.264 NAL unit) ──
  // Header: magic(1) + width(u16) + height(u16) + frameId(u32) + nalLength(u32) = 13 bytes
  runner.on("frame", (nalUnit: Buffer, width: number, height: number) => {
    session.frameCount++;
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

  // ── Audio frame (raw Opus packet — already extracted from Ogg by GameRunner) ──
  runner.on("audio", (opusData: Buffer) => {
    if (!opusData || opusData.length === 0) return;

    const header = Buffer.alloc(5);
    header.writeUInt8(AUDIO_MAGIC, 0);
    header.writeUInt32LE(opusData.length, 1);

    try {
      sendBinaryToSession(session, Buffer.concat([header, opusData]));
    } catch {
      // ok
    }
  });

  // ── Codec configuration (H.264 + Opus descriptors) ──
  runner.on("codecConfig", (videoDesc: Uint8Array, audioDesc: Uint8Array) => {
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
  });

  // ── Round win/loss detection (memory watcher) ──
  runner.on("roundResult", (data: { loser: number; winner: number; p1Losses: number; p2Losses: number }) => {
    console.log(`[ws] 🏆 Round result: P${data.winner} wins round! Score: P1=${data.p1Losses} P2=${data.p2Losses}`);
    sendToSession(session, {
      type: "round_result",
      loser: data.loser,
      winner: data.winner,
      p1Losses: data.p1Losses,
      p2Losses: data.p2Losses,
    });
  });

  runner.on("matchEnd", (data: { winner: number; loser: number; p1Losses: number; p2Losses: number }) => {
    console.log(`[ws] 🏁 MATCH OVER! P${data.winner} wins! Score: P1=${data.p1Losses} P2=${data.p2Losses}`);
    sendToSession(session, {
      type: "match_end",
      winner: data.winner,
      loser: data.loser,
      p1Losses: data.p1Losses,
      p2Losses: data.p2Losses,
    });
    // Game continues indefinitely — no auto-stop. Players use "stop_duel" to end.
  });

  // Start the game
  runner.start().then(({ width, height }) => {
    session.videoWidth = width;
    session.videoHeight = height;
    session.status = "running";
    sendToSession(session, { type: "ready", width, height });

    // ── Auto coin + start for both players (skip title screen) ──
    // Insert 2 coins via P1 at 15s after launch (sequential, no overlap)
    setTimeout(() => {
      if (session.status !== "running") return;
      console.log(`[ws] 🪙 Inserting coins via P1 for session ${msg.sessionId}`);
      runner.ensureFocus();
      // Coin 1: DOWN → UP
      runner.injectInput(1, 4, true);
      setTimeout(() => { runner.injectInput(1, 4, false); }, 200);
      // Coin 2: DOWN → UP
      setTimeout(() => { runner.injectInput(1, 4, true); }, 400);
      setTimeout(() => {
        runner.injectInput(1, 4, false);
        console.log(`[ws] ✅ 2 coins inserted for session ${msg.sessionId}`);
      }, 600);
    }, 15000);

    // Start game for both players 5s after coins (20s total)
    setTimeout(() => {
      if (session.status !== "running") return;
      console.log(`[ws] ▶️  Starting game for P1+P2 in session ${msg.sessionId}`);
      runner.ensureFocus();
      runner.injectInput(1, 5, true);
      setTimeout(() => { runner.injectInput(2, 5, true); }, 100);
      setTimeout(() => {
        runner.injectInput(1, 5, false);
        runner.injectInput(2, 5, false);
        console.log(`[ws] ✅ Auto-start complete for session ${msg.sessionId}`);
        // Start memory watcher 5s after game starts (give time for character select)
        setTimeout(() => {
          if (session.status === "running") {
            console.log(`[ws] 🧠 Starting round detection for session ${msg.sessionId}`);
            runner.startMemoryWatcher();
          }
        }, 5000);
      }, 300);
    }, 20000);

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
  // Validate token
  const expectedToken = process.env.SESSION_TOKEN_SECRET;
  if (expectedToken && msg.token !== expectedToken) {
    ws.send(JSON.stringify({ type: "error", message: "Invalid session token" }));
    ws.close(4001, "Unauthorized");
    return;
  }

  let session = getSession(msg.sessionId);
  if (!session) {
    // P2 joined before P1 — reserve the session and wait for P1's init
    console.log(`[ws] P2 joined before P1 — reserving session ${msg.sessionId}`);
    session = createSession(msg.sessionId, "pending", "pending");
    session.status = "reserved";
  }

  // Add P2 connection
  addConnection(msg.sessionId, ws, 2);

  if (session.status === "reserved") {
    // P1 hasn't connected yet — tell P2 to wait
    console.log(`[ws] P2 waiting for P1 to start session ${msg.sessionId}`);
    ws.send(JSON.stringify({ type: "waiting", message: "Waiting for host to start the game..." }));
    return;
  }

  // Session is already running (P1 connected first) — normal flow
  // Notify P1 that P2 joined
  sendToSession(session, { type: "player_joined", player: 2 });

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
  // 🔍 DEBUG: Log every input message
  console.log(`[ws] 🎮 INPUT P${msg.player} btn=${msg.button} ${msg.pressed ? "DOWN" : "UP"}`);

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

  // Pass the declared player number (from client) to injectInput
  console.log(`[ws] ✅ Routing P${msg.player} input to session ${info.sessionId} runner`);
  runner.injectInput(msg.player, msg.button, msg.pressed);
}

function handleControl(action: "pause" | "resume", sessionId: string): void {
  const session = getSession(sessionId);
  const runner = sessionRunners.get(sessionId);
  if (!session || !runner) return;

  if (action === "pause") {
    session.status = "paused";
    runner.pause();
  } else {
    session.status = "running";
    runner.resume();
  }
}

function handlePing(ws: WebSocket, t: number): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "pong", t }));
  }
}

function stopSession(sessionId: string): void {
  const session = getSession(sessionId);
  if (session) {
    // Notify ALL connected players that the session is closing
    sendToSession(session, { type: "session_closed" });
  }

  // Small delay to ensure the message is flushed before cleanup
  setTimeout(() => {
    const runner = sessionRunners.get(sessionId);
    if (runner) {
      runner.stop();
      sessionRunners.delete(sessionId);
    }
    removeSession(sessionId);
  }, 200);
}

/** P1 requests a rematch — relay to P2. */
function handleRematchRequest(sessionId: string): void {
  const session = getSession(sessionId);
  if (!session) return;
  console.log(`[ws] 🔄 Rematch REQUESTED for ${sessionId} — relaying to P2`);
  sendToSession(session, { type: "rematch_requested" });
}

/** P2 accepted the rematch — broadcast new session info to ALL players. */
function handleRematchAccept(
  sessionId: string,
  msg: { type: "rematch_accept"; newSessionId: string; newWsUrl: string; newRoomCode: string },
): void {
  const session = getSession(sessionId);
  if (!session) return;
  console.log(`[ws] ✅ Rematch ACCEPTED for ${sessionId} — new session: ${msg.newSessionId}`);
  sendToSession(session, {
    type: "rematch_accepted",
    newSessionId: msg.newSessionId,
    newWsUrl: msg.newWsUrl,
    newRoomCode: msg.newRoomCode,
  });
}

/** P2 declined the rematch — relay to P1. */
function handleRematchDecline(sessionId: string): void {
  const session = getSession(sessionId);
  if (!session) return;
  console.log(`[ws] ❌ Rematch DECLINED for ${sessionId}`);
  sendToSession(session, { type: "rematch_declined" });
}
