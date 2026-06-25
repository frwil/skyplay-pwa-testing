import type { WebSocket } from "ws";
import { createSession, getSession, removeSession, sendToSession, sendBinaryToSession, resetIdleTimer } from "./session-manager.js";
import { GameRunner } from "./game-runner.js";
import type { ClientMessage, FrameHeader } from "./types.js";
import { FRAME_MAGIC, AUDIO_MAGIC } from "./types.js";

const sessionRunners = new Map<string, GameRunner>();

export function handleConnection(ws: WebSocket, sessionId: string): void {
  console.log(`[ws] New connection: ${sessionId}`);

  ws.on("message", (raw: Buffer) => {
    try {
      // Check if it's a text message (JSON) or binary
      if (typeof raw === "string" || raw[0] === 0x7b) {
        // JSON text message
        const text = typeof raw === "string" ? raw : raw.toString();
        const msg: ClientMessage = JSON.parse(text);
        handleMessage(ws, msg, sessionId);
      }
      // Binary messages from client are not expected for now
    } catch (err) {
      console.error(`[ws] Failed to parse message:`, err);
    }
  });

  ws.on("close", (code, reason) => {
    console.log(`[ws] Connection closed: ${sessionId} (${code}: ${reason})`);
    stopSession(sessionId);
  });

  ws.on("error", (err) => {
    console.error(`[ws] WebSocket error for ${sessionId}:`, err);
    stopSession(sessionId);
  });
}

function handleMessage(ws: WebSocket, msg: ClientMessage, sessionId: string): void {
  switch (msg.type) {
    case "init":
      handleInit(ws, msg);
      break;

    case "input":
      handleInput(msg);
      break;

    case "pause":
    case "resume":
      handleControl(msg.type, sessionId);
      break;

    case "stop":
      stopSession(sessionId);
      break;

    case "ping":
      handlePing(ws, msg.t);
      break;

    default:
      console.warn(`[ws] Unknown message type from ${sessionId}:`, (msg as { type: string }).type);
  }
}

function handleInit(ws: WebSocket, msg: { type: "init"; sessionId: string; token: string; system: string; rom: string }): void {
  const { system, rom } = msg;

  // Validate token (simple check — in production, verify JWT)
  const expectedToken = process.env.SESSION_TOKEN_SECRET;
  if (expectedToken && msg.token !== expectedToken) {
    ws.send(JSON.stringify({ type: "error", message: "Invalid session token" }));
    ws.close(4001, "Unauthorized");
    return;
  }

  // Create session
  const session = createSession(msg.sessionId, ws, system, rom);
  session.status = "loading";

  // Start game runner
  const runner = new GameRunner(system, rom, msg.sessionId);
  sessionRunners.set(msg.sessionId, runner);

  runner.on("frame", (jpegData: Buffer, width: number, height: number) => {
    session.frameCount++;
    if (!jpegData || jpegData.length === 0) return;

    // Build binary frame message
    const header = Buffer.alloc(9);
    header.writeUInt8(FRAME_MAGIC, 0);        // magic
    header.writeUInt16LE(width, 1);            // width
    header.writeUInt16LE(height, 3);           // height
    header.writeUInt32LE(session.frameCount, 5); // frameId

    try {
      sendBinaryToSession(session, Buffer.concat([header, jpegData]));
    } catch {
      // WebSocket may be closed
    }
  });

  runner.on("error", (err: Error) => {
    console.error(`[ws] Game runner error for ${msg.sessionId}:`, err);
    sendToSession(session, { type: "error", message: err.message });
  });

  runner.on("exit", (code: number | null) => {
    console.log(`[ws] Game runner exited for ${msg.sessionId} (code ${code})`);
    // Don't stop — let the user reconnect or close naturally
  });

  // Start the game
  runner.start().then(({ width, height }) => {
    session.status = "running";
    sendToSession(session, { type: "ready", width, height });

    // Start FPS counter
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

function handleInput(msg: { player: number; button: number; pressed: boolean }): void {
  // Input messages don't have sessionId directly — find the runner
  // For now, apply to all runners (in future, track which session the ws belongs to)
  for (const runner of sessionRunners.values()) {
    runner.injectInput(msg.button, msg.pressed);
  }
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
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: "pong", t }));
  }
}

function stopSession(sessionId: string): void {
  const runner = sessionRunners.get(sessionId);
  if (runner) {
    runner.stop();
    sessionRunners.delete(sessionId);
  }
  removeSession(sessionId);
}
