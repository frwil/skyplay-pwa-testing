import type { EmulatorAdapter } from "../EmulatorAdapter";
import type { EmulatorStatus, RomEntry, SystemType } from "../types";
import { SYSTEM_CONFIGS } from "../EmulatorAdapter";

// Binary frame header layout
const FRAME_HEADER_SIZE = 9; // 1(magic) + 2(width) + 2(height) + 4(frameId)

/**
 * Cloud streaming adapter.
 *
 * Instead of running an emulator locally (WASM or jsnes), this adapter
 * connects to a remote Docker game server via WebSocket and streams
 * MJPEG video frames + Opus audio to the browser canvas.
 *
 * Implements the same EmulatorAdapter interface as local adapters,
 * making it a drop-in replacement for Neo Geo / PS1.
 */
export class CloudAdapter implements EmulatorAdapter {
  readonly systemType: SystemType;

  private ws: WebSocket | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private _status: EmulatorStatus = "idle";
  private _currentRom: string | null = null;
  private _fps: number = 0;
  private _volume: number = 1;
  private _isMuted: boolean = false;
  private callbacks: CloudCallbacks;
  private sessionId: string | null = null;
  private _roomCode: string | null = null;
  private _player: 1 | 2 = 1;
  private lastFrameId: number = 0;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  // Image rendering
  private pendingBitmaps: ImageBitmap[] = [];
  private rafId: number = 0;

  // Audio (Phase 2)
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;

  constructor(systemType: SystemType, callbacks: CloudCallbacks) {
    this.systemType = systemType;
    this.callbacks = callbacks;
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  async loadRom(rom: RomEntry): Promise<void> {
    this._status = "loading";
    this.callbacks.onStatusChange("loading");
    // Use the filename part of the path for the game server (not display name)
    this._currentRom = rom.path.split("/").pop() || rom.name;

    try {
      // 1. Request a cloud gaming session from Vercel API
      const res = await fetch("/api/cloud-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: this.systemType,
          rom: rom.path,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `Session creation failed (${res.status})`);
      }

      const { sessionId, wsUrl, roomCode } = await res.json() as { sessionId: string; wsUrl: string; roomCode: string };
      this.sessionId = sessionId;
      this._roomCode = roomCode;
      this._player = 1;

      // 2. Connect to game server via WebSocket
      await this.connectWebSocket(wsUrl, "init");

      // 3. Wait for "ready" message
      // (handled in connectWebSocket via message listener)

      console.log(`[Cloud:${this.systemType}] Connected — session ${sessionId}`);
    } catch (err) {
      console.error(`[Cloud:${this.systemType}] Failed to load ROM:`, err);
      this._status = "error";
      this.callbacks.onStatusChange("error");
    }
  }

  /**
   * Join an existing cloud gaming session as Player 2 via room code.
   *
   * Used by P2 to connect to a session P1 created. Sends a "join" message
   * instead of "init" — the server adds P2 to the existing session and
   * begins broadcasting frames to the new connection.
   */
  async joinSession(roomCode: string): Promise<void> {
    this._status = "loading";
    this.callbacks.onStatusChange("loading");

    try {
      const res = await fetch("/api/cloud-session/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomCode }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `Join failed (${res.status})`);
      }

      const { sessionId, wsUrl, player } = await res.json() as { sessionId: string; wsUrl: string; player: 2 };
      this.sessionId = sessionId;
      this._player = player;

      await this.connectWebSocket(wsUrl, "join");

      console.log(`[Cloud:${this.systemType}] Joined as P${player} — session ${sessionId}`);
    } catch (err) {
      console.error(`[Cloud:${this.systemType}] Failed to join:`, err);
      this._status = "error";
      this.callbacks.onStatusChange("error");
    }
  }

  private connectWebSocket(wsUrl: string, mode: "init" | "join" = "init"): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = "arraybuffer";

      this.ws.onopen = () => {
        if (mode === "join") {
          this.ws!.send(JSON.stringify({
            type: "join",
            sessionId: this.sessionId,
            token: "",
          }));
        } else {
          this.ws!.send(JSON.stringify({
            type: "init",
            sessionId: this.sessionId,
            token: "", // Token is sent as cookie automatically
            system: this.systemType,
            rom: this._currentRom,
          }));
        }

        // Start ping/pong for latency measurement
        this.startPing();
      };

      this.ws.onmessage = (event) => {
        if (typeof event.data === "string") {
          this.handleTextMessage(event.data);
        } else if (event.data instanceof ArrayBuffer) {
          this.handleBinaryMessage(event.data);
        }
      };

      this.ws.onclose = (event) => {
        console.log(`[Cloud:${this.systemType}] WS closed: ${event.code} ${event.reason}`);
        this.stopPing();
        if (this._status === "running" || this._status === "loading") {
          this._status = "idle";
          this.callbacks.onStatusChange("idle");
        }
      };

      this.ws.onerror = (err) => {
        console.error(`[Cloud:${this.systemType}] WS error:`, err);
        if (this._status === "loading") {
          reject(new Error("WebSocket connection failed"));
        }
      };

      // Timeout after 30s
      setTimeout(() => {
        if (this._status === "loading") {
          reject(new Error("Game server connection timed out"));
        }
      }, 30000);
    });
  }

  private handleTextMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw) as {
        type: string;
        fps?: number;
        frames?: number;
        width?: number;
        height?: number;
        message?: string;
        t?: number;
      };

      switch (msg.type) {
        case "ready": {
          this._status = "running";
          this.callbacks.onStatusChange("running");
          // Set canvas dimensions from stream
          if (msg.width && msg.height && this.canvasEl) {
            this.canvasEl.width = msg.width;
            this.canvasEl.height = msg.height;
          }
          console.log(`[Cloud:${this.systemType}] Stream ready — ${msg.width}x${msg.height}`);
          break;
        }

        case "status": {
          if (msg.fps !== undefined) this._fps = msg.fps;
          break;
        }

        case "error": {
          console.error(`[Cloud:${this.systemType}] Server error:`, msg.message);
          this._status = "error";
          this.callbacks.onStatusChange("error");
          break;
        }

        case "player_joined": {
          const pj = msg as { type: "player_joined"; player: number };
          console.log(`[Cloud:${this.systemType}] Player ${pj.player} joined the session`);
          this.callbacks.onPlayerEvent?.("player_joined", pj.player);
          break;
        }

        case "player_disconnected": {
          const pd = msg as { type: "player_disconnected"; player: number };
          console.log(`[Cloud:${this.systemType}] Player ${pd.player} disconnected`);
          this.callbacks.onPlayerEvent?.("player_disconnected", pd.player);
          break;
        }

        case "pong": {
          // Latency measurement — can be used for UI display
          break;
        }
      }
    } catch {
      // Ignore malformed JSON
    }
  }

  private handleBinaryMessage(data: ArrayBuffer): void {
    if (data.byteLength < FRAME_HEADER_SIZE) return;

    const header = new DataView(data);
    const magic = header.getUint8(0);
    const width = header.getUint16(1, true);
    const height = header.getUint16(3, true);
    const frameId = header.getUint32(5, true);

    if (magic === 0x01) {
      // Video frame
      this.lastFrameId = frameId;

      // Extract JPEG data (skip 9-byte header)
      const jpegData = new Uint8Array(data, FRAME_HEADER_SIZE);
      const blob = new Blob([jpegData], { type: "image/jpeg" });

      // Ensure canvas matches frame dimensions
      if (this.canvasEl && (this.canvasEl.width !== width || this.canvasEl.height !== height)) {
        this.canvasEl.width = width;
        this.canvasEl.height = height;
      }

      // Render via ImageBitmap (off-main-thread decode)
      createImageBitmap(blob).then((bitmap) => {
        if (this.ctx && this.canvasEl) {
          const cw = this.canvasEl.width;
          const ch = this.canvasEl.height;
          // Clear before draw
          this.ctx.clearRect(0, 0, cw, ch);
          // Scale the JPEG (captured at UPSCALE×native) down to canvas size
          this.ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, cw, ch);
        }
        bitmap.close();
      }).catch(() => {
        // Frame decode failed — skip
      });
    } else if (magic === 0x02) {
      // Audio frame — TODO: Phase 2
    }
  }

  private handleReady(msg: { width?: number; height?: number }): void {
    this._status = "running";
    this.callbacks.onStatusChange("running");
  }

  // ── Playback ──────────────────────────────────────────────────

  pause(): void {
    if (this._status !== "running") return;
    this.ws?.send(JSON.stringify({ type: "pause" }));
    this._status = "paused";
    this.callbacks.onStatusChange("paused");
  }

  resume(): void {
    if (this._status !== "paused") return;
    this.ws?.send(JSON.stringify({ type: "resume" }));
    this._status = "running";
    this.callbacks.onStatusChange("running");
  }

  reset(): void {
    // Cloud adapter doesn't support reset — reload instead
    this.ws?.send(JSON.stringify({ type: "stop" }));
  }

  exit(): void {
    this.stopPing();
    if (this.ws) {
      this.ws.send(JSON.stringify({ type: "stop" }));
      this.ws.close();
      this.ws = null;
    }
    this._status = "idle";
    this.callbacks.onStatusChange("idle");
  }

  // ── Canvas ────────────────────────────────────────────────────

  setCanvas(canvas: HTMLCanvasElement): void {
    this.canvasEl = canvas;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      this.ctx = ctx;
    }
  }

  getCanvas(): HTMLCanvasElement | null {
    return this.canvasEl;
  }

  // ── Input ─────────────────────────────────────────────────────

  buttonDown(_player: 1 | 2, button: number): void {
    this.ws?.send(JSON.stringify({
      type: "input",
      player: _player,
      button,
      pressed: true,
    }));
  }

  buttonUp(_player: 1 | 2, button: number): void {
    this.ws?.send(JSON.stringify({
      type: "input",
      player: _player,
      button,
      pressed: false,
    }));
  }

  // ── Volume ────────────────────────────────────────────────────

  get volume(): number { return this._volume; }
  get isMuted(): boolean { return this._isMuted; }

  setVolume(v: number): void {
    this._volume = Math.max(0, Math.min(1, v));
    this._isMuted = v === 0;
    // Volume control for cloud streaming is TBD (Phase 2)
  }

  // ── State ─────────────────────────────────────────────────────

  get status(): EmulatorStatus { return this._status; }
  get fps(): number { return this._fps; }
  get currentRom(): string | null { return this._currentRom; }
  get roomCode(): string | null { return this._roomCode; }
  get player(): 1 | 2 { return this._player; }

  // ── Helpers ───────────────────────────────────────────────────

  private startPing(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping", t: performance.now() }));
      }
    }, 1000);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}

export interface CloudCallbacks {
  onStatusChange: (status: EmulatorStatus) => void;
  /** Fired when another player joins or leaves the session. */
  onPlayerEvent?: (event: "player_joined" | "player_disconnected", player: number) => void;
}
