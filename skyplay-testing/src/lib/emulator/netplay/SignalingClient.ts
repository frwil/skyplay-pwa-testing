import { SIGNALING_POLL_MS } from "./types";

export type SignalType = "offer" | "answer" | "ice_candidate" | "ready" | "start";

export interface Signal {
  id: number;
  fromUserId: number;
  type: SignalType;
  payload: string;
  createdAt: string;
}

/**
 * HTTP polling client for WebRTC signaling.
 *
 * Since Vercel doesn't support WebSocket, we exchange SDP offers/answers
 * and ICE candidates through the `/api/netplay/signal` REST endpoint.
 * The client polls every ~200ms during the handshake phase.
 */
export class SignalingClient {
  private sessionId: number;
  private toUserId: number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastSignalId = 0;
  private onSignal: ((signal: Signal) => void) | null = null;
  private onError: ((err: Error) => void) | null = null;
  private aborted = false;

  constructor(sessionId: number, toUserId: number) {
    this.sessionId = sessionId;
    this.toUserId = toUserId;
  }

  // ── Public API ──────────────────────────────────────────────────

  /** Begin polling for incoming signals. Calls onSignal for each new message. */
  startPolling(
    onSignal: (signal: Signal) => void,
    onError?: (err: Error) => void,
  ): void {
    this.onSignal = onSignal;
    this.onError = onError ?? null;
    this.aborted = false;
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), SIGNALING_POLL_MS);
  }

  /** Send a signaling message to the peer. */
  async send(type: SignalType, payload: string): Promise<void> {
    try {
      const res = await fetch("/api/netplay/signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: this.sessionId,
          toUserId: this.toUserId,
          type,
          payload,
        }),
        credentials: "include",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Signal send failed: ${res.status}`);
      }
    } catch (err) {
      this.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** Stop polling and clean up. */
  stop(): void {
    this.aborted = true;
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.onSignal = null;
  }

  // ── Private ─────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    if (this.aborted) return;

    try {
      const res = await fetch(
        `/api/netplay/signal?sessionId=${this.sessionId}&since=${this.lastSignalId}`,
        { credentials: "include" },
      );

      if (res.status === 401 || res.status === 403) {
        this.onError?.(new Error("Signal polling auth error"));
        return;
      }

      if (!res.ok) return; // Retry next poll

      const data = await res.json();
      const signals: Signal[] = data.signals ?? [];

      for (const signal of signals) {
        this.lastSignalId = Math.max(this.lastSignalId, signal.id);
        this.onSignal?.(signal);
      }
    } catch {
      // Network error — retry next poll, don't spam
    }
  }
}
