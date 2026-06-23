"use client";

import { useState, useCallback, useRef } from "react";
import type { SessionConfig, NetplayStatus } from "../types";
import type { SystemType } from "../../types";
import { usePresence } from "./usePresence";
import { useWebRTC } from "./useWebRTC";
import type { NetplayEmulatorDeps } from "../NetplayManager";
import type { InputDelayEmulatorDeps } from "../InputDelayManager";
import type { NetplayManager } from "../NetplayManager";
import type { InputDelayManager } from "../InputDelayManager";

export type ParticipationStatus = "none" | "pending" | "participating" | "in_game";

interface UseNetplayOptions {
  challengeId: number | null;
  /** Target system — determines rollback (NES) vs input delay (non-NES). */
  system: SystemType;
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
  /** Wire the netplay manager to emulator deps (rollback for NES, input delay for others). */
  bindEmulator: (deps: NetplayEmulatorDeps | InputDelayEmulatorDeps) => void;
  /** Start WebRTC once session is matched. */
  startNetplay: () => Promise<void>;
  /** Full cleanup. */
  cleanup: () => void;
  /** The NetplayManager or InputDelayManager instance (for wiring into emulator). */
  manager: NetplayManager | InputDelayManager | null;

  error: string | null;
}

/**
 * Orchestration hook for the full netplay flow:
 *
 * 1. Participate in a challenge
 * 2. Track presence of other participants
 * 3. Matchmaking: find/join a WAITING session
 * 4. WebRTC handshake → countdown → play
 *
 * Modes:
 * - NES → rollback netplay (GGPO-style, requires toJSON/fromJSON)
 * - SNES/GB/GBA/etc → input delay netplay (33ms delay, universal)
 */
export function useNetplay({ challengeId, system }: UseNetplayOptions): UseNetplayResult {
  const [participationStatus, setParticipationStatus] = useState<ParticipationStatus>("none");
  const [isSearching, setIsSearching] = useState(false);
  const [session, setSession] = useState<SessionConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Emulator deps, set by bindEmulator — state so it triggers re-renders
  const [deps, setDeps] = useState<NetplayEmulatorDeps | InputDelayEmulatorDeps | null>(null);
  const depsRef = useRef<NetplayEmulatorDeps | InputDelayEmulatorDeps | null>(null);
  const sessionIdRef = useRef<number | null>(null);
  const matchmakingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // ── Presence ────────────────────────────────────────────────────

  const presence = usePresence({
    challengeId,
    enabled: participationStatus !== "none",
  });

  // ── WebRTC (only created when session is set) ───────────────────

  const webrtc = useWebRTC({
    session,
    deps,
    system,
  });

  // ── Participate ─────────────────────────────────────────────────

  const participate = useCallback(async () => {
    if (!challengeId) return;
    setError(null);
    console.log("[Netplay:useNetplay] participate() — challengeId:", challengeId);

    try {
      const res = await fetch(`/api/challenges/${challengeId}/participate`, {
        method: "POST",
        credentials: "include",
      });
      console.log("[Netplay:useNetplay] participate response:", res.status);

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          console.log("[Netplay:useNetplay] ❌ participate: not authenticated (401)");
          setError("Vous devez être connecté pour participer");
          return;
        }
        console.log("[Netplay:useNetplay] ❌ participate error:", data.error || res.status);
        setError(data.error || "Erreur lors de la participation");
        return;
      }

      if (mountedRef.current) {
        console.log("[Netplay:useNetplay] ✅ participate success → 'participating'");
        setParticipationStatus("participating");
      }
    } catch (err) {
      console.error("[Netplay:useNetplay] ❌ participate network error:", err);
      setError("Erreur réseau");
    }
  }, [challengeId]);

  const leave = useCallback(async () => {
    if (!challengeId) return;

    try {
      await fetch(`/api/challenges/${challengeId}/participate`, {
        method: "DELETE",
        credentials: "include",
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
          credentials: "include",
        });
      } catch {
        // Best effort
      }
      sessionIdRef.current = null;
    }

    setSession(null);
  }, []);

  const startMatchmaking = useCallback(async () => {
    console.log("[Netplay:useNetplay] startMatchmaking() called", {
      challengeId,
      participationStatus,
      system,
    });
    if (!challengeId || participationStatus === "none") {
      console.log("[Netplay:useNetplay] ❌ startMatchmaking: not participating");
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
        credentials: "include",
      });
      console.log("[Netplay:useNetplay] POST /api/netplay/session response:", res.status);

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.log("[Netplay:useNetplay] ❌ matchmaking POST failed:", data.error || res.status);
        setError(data.error || "Erreur de matchmaking");
        setIsSearching(false);
        return;
      }

      const data = await res.json();
      const sess = data.session;
      console.log("[Netplay:useNetplay] session status:", sess.status, "sessionId:", sess.id);

      if (sess.status === "MATCHED") {
        // We joined an existing session — ready to connect
        console.log("[Netplay:useNetplay] ✅ MATCHED! Joined as P2 vs", sess.opponent?.username);
        setIsSearching(false);

        const sessionConfig: SessionConfig = {
          sessionId: sess.id,
          challengeId,
          playerNumber: 2, // We joined as P2
          opponentId: sess.opponent.id,
          opponentName: sess.opponent.username,
        };

        if (mountedRef.current) {
          console.log("[Netplay:useNetplay] Setting session → 'in_game'");
          setSession(sessionConfig);
          setParticipationStatus("in_game");
        }
        return;
      }

      // WAITING — poll for a match
      console.log("[Netplay:useNetplay] ⏳ WAITING — polling every 2s for match...");
      sessionIdRef.current = sess.id;

      matchmakingTimerRef.current = setInterval(async () => {
        if (!mountedRef.current) {
          clearInterval(matchmakingTimerRef.current!);
          return;
        }

        try {
          const pollRes = await fetch(
            `/api/netplay/session?id=${sessionIdRef.current}`,
            { credentials: "include" },
          );
          if (!pollRes.ok) return;

          const pollData = await pollRes.json();
          const pollSess = pollData.session;

          if (pollSess.status === "MATCHED") {
            console.log("[Netplay:useNetplay] ✅ Poll MATCHED! As P1 vs", pollSess.opponent?.username);
            clearInterval(matchmakingTimerRef.current!);
            matchmakingTimerRef.current = null;
            setIsSearching(false);

            if (mountedRef.current) {
              console.log("[Netplay:useNetplay] Setting session → 'in_game'");
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
        } catch (err) {
          console.error("[Netplay:useNetplay] Poll error:", err);
          // Retry next poll
        }
      }, 2000);
    } catch (err) {
      console.error("[Netplay:useNetplay] ❌ startMatchmaking error:", err);
      setError("Erreur réseau");
      setIsSearching(false);
    }
  }, [challengeId, participationStatus, system]);

  // ── Emulator binding ────────────────────────────────────────────

  const bindEmulator = useCallback((newDeps: NetplayEmulatorDeps | InputDelayEmulatorDeps) => {
    const isRollback = "getNes" in newDeps;
    console.log("[Netplay:useNetplay] bindEmulator() called", {
      mode: isRollback ? "rollback (NES)" : "input delay (non-NES)",
      hasGetNes: "getNes" in newDeps && typeof newDeps.getNes === "function",
      hasApplyButton: "applyButton" in newDeps && typeof newDeps.applyButton === "function",
      hasApplyInputs: "applyInputs" in newDeps && typeof (newDeps as NetplayEmulatorDeps).applyInputs === "function",
    });
    depsRef.current = newDeps;
    setDeps(newDeps);
  }, []);

  // ── Start netplay (WebRTC) ──────────────────────────────────────

  const startNetplay = useCallback(async () => {
    console.log("[Netplay:useNetplay] startNetplay() called — delegating to webrtc.start()");
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
