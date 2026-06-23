"use client";

import { useState, useCallback, useRef } from "react";
import type { SessionConfig, NetplayStatus } from "../types";
import { usePresence } from "./usePresence";
import { useWebRTC } from "./useWebRTC";
import type { NetplayEmulatorDeps } from "../NetplayManager";

export type ParticipationStatus = "none" | "pending" | "participating" | "in_game";

interface UseNetplayOptions {
  challengeId: number | null;
}

interface UseNetplayResult {
  // Participation
  participationStatus: ParticipationStatus;
  participate: () => Promise<void>;
  leave: () => Promise<void>;

  // Matchmaking
  isSearching: boolean;
  session: SessionConfig | null;
  startMatchmaking: () => Promise<void>;
  cancelMatchmaking: () => Promise<void>;

  // WebRTC / Netplay
  netplayStatus: NetplayStatus;
  latency: number;
  rollbacks: number;
  countdown: number;

  // Presence
  participants: Array<{
    id: number;
    userId: number;
    username: string;
    status: string;
    createdAt: string;
    isOnline: boolean;
    lastSeen: string | null;
  }>;

  // Actions
  /** Wire the netplay manager to emulator deps. */
  bindEmulator: (deps: NetplayEmulatorDeps) => void;
  /** Start WebRTC once session is matched. */
  startNetplay: () => Promise<void>;
  /** Full cleanup. */
  cleanup: () => void;
  /** The NetplayManager instance (for wiring into emulator). */
  manager: unknown;

  error: string | null;
}

/**
 * Orchestration hook for the full netplay flow:
 *
 * 1. Participate in a challenge
 * 2. Track presence of other participants
 * 3. Matchmaking: find/join a WAITING session
 * 4. WebRTC handshake → countdown → play
 */
export function useNetplay({ challengeId }: UseNetplayOptions): UseNetplayResult {
  const [participationStatus, setParticipationStatus] = useState<ParticipationStatus>("none");
  const [isSearching, setIsSearching] = useState(false);
  const [session, setSession] = useState<SessionConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Ref to emulator deps, set by bindEmulator
  const depsRef = useRef<NetplayEmulatorDeps | null>(null);
  const sessionIdRef = useRef<number | null>(null);
  const matchmakingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // ── Presence ────────────────────────────────────────────────────

  const presence = usePresence({
    challengeId,
    enabled: participationStatus !== "none",
  });

  // ── WebRTC (only created when session is set) ────────────────────

  const webrtc = useWebRTC({
    session,
    deps: depsRef.current,
  });

  // ── Participate ─────────────────────────────────────────────────

  const participate = useCallback(async () => {
    if (!challengeId) return;
    setError(null);

    try {
      const res = await fetch(`/api/challenges/${challengeId}/participate`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setError("Vous devez être connecté pour participer");
          return;
        }
        setError(data.error || "Erreur lors de la participation");
        return;
      }

      if (mountedRef.current) {
        setParticipationStatus("participating");
      }
    } catch {
      setError("Erreur réseau");
    }
  }, [challengeId]);

  const leave = useCallback(async () => {
    if (!challengeId) return;

    try {
      await fetch(`/api/challenges/${challengeId}/participate`, {
        method: "DELETE",
      });
    } catch {
      // Best effort
    }

    if (mountedRef.current) {
      setParticipationStatus("none");
      setSession(null);
    }
  }, [challengeId]);

  // ── Matchmaking ─────────────────────────────────────────────────

  const cancelMatchmaking = useCallback(async () => {
    setIsSearching(false);
    if (matchmakingTimerRef.current) {
      clearInterval(matchmakingTimerRef.current);
      matchmakingTimerRef.current = null;
    }

    if (sessionIdRef.current) {
      try {
        await fetch("/api/netplay/session", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sessionIdRef.current }),
        });
      } catch {
        // Best effort
      }
      sessionIdRef.current = null;
    }

    setSession(null);
  }, []);

  const startMatchmaking = useCallback(async () => {
    if (!challengeId || participationStatus === "none") {
      setError("Vous devez d'abord participer au challenge");
      return;
    }

    setError(null);
    setIsSearching(true);

    try {
      // POST /api/netplay/session — either creates WAITING or joins existing
      const res = await fetch("/api/netplay/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Erreur de matchmaking");
        setIsSearching(false);
        return;
      }

      const data = await res.json();
      const sess = data.session;

      if (sess.status === "MATCHED") {
        // We joined an existing session — ready to connect
        setIsSearching(false);

        const sessionConfig: SessionConfig = {
          sessionId: sess.id,
          challengeId,
          playerNumber: 2, // We joined as P2
          opponentId: sess.opponent.id,
          opponentName: sess.opponent.username,
        };

        if (mountedRef.current) {
          setSession(sessionConfig);
          setParticipationStatus("in_game");
        }
        return;
      }

      // WAITING — poll for a match
      sessionIdRef.current = sess.id;

      matchmakingTimerRef.current = setInterval(async () => {
        if (!mountedRef.current) {
          clearInterval(matchmakingTimerRef.current!);
          return;
        }

        try {
          const pollRes = await fetch(
            `/api/netplay/session?id=${sessionIdRef.current}`,
          );
          if (!pollRes.ok) return;

          const pollData = await pollRes.json();
          const pollSess = pollData.session;

          if (pollSess.status === "MATCHED") {
            clearInterval(matchmakingTimerRef.current!);
            matchmakingTimerRef.current = null;
            setIsSearching(false);

            if (mountedRef.current) {
              setSession({
                sessionId: pollSess.id,
                challengeId,
                playerNumber: 1, // We were P1, waiting
                opponentId: pollSess.opponent.id,
                opponentName: pollSess.opponent.username,
              });
              setParticipationStatus("in_game");
            }
          }
        } catch {
          // Retry next poll
        }
      }, 2000);
    } catch {
      setError("Erreur réseau");
      setIsSearching(false);
    }
  }, [challengeId, participationStatus]);

  // ── Emulator binding ────────────────────────────────────────────

  const bindEmulator = useCallback((deps: NetplayEmulatorDeps) => {
    depsRef.current = deps;
  }, []);

  // ── Start netplay (WebRTC) ──────────────────────────────────────

  const startNetplay = useCallback(async () => {
    await webrtc.start();
  }, [webrtc]);

  // ── Cleanup ──────────────────────────────────────────────────────

  const cleanup = useCallback(() => {
    mountedRef.current = false;
    webrtc.stop();
    if (matchmakingTimerRef.current) {
      clearInterval(matchmakingTimerRef.current);
      matchmakingTimerRef.current = null;
    }
    setSession(null);
    setParticipationStatus("none");
    setIsSearching(false);
  }, [webrtc]);

  return {
    participationStatus,
    participate,
    leave,
    isSearching,
    session,
    startMatchmaking,
    cancelMatchmaking,
    netplayStatus: webrtc.status,
    latency: webrtc.latency,
    rollbacks: webrtc.rollbacks,
    countdown: webrtc.countdown,
    participants: presence.participants,
    bindEmulator,
    startNetplay,
    cleanup,
    manager: webrtc.manager,
    error,
  };
}
