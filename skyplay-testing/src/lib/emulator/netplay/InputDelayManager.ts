import {
  type SessionConfig,
  type NetplayState,
  type NetplayStatus,
  type NetplayButtonMessage,
  type NetplayDataMessage,
  COUNTDOWN_SECONDS,
  INPUT_DELAY_MS,
  INPUT_DELAY_FLUSH_MS,
} from "./types";
import { WebRTCConnection } from "./WebRTCConnection";

export type StateCallback = (state: NetplayState) => void;
export type CountdownCallback = (remaining: number) => void;

/** Minimal deps needed for Input Delay netplay (non-NES systems). */
export interface InputDelayEmulatorDeps {
  /** Apply a single button press/release to the emulator. */
  applyButton: (player: 1 | 2, button: number, pressed: boolean) => void;
}

interface DelayedInput {
  player: 1 | 2;
  button: number;
  pressed: boolean;
  applyAt: number; // performance.now() at which to apply
}

/**
 * Input Delay manager for non-NES P2P netplay.
 *
 * Unlike rollback (NES-only, requires toJSON/fromJSON), Input Delay
 * works with ANY emulator by adding a fixed ~33ms delay to remote inputs.
 *
 * Lifecycle:
 * 1. WebRTC handshake (same as NES rollback)
 * 2. Countdown 3-2-1-GO!
 * 3. During play:
 *    - Local inputs → apply immediately + send to peer
 *    - Remote inputs → queue → apply after INPUT_DELAY_MS
 * 4. stop() to tear down
 */
export class InputDelayManager {
  private session: SessionConfig;
  private rtc: WebRTCConnection;
  private onStateChange: StateCallback;
  private onCountdown: CountdownCallback | null = null;

  private state: NetplayState;
  private inputQueue: DelayedInput[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;

  /** Callback to apply a button press on the actual emulator. */
  private applyButton: ((player: 1 | 2, button: number, pressed: boolean) => void) | null =
    null;

  // Stable wrapper callbacks
  private boundOnMessage: (msg: NetplayDataMessage) => void;
  private boundOnReady: () => void;

  constructor(session: SessionConfig, onStateChange: StateCallback) {
    this.session = session;
    this.onStateChange = onStateChange;
    this.rtc = new WebRTCConnection();

    this.state = {
      status: "idle",
      latency: 0,
      rollbacks: 0,
      session,
      error: null,
    };

    this.boundOnMessage = (msg) => this.handleMessage(msg);
    this.boundOnReady = () => this.onDataChannelReady();
  }

  // ── Public API ──────────────────────────────────────────────────

  /** Set the function that applies button presses to the emulator. */
  setApplyButton(
    fn: (player: 1 | 2, button: number, pressed: boolean) => void,
  ): void {
    this.applyButton = fn;
  }

  /** Start the WebRTC handshake and countdown. */
  async start(onCountdown?: CountdownCallback): Promise<void> {
    console.log("[InputDelay:Manager] start() called", {
      playerNumber: this.session.playerNumber,
      sessionId: this.session.sessionId,
      opponentId: this.session.opponentId,
      opponentName: this.session.opponentName,
    });
    this.onCountdown = onCountdown ?? null;
    this.setState("connecting");

    this.rtc.setOnMessage(this.boundOnMessage);
    this.rtc.setOnReady(this.boundOnReady);
    this.rtc.setOnLatency((latency) => {
      this.state.latency = Math.round(latency);
    });
    this.rtc.setOnStateChange((connectionState) => {
      console.log("[InputDelay:Manager] RTC connection state:", connectionState);
      if (
        connectionState === "disconnected" ||
        connectionState === "failed" ||
        connectionState === "closed"
      ) {
        if (this.state.status === "playing") {
          console.log("[InputDelay:Manager] ❌ Connection lost during play!");
          this.setState("error");
          this.state.error = "Connection lost";
        }
      }
    });

    try {
      if (this.session.playerNumber === 1) {
        console.log("[InputDelay:Manager] P1: initiating WebRTC handshake...");
        await this.rtc.initiate(this.session.sessionId, this.session.opponentId);
        console.log("[InputDelay:Manager] P1: initiate() completed");
      } else {
        console.log("[InputDelay:Manager] P2: waiting for offer...");
        await this.rtc.accept(this.session.sessionId, this.session.opponentId);
        console.log("[InputDelay:Manager] P2: accept() completed");
      }
    } catch (err) {
      console.error("[InputDelay:Manager] ❌ WebRTC start error:", err);
      this.setState("error");
      this.state.error =
        err instanceof Error ? err.message : "Connection failed";
      this.onStateChange({ ...this.state });
    }
  }

  /**
   * Called by the emulator whenever the local player presses or releases
   * a button.
   *
   * - Applies the button locally immediately (responsive).
   * - Sends the button event to the peer via DataChannel.
   *
   * @param player - Always 1 for local inputs (the local player).
   * @param button - Emulator-specific button index.
   * @param pressed - true for press, false for release.
   */
  onLocalInput(player: 1 | 2, button: number, pressed: boolean): void {
    // Apply locally immediately
    this.applyButton?.(player, button, pressed);

    // Send to peer if we're in playing state
    if (this.state.status === "playing" || this.state.status === "countdown") {
      this.rtc.send({
        type: "button",
        player,
        button,
        pressed,
        seq: this.seq++,
      });
    }
  }

  /** Get the current netplay state. */
  getState(): NetplayState {
    return { ...this.state };
  }

  /** Tear down the connection. */
  stop(): void {
    this.stopFlush();
    this.rtc.close();
    this.onCountdown = null;
    this.inputQueue = [];
    this.setState("finished");
  }

  // ── Private ─────────────────────────────────────────────────────

  private setState(status: NetplayStatus): void {
    this.state.status = status;
    this.onStateChange({ ...this.state });
  }

  private onDataChannelReady(): void {
    console.log("[InputDelay:Manager] 🔗 DataChannel OPEN — sending 'ready' + starting countdown");
    this.setState("connected");

    this.rtc.send({ type: "ready" });
    this.startCountdown();
  }

  private startCountdown(): void {
    console.log("[InputDelay:Manager] ⏱ Starting countdown:", COUNTDOWN_SECONDS);
    this.setState("countdown");

    let remaining = COUNTDOWN_SECONDS;
    this.onCountdown?.(remaining);

    const timer = setInterval(() => {
      remaining--;
      this.onCountdown?.(remaining);

      if (remaining <= 0) {
        console.log("[InputDelay:Manager] 🚀 Countdown complete — sending 'start' → 'playing'");
        clearInterval(timer);

        this.rtc.send({ type: "start", startFrame: 0 });
        this.setState("playing");

        // Start processing the delayed input queue
        this.startFlush();
      }
    }, 1000);
  }

  private handleMessage(msg: NetplayDataMessage): void {
    console.log("[InputDelay:Manager] 📩 handleMessage type:", msg.type, "status:", this.state.status);

    switch (msg.type) {
      case "button": {
        const btnMsg = msg as NetplayButtonMessage;
        // Determine which player this input is for on our side:
        // If WE are P1, then remote is P2; if WE are P2, remote is P1
        const remotePlayer: 1 | 2 =
          this.session.playerNumber === 1 ? 2 : 1;

        // Queue with delay
        this.inputQueue.push({
          player: remotePlayer,
          button: btnMsg.button,
          pressed: btnMsg.pressed,
          applyAt: performance.now() + INPUT_DELAY_MS,
        });
        break;
      }

      case "ready": {
        console.log("[InputDelay:Manager] 📩 Received 'ready' from peer");
        if (this.state.status === "connected") {
          console.log("[InputDelay:Manager] Starting countdown (triggered by peer ready)");
          this.startCountdown();
        }
        break;
      }

      case "start": {
        console.log("[InputDelay:Manager] 📩 Received 'start' from peer → 'playing'");
        this.setState("playing");
        this.startFlush();
        break;
      }

      // Ignore frame-based input messages (from rollback NES path)
      case "input":
      case "ping":
      case "pong":
        break;
    }
  }

  // ── Delayed input processing ────────────────────────────────────

  private startFlush(): void {
    this.stopFlush();
    this.flushTimer = setInterval(() => this.processQueue(), INPUT_DELAY_FLUSH_MS);
  }

  private stopFlush(): void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /** Apply any delayed inputs whose time has come. */
  private processQueue(): void {
    const now = performance.now();
    const remaining: DelayedInput[] = [];

    for (const input of this.inputQueue) {
      if (now >= input.applyAt) {
        this.applyButton?.(input.player, input.button, input.pressed);
      } else {
        remaining.push(input);
      }
    }

    this.inputQueue = remaining;
  }
}
