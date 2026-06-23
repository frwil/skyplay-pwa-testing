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

    if (session && deps) {
      const mgr = new NetplayManager(session, deps, (state: NetplayState) => {
        if (!mountedRef.current) return;
        setStatus(state.status);
        setLatency(state.latency);
        setRollbacks(state.rollbacks);
        setError(state.error);
      });
      managerRef.current = mgr;
      setManager(mgr);
    }

    return () => {
      mountedRef.current = false;
      managerRef.current?.stop();
      managerRef.current = null;
      setManager(null);
    };
  }, [session?.sessionId, deps]); // Re-create when session ID or deps change

  // ── Start / Stop ────────────────────────────────────────────────

  const start = useCallback(async () => {
    const manager = managerRef.current;
    if (!manager) return;

    setCountdown(COUNTDOWN_SECONDS);
    await manager.start((remaining) => {
      if (mountedRef.current) setCountdown(remaining);
    });
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
