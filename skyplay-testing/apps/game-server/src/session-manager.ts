import type { ServerMessage } from "./types.js";
import type { PortraitGridResult } from "./pixel/portrait-detector.js";
import { WebSocket } from "ws";

export interface PlayerConnection {
  ws: WebSocket;
  player: 1 | 2;
  joinedAt: number;
}

export interface Session {
  id: string;
  connections: PlayerConnection[];
  system: string;
  rom: string;
  /** "cpu" = play page (P1 vs CPU), "pvp" = duel (P1 vs P2). */
  mode: "cpu" | "pvp";
  videoWidth?: number;
  videoHeight?: number;
  status: "reserved" | "init" | "loading" | "running" | "paused" | "stopped";
  createdAt: number;
  frameCount: number;
  fps: number;
  /** setTimeout handle for idle timeout */
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** setTimeout handle for pause auto-resume (30s countdown). */
  pauseTimer?: ReturnType<typeof setTimeout> | null;
  /** Which player initiated the pause (1 or 2). */
  pauseInitiator?: 1 | 2;
  /** Cached codec config descriptors so late-joining P2 can get them. */
  codecVideoDesc?: Uint8Array;
  codecAudioDesc?: Uint8Array;
  /** Whether the game is currently at the character select screen. */
  charSelectActive: boolean;
  /** Cursor positions during character select (row, col in the grid). */
  p1CursorRow: number;
  p1CursorCol: number;
  p2CursorRow: number;
  p2CursorCol: number;
  /** Whether each player has locked in their character selection. */
  p1CharLocked: boolean;
  p2CharLocked: boolean;
  /** The character each player selected (ID + display name). */
  p1SelectedCharId: number;
  p2SelectedCharId: number;
  p1SelectedCharName: string;
  p2SelectedCharName: string;
  /** Timer handle for character select timeout (auto-locks after N seconds). */
  charSelectTimer: ReturnType<typeof setTimeout> | null;
  /** Dual-client ready guard: whether P1 has sent client_ready. */
  p1ClientReady: boolean;
  /** Dual-client ready guard: whether P2 has sent client_ready. */
  p2ClientReady: boolean;
  /** Timer handle for the 10s dual-client ready guard. */
  clientReadyTimer: ReturnType<typeof setTimeout> | null;
  /** Portrait grid detection result from the character select screen (diagnostic only). */
  portraitResults?: PortraitGridResult;
}

const sessions = new Map<string, Session>();
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** Reverse lookup: WebSocket → { sessionId, player } for input routing. */
const wsToPlayer = new Map<WebSocket, { sessionId: string; player: number }>();

export function createSession(
  id: string,
  system: string,
  rom: string,
  mode: "cpu" | "pvp" = "cpu",
): Session {
  const session: Session = {
    id,
    connections: [],
    system,
    rom,
    mode,
    status: "init",
    createdAt: Date.now(),
    frameCount: 0,
    fps: 0,
    idleTimer: null,
    charSelectActive: false,
    p1CursorRow: 0,
    p1CursorCol: 0,
    p2CursorRow: 0,
    p2CursorCol: 0,
    p1CharLocked: false,
    p2CharLocked: false,
    p1SelectedCharId: -1,
    p2SelectedCharId: -1,
    p1SelectedCharName: "",
    p2SelectedCharName: "",
    charSelectTimer: null,
    p1ClientReady: false,
    p2ClientReady: false,
    clientReadyTimer: null,
  };
  sessions.set(id, session);
  console.log(`[session] Created session ${id} (${system} / ${rom}), total: ${sessions.size}`);
  return session;
}

export function addConnection(
  sessionId: string,
  ws: WebSocket,
  player: 1 | 2,
): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  // ── Cross-session dedup: one WebSocket → one session at a time ──
  // If this WS is already registered in ANOTHER session, eject it from
  // that session first. Otherwise a single player can be in two sessions
  // simultaneously (e.g. a stale session + a new one).
  const oldInfo = wsToPlayer.get(ws);
  if (oldInfo && oldInfo.sessionId !== sessionId) {
    const oldSession = sessions.get(oldInfo.sessionId);
    if (oldSession) {
      const idx = oldSession.connections.findIndex((c) => c.ws === ws);
      if (idx !== -1) oldSession.connections.splice(idx, 1);
      console.log(`[session] Ejected P${oldInfo.player} from stale session ${oldInfo.sessionId}`);
    }
  }

  // Prevent duplicate player connections — replace if same player reconnects
  const existingIdx = session.connections.findIndex((c) => c.player === player);
  if (existingIdx !== -1) {
    const old = session.connections[existingIdx];
    wsToPlayer.delete(old.ws);
    try { old.ws.close(1000, "Replaced by new connection"); } catch { /* ok */ }
    session.connections.splice(existingIdx, 1);
    console.log(`[session] Replaced P${player} connection in ${sessionId}`);
  }
  session.connections.push({ ws, player, joinedAt: Date.now() });
  wsToPlayer.set(ws, { sessionId, player });
  resetIdleTimer(session);
  console.log(`[session] Added P${player} to ${sessionId}, connections: ${session.connections.length}`);
}

export function removeConnection(
  sessionId: string,
  player: number,
): PlayerConnection | undefined {
  const session = sessions.get(sessionId);
  if (!session) return undefined;
  const idx = session.connections.findIndex((c) => c.player === player);
  if (idx === -1) return undefined;
  const conn = session.connections[idx];
  wsToPlayer.delete(conn.ws);
  session.connections.splice(idx, 1);
  console.log(`[session] Removed P${player} from ${sessionId}, remaining: ${session.connections.length}`);
  return conn;
}

/** Get which session+player a WebSocket belongs to. */
export function getPlayerInfo(ws: WebSocket): { sessionId: string; player: number } | undefined {
  return wsToPlayer.get(ws);
}

/** Check if a player slot is taken. */
export function hasConnection(sessionId: string, player: 1 | 2): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  return session.connections.some((c) => c.player === player && c.ws.readyState === WebSocket.OPEN);
}

/** Check if any WS connection is still open. */
export function hasActiveConnections(session: Session): boolean {
  return session.connections.some((c) => c.ws.readyState === WebSocket.OPEN);
}

export function getConnections(sessionId: string): PlayerConnection[] {
  return sessions.get(sessionId)?.connections ?? [];
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export function removeSession(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  if (session.idleTimer) {
    clearTimeout(session.idleTimer);
  }
  if (session.clientReadyTimer) {
    clearTimeout(session.clientReadyTimer);
  }
  if (session.charSelectTimer) {
    clearTimeout(session.charSelectTimer);
  }
  // Close all remaining connections
  for (const conn of session.connections) {
    wsToPlayer.delete(conn.ws);
    try { conn.ws.close(1000, "Session ended"); } catch { /* ok */ }
  }
  session.connections = [];
  sessions.delete(id);
  console.log(`[session] Removed session ${id}, remaining: ${sessions.size}`);
}

export function getAllSessions(): Session[] {
  return [...sessions.values()];
}

export function getSessionCount(): number {
  return sessions.size;
}

export function resetIdleTimer(session: Session): void {
  if (session.idleTimer) {
    clearTimeout(session.idleTimer);
  }
  session.idleTimer = setTimeout(() => {
    console.log(`[session] Session ${session.id} idle timeout — stopping`);
    session.status = "stopped";
    // Close all connections
    for (const conn of session.connections) {
      wsToPlayer.delete(conn.ws);
      try { conn.ws.close(1000, "Idle timeout"); } catch { /* ok */ }
    }
    session.connections = [];
    removeSession(session.id);
  }, IDLE_TIMEOUT_MS);
}

/** Broadcast a JSON message to all connections in a session. */
export function sendToSession(session: Session, msg: ServerMessage): void {
  const data = JSON.stringify(msg);
  for (const conn of session.connections) {
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(data);
    }
  }
}

/** Broadcast binary data to all connections in a session. */
export function sendBinaryToSession(session: Session, data: Buffer): void {
  for (const conn of session.connections) {
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(data);
    }
  }
}

/** Send binary data to a specific connection. */
export function sendBinaryToConnection(conn: PlayerConnection, data: Buffer): void {
  if (conn.ws.readyState === WebSocket.OPEN) {
    conn.ws.send(data);
  }
}
