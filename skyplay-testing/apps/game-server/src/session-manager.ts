import type { ServerMessage } from "./types.js";
import { WebSocket } from "ws";

export interface PlayerConnection {
  ws: WebSocket;
  player: 1 | 2;
  joinedAt: number;
}

export interface SpectatorConnection {
  ws: WebSocket;
  userId: string;
  username: string;
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
  /** Dual-client ready guard: whether P1 has sent client_ready. */
  p1ClientReady: boolean;
  /** Dual-client ready guard: whether P2 has sent client_ready. */
  p2ClientReady: boolean;
  /** Timer handle for the 10s dual-client ready guard. */
  clientReadyTimer: ReturnType<typeof setTimeout> | null;
  /** Whether player input is locked (during auto-start sequence). */
  inputLocked: boolean;
  /** Timer handle for pre-match disconnect grace period (10s). */
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  /** Spectators watching the session (read-only, no input allowed). */
  spectators: SpectatorConnection[];
}

const sessions = new Map<string, Session>();
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** Reverse lookup: WebSocket → { sessionId, player } for input routing. */
const wsToPlayer = new Map<WebSocket, { sessionId: string; player: number }>();

/** Reverse lookup: WebSocket → { sessionId, userId } for spectator tracking. */
const wsToSpectator = new Map<WebSocket, { sessionId: string; userId: string }>();

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
    p1ClientReady: false,
    p2ClientReady: false,
    clientReadyTimer: null,
    inputLocked: false,
    disconnectTimer: null,
    spectators: [],
  };
  sessions.set(id, session);
  console.log(`[session] Created session ${id} (${system} / ${rom}), total: ${sessions.size}`);
  return session;
}

export function clearDisconnectTimer(session: Session): void {
  if (session.disconnectTimer) {
    clearTimeout(session.disconnectTimer);
    session.disconnectTimer = null;
  }
}

export function startDisconnectTimer(session: Session, callback: () => void, ms = 10_000): void {
  clearDisconnectTimer(session);
  session.disconnectTimer = setTimeout(() => {
    session.disconnectTimer = null;
    callback();
  }, ms);
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
  // Cancel any pending disconnect timer — the player reconnected
  clearDisconnectTimer(session);
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

/** Get which session+userId a spectator WebSocket belongs to. */
export function getSpectatorInfo(ws: WebSocket): { sessionId: string; userId: string } | undefined {
  return wsToSpectator.get(ws);
}

// ── Spectator management ──────────────────────────────────────────────

export function addSpectator(
  sessionId: string,
  ws: WebSocket,
  userId: string,
  username: string,
): void {
  const session = sessions.get(sessionId);
  if (!session) {
    console.warn(`[session] addSpectator: session ${sessionId} not found`);
    return;
  }

  // Cross-session dedup: remove this WS from any other session's spectator list
  const oldInfo = wsToSpectator.get(ws);
  if (oldInfo && oldInfo.sessionId !== sessionId) {
    const oldSession = sessions.get(oldInfo.sessionId);
    if (oldSession) {
      const idx = oldSession.spectators.findIndex((s) => s.ws === ws);
      if (idx !== -1) oldSession.spectators.splice(idx, 1);
    }
  }

  // Don't add as spectator if already a player in this session
  const playerInfo = wsToPlayer.get(ws);
  if (playerInfo && playerInfo.sessionId === sessionId) {
    console.warn(`[session] addSpectator: WS is already P${playerInfo.player} in ${sessionId} — not adding as spectator`);
    return;
  }

  // Prevent duplicate spectator connections from same WS
  const existingIdx = session.spectators.findIndex((s) => s.ws === ws);
  if (existingIdx !== -1) {
    session.spectators.splice(existingIdx, 1);
  }

  session.spectators.push({ ws, userId, username, joinedAt: Date.now() });
  wsToSpectator.set(ws, { sessionId, userId });
  resetIdleTimer(session);
  console.log(`[session] Added spectator ${username} (${userId}) to ${sessionId}, spectators: ${session.spectators.length}`);
}

export function removeSpectator(
  sessionId: string,
  ws: WebSocket,
): SpectatorConnection | undefined {
  const session = sessions.get(sessionId);
  if (!session) return undefined;
  const idx = session.spectators.findIndex((s) => s.ws === ws);
  if (idx === -1) return undefined;
  const spec = session.spectators[idx];
  wsToSpectator.delete(spec.ws);
  session.spectators.splice(idx, 1);
  console.log(`[session] Removed spectator from ${sessionId}, remaining: ${session.spectators.length}`);
  return spec;
}

export function getSpectatorCount(sessionId: string): number {
  return sessions.get(sessionId)?.spectators.length ?? 0;
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
  if (session.disconnectTimer) {
    clearTimeout(session.disconnectTimer);
  }
  // Close all remaining connections
  for (const conn of session.connections) {
    wsToPlayer.delete(conn.ws);
    try { conn.ws.close(1000, "Session ended"); } catch { /* ok */ }
  }
  session.connections = [];
  // Close all spectator connections
  for (const spec of session.spectators) {
    wsToSpectator.delete(spec.ws);
    try { spec.ws.close(1000, "Session ended"); } catch { /* ok */ }
  }
  session.spectators = [];
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
    for (const spec of session.spectators) {
      wsToSpectator.delete(spec.ws);
      try { spec.ws.close(1000, "Idle timeout"); } catch { /* ok */ }
    }
    session.spectators = [];
    removeSession(session.id);
  }, IDLE_TIMEOUT_MS);
}

/** Broadcast a JSON message to all connections AND spectators in a session. */
export function sendToSession(session: Session, msg: ServerMessage): void {
  const data = JSON.stringify(msg);
  for (const conn of session.connections) {
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(data);
    }
  }
  for (const spec of session.spectators) {
    if (spec.ws.readyState === WebSocket.OPEN) {
      spec.ws.send(data);
    }
  }
}

/** Broadcast binary data to all connections AND spectators in a session. */
export function sendBinaryToSession(session: Session, data: Buffer): void {
  for (const conn of session.connections) {
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(data);
    }
  }
  for (const spec of session.spectators) {
    if (spec.ws.readyState === WebSocket.OPEN) {
      spec.ws.send(data);
    }
  }
}

/** Send binary data to a spectator connection. */
export function sendBinaryToSpectator(spec: SpectatorConnection, data: Buffer): void {
  if (spec.ws.readyState === WebSocket.OPEN) {
    spec.ws.send(data);
  }
}

/** Send binary data to a specific connection. */
export function sendBinaryToConnection(conn: PlayerConnection, data: Buffer): void {
  if (conn.ws.readyState === WebSocket.OPEN) {
    conn.ws.send(data);
  }
}
