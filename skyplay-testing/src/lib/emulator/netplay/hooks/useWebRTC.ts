"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { NetplayManager } from "../NetplayManager";
import type { NetplayEmulatorDeps } from "../NetplayManager";
import type { SessionConfig, NetplayState, NetplayStatus } from "../types";
import { COUNTDOWN_SECONDS } from "../types";

interface UseWebRTCOptions {
  session: SessionConfig | null;
  deps: NetplayEmulatorDeps | null;
}

interface UseWebRTCResult {
  status: NetplayStatus;
  latency: number;
  rollbacks: number;
  error: string | null;
  countdown: number;
  manager: NetplayManager | null;
  start: () => Promise<void>;
  stop: () => void;
}

/**
 * Wraps NetplayManager in React-friendly state.
 *
 * Creates a NetplayManager when `session` and `deps` are provided,
 * exposes its state reactively, and provides start/stop controls.
 */
export function useWebRTC({ session, deps }: UseWebRTCOptions): UseWebRTCResult {
  const [status, setStatus] = useState<NetplayStatus>("idle");
  const [latency, setLatency] = useState(0);
  const [rollbacks, setRollbacks] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [manager, setManager] = useState<NetplayManager | null>(null);

  const managerRef = useRef<NetplayManager | null>(null);
  const mountedRef = useRef(true);

  // ── Create / destroy manager when session or deps change ───────

  useEffect(() => {
    mountedRef.current = true;
    console.log("[Netplay:useWebRTC] useEffect trigger", {
      hasSession: !!session,
      sessionId: session?.sessionId,
      hasDeps: !!deps,
      playerNumber: session?.playerNumber,
      opponentName: session?.opponentName,
    });

    if (session && deps) {
      console.log("[Netplay:useWebRTC] ✅ Creating NetplayManager...");
      const mgr = new NetplayManager(session, deps, (state: NetplayState) => {
        if (!mountedRef.current) return;
        setStatus(state.status);
        setLatency(state.latency);
        setRollbacks(state.rollbacks);
        setError(state.error);
      });
      managerRef.current = mgr;
      setManager(mgr);
      console.log("[Netplay:useWebRTC] ✅ NetplayManager created and stored in state");
    } else {
      console.log("[Netplay:useWebRTC] ⏳ Skipping manager creation — need both session AND deps", {
        hasSession: !!session,
        hasDeps: !!deps,
      });
    }

    return () => {
      console.log("[Netplay:useWebRTC] useEffect cleanup — destroying manager");
      mountedRef.current = false;
      managerRef.current?.stop();
      managerRef.current = null;
      setManager(null);
    };
  }, [session?.sessionId, deps]); // Re-create when session ID or deps change

  // ── Start / Stop ────────────────────────────────────────────────

  const start = useCallback(async () => {
    const manager = managerRef.current;
    console.log("[Netplay:useWebRTC] start() called", { hasManager: !!manager });
    if (!manager) {
      console.log("[Netplay:useWebRTC] ❌ start: no manager, returning");
      return;
    }

    setCountdown(COUNTDOWN_SECONDS);
    console.log("[Netplay:useWebRTC] Calling manager.start()...");
    await manager.start((remaining) => {
      if (mountedRef.current) setCountdown(remaining);
    });
    console.log("[Netplay:useWebRTC] manager.start() completed");
  }, []);

  const stop = useCallback(() => {
    managerRef.current?.stop();
    managerRef.current = null;
  }, []);

  return {
    status,
    latency,
    rollbacks,
    error,
    countdown,
    manager,
    start,
    stop,
  };
}
