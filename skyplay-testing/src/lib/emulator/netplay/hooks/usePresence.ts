"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export interface Participant {
  id: number;
  userId: number;
  username: string;
  status: string;
  createdAt: string;
  isOnline: boolean;
  lastSeen: string | null;
}

interface UsePresenceOptions {
  /** Challenge ID to track presence for. */
  challengeId: number | null;
  /** Whether heartbeat/polling is active. */
  enabled: boolean;
}

interface UsePresenceResult {
  participants: Participant[];
  onlineUserIds: Set<number>;
  isOnline: (userId: number) => boolean;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Manages presence heartbeat and participant polling for a challenge.
 *
 * - Sends heartbeat POST /api/presence/heartbeat every 15s while enabled
 * - Polls GET /api/challenges/[id]/participants every 5s
 * - Sends is_online=0 on unmount
 */
export function usePresence({
  challengeId,
  enabled,
}: UsePresenceOptions): UsePresenceResult {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // ── Fetch participants ──────────────────────────────────────────

  const fetchParticipants = useCallback(async () => {
    if (!challengeId) return;

    try {
      const res = await fetch(`/api/challenges/${challengeId}/participants`, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      if (mountedRef.current) {
        setParticipants(data.participants ?? []);
        setLoading(false);
      }
    } catch {
      // Retry next poll
    }
  }, [challengeId]);

  // ── Heartbeat ───────────────────────────────────────────────────

  const sendHeartbeat = useCallback(async (online: boolean) => {
    if (!challengeId) return;
    try {
      await fetch("/api/presence/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, isOnline: online }),
        credentials: "include",
      });
    } catch {
      // Retry next interval
    }
  }, [challengeId]);

  // ── Start/Stop intervals ────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;

    if (enabled && challengeId) {
      setLoading(true);
      fetchParticipants();

      // Poll participants every 5s
      pollTimerRef.current = setInterval(fetchParticipants, 5000);

      // Heartbeat every 15s
      sendHeartbeat(true);
      heartbeatTimerRef.current = setInterval(() => sendHeartbeat(true), 15000);
    }

    return () => {
      mountedRef.current = false;

      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }

      // Mark offline on unmount
      if (enabled && challengeId) {
        sendHeartbeat(false);
      }
    };
  }, [enabled, challengeId, fetchParticipants, sendHeartbeat]);

  // ── Derived state ───────────────────────────────────────────────

  const onlineUserIds = new Set(
    participants.filter((p) => p.isOnline).map((p) => p.userId),
  );

  const isOnline = useCallback(
    (userId: number) => onlineUserIds.has(userId),
    [onlineUserIds],
  );

  const refetch = useCallback(() => {
    fetchParticipants();
  }, [fetchParticipants]);

  return { participants, onlineUserIds, isOnline, loading, error, refetch };
}
