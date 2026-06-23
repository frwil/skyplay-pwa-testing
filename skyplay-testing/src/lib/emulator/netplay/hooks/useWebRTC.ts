"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { NetplayManager } from "../NetplayManager";
import type { NetplayEmulatorDeps } from "../NetplayManager";
import { InputDelayManager } from "../InputDelayManager";
import type { InputDelayEmulatorDeps } from "../InputDelayManager";
import type { SessionConfig, NetplayState, NetplayStatus } from "../types";
import type { SystemType } from "../../types";
import { COUNTDOWN_SECONDS } from "../types";

interface UseWebRTCOptions {
  session: SessionConfig | null;
  /** Rollback deps (NES) or Input Delay deps (non-NES). */
  deps: NetplayEmulatorDeps | InputDelayEmulatorDeps | null;
  /** Target system — determines whether to use rollback or input delay. */
  system: SystemType;
}

interface UseWebRTCResult {
  status: NetplayStatus;
  latency: number;
  rollbacks: number;
  error: string | null;
  countdown: number;
  manager: NetplayManager | InputDelayManager | null;
  start: () => Promise<void>;
  stop: () => void;
}

/**
 * Wraps NetplayManager (rollback for NES) or InputDelayManager
 * (input delay for non-NES) in React-friendly state.
 */
export function useWebRTC({ session, deps, system }: UseWebRTCOptions): UseWebRTCResult {
  const [status, setStatus] = useState<NetplayStatus>("idle");
  const [latency, setLatency] = useState(0);
  const [rollbacks, setRollbacks] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [manager, setManager] = useState<NetplayManager | InputDelayManager | null>(null);

  const managerRef = useRef<NetplayManager | InputDelayManager | null>(null);
  const mountedRef = useRef(true);

  const isNes = system === "nes";

  // ── Create / destroy manager when session or deps change ───────

  useEffect(() => {
    mountedRef.current = true;
    console.log("[Netplay:useWebRTC] useEffect trigger", {
      hasSession: !!session,
      sessionId: session?.sessionId,
      hasDeps: !!deps,
      system,
      playerNumber: session?.playerNumber,
      opponentName: session?.opponentName,
    });

    if (session) {
      if (isNes && deps) {
        // ── NES: Rollback netplay ────────────────────────────────
        console.log("[Netplay:useWebRTC] ✅ Creating NetplayManager (rollback, NES)...");
        const mgr = new NetplayManager(
          session,
          deps as NetplayEmulatorDeps,
          (state: NetplayState) => {
            if (!mountedRef.current) return;
            setStatus(state.status);
            setLatency(state.latency);
            setRollbacks(state.rollbacks);
            setError(state.error);
          },
        );
        managerRef.current = mgr;
        setManager(mgr);
        console.log("[Netplay:useWebRTC] ✅ NetplayManager created and stored in state");
      } else if (!isNes) {
        // ── Non-NES: Input Delay netplay ─────────────────────────
        console.log("[Netplay:useWebRTC] ✅ Creating InputDelayManager (input delay, non-NES)...");
        const mgr = new InputDelayManager(
          session,
          (state: NetplayState) => {
            if (!mountedRef.current) return;
            setStatus(state.status);
            setLatency(state.latency);
            setRollbacks(state.rollbacks);
            setError(state.error);
          },
        );
        // Wire applyButton if deps are already available
        if (deps) {
          mgr.setApplyButton((deps as InputDelayEmulatorDeps).applyButton);
          console.log("[Netplay:useWebRTC] ✅ applyButton wired to InputDelayManager");
        }
        managerRef.current = mgr;
        setManager(mgr);
        console.log("[Netplay:useWebRTC] ✅ InputDelayManager created and stored in state");
      } else {
        // NES without deps — wait
        console.log("[Netplay:useWebRTC] ⏳ NES session available but no deps yet — waiting...");
      }
    } else {
      console.log("[Netplay:useWebRTC] ⏳ Skipping — need session", {
        hasSession: !!session,
        hasDeps: !!deps,
        system,
      });
    }

    return () => {
      console.log("[Netplay:useWebRTC] useEffect cleanup — destroying manager");
      mountedRef.current = false;
      managerRef.current?.stop();
      managerRef.current = null;
      setManager(null);
    };
  }, [session?.sessionId, deps, system]); // Re-create when session ID, deps, or system change

  // ── Wire applyButton for InputDelayManager when deps arrive after creation ──

  useEffect(() => {
    const mgr = managerRef.current;
    if (mgr instanceof InputDelayManager && deps) {
      console.log("[Netplay:useWebRTC] Wiring applyButton (deps arrived after manager creation)");
      mgr.setApplyButton((deps as InputDelayEmulatorDeps).applyButton);
    }
  }, [deps]);

  // ── Start / Stop ────────────────────────────────────────────────

  const start = useCallback(async () => {
    const manager = managerRef.current;
    console.log("[Netplay:useWebRTC] start() called", {
      hasManager: !!manager,
      managerType: manager?.constructor.name,
    });
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
