"use client";

import { useState, useCallback, useRef, useEffect } from "react";

// ── Types ──────────────────────────────────────────────────────────

export interface DuelPlayer {
  userId: number;
  username: string;
  avatar?: string | null;
  country?: string | null;
  system: string;
  rom: string;
  status: string;
  createdAt: string;
}

export interface DuelNotification {
  id: number;
  duelChallengeId: number;
  fromUserId: number;
  fromUsername: string;
  type: "duel_challenge" | "duel_accepted" | "duel_declined";
  challengeId: number | null;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface DuelSession {
  sessionId: string;
  wsUrl: string;
  roomCode: string;
  player1Id: number;
  player2Id: number;
  challengeId: number;
}

export interface OutgoingChallenge {
  challengeId: number;
  targetUserId: number;
  targetUsername: string;
  status: "pending" | "accepted" | "declined";
  session?: DuelSession;
}

// ── Helpers ────────────────────────────────────────────────────────

/** Append dev auth query params when running in local dev mode (no JWT). */
function addDevQuery(url: string, devUserId: number, devUsername: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}devUserId=${devUserId}&devUsername=${encodeURIComponent(devUsername)}`;
}

/** Merge dev auth fields into a POST body object. */
function withDevAuth<T extends Record<string, unknown>>(
  obj: T,
  devUserId: number,
  devUsername: string,
): T & { devUserId: number; devUsername: string } {
  return { ...obj, devUserId, devUsername };
}

// ── Hook ───────────────────────────────────────────────────────────

interface UseDuelLobbyOptions {
  userId: number | null;
  /** Display name, used as devUsername when isDevMode. */
  username?: string | null;
  /** When true, sends devUserId/devUsername in API requests (local development without JWT). */
  isDevMode?: boolean;
  enabled: boolean;
}

interface UseDuelLobbyResult {
  players: DuelPlayer[];
  inLobby: boolean;
  pendingChallenge: DuelNotification | null;
  outgoingChallenge: OutgoingChallenge | null;
  duelSession: DuelSession | null;
  joinLobby: () => Promise<void>;
  leaveLobby: () => Promise<void>;
  sendChallenge: (targetUserId: number) => Promise<string | null>;
  acceptChallenge: (duelChallengeId: number) => Promise<DuelSession | null>;
  declineChallenge: (duelChallengeId: number) => Promise<void>;
  clearChallenge: () => void;
  isSending: boolean;
  isResponding: boolean;
  error: string | null;
}

export function useDuelLobby({
  userId,
  username,
  isDevMode,
  enabled,
}: UseDuelLobbyOptions): UseDuelLobbyResult {
  const [players, setPlayers] = useState<DuelPlayer[]>([]);
  const [inLobby, setInLobby] = useState(false);
  const [pendingChallenge, setPendingChallenge] = useState<DuelNotification | null>(null);
  const [outgoingChallenge, setOutgoingChallenge] = useState<OutgoingChallenge | null>(null);
  const [duelSession, setDuelSession] = useState<DuelSession | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastNotifIdRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const pendingRef = useRef<DuelNotification | null>(null);
  const outgoingRef = useRef<OutgoingChallenge | null>(null);
  const userIdRef = useRef<number | null>(userId);
  const usernameRef = useRef<string | null>(username ?? null);
  const isDevModeRef = useRef<boolean>(!!isDevMode);

  // Keep refs in sync with props
  userIdRef.current = userId;
  usernameRef.current = username ?? null;
  isDevModeRef.current = !!isDevMode;

  pendingRef.current = pendingChallenge;
  outgoingRef.current = outgoingChallenge;

  // ── Poll lobby + notifications ──────────────────────────────────

  /** Validate that a challenge is still pending before showing the notification. */
  async function validateChallengeStatus(
    challengeId: number,
    devId: number,
    devName: string,
  ): Promise<boolean> {
    try {
      let url = `/api/duel/challenge?challengeId=${challengeId}`;
      if (devId) url = addDevQuery(url, devId, devName);
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return false;
      const data = await res.json();
      return data.challenge?.status === "pending";
    } catch {
      return false;
    }
  }

  /** Mark a notification as read so it won't show up again. */
  async function markNotificationRead(
    notifId: number,
    devId: number,
    devName: string,
  ): Promise<void> {
    try {
      let body: Record<string, unknown> = { ids: [notifId] };
      if (devId) body = withDevAuth(body, devId, devName);
      await fetch("/api/duel/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
    } catch { /* best effort */ }
  }

  useEffect(() => {
    if (!enabled || !userId) {
      setPlayers([]);
      setInLobby(false);
      return;
    }

    const devId = isDevModeRef.current ? userId : 0;
    const devName = usernameRef.current || "";

    const poll = async () => {
      try {
        // Poll lobby players
        let lobbyUrl = "/api/duel/lobby";
        if (devId) lobbyUrl = addDevQuery(lobbyUrl, devId, devName);
        const lobbyRes = await fetch(lobbyUrl, { credentials: "include" });
        if (lobbyRes.ok && mountedRef.current) {
          const data = await lobbyRes.json();
          setPlayers(data.players || []);
          setInLobby(data.inLobby);
        }

        // Poll notifications
        let notifUrl = `/api/duel/notifications?since=${lastNotifIdRef.current}`;
        if (devId) notifUrl = addDevQuery(notifUrl, devId, devName);
        const notifRes = await fetch(notifUrl, { credentials: "include" });
        if (notifRes.ok && mountedRef.current) {
          const data = await notifRes.json();
          const items: DuelNotification[] = data.notifications || [];

          for (const n of items) {
            if (n.id > lastNotifIdRef.current) lastNotifIdRef.current = n.id;

            // Handle incoming challenge — validate it's still pending first
            if (n.type === "duel_challenge" && !pendingRef.current) {
              const isValid = await validateChallengeStatus(n.duelChallengeId, devId, devName);
              if (isValid && mountedRef.current) {
                setPendingChallenge(n);
              } else if (!isValid && mountedRef.current) {
                // Challenge no longer pending — mark notification as read
                await markNotificationRead(n.id, devId, devName);
              }
            }

            // Handle accepted response (for the challenger — P1)
            if (n.type === "duel_accepted") {
              if (outgoingRef.current?.challengeId === n.duelChallengeId) {
                fetchChallengeSession(n.duelChallengeId, devId, devName).then((session) => {
                  if (session && mountedRef.current) {
                    setDuelSession(session);
                    setOutgoingChallenge((prev) =>
                      prev ? { ...prev, status: "accepted", session } : null,
                    );
                  }
                });
              } else {
                // Stale accepted notification — mark as read
                await markNotificationRead(n.id, devId, devName);
              }
            }

            // Handle declined response
            if (n.type === "duel_declined") {
              if (outgoingRef.current?.challengeId === n.duelChallengeId) {
                setOutgoingChallenge((prev) =>
                  prev ? { ...prev, status: "declined" } : null,
                );
                setError(n.message);
              } else {
                // Stale declined notification — mark as read
                await markNotificationRead(n.id, devId, devName);
              }
            }
          }
        }
      } catch {
        // Retry next poll
      }
    };

    poll();
    pollTimerRef.current = setInterval(poll, 2000);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [enabled, userId]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── Fetch challenge session info (P1 polls this after P2 accepts) ─

  async function fetchChallengeSession(
    challengeId: number,
    devId: number,
    devName: string,
  ): Promise<DuelSession | null> {
    try {
      let url = `/api/duel/challenge?challengeId=${challengeId}`;
      if (devId) url = addDevQuery(url, devId, devName);
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return null;
      const data = await res.json();
      return data.challenge?.session ?? null;
    } catch {
      return null;
    }
  }

  // ── Join/Leave lobby ────────────────────────────────────────────

  const joinLobby = useCallback(async () => {
    setError(null);
    const devId = isDevModeRef.current ? userIdRef.current : 0;
    const devName = usernameRef.current || "";
    try {
      let body: Record<string, unknown> = { action: "join", system: "neogeo", rom: "kof98.zip" };
      if (devId) body = withDevAuth(body, devId, devName);
      const res = await fetch("/api/duel/lobby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to join lobby");
      }
      setInLobby(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lobby join failed");
    }
  }, []);

  const leaveLobby = useCallback(async () => {
    const devId = isDevModeRef.current ? userIdRef.current : 0;
    const devName = usernameRef.current || "";
    try {
      let body: Record<string, unknown> = { action: "leave" };
      if (devId) body = withDevAuth(body, devId, devName);
      await fetch("/api/duel/lobby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
    } catch { /* best effort */ }
    setInLobby(false);
    setPlayers([]);
    setPendingChallenge(null);
    setOutgoingChallenge(null);
  }, []);

  // ── Send challenge ──────────────────────────────────────────────

  const sendChallenge = useCallback(
    async (targetUserId: number): Promise<string | null> => {
      setIsSending(true);
      setError(null);
      const devId = isDevModeRef.current ? userIdRef.current : 0;
      const devName = usernameRef.current || "";
      try {
        let body: Record<string, unknown> = { targetUserId, system: "neogeo", rom: "kof98.zip" };
        if (devId) body = withDevAuth(body, devId, devName);
        const res = await fetch("/api/duel/challenge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Failed to send challenge");
        }

        const challenge: OutgoingChallenge = {
          challengeId: data.challenge.id,
          targetUserId,
          targetUsername: data.challenge.targetUsername,
          status: "pending",
        };
        setOutgoingChallenge(challenge);
        return null; // success
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Challenge failed";
        setError(msg);
        return msg;
      } finally {
        if (mountedRef.current) setIsSending(false);
      }
    },
    [],
  );

  // ── Accept challenge ────────────────────────────────────────────

  const acceptChallenge = useCallback(
    async (duelChallengeId: number): Promise<DuelSession | null> => {
      setIsResponding(true);
      setError(null);
      const devId = isDevModeRef.current ? userIdRef.current : 0;
      const devName = usernameRef.current || "";
      try {
        let body: Record<string, unknown> = { challengeId: duelChallengeId, accept: true };
        if (devId) body = withDevAuth(body, devId, devName);
        const res = await fetch("/api/duel/challenge/respond", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Failed to accept challenge");
        }

        setPendingChallenge(null);

        if (data.session) {
          const session: DuelSession = {
            sessionId: data.session.sessionId,
            wsUrl: data.session.wsUrl,
            roomCode: data.session.roomCode,
            player1Id: data.session.player1Id,
            player2Id: data.session.player2Id,
            challengeId: data.session.challengeId || duelChallengeId,
          };
          setDuelSession(session);
          return session;
        }
        return null;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Accept failed";
        setError(msg);
        return null;
      } finally {
        if (mountedRef.current) setIsResponding(false);
      }
    },
    [],
  );

  // ── Decline challenge ───────────────────────────────────────────

  const declineChallenge = useCallback(async (duelChallengeId: number) => {
    setIsResponding(true);
    setError(null);
    const devId = isDevModeRef.current ? userIdRef.current : 0;
    const devName = usernameRef.current || "";
    try {
      let body: Record<string, unknown> = { challengeId: duelChallengeId, accept: false };
      if (devId) body = withDevAuth(body, devId, devName);
      const res = await fetch("/api/duel/challenge/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to decline challenge");
      }
      setPendingChallenge(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Decline failed");
    } finally {
      if (mountedRef.current) setIsResponding(false);
    }
  }, []);

  // ── Clear challenge ─────────────────────────────────────────────

  const clearChallenge = useCallback(() => {
    setOutgoingChallenge(null);
    setError(null);
  }, []);

  return {
    players,
    inLobby,
    pendingChallenge,
    outgoingChallenge,
    duelSession,
    joinLobby,
    leaveLobby,
    sendChallenge,
    acceptChallenge,
    declineChallenge,
    clearChallenge,
    isSending,
    isResponding,
    error,
  };
}
