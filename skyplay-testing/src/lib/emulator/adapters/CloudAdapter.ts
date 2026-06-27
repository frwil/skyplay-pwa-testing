import type { EmulatorAdapter } from "../EmulatorAdapter";
import type { EmulatorStatus, RomEntry, SystemType } from "../types";
import { SYSTEM_CONFIGS } from "../EmulatorAdapter";

const FRAME_HEADER_SIZE = 11;
const AUDIO_HEADER_SIZE = 5;
const CODEC_CFG_HEADER_SIZE = 3;
const MAX_DECODE_QUEUE = 3; // Réduit pour éviter la latence

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
  private videoNeedsKeyframe = false;
  private pendingVideoChunks: { chunk: EncodedVideoChunk; nalType: number }[] = [];
  private streamWidth = 320;
  private streamHeight = 224;
  private frameCount = 0;
  private lastFpsTime = performance.now();

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
        console.log(`[Cloud:${this.systemType}] Attempting WebSocket connection:`, {
          url: wsUrl, mode, sessionId: this.sessionId, currentRom: this._currentRom,
        });
        
        try {
          new URL(wsUrl);
        } catch {
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
          console.log(`[Cloud:${this.systemType}] ✅ WebSocket OPEN`);
          const initMessage = mode === "join" ? {
            type: "join", sessionId: this.sessionId, token: "",
          } : {
            type: "init", sessionId: this.sessionId, token: "",
            system: this.systemType, rom: this._currentRom,
          };
          this.ws!.send(JSON.stringify(initMessage));
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
          console.log(`[Cloud:${this.systemType}] WebSocket CLOSED: code=${event.code} reason="${event.reason}"`);
          this.stopPing();
          this.closeDecoders();
          if (this._status === "running" || this._status === "loading") {
            this._status = "idle";
            this.callbacks.onStatusChange("idle");
          }
        };

        this.ws.onerror = () => {
          console.error(`[Cloud:${this.systemType}] ❌ WebSocket ERROR`, {
            url: wsUrl, readyState: this.ws?.readyState,
          });
          if (this._status === "loading") {
            reject(new Error(`WebSocket connection failed to ${wsUrl}`));
          }
        };

        setTimeout(() => {
          if (this.ws?.readyState === WebSocket.CONNECTING) {
            console.error(`[Cloud:${this.systemType}] Connection timeout after 10s`);
            if (this._status === "loading") {
              reject(new Error(`Connection timeout - server at ${wsUrl} not responding`));
            }
          }
        }, 10000);
        
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
            // Ne redimensionner que si nécessaire
            if (this.canvasEl.width !== frame.displayWidth || this.canvasEl.height !== frame.displayHeight) {
              this.canvasEl.width = frame.displayWidth;
              this.canvasEl.height = frame.displayHeight;
            }
            // Éviter clearRect inutile, drawImage écrase tout
            this.ctx.drawImage(frame, 0, 0);
            
            // Compteur FPS (debug)
            this.frameCount++;
            const now = performance.now();
            if (now - this.lastFpsTime >= 5000) {
              console.log(`[Video] FPS: ${Math.round(this.frameCount / 5)}`);
              this.frameCount = 0;
              this.lastFpsTime = now;
            }
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
        console.warn(`[Cloud:${this.systemType}] H.264 codec not supported`);
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

      // === CORRECTION : Ne pas envoyer SPS/PPS seuls ===
      // Trouver la première keyframe
      const firstKeyIdx = this.pendingVideoChunks.findIndex(p => p.nalType === 5);
      
      if (firstKeyIdx >= 0) {
        // Envoyer UNIQUEMENT la keyframe en premier
        this.videoDecoder.decode(this.pendingVideoChunks[firstKeyIdx].chunk);
        this.videoNeedsKeyframe = false;
        
        // Ensuite, traiter les trames suivantes normalement
        for (let i = firstKeyIdx + 1; i < this.pendingVideoChunks.length; i++) {
          if (this.videoDecoder.decodeQueueSize < MAX_DECODE_QUEUE) {
            this.videoDecoder.decode(this.pendingVideoChunks[i].chunk);
          }
        }
        
        this.pendingVideoChunks = [];
        console.log(`[Cloud:${this.systemType}] VideoDecoder ready: ${config.codec} ${config.width}x${config.height}`);
      } else {
        // Garder uniquement SPS/PPS en attente de la première keyframe
        this.pendingVideoChunks = this.pendingVideoChunks.filter(p => 
          p.nalType === 5 || p.nalType === 7 || p.nalType === 8
        );
        console.log(`[Cloud:${this.systemType}] VideoDecoder ready (awaiting keyframe)`);
      }
    } catch (err) {
      console.error(`[Cloud:${this.systemType}] Failed to init VideoDecoder:`, err);
    }
  }

  private async initAudioDecoder(config: { codec: string; sampleRate: number; channels: number }): Promise<void> {
    try {
      // Toujours utiliser 48000Hz pour l'AudioContext Opus
      if (!this.audioCtx) {
        this.audioCtx = new AudioContext({ sampleRate: 48000 });
      }

      const init: AudioDecoderInit = {
        output: (data: AudioData) => {
          if (!this.audioCtx || this._isMuted) {
            data.close();
            return;
          }
          try {
            // Vérifier que les données audio sont valides
            if (data.numberOfFrames === 0 || data.numberOfChannels === 0) {
              data.close();
              return;
            }
            
            const buf = this.audioCtx.createBuffer(
              data.numberOfChannels,
              data.numberOfFrames,
              data.sampleRate,
            );
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
          } catch (err) {
            console.error(`[Cloud:${this.systemType}] Audio output error:`, err);
            data.close();
          }
        },
        error: (err) => {
          console.error(`[Cloud:${this.systemType}] AudioDecoder error:`, err);
          this.audioDecoderReady = false;
          try { this.audioDecoder?.close(); } catch { /* ok */ }
          this.audioDecoder = null;
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
      const opusHead = this.buildOpusHead(config.channels, 48000); // Forcer 48000
      this.audioDecoder.configure({
        codec: config.codec,
        sampleRate: 48000, // Forcer 48000 Hz (standard Opus)
        numberOfChannels: config.channels,
        description: opusHead,
      });
      this.audioDecoderReady = true;

      if (this.audioDecoder.state === "configured") {
        for (const chunk of this.pendingAudioChunks) {
          try { this.audioDecoder.decode(chunk); } catch { break; }
        }
      }
      this.pendingAudioChunks = [];
      console.log(`[Cloud:${this.systemType}] AudioDecoder ready: Opus 48000Hz ${config.channels}ch`);
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
    this.frameCount = 0;
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  }

  // ── Message Handlers ─────────────────────────────────────────

  private handleTextMessage(raw: string, readyResolve?: (value: void | PromiseLike<void>) => void): void {
    try {
      const msg = JSON.parse(raw) as {
        type: string; fps?: number; frames?: number;
        width?: number; height?: number; message?: string;
        t?: number; player?: number;
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
      if (data.byteLength < FRAME_HEADER_SIZE) return;

      const width = view.getUint16(1, true);
      const height = view.getUint16(3, true);
      const frameId = view.getUint32(5, true);
      const nalLength = view.getUint16(9, true);

      if (nalLength === 0 || 11 + nalLength > data.byteLength) return;

      this.lastFrameId = frameId;
      const nalData = new Uint8Array(data, FRAME_HEADER_SIZE, nalLength);
      const nalUnitType = this.getNalUnitType(nalData);
      const chunkType: EncodedVideoChunkType = nalUnitType === 5 ? "key" : "delta";

      const chunk = new EncodedVideoChunk({
        type: chunkType,
        timestamp: frameId * 16667,
        duration: 16667,
        data: nalData,
      });

      if (this.videoDecoderReady && this.videoDecoder) {
        if (this.videoNeedsKeyframe) {
          if (nalUnitType === 5) {
            // Envoyer SPS/PPS en attente, puis la keyframe
            const pendingSpsPps = this.pendingVideoChunks.filter(p => p.nalType === 7 || p.nalType === 8);
            for (const p of pendingSpsPps) {
              this.videoDecoder.decode(p.chunk);
            }
            this.videoDecoder.decode(chunk);
            this.videoNeedsKeyframe = false;
            this.pendingVideoChunks = [];
          } else if (nalUnitType === 7 || nalUnitType === 8) {
            // Stocker SPS/PPS pour plus tard
            this.pendingVideoChunks.push({ chunk, nalType: nalUnitType });
          }
          // Ignorer les delta avant la première keyframe
        } else {
          if (this.videoDecoder.decodeQueueSize < MAX_DECODE_QUEUE) {
            this.videoDecoder.decode(chunk);
          }
        }
      } else {
        this.pendingVideoChunks.push({ chunk, nalType: nalUnitType });
        if (this.pendingVideoChunks.length > 300) {
          this.pendingVideoChunks.shift();
        }
      }

      if (this.canvasEl && this.streamWidth > 0) {
        if (this.canvasEl.width !== this.streamWidth || this.canvasEl.height !== this.streamHeight) {
          this.canvasEl.width = this.streamWidth;
          this.canvasEl.height = this.streamHeight;
        }
      }

    } else if (magic === 0x02) {
      if (data.byteLength < AUDIO_HEADER_SIZE) return;

      const opusLength = view.getUint32(1, true);
      if (opusLength === 0 || 5 + opusLength > data.byteLength) return;

      const opusData = new Uint8Array(data, AUDIO_HEADER_SIZE, opusLength);
      this.audioFrameCount++;
      const chunk = new EncodedAudioChunk({
        type: "key",
        timestamp: this.audioFrameCount * 20000,
        duration: 20000,
        data: opusData,
      });

      if (this.audioDecoderReady && this.audioDecoder && this.audioDecoder.state === "configured") {
        if (this.audioDecoder.decodeQueueSize < MAX_DECODE_QUEUE) {
          this.audioDecoder.decode(chunk);
        }
      } else {
        this.pendingAudioChunks.push(chunk);
        if (this.pendingAudioChunks.length > 600) {
          this.pendingAudioChunks.shift();
        }
      }

    } else if (magic === 0x03) {
      if (data.byteLength < CODEC_CFG_HEADER_SIZE) return;

      const payloadLen = view.getUint16(1, true);
      if (payloadLen === 0 || 3 + payloadLen > data.byteLength) return;

      const payload = new Uint8Array(data, 3, payloadLen);
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

  private getNalUnitType(nalData: Uint8Array): number {
    if (nalData.length < 5) return 0;
    if (nalData[0] === 0x00 && nalData[1] === 0x00 && nalData[2] === 0x00 && nalData[3] === 0x01) {
      return nalData[4] & 0x1f;
    }
    if (nalData[0] === 0x00 && nalData[1] === 0x00 && nalData[2] === 0x01) {
      return nalData[3] & 0x1f;
    }
    return 0;
  }

  private buildOpusHead(channels: number, sampleRate: number): ArrayBuffer {
    const buf = new ArrayBuffer(19);
    const view = new DataView(buf);
    view.setUint8(0, 0x4F); view.setUint8(1, 0x70); view.setUint8(2, 0x75); view.setUint8(3, 0x73);
    view.setUint8(4, 0x48); view.setUint8(5, 0x65); view.setUint8(6, 0x61); view.setUint8(7, 0x64);
    view.setUint8(8, 0x01);
    view.setUint8(9, channels);
    view.setUint16(10, 312, true);
    view.setUint32(12, sampleRate, true);
    view.setUint16(16, 0, true);
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

  setCanvas(canvas: HTMLCanvasElement): void {
    this.canvasEl = canvas;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      this.ctx = ctx;
    }
  }

  getCanvas(): HTMLCanvasElement | null { return this.canvasEl; }

  buttonDown(_player: 1 | 2, button: number): void {
    // 🔍 DEBUG P2
    if (_player === 2) {
      console.log(`[CloudAdapter] P2 btn=${button} DOWN ws=${this.ws?.readyState}`);
    }
    this.ws?.send(JSON.stringify({ type: "input", player: _player, button, pressed: true }));
  }

  buttonUp(_player: 1 | 2, button: number): void {
    // 🔍 DEBUG P2
    if (_player === 2) {
      console.log(`[CloudAdapter] P2 btn=${button} UP ws=${this.ws?.readyState}`);
    }
    this.ws?.send(JSON.stringify({ type: "input", player: _player, button, pressed: false }));
  }

  get volume(): number { return this._volume; }
  get isMuted(): boolean { return this._isMuted; }

  setVolume(v: number): void {
    this._volume = Math.max(0, Math.min(1, v));
    this._isMuted = v === 0;
  }

  get status(): EmulatorStatus { return this._status; }
  get fps(): number { return this._fps; }
  get currentRom(): string | null { return this._currentRom; }
  get roomCode(): string | null { return this._roomCode; }
  get player(): 1 | 2 { return this._player; }

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
  onPlayerEvent?: (event: "player_joined" | "player_disconnected", player: number) => void;
}