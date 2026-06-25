import type { ServerMessage } from "./types.js";
import type { WebSocket } from "ws";

export interface Session {
  id: string;
  ws: WebSocket;
  system: string;
  rom: string;
  status: "init" | "loading" | "running" | "paused" | "stopped";
  createdAt: number;
  frameCount: number;
  fps: number;
  /** setTimeout handle for idle timeout */
  idleTimer: ReturnType<typeof setTimeout> | null;
}

const sessions = new Map<string, Session>();
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export function createSession(
  id: string,
  ws: WebSocket,
  system: string,
  rom: string,
): Session {
  const session: Session = {
    id,
    ws,
    system,
    rom,
    status: "init",
    createdAt: Date.now(),
    frameCount: 0,
    fps: 0,
    idleTimer: null,
  };
  sessions.set(id, session);
  resetIdleTimer(session);
  console.log(`[session] Created session ${id} (${system} / ${rom}), total: ${sessions.size}`);
  return session;
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export function removeSession(id: string): void {
  const session = sessions.get(id);
  if (session?.idleTimer) {
    clearTimeout(session.idleTimer);
  }
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
    try {
      session.ws.close(1000, "Idle timeout");
    } catch {
      // Already closed
    }
    removeSession(session.id);
  }, IDLE_TIMEOUT_MS);
}

export function sendToSession(session: Session, msg: ServerMessage): void {
  if (session.ws.readyState === session.ws.OPEN) {
    session.ws.send(JSON.stringify(msg));
  }
}

export function sendBinaryToSession(session: Session, data: Buffer): void {
  if (session.ws.readyState === session.ws.OPEN) {
    session.ws.send(data);
  }
}
