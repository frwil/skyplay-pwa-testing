import {
  RTC_CONFIG,
  DATA_CHANNEL_LABEL,
  PING_INTERVAL_MS,
  type NetplayDataMessage,
} from "./types";
import { SignalingClient, type Signal } from "./SignalingClient";

export type ConnectionStateCallback = (state: RTCPeerConnectionState) => void;
export type MessageCallback = (message: NetplayDataMessage) => void;
export type LatencyCallback = (latencyMs: number) => void;

/**
 * Manages a WebRTC peer-to-peer connection with a single DataChannel.
 *
 * Lifecycle:
 * 1. `initiate(sessionId, toUserId)` — creates offer, starts signaling
 * 2. `accept(sessionId, toUserId)` — waits for offer, responds with answer
 * 3. DataChannel opens → `onReady` callback fires
 * 4. `send(message)` enqueues on the DataChannel
 * 5. `close()` tears everything down
 */
export class WebRTCConnection {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private signaling: SignalingClient | null = null;

  private onStateChange: ConnectionStateCallback | null = null;
  private onMessage: MessageCallback | null = null;
  private onLatency: LatencyCallback | null = null;
  private onReady: (() => void) | null = null;

  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private isInitiator = false;
  private destroyed = false;

  // ── Public API ──────────────────────────────────────────────────

  /** P1 calls this to start the WebRTC handshake. */
  async initiate(
    sessionId: number,
    toUserId: number,
  ): Promise<void> {
    console.log("[WebRTC:Connection] P1 initiate() — sessionId:", sessionId, "toUserId:", toUserId);
    this.isInitiator = true;
    this.destroyed = false;

    this.signaling = new SignalingClient(sessionId, toUserId);
    this.signaling.startPolling(
      (signal) => {
        this.handleSignal(signal).catch((err) =>
          console.log("[WebRTC:Connection] ⚠️ Signal handling error (non-fatal):", err.message),
        );
      },
      (err) => console.error("[WebRTC:Connection] Signaling error:", err),
    );
    console.log("[WebRTC:Connection] Signaling polling started");

    this.createPeerConnection();
    console.log("[WebRTC:Connection] PeerConnection created, creating DataChannel...");

    // Create DataChannel (initiator side)
    this.dc = this.pc!.createDataChannel(DATA_CHANNEL_LABEL, {
      ordered: false,       // Low latency — no head-of-line blocking
      maxRetransmits: 0,    // Don't retransmit stale inputs
    });
    this.setupDataChannel(this.dc);
    console.log("[WebRTC:Connection] DataChannel created, label:", DATA_CHANNEL_LABEL);

    // Create and send SDP offer
    const offer = await this.pc!.createOffer();
    await this.pc!.setLocalDescription(offer);
    console.log("[WebRTC:Connection] SDP offer created, sending via signaling...");

    // Wait for ICE gathering to complete, then send
    // (We send immediately and also trickle ICE candidates)
    await this.signaling.send("offer", JSON.stringify(this.pc!.localDescription));
    console.log("[WebRTC:Connection] Offer sent via signaling");
  }

  /** P2 calls this to accept an incoming connection. */
  async accept(
    sessionId: number,
    toUserId: number,
  ): Promise<void> {
    console.log("[WebRTC:Connection] P2 accept() — sessionId:", sessionId, "toUserId:", toUserId);
    this.isInitiator = false;
    this.destroyed = false;

    this.signaling = new SignalingClient(sessionId, toUserId);
    this.signaling.startPolling(
      (signal) => {
        this.handleSignal(signal).catch((err) =>
          console.log("[WebRTC:Connection] ⚠️ Signal handling error (non-fatal):", err.message),
        );
      },
      (err) => console.error("[WebRTC:Connection] Signaling error:", err),
    );
    console.log("[WebRTC:Connection] P2 signaling polling started, waiting for offer...");

    // PeerConnection will be created when we receive the offer
    // The DataChannel will arrive via ondatachannel event
  }

  /** Send a message over the DataChannel. */
  send(message: NetplayDataMessage): void {
    if (this.dc?.readyState === "open") {
      try {
        this.dc.send(JSON.stringify(message));
      } catch {
        console.log("[WebRTC:Connection] ⚠️ DataChannel send failed (closed between check and send)");
      }
    } else {
      console.log("[WebRTC:Connection] ⚠️ Cannot send — DataChannel not open. readyState:", this.dc?.readyState ?? "no dc");
    }
  }

  /** Register callbacks. */
  setOnReady(cb: () => void): void { this.onReady = cb; }
  setOnMessage(cb: MessageCallback): void { this.onMessage = cb; }
  setOnStateChange(cb: ConnectionStateCallback): void { this.onStateChange = cb; }
  setOnLatency(cb: LatencyCallback): void { this.onLatency = cb; }

  /** Tear down the connection. */
  close(): void {
    this.destroyed = true;
    this.stopPing();
    this.signaling?.stop();
    this.dc?.close();
    this.pc?.close();
    this.pc = null;
    this.dc = null;
    this.signaling = null;
    this.onReady = null;
    this.onMessage = null;
    this.onStateChange = null;
    this.onLatency = null;
  }

  // ── Private: PeerConnection ──────────────────────────────────────

  private createPeerConnection(): void {
    this.pc = new RTCPeerConnection(RTC_CONFIG);

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signaling?.send(
          "ice_candidate",
          JSON.stringify(event.candidate),
        );
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc?.connectionState ?? "disconnected";
      this.onStateChange?.(state);

      if (state === "disconnected" || state === "failed" || state === "closed") {
        this.stopPing();
      }
    };

    // Handle incoming DataChannel (answerer side)
    this.pc.ondatachannel = (event) => {
      this.dc = event.channel;
      this.setupDataChannel(this.dc);
    };
  }

  // ── Private: DataChannel ─────────────────────────────────────────

  private setupDataChannel(channel: RTCDataChannel): void {
    console.log("[WebRTC:Connection] setupDataChannel — readyState:", channel.readyState);
    channel.onopen = () => {
      console.log("[WebRTC:Connection] 🔗 DataChannel OPEN! Firing onReady callback");
      this.startPing();
      this.onReady?.();
    };

    channel.onclose = () => {
      console.log("[WebRTC:Connection] DataChannel closed");
      this.stopPing();
    };

    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as NetplayDataMessage;
        console.log("[WebRTC:Connection] DataChannel message received:", message.type);
        this.handleMessage(message);
      } catch {
        console.log("[WebRTC:Connection] DataChannel: malformed message ignored");
      }
    };
  }

  // ── Private: Signal Handling ─────────────────────────────────────

  private async handleSignal(signal: Signal): Promise<void> {
    if (this.destroyed) return;

    console.log("[WebRTC:Connection] 📡 handleSignal:", signal.type, "from:", signal.fromUserId, "id:", signal.id);
    const data = JSON.parse(signal.payload);

    switch (signal.type) {
      case "offer": {
        console.log("[WebRTC:Connection] Received OFFER, creating PeerConnection + sending ANSWER");
        this.createPeerConnection();
        await this.pc!.setRemoteDescription(
          new RTCSessionDescription(data),
        );
        const answer = await this.pc!.createAnswer();
        await this.pc!.setLocalDescription(answer);
        await this.signaling!.send(
          "answer",
          JSON.stringify(this.pc!.localDescription),
        );
        console.log("[WebRTC:Connection] ANSWER sent");
        break;
      }

      case "answer": {
        // Guard: ignore duplicate answers (polling may return the same signal twice)
        if (this.pc!.signalingState !== "have-local-offer") {
          console.log("[WebRTC:Connection] ⚠️ Ignoring answer — signaling state is:", this.pc!.signalingState);
          break;
        }
        console.log("[WebRTC:Connection] Received ANSWER, setting remote description");
        await this.pc!.setRemoteDescription(
          new RTCSessionDescription(data),
        );
        break;
      }

      case "ice_candidate": {
        try {
          await this.pc?.addIceCandidate(new RTCIceCandidate(data));
          console.log("[WebRTC:Connection] ICE candidate added");
        } catch (err) {
          console.log("[WebRTC:Connection] ICE candidate ignored:", err);
        }
        break;
      }

      case "ready":
      case "start":
        console.log("[WebRTC:Connection] Received", signal.type, "(via signaling — before DataChannel open)");
        // Forwarded to message handler — these are DataChannel messages
        // relayed via signaling before DataChannel is open
        break;
    }
  }

  // ── Private: Message Handling ────────────────────────────────────

  private handleMessage(message: NetplayDataMessage): void {
    switch (message.type) {
      case "ping": {
        this.send({
          type: "pong",
          timestamp: performance.now(),
          originalTimestamp: message.timestamp,
        });
        break;
      }
      case "pong": {
        const rtt = performance.now() - message.originalTimestamp;
        this.onLatency?.(rtt);
        break;
      }
      default: {
        this.onMessage?.(message);
      }
    }
  }

  // ── Private: Ping/Pong ───────────────────────────────────────────

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.send({ type: "ping", timestamp: performance.now() });
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}
