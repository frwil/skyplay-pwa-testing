import {
  type SessionConfig,
  type NetplayState,
  type NetplayStatus,
  type NetplayInputMessage,
  type NetplayStartMessage,
  type NetplayDataMessage,
  COUNTDOWN_SECONDS,
} from "./types";
import { WebRTCConnection } from "./WebRTCConnection";
import { RollbackEngine } from "./RollbackEngine";
import type { StateBuffer } from "../buffers/StateBuffer";
import type { InputBuffer } from "../buffers/InputBuffer";

/**
 * Dependencies injected from the emulator game loop.
 * The NetplayManager needs access to the emulator internals
 * to perform rollbacks and read/write inputs.
 */
export interface NetplayEmulatorDeps {
  /** Reference to the jsnes instance. */
  getNes: () => {
    fromJSON(state: object): void;
    frame(): void;
  } | null;
  /** The circular state buffer for savestates. */
  stateBuffer: StateBuffer;
  /** The circular input buffer for input records. */
  inputBuffer: InputBuffer;
  /** Mute audio during fast-forward replay. */
  muteAudio: () => void;
  /** Unmute audio after fast-forward replay. */
  unmuteAudio: () => void;
  /**
   * Inject button transitions into jsnes.
   * Uses edge-detection: only calls buttonDown/buttonUp on changes.
   */
  applyInputs: (player: 1 | 2, bitmask: number, prevBitmask: number) => void;
}

export type StateCallback = (state: NetplayState) => void;
export type CountdownCallback = (remaining: number) => void;

/**
 * NetplayManager is the bridge between the WebRTC connection,
 * the RollbackEngine, and the emulator game loop.
 *
 * Lifecycle:
 * ```
 * const manager = new NetplayManager(session, deps, onStateChange);
 * await manager.start();     // WebRTC handshake → countdown → playing
 *
 * // In the game loop, every frame:
 * const predictedP2 = manager.onFrame(currentFrame, localInput);
 *
 * // When done:
 * manager.stop();
 * ```
 */
export class NetplayManager {
  private session: SessionConfig;
  private deps: NetplayEmulatorDeps;
  private rtc: WebRTCConnection;
  private rollback: RollbackEngine;
  private onStateChange: StateCallback;
  private onCountdown: CountdownCallback | null = null;

  private state: NetplayState;
  private latestRemoteInput: { p1: number; p2: number } = { p1: 0, p2: 0 };

  // Stable wrapper callbacks so we can unsubscribe on stop()
  private boundOnMessage: (msg: NetplayDataMessage) => void;
  private boundOnReady: () => void;

  constructor(
    session: SessionConfig,
    deps: NetplayEmulatorDeps,
    onStateChange: StateCallback,
  ) {
    this.session = session;
    this.deps = deps;
    this.onStateChange = onStateChange;
    this.rtc = new WebRTCConnection();
    this.rollback = new RollbackEngine();

    this.state = {
      status: "idle",
      latency: 0,
      rollbacks: 0,
      session,
      error: null,
    };

    // Bind stable callbacks
    this.boundOnMessage = (msg) => this.handleMessage(msg);
    this.boundOnReady = () => this.onDataChannelReady();
  }

  // ── Public API ──────────────────────────────────────────────────

  /** Start the connection and begin the countdown. */
  async start(onCountdown?: CountdownCallback): Promise<void> {
    this.onCountdown = onCountdown ?? null;
    this.setState("connecting");

    this.rtc.setOnMessage(this.boundOnMessage);
    this.rtc.setOnReady(this.boundOnReady);
    this.rtc.setOnLatency((latency) => {
      this.state.latency = Math.round(latency);
    });
    this.rtc.setOnStateChange((connectionState) => {
      if (
        connectionState === "disconnected" ||
        connectionState === "failed" ||
        connectionState === "closed"
      ) {
        if (this.state.status === "playing") {
          this.setState("error");
          this.state.error = "Connection lost";
        }
      }
    });

    try {
      if (this.session.playerNumber === 1) {
        // P1 initiates the WebRTC handshake
        await this.rtc.initiate(this.session.sessionId, this.session.opponentId);
      } else {
        // P2 waits for the offer
        await this.rtc.accept(this.session.sessionId, this.session.opponentId);
      }
    } catch (err) {
      this.setState("error");
      this.state.error = err instanceof Error ? err.message : "Connection failed";
      this.onStateChange({ ...this.state });
    }
  }

  /**
   * Called by the emulator game loop every frame.
   *
   * 1. Sends our local input to the peer via DataChannel
   * 2. Returns the predicted opponent input for THIS frame
   *
   * @param currentFrame - Absolute frame number about to be rendered
   * @param localInput - Our button bitmask for this frame
   * @returns The predicted opponent input bitmask
   */
  onFrame(currentFrame: number, localInput: number): number {
    if (this.state.status !== "playing" && this.state.status !== "countdown") {
      // Not ready yet — return 0 as opponent input
      return this.latestRemoteInput.p1 !== undefined
        ? (this.session.playerNumber === 1 ? this.latestRemoteInput.p2 : this.latestRemoteInput.p1)
        : 0;
    }

    const isP1 = this.session.playerNumber === 1;

    // 1. Send our local input to the peer
    const inputMsg: NetplayInputMessage = {
      type: "input",
      frame: currentFrame,
    };
    if (isP1) {
      inputMsg.p1 = localInput;
    } else {
      inputMsg.p2 = localInput;
    }
    this.rtc.send(inputMsg);

    // 2. Return predicted opponent input
    if (isP1) {
      return this.latestRemoteInput.p2;
    } else {
      return this.latestRemoteInput.p1;
    }
  }

  /**
   * Process any late-arriving remote inputs via the rollback engine.
   * Called AFTER the emulator has advanced one frame.
   *
   * @param currentFrame - The absolute frame number just rendered.
   */
  afterFrame(currentFrame: number): void {
    if (this.state.status !== "playing") return;

    const nes = this.deps.getNes();
    if (!nes) return;

    const rollbacks = this.rollback.processRemoteInputs(
      currentFrame,
      nes,
      this.deps.stateBuffer,
      this.deps.inputBuffer,
      this.deps.muteAudio,
      this.deps.unmuteAudio,
      this.deps.applyInputs,
    );

    this.state.rollbacks = this.rollback.rollbackCount;
  }

  /** Get the current netplay state (for React rendering). */
  getState(): NetplayState {
    return { ...this.state };
  }

  /** Tear down the connection and clean up. */
  stop(): void {
    this.rtc.close();
    this.rollback.reset();
    this.onCountdown = null;
    this.setState("finished");
  }

  // ── Private ─────────────────────────────────────────────────────

  private setState(status: NetplayStatus): void {
    this.state.status = status;
    this.onStateChange({ ...this.state });
  }

  private onDataChannelReady(): void {
    this.setState("connected");

    // Send ready signal, then start countdown
    this.rtc.send({ type: "ready" });
    this.startCountdown();
  }

  private startCountdown(): void {
    this.setState("countdown");

    let remaining = COUNTDOWN_SECONDS;
    this.onCountdown?.(remaining);

    const timer = setInterval(() => {
      remaining--;
      this.onCountdown?.(remaining);

      if (remaining <= 0) {
        clearInterval(timer);

        // Both sides start on the same frame number
        this.rtc.send({ type: "start", startFrame: 0 });
        this.setState("playing");
      }
    }, 1000);
  }

  private handleMessage(msg: NetplayDataMessage): void {
    switch (msg.type) {
      case "input": {
        const inputMsg = msg as unknown as NetplayInputMessage;
        // Update our latest known remote input for prediction
        if (inputMsg.p1 !== undefined) this.latestRemoteInput.p1 = inputMsg.p1;
        if (inputMsg.p2 !== undefined) this.latestRemoteInput.p2 = inputMsg.p2;

        // If the input is for a past frame (or current), queue for rollback
        // The RollbackEngine handles late inputs
        if (this.state.status === "playing") {
          this.rollback.queueRemoteInput(
            inputMsg.frame,
            inputMsg.p1,
            inputMsg.p2,
          );
        }
        break;
      }

      case "ready": {
        // Peer's DataChannel is open — if we haven't started countdown yet
        if (this.state.status === "connected") {
          this.startCountdown();
        }
        break;
      }

      case "start": {
        const startMsg = msg as unknown as NetplayStartMessage;
        // Synchronize start: both sides begin at the same frame
        // startMsg.startFrame is the agreed-upon starting frame
        this.setState("playing");
        break;
      }
    }
  }
}
