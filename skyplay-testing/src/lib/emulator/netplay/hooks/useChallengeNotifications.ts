"use client";

import { useState, useCallback, useRef, useEffect } from "react";

export interface NetplayNotification {
  id: number;
  sessionId: number;
  fromUserId: number;
  fromUsername: string;
  type: "challenge" | "accepted" | "declined" | "disconnect_win" | "disconnect_loss";
  challengeId: number | null;
  message: string;
  read: boolean;
  createdAt: string;
}

interface UseChallengeNotificationsOptions {
  /** Current user ID — notifications are scoped to this user. */
  userId: number | null;
  /** Whether to poll for notifications. */
  enabled: boolean;
  /** Called when a new challenge notification arrives. */
  onChallengeReceived?: (notification: NetplayNotification) => void;
}

interface UseChallengeNotificationsResult {
  /** All unread notifications. */
  notifications: NetplayNotification[];
  /** The current pending challenge (type === "challenge"), if any. */
  pendingChallenge: NetplayNotification | null;
  /** Accept the pending challenge. Returns the session config on success. */
  acceptChallenge: (sessionId: number) => Promise<AcceptResult | null>;
  /** Decline the pending challenge. */
  declineChallenge: (sessionId: number) => Promise<void>;
  /** Mark notifications as read on the server. */
  markRead: (ids: number[]) => Promise<void>;
  isAccepting: boolean;
  isDeclining: boolean;
  error: string | null;
}

export interface AcceptResult {
  session: {
    id: number;
    challengeId: number;
    status: "MATCHED";
    player1Id: number;
    player2Id: number;
    opponent: { id: number; username: string };
  };
}

/**
 * Polls GET /api/netplay/notifications every 2s to detect incoming
 * challenges and other netplay notifications.
 *
 * When a "challenge" notification arrives, sets `pendingChallenge`
 * so the UI can show the ChallengeNotificationDialog.
 */
export function useChallengeNotifications({
  userId,
  enabled,
  onChallengeReceived,
}: UseChallengeNotificationsOptions): UseChallengeNotificationsResult {
  const [notifications, setNotifications] = useState<NetplayNotification[]>([]);
  const [pendingChallenge, setPendingChallenge] = useState<NetplayNotification | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastIdRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const pendingRef = useRef<NetplayNotification | null>(null);

  // Keep ref in sync
  pendingRef.current = pendingChallenge;

  // ── Poll for notifications ──────────────────────────────────────

  useEffect(() => {
    if (!enabled || !userId) {
      // Clear state when disabled
      setNotifications([]);
      setPendingChallenge(null);
      return;
    }

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/netplay/notifications?since=${lastIdRef.current}`,
          { credentials: "include" },
        );
        if (!res.ok) return;
        if (!mountedRef.current) return;

        const data = await res.json();
        const items: NetplayNotification[] = data.notifications || [];

        if (items.length > 0) {
          // Update last seen ID
          for (const n of items) {
            if (n.id > lastIdRef.current) lastIdRef.current = n.id;
          }

          setNotifications((prev) => {
            // Merge, deduplicate by id
            const existing = new Set(prev.map((n) => n.id));
            const fresh = items.filter((n) => !existing.has(n.id));
            return [...prev, ...fresh];
          });

          // Check for new challenge
          for (const n of items) {
            if (n.type === "challenge" && !pendingRef.current) {
              setPendingChallenge(n);
              onChallengeReceived?.(n);
              break; // Only one pending at a time
            }
          }
        }
      } catch {
        // Retry next poll
      }
    };

    // Initial poll
    poll();

    // Periodic poll every 2s
    pollTimerRef.current = setInterval(poll, 2000);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [enabled, userId, onChallengeReceived]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── Accept challenge ────────────────────────────────────────────

  const acceptChallenge = useCallback(async (sessionId: number): Promise<AcceptResult | null> => {
    setIsAccepting(true);
    setError(null);

    try {
      const res = await fetch(`/api/netplay/session/${sessionId}/accept`, {
        method: "PUT",
        credentials: "include",
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || "Erreur lors de l'acceptation");
        return null;
      }

      // Clear pending challenge
      if (mountedRef.current) {
        setPendingChallenge(null);
        // Mark the notification as read
        if (data.session) {
          // Mark this notification read on server (best-effort)
          fetch("/api/netplay/notifications", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: [lastIdRef.current] }),
            credentials: "include",
          }).catch(() => {});
        }
      }

      return data as AcceptResult;
    } catch {
      setError("Erreur réseau");
      return null;
    } finally {
      if (mountedRef.current) setIsAccepting(false);
    }
  }, []);

  // ── Decline challenge ───────────────────────────────────────────

  const declineChallenge = useCallback(async (sessionId: number) => {
    setIsDeclining(true);
    setError(null);

    try {
      const res = await fetch(`/api/netplay/session/${sessionId}/decline`, {
        method: "PUT",
        credentials: "include",
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || "Erreur lors du refus");
        return;
      }

      if (mountedRef.current) {
        setPendingChallenge(null);
      }
    } catch {
      setError("Erreur réseau");
    } finally {
      if (mountedRef.current) setIsDeclining(false);
    }
  }, []);

  // ── Mark read ───────────────────────────────────────────────────

  const markRead = useCallback(async (ids: number[]) => {
    try {
      await fetch("/api/netplay/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
        credentials: "include",
      });
    } catch {
      // Best effort
    }
  }, []);

  return {
    notifications,
    pendingChallenge,
    acceptChallenge,
    declineChallenge,
    markRead,
    isAccepting,
    isDeclining,
    error,
  };
}
