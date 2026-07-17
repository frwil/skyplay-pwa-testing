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
  type: "duel_challenge" | "duel_accepted" | "duel_declined" | "duel_rules_pending" | "duel_challenge_expired";
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
  status: "pending" | "accepted" | "declined" | "expired";
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
  /** Emulator system (e.g. "neogeo", "snes"). */
  system?: string;
  /** ROM filename (e.g. "kof98.zip"). */
  rom?: string;
}

interface UseDuelLobbyResult {
  players: DuelPlayer[];
  inLobby: boolean;
  pendingChallenge: DuelNotification | null;
  outgoingChallenge: OutgoingChallenge | null;
  duelSession: DuelSession | null;
  /** Set when both players need to confirm rules before the session is created. */
  rulesPendingChallenge: DuelNotification | null;
  joinLobby: () => Promise<void>;
  leaveLobby: () => Promise<void>;
  sendChallenge: (targetUserId: number, modeId?: string) => Promise<string | null>;
  acceptChallenge: (duelChallengeId: number) => Promise<DuelSession | null>;
  declineChallenge: (duelChallengeId: number) => Promise<void>;
  clearChallenge: () => void;
  clearRulesPending: () => void;
  /** Directly set the duel session (used by confirm-rules response to avoid polling delay). */
  setDuelSession: (session: DuelSession | null) => void;
  isSending: boolean;
  isResponding: boolean;
  error: string | null;
  /** True while auto-cleaning up a stale 409 challenge. */
  isCleaningUp: boolean;
  /** Manually reset a stale challenge: cancel → leave lobby → rejoin. */
  resetStaleChallenge: () => Promise<void>;
}

export function useDuelLobby({
  userId,
  username,
  isDevMode,
  enabled,
  system = "neogeo",
  rom = "kof98.zip",
}: UseDuelLobbyOptions): UseDuelLobbyResult {
  const [players, setPlayers] = useState<DuelPlayer[]>([]);
  const [inLobby, setInLobby] = useState(false);
  const [pendingChallenge, setPendingChallenge] = useState<DuelNotification | null>(null);
  const [outgoingChallenge, setOutgoingChallenge] = useState<OutgoingChallenge | null>(null);
  const [duelSession, setDuelSession] = useState<DuelSession | null>(null);
  const [rulesPendingChallenge, setRulesPendingChallenge] = useState<DuelNotification | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCleaningUp, setIsCleaningUp] = useState(false);

  const lastNotifIdRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const challengeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rulesPendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const staleChallengeIdRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const lobbyEmptySinceRef = useRef<number | null>(null);
  const lobbyAutoResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<DuelNotification | null>(null);
  const outgoingRef = useRef<OutgoingChallenge | null>(null);
  const userIdRef = useRef<number | null>(userId);
  const usernameRef = useRef<string | null>(username ?? null);
  const isDevModeRef = useRef<boolean>(!!isDevMode);
  const systemRef = useRef<string>(system);
  const romRef = useRef<string>(rom);

  // Keep refs in sync with props
  userIdRef.current = userId;
  usernameRef.current = username ?? null;
  isDevModeRef.current = !!isDevMode;
  systemRef.current = system;
  romRef.current = rom;

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

          // ── 10s empty-lobby detection ──────────────────────────
          // If the player is alone in the lobby with no challenge activity
          // for >10s, auto-reset the cage (leave + rejoin).
          if (data.inLobby) {
            const players: DuelPlayer[] = data.players || [];
            const selfId = userIdRef.current;
            const hasOtherPlayer = players.some((p) => p.userId !== selfId);
            const hasActivity = pendingRef.current || outgoingRef.current;

            if (!hasOtherPlayer && !hasActivity) {
              if (lobbyEmptySinceRef.current === null) {
                lobbyEmptySinceRef.current = Date.now();
              }
              if (!lobbyAutoResetTimerRef.current) {
                lobbyAutoResetTimerRef.current = setTimeout(() => {
                  performAutoReset();
                }, 10_000);
              }
            } else {
              clearAutoReset();
            }
          } else {
            // Not in lobby anymore — clear timer
            clearAutoReset();
          }
        }

        // Poll notifications
        let notifUrl = `/api/duel/notifications?since=${lastNotifIdRef.current}`;
        if (devId) notifUrl = addDevQuery(notifUrl, devId, devName);
        const notifRes = await fetch(notifUrl, { credentials: "include" });
        if (notifRes.ok && mountedRef.current) {
          const data = await notifRes.json();
          const items: DuelNotification[] = data.notifications || [];

          for (const n of items) {
            // ── Track highest seen notification id — but do NOT advance for
            //     duel_accepted until the session is successfully fetched.
            //     This ensures failed fetches are retried on the next poll
            //     instead of being silently dropped.
            const advanceNotif = () => {
              if (n.id > lastNotifIdRef.current) lastNotifIdRef.current = n.id;
            };

            // Handle incoming challenge — validate it's still pending first
            if (n.type === "duel_challenge" && !pendingRef.current) {
              const isValid = await validateChallengeStatus(n.duelChallengeId, devId, devName);
              if (isValid && mountedRef.current) {
                advanceNotif();
                setPendingChallenge(n);
              } else if (!isValid && mountedRef.current) {
                // Challenge no longer pending — mark notification as read
                advanceNotif();
                await markNotificationRead(n.id, devId, devName);
              }
            }

            // Handle rules_pending (both players must confirm rules)
            if (n.type === "duel_rules_pending") {
              advanceNotif();
              if (mountedRef.current) {
                setRulesPendingChallenge(n);
                // Fully clear the outgoing challenge — the flow is now in "rules"
                // phase and the "Défi envoyé" banner must disappear. The
                // duel_accepted handler below has a fallback path for null
                // outgoingChallenge, so clearing here is safe.
                if (outgoingRef.current?.challengeId === n.duelChallengeId) {
                  setOutgoingChallenge(null);
                }
                // ── 30s rules confirmation timeout (challenger side) ──────
                // If the opponent doesn't confirm rules within 30s, cancel
                // the challenge so neither player is stuck waiting forever.
                if (rulesPendingTimeoutRef.current) {
                  clearTimeout(rulesPendingTimeoutRef.current);
                  rulesPendingTimeoutRef.current = null;
                }
                const rpChallengeId = n.duelChallengeId;
                rulesPendingTimeoutRef.current = setTimeout(async () => {
                  const devId3 = isDevModeRef.current ? userIdRef.current : 0;
                  const devName3 = usernameRef.current || "";
                  console.log("[Duel] ⏰ Rules pending for 30s — cancelling challenge %d", rpChallengeId);
                  try {
                    let cancelBody: Record<string, unknown> = { challengeId: rpChallengeId };
                    if (devId3) cancelBody = withDevAuth(cancelBody, devId3, devName3);
                    await fetch("/api/duel/challenge/cancel", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(cancelBody),
                      credentials: "include",
                    });
                  } catch { /* best effort */ }
                  if (mountedRef.current) {
                    setRulesPendingChallenge(null);
                    setError("Défi expiré — pas de confirmation après 30s");
                  }
                }, 30_000);
              }
            }

            // Handle accepted response (both challenger P1 + target P2 via rules_pending)
            if (n.type === "duel_accepted") {
              // P1 (challenger): outgoing challenge matches the notification
              if (outgoingRef.current?.challengeId === n.duelChallengeId) {
                // Clear rules-pending timeout — opponent confirmed rules
                if (rulesPendingTimeoutRef.current) {
                  clearTimeout(rulesPendingTimeoutRef.current);
                  rulesPendingTimeoutRef.current = null;
                }
                fetchChallengeSession(n.duelChallengeId, devId, devName).then((session) => {
                  if (session && mountedRef.current) {
                    advanceNotif();
                    setDuelSession(session);
                    setRulesPendingChallenge(null); // dismiss rules overlay for the waiting player
                    setOutgoingChallenge((prev) =>
                      prev ? { ...prev, status: "accepted", session } : null,
                    );
                  }
                  // If session is null (fetch failed), do NOT advance lastNotifIdRef.
                  // The notification will be retried on the next poll.
                });
              } else if (!outgoingRef.current) {
                // P2 (target) or rules_pending flow: no outgoing challenge, but the session
                // may have been created via confirm-rules. Try to fetch it — if successful,
                // this is our signal to connect. If fetch returns null, the session was
                // already set directly by handleRulesAccept, or it's genuinely stale.
                // Clear rules-pending timeout — match is starting
                if (rulesPendingTimeoutRef.current) {
                  clearTimeout(rulesPendingTimeoutRef.current);
                  rulesPendingTimeoutRef.current = null;
                }
                fetchChallengeSession(n.duelChallengeId, devId, devName).then((session) => {
                  if (session && mountedRef.current) {
                    advanceNotif();
                    setDuelSession(session);
                    setRulesPendingChallenge(null); // dismiss rules overlay for P2 as well
                  }
                  // If session is null, do NOT advance — retry on next poll.
                });
              } else {
                // Stale accepted notification (different challenge) — mark as read
                advanceNotif();
                await markNotificationRead(n.id, devId, devName);
              }
            }

            // Handle declined response
            if (n.type === "duel_declined") {
              advanceNotif();
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

            // Handle expired challenge (30s timeout — cancels on both sides)
            if (n.type === "duel_challenge_expired") {
              advanceNotif();
              // P2 (target): clear pending challenge
              if (pendingRef.current?.duelChallengeId === n.duelChallengeId) {
                setPendingChallenge(null);
                setError("Le défi a expiré — pas de réponse après 30s");
              }
              // P1 (challenger): confirm cancellation — the timeout already set
              // outgoingChallenge to "expired", but if the notification arrives first
              // (race), update it here too.
              if (outgoingRef.current?.challengeId === n.duelChallengeId) {
                setOutgoingChallenge((prev) =>
                  prev ? { ...prev, status: "expired" } : null,
                );
                setError(n.message || "Défi expiré — pas de réponse après 30s");
              }
              await markNotificationRead(n.id, devId, devName);
            }
          }
        }
      } catch {
        // Retry next poll
      }
    };

    poll();
    pollTimerRef.current = setInterval(poll, 2000);

    // ── Recovery DISABLED: auto-reconnection to active challenges was
    //     causing games to start on page refresh without user action.
    //     Players must now explicitly re-join via the lobby UI.

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

  // ── Clear 30s timeout when challenge is no longer pending ──────
  useEffect(() => {
    if (outgoingChallenge?.status !== "pending" && challengeTimeoutRef.current) {
      clearTimeout(challengeTimeoutRef.current);
      challengeTimeoutRef.current = null;
    }
  }, [outgoingChallenge?.status]);

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
      let body: Record<string, unknown> = { action: "join", system: systemRef.current, rom: romRef.current };
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
    if (challengeTimeoutRef.current) {
      clearTimeout(challengeTimeoutRef.current);
      challengeTimeoutRef.current = null;
    }
    if (rulesPendingTimeoutRef.current) {
      clearTimeout(rulesPendingTimeoutRef.current);
      rulesPendingTimeoutRef.current = null;
    }
  }, []);

  // ── Send challenge ──────────────────────────────────────────────

  const sendChallenge = useCallback(
    async (targetUserId: number, modeId?: string): Promise<string | null> => {
      setIsSending(true);
      setError(null);
      const devId = isDevModeRef.current ? userIdRef.current : 0;
      const devName = usernameRef.current || "";
      try {
        let body: Record<string, unknown> = { targetUserId, system: systemRef.current, rom: romRef.current };
        if (modeId) body.modeId = modeId;
        if (devId) body = withDevAuth(body, devId, devName);
        const res = await fetch("/api/duel/challenge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // ── 409 same-direction duplicate: auto-cleanup ──────────
          if (res.status === 409 && (data.existingChallengeId as number | undefined)) {
            const staleId = data.existingChallengeId as number;
            staleChallengeIdRef.current = staleId;
            setIsCleaningUp(true);
            setError("Défi existant détecté, nettoyage en cours…");

            // Cancel the stale challenge
            try {
              let cancelBody: Record<string, unknown> = { challengeId: staleId };
              if (devId) cancelBody = withDevAuth(cancelBody, devId, devName);
              await fetch("/api/duel/challenge/cancel", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(cancelBody),
                credentials: "include",
              });
            } catch { /* best effort */ }

            // Clear any previous cleanup timeout
            if (cleanupTimeoutRef.current) {
              clearTimeout(cleanupTimeoutRef.current);
            }

            // Wait 10s for the cancelled challenge to propagate server-side
            await new Promise<void>((resolve) => {
              cleanupTimeoutRef.current = setTimeout(() => {
                cleanupTimeoutRef.current = null;
                resolve();
              }, 10_000);
            });

            if (!mountedRef.current) {
              setIsCleaningUp(false);
              return null;
            }

            // Check if a new challenge/session arrived in the meantime
            if (pendingRef.current || outgoingRef.current) {
              setIsCleaningUp(false);
              setError(null);
              staleChallengeIdRef.current = null;
              return null; // Something resolved — we're good
            }

            // Still nothing after 10s — destroy session and re-create
            setError("Aucune réponse — réinitialisation de la session…");
            setInLobby(false);
            setPlayers([]);
            setPendingChallenge(null);
            setOutgoingChallenge(null);
            if (challengeTimeoutRef.current) {
              clearTimeout(challengeTimeoutRef.current);
              challengeTimeoutRef.current = null;
            }

            try {
              let leaveBody: Record<string, unknown> = { action: "leave" };
              if (devId) leaveBody = withDevAuth(leaveBody, devId, devName);
              await fetch("/api/duel/lobby", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(leaveBody),
                credentials: "include",
              });
            } catch { /* best effort */ }

            // Brief pause then rejoin
            await new Promise((r) => setTimeout(r, 800));

            try {
              let joinBody: Record<string, unknown> = { action: "join", system: systemRef.current, rom: romRef.current };
              if (devId) joinBody = withDevAuth(joinBody, devId, devName);
              const joinRes = await fetch("/api/duel/lobby", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(joinBody),
                credentials: "include",
              });
              if (joinRes.ok) {
                setInLobby(true);
                setError(null);
              } else {
                setError("Échec de la reconnexion — rechargez la page");
              }
            } catch {
              setError("Échec de la reconnexion — rechargez la page");
            }

            setIsCleaningUp(false);
            staleChallengeIdRef.current = null;
            return null; // Handled — don't throw
          }

          throw new Error(data.error || "Failed to send challenge");
        }

        // ── Mutual challenge resolution: the target already challenged us ──
        // The server auto-accepted the existing challenge instead of creating
        // a second one. Set rules_pending directly — skip the "Défi envoyé" banner.
        if (data.autoAccepted) {
          setRulesPendingChallenge({
            id: 0,
            duelChallengeId: data.challengeId as number,
            fromUsername: "",
            message: "",
            fromUserId: 0,
            type: "duel_rules_pending",
            challengeId: data.challengeId as number,
            read: false,
            createdAt: new Date().toISOString(),
          });
          return null; // success — rules overlay will show for both players
        }

        const challenge: OutgoingChallenge = {
          challengeId: data.challenge.id,
          targetUserId,
          targetUsername: data.challenge.targetUsername,
          status: "pending",
        };
        setOutgoingChallenge(challenge);

        // ── 20s auto-cancel timeout ────────────────────────────
        // Clear any previous timeout
        if (challengeTimeoutRef.current) {
          clearTimeout(challengeTimeoutRef.current);
          challengeTimeoutRef.current = null;
        }
        challengeTimeoutRef.current = setTimeout(async () => {
          const devId2 = isDevModeRef.current ? userIdRef.current : 0;
          const devName2 = usernameRef.current || "";
          try {
            let cancelBody: Record<string, unknown> = { challengeId: challenge.challengeId };
            if (devId2) cancelBody = withDevAuth(cancelBody, devId2, devName2);
            await fetch("/api/duel/challenge/cancel", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(cancelBody),
              credentials: "include",
            });
          } catch { /* best effort — the server-side cancel may have already run */ }
          if (mountedRef.current) {
            setOutgoingChallenge((prev) =>
              prev?.challengeId === challenge.challengeId
                ? { ...prev, status: "expired" }
                : prev,
            );
            setError("Défi expiré — pas de réponse après 20s");
          }
        }, 20_000);

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

        if (data.rulesPending) {
          // Set rules pending — both players will see the DuelRulesOverlay
          setRulesPendingChallenge({
            id: 0,
            duelChallengeId: data.challengeId as number,
            fromUsername: "",
            message: "",
            fromUserId: 0,
            type: "duel_rules_pending",
            challengeId: data.challengeId as number,
            read: false,
            createdAt: new Date().toISOString(),
          });
          return null; // Session will be created after both confirm rules
        }

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
    if (challengeTimeoutRef.current) {
      clearTimeout(challengeTimeoutRef.current);
      challengeTimeoutRef.current = null;
    }
    if (rulesPendingTimeoutRef.current) {
      clearTimeout(rulesPendingTimeoutRef.current);
      rulesPendingTimeoutRef.current = null;
    }
  }, []);

  const clearRulesPending = useCallback(() => {
    setRulesPendingChallenge(null);
    if (rulesPendingTimeoutRef.current) {
      clearTimeout(rulesPendingTimeoutRef.current);
      rulesPendingTimeoutRef.current = null;
    }
  }, []);

  // ── 10s empty-lobby auto-reset ──────────────────────────────────

  /** Clear any pending auto-reset timer. Call whenever a player appears or a challenge comes in. */
  const clearAutoReset = useCallback(() => {
    lobbyEmptySinceRef.current = null;
    if (lobbyAutoResetTimerRef.current) {
      clearTimeout(lobbyAutoResetTimerRef.current);
      lobbyAutoResetTimerRef.current = null;
    }
  }, []);

  const performAutoReset = useCallback(async () => {
    const deepPending = pendingRef.current;
    const deepOutgoing = outgoingRef.current;

    const devId = isDevModeRef.current ? userIdRef.current : 0;
    const devName = usernameRef.current || "";

    console.log("[Duel] ⏰ Lobby empty for 10s — purging cage");

    // ── Purge ALL duels linked to the current user ──────────────────
    // Cancel outgoing + decline incoming before leave/rejoin.
    const purgeOps: Promise<void>[] = [];

    if (deepOutgoing) {
      // We are the challenger → cancel
      const challengeId = deepOutgoing.challengeId;
      console.log("[Duel] 🔥 Auto-reset: cancelling outgoing challenge %d", challengeId);
      purgeOps.push(
        (async () => {
          let body: Record<string, unknown> = { challengeId };
          if (devId) body = withDevAuth(body, devId, devName);
          const res = await fetch("/api/duel/challenge/cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            credentials: "include",
          });
          if (!res.ok) console.warn("[Duel] ⚠️ Auto-reset: cancel outgoing failed for challenge %d", challengeId);
        })(),
      );
    }

    if (deepPending) {
      // We are the target → decline
      const challengeId = deepPending.duelChallengeId;
      console.log("[Duel] 🔥 Auto-reset: declining incoming challenge %d", challengeId);
      purgeOps.push(
        (async () => {
          let body: Record<string, unknown> = { challengeId, accept: false };
          if (devId) body = withDevAuth(body, devId, devName);
          const res = await fetch("/api/duel/challenge/respond", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            credentials: "include",
          });
          if (!res.ok) console.warn("[Duel] ⚠️ Auto-reset: decline incoming failed for challenge %d", challengeId);
        })(),
      );
    }

    // Best-effort: don't block leave/rejoin on purge failures
    await Promise.allSettled(purgeOps);

    // Clear client state
    setInLobby(false);
    setPlayers([]);
    setPendingChallenge(null);
    setOutgoingChallenge(null);
    if (challengeTimeoutRef.current) {
      clearTimeout(challengeTimeoutRef.current);
      challengeTimeoutRef.current = null;
    }
    if (rulesPendingTimeoutRef.current) {
      clearTimeout(rulesPendingTimeoutRef.current);
      rulesPendingTimeoutRef.current = null;
    }

    // Notify server we're leaving
    try {
      let leaveBody: Record<string, unknown> = { action: "leave" };
      if (devId) leaveBody = withDevAuth(leaveBody, devId, devName);
      await fetch("/api/duel/lobby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(leaveBody),
        credentials: "include",
      });
    } catch { /* best effort */ }

    // Brief pause then rejoin
    await new Promise((r) => setTimeout(r, 800));

    try {
      let joinBody: Record<string, unknown> = { action: "join", system: systemRef.current, rom: romRef.current };
      if (devId) joinBody = withDevAuth(joinBody, devId, devName);
      const joinRes = await fetch("/api/duel/lobby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(joinBody),
        credentials: "include",
      });
      if (joinRes.ok) {
        console.log("[Duel] ✅ Auto-reset: rejoined lobby successfully");
        setInLobby(true);
        clearAutoReset();
      } else {
        console.warn("[Duel] ⚠️ Auto-reset: failed to rejoin lobby");
        setError("Échec du rafraîchissement du lobby");
      }
    } catch {
      setError("Échec du rafraîchissement du lobby");
    }
  }, [clearAutoReset]);

  // ── Manual reset for stale challenges ────────────────────────────

  const resetStaleChallenge = useCallback(async () => {
    // Clear any pending auto-cleanup timeout
    if (cleanupTimeoutRef.current) {
      clearTimeout(cleanupTimeoutRef.current);
      cleanupTimeoutRef.current = null;
    }

    setIsCleaningUp(true);
    setError("Réinitialisation manuelle en cours…");

    // Cancel the stale challenge server-side if we have its ID
    const staleId = staleChallengeIdRef.current;
    if (staleId) {
      try {
        const devId = isDevModeRef.current ? userIdRef.current : 0;
        const devName = usernameRef.current || "";
        let cancelBody: Record<string, unknown> = { challengeId: staleId };
        if (devId) cancelBody = withDevAuth(cancelBody, devId, devName);
        await fetch("/api/duel/challenge/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cancelBody),
          credentials: "include",
        });
      } catch { /* best effort */ }
      staleChallengeIdRef.current = null;
    }

    // Destroy current session state
    setInLobby(false);
    setPlayers([]);
    setPendingChallenge(null);
    setOutgoingChallenge(null);
    if (challengeTimeoutRef.current) {
      clearTimeout(challengeTimeoutRef.current);
      challengeTimeoutRef.current = null;
    }
    if (rulesPendingTimeoutRef.current) {
      clearTimeout(rulesPendingTimeoutRef.current);
      rulesPendingTimeoutRef.current = null;
    }

    // Notify server we're leaving
    try {
      const devId = isDevModeRef.current ? userIdRef.current : 0;
      const devName = usernameRef.current || "";
      let leaveBody: Record<string, unknown> = { action: "leave" };
      if (devId) leaveBody = withDevAuth(leaveBody, devId, devName);
      await fetch("/api/duel/lobby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(leaveBody),
        credentials: "include",
      });
    } catch { /* best effort */ }

    // Brief pause then rejoin
    await new Promise((r) => setTimeout(r, 800));

    try {
      const devId = isDevModeRef.current ? userIdRef.current : 0;
      const devName = usernameRef.current || "";
      let joinBody: Record<string, unknown> = { action: "join", system: systemRef.current, rom: romRef.current };
      if (devId) joinBody = withDevAuth(joinBody, devId, devName);
      const joinRes = await fetch("/api/duel/lobby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(joinBody),
        credentials: "include",
      });
      if (joinRes.ok) {
        setInLobby(true);
        setError(null);
      } else {
        setError("Échec de la reconnexion — rechargez la page");
      }
    } catch {
      setError("Échec de la reconnexion — rechargez la page");
    }

    setIsCleaningUp(false);
  }, []);

  return {
    players,
    inLobby,
    pendingChallenge,
    outgoingChallenge,
    duelSession,
    rulesPendingChallenge,
    joinLobby,
    leaveLobby,
    sendChallenge,
    acceptChallenge,
    declineChallenge,
    clearChallenge,
    clearRulesPending,
    resetStaleChallenge,
    setDuelSession,
    isSending,
    isResponding,
    isCleaningUp,
    error,
  };
}
