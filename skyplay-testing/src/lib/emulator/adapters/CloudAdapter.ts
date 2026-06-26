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
  private videoNeedsKeyframe = false; // true after configure/flush until first IDR
  private pendingVideoChunks: { chunk: EncodedVideoChunk; nalType: number }[] = [];
  private streamWidth = 320;
  private streamHeight = 224;

  // WebCodecs — Audio
  private audioDecoder: AudioDecoder | null = null;
  private audioDecoderReady = false;
  private pendingAudioChunks: EncodedAudioChunk[] = [];
  private audioCtx: AudioContext | null = null;
  private audioFrameCount = 0;

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
    try {
      // Log BEFORE creating WebSocket
      console.log(`[Cloud:${this.systemType}] Attempting WebSocket connection:`, {
        url: wsUrl,
        mode,
        sessionId: this.sessionId,
        currentRom: this._currentRom,
      });
      
      // Check URL validity before creating WebSocket
      try {
        new URL(wsUrl); // Will throw if invalid
      } catch (urlError) {
        console.error(`[Cloud:${this.systemType}] Invalid WebSocket URL:`, wsUrl);
        this._status = "error";
        this.callbacks.onStatusChange("error");
        reject(new Error(`Invalid WebSocket URL: ${wsUrl}`));
        return;
      }
      
      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = "arraybuffer";
      
      console.log(`[Cloud:${this.systemType}] WebSocket created, readyState: ${this.ws.readyState}`);

      this.ws.onopen = () => {
        console.log(`[Cloud:${this.systemType}] ✅ WebSocket OPEN - connected to ${wsUrl}`);
        
        const initMessage = mode === "join" ? {
          type: "join",
          sessionId: this.sessionId,
          token: "",
        } : {
          type: "init",
          sessionId: this.sessionId,
          token: "",
          system: this.systemType,
          rom: this._currentRom,
        };
        
        console.log(`[Cloud:${this.systemType}] Sending:`, initMessage);
        this.ws!.send(JSON.stringify(initMessage));
        this.startPing();
      };

      this.ws.onmessage = (event) => {
        console.log(`[Cloud:${this.systemType}] Message received:`, {
          type: typeof event.data,
          size: event.data instanceof ArrayBuffer ? event.data.byteLength : event.data.length,
          isString: typeof event.data === "string",
        });
        
        if (typeof event.data === "string") {
          this.handleTextMessage(event.data, resolve);
        } else if (event.data instanceof ArrayBuffer) {
          this.handleBinaryMessage(event.data);
        }
      };

      this.ws.onclose = (event) => {
        console.log(`[Cloud:${this.systemType}] WebSocket CLOSED:`, {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
          codes: {
            1000: 'Normal Closure',
            1001: 'Going Away',
            1002: 'Protocol Error',
            1003: 'Unsupported Data',
            1005: 'No Status Received',
            1006: 'Abnormal Closure',
            1007: 'Invalid frame payload data',
            1008: 'Policy Violation',
            1009: 'Message too big',
            1010: 'Missing Extension',
            1011: 'Internal Error',
            1012: 'Service Restart',
            1013: 'Try Again Later',
            1014: 'Bad Gateway',
            1015: 'TLS Handshake'
          }[event.code] || 'Unknown'
        });
        
        this.stopPing();
        this.closeDecoders();
        if (this._status === "running" || this._status === "loading") {
          this._status = "idle";
          this.callbacks.onStatusChange("idle");
        }
      };

      this.ws.onerror = (event) => {
        // The browser hides most error details for security
        console.error(`[Cloud:${this.systemType}] ❌ WebSocket ERROR:`, {
          url: wsUrl,
          readyState: this.ws?.readyState,
          readyStateText: this.ws ? ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][this.ws.readyState] : 'null',
          timestamp: new Date().toISOString(),
          // Check if the server exists
          hostname: new URL(wsUrl).hostname,
          port: new URL(wsUrl).port,
          protocol: new URL(wsUrl).protocol,
        });
        
        // Check if it's a CORS or mixed-content issue
        const currentProtocol = window.location.protocol;
        const wsProtocol = new URL(wsUrl).protocol;
        if (currentProtocol === 'https:' && wsProtocol === 'ws:') {
          console.error(`[Cloud:${this.systemType}] ❌ MIXED CONTENT: Cannot connect to WS from HTTPS page. Use WSS.`);
        }
        
        if (this._status === "loading") {
          reject(new Error(`WebSocket connection failed to ${wsUrl} (check browser console for details)`));
        }
      };

      // Add a shorter timeout for initial connection
      setTimeout(() => {
        if (this.ws?.readyState === WebSocket.CONNECTING) {
          console.error(`[Cloud:${this.systemType}] Connection timeout after 10s`);
          if (this._status === "loading") {
            reject(new Error(`Connection timeout - server at ${wsUrl} not responding`));
          }
        }
      }, 10000); // 10 seconds for initial connection
      
    } catch (err) {
      console.error(`[Cloud:${this.systemType}] Failed to create WebSocket:`, err);
      reject(err);
    }
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
            const cw = this.canvasEl.width;
            const ch = this.canvasEl.height;
            if (cw !== frame.displayWidth || ch !== frame.displayHeight) {
              this.canvasEl.width = frame.displayWidth;
              this.canvasEl.height = frame.displayHeight;
            }
            this.ctx.clearRect(0, 0, frame.displayWidth, frame.displayHeight);
            this.ctx.drawImage(frame, 0, 0);
          }
          frame.close();
        },
        error: (err) => {
          console.error(`[Cloud:${this.systemType}] VideoDecoder error:`, err);
          this.videoDecoderReady = false;
          this.videoNeedsKeyframe = true;
          try { this.videoDecoder?.close(); } catch { /* ok */ }
          this.videoDecoder = null;
        },
      };

      const support = await VideoDecoder.isConfigSupported({
        codec: config.codec,
        codedWidth: config.width,
        codedHeight: config.height,
      });

      if (!support.supported) {
        console.warn(`[Cloud:${this.systemType}] H.264 codec not supported, falling back`);
        return;
      }

      this.videoDecoder = new VideoDecoder(init);
      this.videoDecoder.configure({
        codec: config.codec,
        codedWidth: config.width,
        codedHeight: config.height,
      });
      this.videoDecoderReady = true;
      this.videoNeedsKeyframe = true;

      // Find the first keyframe in pending chunks
      const firstKeyIdx = this.pendingVideoChunks.findIndex(p => p.nalType === 5);
      
      if (firstKeyIdx >= 0) {
        // Collect SPS/PPS that appear before the keyframe
        const spsPpsBeforeKey: typeof this.pendingVideoChunks = [];
        const keyframeChunk = this.pendingVideoChunks[firstKeyIdx];
        
        for (let i = 0; i < firstKeyIdx; i++) {
          const { nalType } = this.pendingVideoChunks[i];
          if (nalType === 7 || nalType === 8) {
            spsPpsBeforeKey.push(this.pendingVideoChunks[i]);
          }
          // Skip delta frames before keyframe
        }
        
        // Feed SPS first, then PPS, then the keyframe itself
        for (const pending of spsPpsBeforeKey) {
          this.videoDecoder.decode(pending.chunk);
        }
        this.videoDecoder.decode(keyframeChunk.chunk);
        this.videoNeedsKeyframe = false;
        
        // Process remaining chunks after keyframe normally
        for (let i = firstKeyIdx + 1; i < this.pendingVideoChunks.length; i++) {
          if (this.videoDecoder.decodeQueueSize < 10) {
            this.videoDecoder.decode(this.pendingVideoChunks[i].chunk);
          }
        }
        
        this.pendingVideoChunks = [];
        console.log(`[Cloud:${this.systemType}] VideoDecoder ready: ${config.codec} ${config.width}x${config.height}`);
      } else {
        // No keyframe found - only keep SPS/PPS for later, drop deltas
        this.pendingVideoChunks = this.pendingVideoChunks.filter(p => 
          p.nalType === 7 || p.nalType === 8
        );
        console.log(`[Cloud:${this.systemType}] VideoDecoder ready (awaiting keyframe)`);
      }
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
          // AudioDecoder enters "closed" state on error.
          // Mark as not ready so subsequent packets go to pending queue.
          this.audioDecoderReady = false;
          try { this.audioDecoder?.close(); } catch { /* ok */ }
          this.audioDecoder = null;
          // The decoder will be re-created on next codec config.
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

      // Build OpusHead description (19 bytes) for proper decoder init.
      // This tells the browser the exact Opus stream parameters.
      const opusHead = this.buildOpusHead(config.channels, config.sampleRate);

      this.audioDecoder.configure({
        codec: config.codec,
        sampleRate: config.sampleRate,
        numberOfChannels: config.channels,
        description: opusHead,
      });
      this.audioDecoderReady = true;

      // Flush pending chunks — but only if decoder is still valid
      if (this.audioDecoder.state === "configured") {
        for (const chunk of this.pendingAudioChunks) {
          try { this.audioDecoder.decode(chunk); } catch { break; }
        }
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
      this.videoNeedsKeyframe = false;
    }
    if (this.audioDecoder) {
      try { this.audioDecoder.close(); } catch { /* ok */ }
      this.audioDecoder = null;
      this.audioDecoderReady = false;
    }
    this.pendingVideoChunks = [];
    this.pendingAudioChunks = [];
    this.audioFrameCount = 0;
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
      const nalUnitType = this.getNalUnitType(nalData);
      const chunkType: EncodedVideoChunkType = nalUnitType === 5 ? "key" : "delta";

      // We need to construct an EncodedVideoChunk
      const chunk = new EncodedVideoChunk({
        type: chunkType,
        timestamp: frameId * 16667, // ~16.67ms per frame at 60fps (in microseconds)
        duration: 16667,
        data: nalData,
      });

      if (this.videoDecoderReady && this.videoDecoder) {
        // After configure()/flush(), the first chunk MUST be a keyframe.
        // Drop non-IDR slices and feed SPS/PPS (needed for decode context).
        if (this.videoNeedsKeyframe) {
          if (nalUnitType === 5) {
            // Found first IDR — feed it and lift the restriction
            this.videoDecoder.decode(chunk);
            this.videoNeedsKeyframe = false;
          } else if (nalUnitType === 7 || nalUnitType === 8) {
            // SPS/PPS — feed to prime the decoder
            this.videoDecoder.decode(chunk);
          }
          // else: drop delta slices before first keyframe
        } else {
          // Normal operation
          if (this.videoDecoder.decodeQueueSize < 10) {
            this.videoDecoder.decode(chunk);
          }
        }
      } else {
        this.pendingVideoChunks.push({ chunk, nalType: nalUnitType });
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

      this.audioFrameCount++;
      const chunk = new EncodedAudioChunk({
        type: "key", // Opus doesn't have key/delta distinction
        timestamp: this.audioFrameCount * 20000, // 20ms per Opus frame (in microseconds)
        duration: 20000,
        data: opusData,
      });

      if (this.audioDecoderReady && this.audioDecoder && this.audioDecoder.state === "configured") {
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

  /** Extract raw NAL unit type from H.264 Annex B data.
   *  Returns 0 if the data doesn't contain a recognizable start code. */
  private getNalUnitType(nalData: Uint8Array): number {
    if (nalData.length < 5) return 0;
    let nalTypeByte = 0;
    if (nalData[0] === 0x00 && nalData[1] === 0x00 && nalData[2] === 0x00 && nalData[3] === 0x01) {
      nalTypeByte = nalData[4];
    } else if (nalData[0] === 0x00 && nalData[1] === 0x00 && nalData[2] === 0x01) {
      nalTypeByte = nalData[3];
    }
    return nalTypeByte & 0x1f;
  }

  /** Determine if a H.264 NAL unit is a keyframe or delta frame. */
  private getNalType(nalData: Uint8Array): EncodedVideoChunkType {
    return this.getNalUnitType(nalData) === 5 ? "key" : "delta";
  }

  /** Build OpusHead descriptor for AudioDecoder.configure().
   *  This 19-byte structure primes the Opus decoder with stream params. */
  private buildOpusHead(channels: number, sampleRate: number): ArrayBuffer {
    const buf = new ArrayBuffer(19);
    const view = new DataView(buf);
    // "OpusHead" magic (8 bytes)
    view.setUint8(0, 0x4F);  // O
    view.setUint8(1, 0x70);  // p
    view.setUint8(2, 0x75);  // u
    view.setUint8(3, 0x73);  // s
    view.setUint8(4, 0x48);  // H
    view.setUint8(5, 0x65);  // e
    view.setUint8(6, 0x61);  // a
    view.setUint8(7, 0x64);  // d
    // Version (1 byte)
    view.setUint8(8, 0x01);
    // Channel count (1 byte)
    view.setUint8(9, channels);
    // Pre-skip (2 bytes LE) — 80ms at 48kHz = 3840 samples, but standard is 312
    view.setUint16(10, 312, true);
    // Input sample rate (4 bytes LE)
    view.setUint32(12, sampleRate, true);
    // Output gain (2 bytes LE) — 0 dB
    view.setUint16(16, 0, true);
    // Channel mapping family (1 byte) — 0 = mono/stereo
    view.setUint8(18, 0x00);
    return buf;
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
