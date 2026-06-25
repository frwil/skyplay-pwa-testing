import type { EmulatorAdapter } from "../EmulatorAdapter";
import type { EmulatorStatus, RomEntry, SystemType } from "../types";
import { SYSTEM_CONFIGS } from "../EmulatorAdapter";

// Binary frame header sizes
const FRAME_HEADER_SIZE = 11;  // 1(magic) + 2(w) + 2(h) + 4(id) + 2(nalLen)
const AUDIO_HEADER_SIZE = 5;   // 1(magic) + 4(opusLen)
const CODEC_CFG_HEADER_SIZE = 3; // 1(magic) + 2(payloadLen)

/**
 * Cloud streaming adapter with WebCodecs hardware-accelerated decoding.
 *
 * Connects to a remote Docker game server via WebSocket and decodes:
 * - H.264 video via VideoDecoder API → canvas
 * - Opus audio via AudioDecoder API → AudioContext
 *
 * This replaces the old MJPEG/ImageBitmap approach with browser-native
 * hardware-accelerated codecs, giving much better compression and lower
 * CPU usage.
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

  // WebCodecs — Video
  private videoDecoder: VideoDecoder | null = null;
  private videoDecoderReady = false;
  private pendingVideoChunks: EncodedVideoChunk[] = [];
  private streamWidth = 320;
  private streamHeight = 224;

  // WebCodecs — Audio
  private audioDecoder: AudioDecoder | null = null;
  private audioDecoderReady = false;
  private pendingAudioChunks: EncodedAudioChunk[] = [];
  private audioCtx: AudioContext | null = null;

  constructor(systemType: SystemType, callbacks: CloudCallbacks) {
    this.systemType = systemType;
    this.callbacks = callbacks;
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  async loadRom(rom: RomEntry): Promise<void> {
    this._status = "loading";
    this.callbacks.onStatusChange("loading");
    this._currentRom = rom.path.split("/").pop() || rom.name;

    try {
      const res = await fetch("/api/cloud-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system: this.systemType, rom: rom.path }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `Session creation failed (${res.status})`);
      }

      const { sessionId, wsUrl, roomCode } = await res.json() as { sessionId: string; wsUrl: string; roomCode: string };
      this.sessionId = sessionId;
      this._roomCode = roomCode;
      this._player = 1;

      await this.connectWebSocket(wsUrl, "init");
      console.log(`[Cloud:${this.systemType}] Connected — session ${sessionId}`);
    } catch (err) {
      console.error(`[Cloud:${this.systemType}] Failed to load ROM:`, err);
      this._status = "error";
      this.callbacks.onStatusChange("error");
    }
  }

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
            token: "",
            system: this.systemType,
            rom: this._currentRom,
          }));
        }
        this.startPing();
      };

      this.ws.onmessage = (event) => {
        if (typeof event.data === "string") {
          this.handleTextMessage(event.data, resolve);
        } else if (event.data instanceof ArrayBuffer) {
          this.handleBinaryMessage(event.data);
        }
      };

      this.ws.onclose = (event) => {
        console.log(`[Cloud:${this.systemType}] WS closed: ${event.code} ${event.reason}`);
        this.stopPing();
        this.closeDecoders();
        if (this._status === "running" || this._status === "loading") {
          this._status = "idle";
          this.callbacks.onStatusChange("idle");
        }
      };

      this.ws.onerror = () => {
        if (this._status === "loading") {
          reject(new Error("WebSocket connection failed"));
        }
      };

      setTimeout(() => {
        if (this._status === "loading") {
          reject(new Error("Game server connection timed out"));
        }
      }, 30000);
    });
  }

  // ── WebCodecs Decoder Setup ──────────────────────────────────

  private async initVideoDecoder(config: { codec: string; width: number; height: number; framerate: number }): Promise<void> {
    try {
      this.streamWidth = config.width;
      this.streamHeight = config.height;

      const init: VideoDecoderInit = {
        output: (frame: VideoFrame) => {
          if (this.ctx && this.canvasEl) {
            // Ensure canvas matches frame dimensions
            const cw = this.canvasEl.width;
            const ch = this.canvasEl.height;
            if (cw !== frame.displayWidth || ch !== frame.displayHeight) {
              this.canvasEl.width = frame.displayWidth;
              this.canvasEl.height = frame.displayHeight;
            }
            this.ctx.clearRect(0, 0, cw, ch);
            this.ctx.drawImage(frame, 0, 0, cw, ch);
          }
          frame.close();
        },
        error: (err) => {
          console.error(`[Cloud:${this.systemType}] VideoDecoder error:`, err);
        },
      };

      const support = await VideoDecoder.isConfigSupported({
        codec: config.codec,
        codedWidth: config.width,
        codedHeight: config.height,
      });

      if (!support.supported) {
        console.warn(`[Cloud:${this.systemType}] H.264 codec not supported, falling back`);
        // The server sends raw NAL units; we'll try a different codec string
        return;
      }

      this.videoDecoder = new VideoDecoder(init);
      this.videoDecoder.configure({
        codec: config.codec,
        codedWidth: config.width,
        codedHeight: config.height,
      });
      this.videoDecoderReady = true;

      // Flush pending chunks
      for (const chunk of this.pendingVideoChunks) {
        this.videoDecoder.decode(chunk);
      }
      this.pendingVideoChunks = [];

      console.log(`[Cloud:${this.systemType}] VideoDecoder ready: ${config.codec} ${config.width}x${config.height}`);
    } catch (err) {
      console.error(`[Cloud:${this.systemType}] Failed to init VideoDecoder:`, err);
    }
  }

  private async initAudioDecoder(config: { codec: string; sampleRate: number; channels: number }): Promise<void> {
    try {
      // Initialize AudioContext on first audio data
      if (!this.audioCtx) {
        this.audioCtx = new AudioContext({ sampleRate: config.sampleRate });
      }

      const init: AudioDecoderInit = {
        output: (data: AudioData) => {
          if (!this.audioCtx || this._isMuted) {
            data.close();
            return;
          }
          try {
            const buf = this.audioCtx.createBuffer(
              data.numberOfChannels,
              data.numberOfFrames,
              data.sampleRate,
            );

            // Copy PCM data
            for (let ch = 0; ch < data.numberOfChannels; ch++) {
              const channelData = new Float32Array(data.numberOfFrames);
              data.copyTo(channelData, { planeIndex: ch, format: "f32-planar" });
              buf.copyToChannel(channelData, ch);
            }

            const source = this.audioCtx.createBufferSource();
            source.buffer = buf;
            const gain = this.audioCtx.createGain();
            gain.gain.value = this._volume;
            source.connect(gain).connect(this.audioCtx.destination);
            source.start();
            data.close();
          } catch {
            data.close();
          }
        },
        error: (err) => {
          console.error(`[Cloud:${this.systemType}] AudioDecoder error:`, err);
        },
      };

      const support = await AudioDecoder.isConfigSupported({
        codec: config.codec,
        sampleRate: config.sampleRate,
        numberOfChannels: config.channels,
      });

      if (!support.supported) {
        console.warn(`[Cloud:${this.systemType}] Opus codec not supported`);
        return;
      }

      this.audioDecoder = new AudioDecoder(init);
      this.audioDecoder.configure({
        codec: config.codec,
        sampleRate: config.sampleRate,
        numberOfChannels: config.channels,
      });
      this.audioDecoderReady = true;

      // Flush pending chunks
      for (const chunk of this.pendingAudioChunks) {
        this.audioDecoder.decode(chunk);
      }
      this.pendingAudioChunks = [];

      console.log(`[Cloud:${this.systemType}] AudioDecoder ready: Opus ${config.sampleRate}Hz ${config.channels}ch`);
    } catch (err) {
      console.error(`[Cloud:${this.systemType}] Failed to init AudioDecoder:`, err);
    }
  }

  private closeDecoders(): void {
    if (this.videoDecoder) {
      try { this.videoDecoder.close(); } catch { /* ok */ }
      this.videoDecoder = null;
      this.videoDecoderReady = false;
    }
    if (this.audioDecoder) {
      try { this.audioDecoder.close(); } catch { /* ok */ }
      this.audioDecoder = null;
      this.audioDecoderReady = false;
    }
    this.pendingVideoChunks = [];
    this.pendingAudioChunks = [];
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  }

  // ── Message Handlers ─────────────────────────────────────────

  private handleTextMessage(raw: string, readyResolve?: (value: void | PromiseLike<void>) => void): void {
    try {
      const msg = JSON.parse(raw) as {
        type: string;
        fps?: number;
        frames?: number;
        width?: number;
        height?: number;
        message?: string;
        t?: number;
        player?: number;
      };

      switch (msg.type) {
        case "ready": {
          this._status = "running";
          this.callbacks.onStatusChange("running");
          console.log(`[Cloud:${this.systemType}] Stream ready — ${msg.width}x${msg.height}`);
          readyResolve?.();
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
          this.callbacks.onPlayerEvent?.("player_joined", msg.player ?? 2);
          break;
        }

        case "player_disconnected": {
          this.callbacks.onPlayerEvent?.("player_disconnected", msg.player ?? 2);
          break;
        }

        case "pong": { break; }
      }
    } catch {
      // Ignore malformed JSON
    }
  }

  private handleBinaryMessage(data: ArrayBuffer): void {
    const view = new DataView(data);
    if (data.byteLength < 1) return;

    const magic = view.getUint8(0);

    if (magic === 0x01) {
      // Video frame — H.264 NAL unit
      if (data.byteLength < FRAME_HEADER_SIZE) return;

      const width = view.getUint16(1, true);
      const height = view.getUint16(3, true);
      const frameId = view.getUint32(5, true);
      const nalLength = view.getUint16(9, true);

      if (nalLength === 0 || 11 + nalLength > data.byteLength) return;

      this.lastFrameId = frameId;

      // Extract NAL unit data
      const nalData = new Uint8Array(data, FRAME_HEADER_SIZE, nalLength);

      // Detect NAL type from first byte after start code
      // We need to construct an EncodedVideoChunk
      const chunk = new EncodedVideoChunk({
        type: this.getNalType(nalData),
        timestamp: frameId * 16667, // ~16.67ms per frame at 60fps (in microseconds)
        duration: 16667,
        data: nalData,
      });

      if (this.videoDecoderReady && this.videoDecoder) {
        if (this.videoDecoder.decodeQueueSize < 10) {
          this.videoDecoder.decode(chunk);
        }
      } else {
        this.pendingVideoChunks.push(chunk);
        if (this.pendingVideoChunks.length > 300) {
          this.pendingVideoChunks.shift(); // Drop oldest to prevent unbounded growth
        }
      }

      // Update canvas dimensions from stream
      if (this.canvasEl && this.streamWidth > 0) {
        if (this.canvasEl.width !== this.streamWidth || this.canvasEl.height !== this.streamHeight) {
          this.canvasEl.width = this.streamWidth;
          this.canvasEl.height = this.streamHeight;
        }
      }

    } else if (magic === 0x02) {
      // Audio frame — Opus packet
      if (data.byteLength < AUDIO_HEADER_SIZE) return;

      const opusLength = view.getUint32(1, true);
      if (opusLength === 0 || 5 + opusLength > data.byteLength) return;

      const opusData = new Uint8Array(data, AUDIO_HEADER_SIZE, opusLength);

      const chunk = new EncodedAudioChunk({
        type: "key", // Opus doesn't have key/delta distinction
        timestamp: this.lastFrameId * 16667,
        duration: 20000, // 20ms frames
        data: opusData,
      });

      if (this.audioDecoderReady && this.audioDecoder) {
        if (this.audioDecoder.decodeQueueSize < 10) {
          this.audioDecoder.decode(chunk);
        }
      } else {
        this.pendingAudioChunks.push(chunk);
        if (this.pendingAudioChunks.length > 600) {
          this.pendingAudioChunks.shift();
        }
      }

    } else if (magic === 0x03) {
      // Codec configuration
      if (data.byteLength < CODEC_CFG_HEADER_SIZE) return;

      const payloadLen = view.getUint16(1, true);
      if (payloadLen === 0 || 3 + payloadLen > data.byteLength) return;

      const payload = new Uint8Array(data, 3, payloadLen);
      const payloadText = new TextDecoder().decode(payload);

      // Parse video descriptor length (first 2 bytes of payload are videoDesc length)
      if (payload.length < 2) return;
      const videoDescLen = new DataView(payload.buffer, payload.byteOffset, 2).getUint16(0, true);
      if (2 + videoDescLen > payload.length) return;

      const videoDescJson = new TextDecoder().decode(payload.subarray(2, 2 + videoDescLen));
      const audioDescJson = new TextDecoder().decode(payload.subarray(2 + videoDescLen));

      try {
        const videoCfg = JSON.parse(videoDescJson) as { codec: string; width: number; height: number; framerate: number };
        const audioCfg = JSON.parse(audioDescJson) as { codec: string; sampleRate: number; channels: number };

        console.log(`[Cloud:${this.systemType}] Codec config received:`, videoCfg.codec, audioCfg.codec);

        this.initVideoDecoder(videoCfg);
        this.initAudioDecoder(audioCfg);
      } catch (err) {
        console.error(`[Cloud:${this.systemType}] Failed to parse codec config:`, err);
      }
    }
  }

  /** Determine if a H.264 NAL unit is a keyframe or delta frame. */
  private getNalType(nalData: Uint8Array): EncodedVideoChunkType {
    if (nalData.length < 5) return "delta";
    // NAL unit type is in the lower 5 bits of the first byte after start code
    // For 4-byte start code (0x00 0x00 0x00 0x01), nal_type is at offset 4
    // For 3-byte start code (0x00 0x00 0x01), nal_type is at offset 3
    let nalTypeByte = 0;
    if (nalData[0] === 0x00 && nalData[1] === 0x00 && nalData[2] === 0x00 && nalData[3] === 0x01) {
      nalTypeByte = nalData[4];
    } else if (nalData[0] === 0x00 && nalData[1] === 0x00 && nalData[2] === 0x01) {
      nalTypeByte = nalData[3];
    }
    const nalType = nalTypeByte & 0x1f;
    // 5 = IDR (keyframe), 1 = non-IDR (delta), 7 = SPS, 8 = PPS
    return nalType === 5 ? "key" : "delta";
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
    this.ws?.send(JSON.stringify({ type: "stop" }));
  }

  exit(): void {
    this.stopPing();
    this.closeDecoders();
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
    this.ws?.send(JSON.stringify({ type: "input", player: _player, button, pressed: true }));
  }

  buttonUp(_player: 1 | 2, button: number): void {
    this.ws?.send(JSON.stringify({ type: "input", player: _player, button, pressed: false }));
  }

  // ── Volume ────────────────────────────────────────────────────

  get volume(): number { return this._volume; }
  get isMuted(): boolean { return this._isMuted; }

  setVolume(v: number): void {
    this._volume = Math.max(0, Math.min(1, v));
    this._isMuted = v === 0;
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
