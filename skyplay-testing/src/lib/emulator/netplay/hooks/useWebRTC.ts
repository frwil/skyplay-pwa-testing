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

  const managerRef = useRef<NetplayManager | null>(null);
  const mountedRef = useRef(true);

  // ── Create / destroy manager when session changes ───────────────

  useEffect(() => {
    mountedRef.current = true;

    if (session && deps) {
      const manager = new NetplayManager(session, deps, (state: NetplayState) => {
        if (!mountedRef.current) return;
        setStatus(state.status);
        setLatency(state.latency);
        setRollbacks(state.rollbacks);
        setError(state.error);
      });
      managerRef.current = manager;
    }

    return () => {
      mountedRef.current = false;
      managerRef.current?.stop();
      managerRef.current = null;
    };
  }, [session?.sessionId]); // Re-create only when session ID changes

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
    manager: managerRef.current,
    start,
    stop,
  };
}
