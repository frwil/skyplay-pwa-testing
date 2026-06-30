import type { EmulatorAdapter } from "../EmulatorAdapter";
import type { EmulatorStatus, RomEntry, SystemType } from "../types";
import { SYSTEM_CONFIGS } from "../EmulatorAdapter";

const FRAME_HEADER_SIZE = 13; // magic(1) + width(u16) + height(u16) + frameId(u32) + nalLength(u32)
const AUDIO_HEADER_SIZE = 5;
const CODEC_CFG_HEADER_SIZE = 3;
const MAX_DECODE_QUEUE = 16; // Assez large pour 60fps sans bloquer le décodeur

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

  /**
   * Connect as host (P1) to a pre-created cloud session.
   * Used by the duel matchmaking system where the server creates the
   * session before the client connects (after P2 accepts the challenge).
   */
  async connectAsHost(wsUrl: string, sessionId: string, rom: string, roomCode: string): Promise<void> {
    this._status = "loading";
    this.callbacks.onStatusChange("loading");
    this._currentRom = rom;
    this.sessionId = sessionId;
    this._roomCode = roomCode;
    this._player = 1;

    try {
      await this.connectWebSocket(wsUrl, "init");
      console.log(`[Cloud:${this.systemType}] Connected as host — session ${sessionId}`);
    } catch (err) {
      console.error(`[Cloud:${this.systemType}] Failed to connect as host:`, err);
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
          // VideoDecoder errors are often transient (corrupted frame, etc.)
          // Don't destroy the decoder — just wait for the next keyframe
          console.warn(`[Cloud:${this.systemType}] VideoDecoder error (non-fatal):`, err);
          this.videoNeedsKeyframe = true;
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
      // Use the config returned by the browser (may normalize codec string)
      this.videoDecoder.configure(support.config!);
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
          // AudioDecoder errors are often transient — don't destroy
          // the decoder on every single one. Just log and continue.
          console.warn(`[Cloud:${this.systemType}] AudioDecoder error (non-fatal):`, err);
        },
      };

      // Build OpusHead description BEFORE calling isConfigSupported
      // so the browser sees the exact description we'll use.
      const opusHead = this.buildOpusHead(config.channels, 48000);

      const requestedConfig: AudioDecoderConfig = {
        codec: config.codec,
        sampleRate: 48000,
        numberOfChannels: config.channels,
        description: opusHead as BufferSource,
      };

      const support = await AudioDecoder.isConfigSupported(requestedConfig);

      if (!support.supported) {
        console.warn(`[Cloud:${this.systemType}] AudioDecoder config NOT supported:`,
          JSON.stringify({ codec: config.codec, sampleRate: 48000, channels: config.channels }));
        return;
      }

      // ⚠️ Use the config returned by the browser — it may have normalized
      // the codec string or other fields. Passing our own config to
      // configure() after isConfigSupported() is a known footgun.
      this.audioDecoder = new AudioDecoder(init);
      this.audioDecoder.configure(support.config!);
      this.audioDecoderReady = true;

      console.log(`[Cloud:${this.systemType}] AudioDecoder ready:`,
        `codec=${support.config?.codec ?? config.codec}`,
        `${support.config?.numberOfChannels ?? config.channels}ch`,
        `${support.config?.sampleRate ?? 48000}Hz`);

      // Flush pending chunks
      if (this.audioDecoder.state === "configured") {
        for (const chunk of this.pendingAudioChunks) {
          try { this.audioDecoder.decode(chunk); } catch { break; }
        }
      }
      this.pendingAudioChunks = [];
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
        case "waiting": {
          console.log(`[Cloud:${this.systemType}] Waiting for host:`, msg.message);
          break;
        }
        case "round_result": {
          const rrData = msg as unknown as { loser: number; winner: number; p1Losses: number; p2Losses: number };
          console.log(`[Cloud:${this.systemType}] 🏆 Round result: P${rrData.winner} wins! P${rrData.loser} KO. Score: P1=${rrData.p1Losses} P2=${rrData.p2Losses}`);
          this.callbacks.onRoundResult?.(
            rrData.loser, rrData.winner, rrData.p1Losses, rrData.p2Losses,
          );
          break;
        }
        case "match_end": {
          const meData = msg as unknown as { winner: number; loser: number; p1Losses: number; p2Losses: number };
          console.log(`[Cloud:${this.systemType}] 🏁 MATCH OVER! P${meData.winner} wins! Score: P1=${meData.p1Losses} P2=${meData.p2Losses}`);
          this.callbacks.onMatchEnd?.(
            meData.winner, meData.loser, meData.p1Losses, meData.p2Losses,
          );
          break;
        }
        case "rematch_starting": {
          console.log(`[Cloud:${this.systemType}] 🔄 Rematch starting`);
          this.callbacks.onRematchStarting?.();
          break;
        }
        case "rematch_requested": {
          console.log(`[Cloud:${this.systemType}] 🔄 Rematch requested by opponent`);
          this.callbacks.onRematchRequested?.();
          break;
        }
        case "rematch_accepted": {
          const raData = msg as unknown as { newSessionId: string; newWsUrl: string; newRoomCode: string };
          console.log(`[Cloud:${this.systemType}] ✅ Rematch accepted — new session: ${raData.newSessionId}`);
          this.callbacks.onRematchAccepted?.(raData.newSessionId, raData.newWsUrl, raData.newRoomCode);
          break;
        }
        case "rematch_declined": {
          console.log(`[Cloud:${this.systemType}] ❌ Rematch declined`);
          this.callbacks.onRematchDeclined?.();
          break;
        }
        case "session_closed": {
          console.log(`[Cloud:${this.systemType}] 🚪 Session closed by server`);
          this.callbacks.onSessionClosed?.();
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
      const nalLength = view.getUint32(9, true);

      if (nalLength === 0 || FRAME_HEADER_SIZE + nalLength > data.byteLength) return;

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
      // Server now sends raw Opus packets (Ogg parsing done server-side).
      // Just feed them directly to AudioDecoder.
      if (data.byteLength < AUDIO_HEADER_SIZE) return;

      const opusLen = view.getUint32(1, true);
      if (opusLen === 0 || AUDIO_HEADER_SIZE + opusLen > data.byteLength) return;

      const rawOpus = new Uint8Array(data, AUDIO_HEADER_SIZE, opusLen);
      if (rawOpus.length === 0) return;

      // Validate TOC byte (config field is bits 3-7 of byte 0, valid 0-15)
      if (((rawOpus[0] >> 3) & 0x1f) > 15) {
        console.warn(`[Cloud:${this.systemType}] Bad Opus TOC: ${rawOpus[0].toString(16)}`);
        return;
      }

      this.audioFrameCount++;
      const chunk = new EncodedAudioChunk({
        type: "key",
        timestamp: this.audioFrameCount * 20000,
        duration: 20000,
        data: rawOpus,
      });

      if (this.audioDecoderReady && this.audioDecoder && this.audioDecoder.state === "configured") {
        if (this.audioDecoder.decodeQueueSize < MAX_DECODE_QUEUE) {
          try { this.audioDecoder.decode(chunk); } catch { /* retry next tick */ }
        }
      } else {
        this.pendingAudioChunks.push(chunk);
        if (this.pendingAudioChunks.length > 600) this.pendingAudioChunks.shift();
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

  /** Request a rematch (notify opponent). */
  requestRematch(): void {
    this.ws?.send(JSON.stringify({ type: "rematch_request" }));
  }

  /** P2 accepts the rematch — sends new session info back. */
  acceptRematch(newSessionId: string, newWsUrl: string, newRoomCode: string): void {
    this.ws?.send(JSON.stringify({
      type: "rematch_accept",
      newSessionId,
      newWsUrl,
      newRoomCode,
    }));
  }

  /** P2 declines the rematch. */
  declineRematch(): void {
    this.ws?.send(JSON.stringify({ type: "rematch_decline" }));
  }

  /** Stop the duel entirely — closes the session. */
  stopDuel(): void {
    this.ws?.send(JSON.stringify({ type: "stop_duel" }));
  }

  /** Reconnect to a new session (used for rematch transition). */
  async reconnectToNewSession(wsUrl: string, sessionId: string, roomCode: string): Promise<void> {
    console.log(`[Cloud:${this.systemType}] 🔄 Reconnecting to new session ${sessionId}`);
    this.stopPing();
    this.closeDecoders();
    if (this.ws) {
      try { this.ws.close(); } catch { /* ok */ }
      this.ws = null;
    }
    this.sessionId = sessionId;
    this._roomCode = roomCode;
    // _player stays the same (1=host, 2=guest)
    const mode = this._player === 1 ? "init" : "join";
    await this.connectWebSocket(wsUrl, mode);
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
    // 🔍 DEBUG: log all cloud inputs
    const playerLabel = this._player === 1 ? "P1" : "P2";
    console.log(`[CloudAdapter] ${playerLabel} btn=${button} DOWN ws=${this.ws?.readyState}`);
    // For cloud gaming, each player uses their own machine — force the player
    // number to this._player (1=host, 2=guest) instead of trusting the keymap.
    // This lets P2 use the same intuitive keys as P1 (arrows, X/Z/C/V, etc.)
    // instead of the right-side keys meant for local same-keyboard multiplayer.
    this.ws?.send(JSON.stringify({ type: "input", player: this._player, button, pressed: true }));
  }

  buttonUp(_player: 1 | 2, button: number): void {
    const playerLabel = this._player === 1 ? "P1" : "P2";
    console.log(`[CloudAdapter] ${playerLabel} btn=${button} UP ws=${this.ws?.readyState}`);
    this.ws?.send(JSON.stringify({ type: "input", player: this._player, button, pressed: false }));
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
  /** Called when a round ends (character KO detected). loser/winner are player numbers (1 or 2). */
  onRoundResult?: (loser: number, winner: number, p1Losses: number, p2Losses: number) => void;
  /** Called when the match is over (one player has accumulated 2+ losses). */
  onMatchEnd?: (winner: number, loser: number, p1Losses: number, p2Losses: number) => void;
  /** Called when the opponent requests a rematch. */
  onRematchRequested?: () => void;
  /** Called when the opponent accepts the rematch (new session info provided). */
  onRematchAccepted?: (newSessionId: string, newWsUrl: string, newRoomCode: string) => void;
  /** Called when the opponent declines the rematch. */
  onRematchDeclined?: () => void;
  /** Called when a rematch is starting (server has reset the game — legacy same-session). */
  onRematchStarting?: () => void;
  /** Called when the server closes the session — all players should return to lobby. */
  onSessionClosed?: () => void;
}