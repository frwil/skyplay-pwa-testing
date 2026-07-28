import type { EmulatorAdapter } from "../EmulatorAdapter";
import type { EmulatorStatus, RomEntry, SystemType, MatchStateData } from "../types";
import { SYSTEM_CONFIGS } from "../EmulatorAdapter";
import { getStreamKey } from "../streamKey";

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
  private mode: "cpu" | "pvp" = "cpu";
  /** Plan A (optional): RTMP ingest URL with embedded stream key. Sent in the init message
   *  when set (before connectAsHost). Inert by default — no stream unless the host pastes one. */
  private rtmpUrl: string | null = null;
  private lastFrameId: number = 0;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  /** Character names selected by each player (received via match_started / match_end, RAM-based). */
  private p1CharName: string | null = null;
  private p2CharName: string | null = null;
  private p1CharId: number = -1;
  private p2CharId: number = -1;

  // WebCodecs — Video
  private videoDecoder: VideoDecoder | null = null;
  private videoDecoderReady = false;
  private videoNeedsKeyframe = false;
  private pendingVideoChunks: { chunk: EncodedVideoChunk; nalType: number; nalData: Uint8Array }[] = [];
  private lastVideoDecoderConfig: VideoDecoderConfig | null = null;
  /** Saved init config so the error handler can re-create the decoder. */
  private lastDecoderInitConfig: { codec: string; width: number; height: number; framerate: number } | null = null;
  /** Whether the codec config had extradata (SPS/PPS in description). */
  private hasConfigExtradata = false;
  /** Config received before we have SPS+PPS+IDR — defer decoder creation. */
  private pendingVideoConfig: { codec: string; width: number; height: number; framerate: number } | null = null;
  private streamWidth = 320;
  private streamHeight = 224;
  private frameCount = 0;
  private lastFpsTime = performance.now();
  // Playout: the newest decoded frame awaiting paint, and the rAF handle.
  // We paint on requestAnimationFrame (synced to the display) instead of drawing
  // inside the decoder callback — bursty TCP arrival (tunnel HOL blocking) would
  // otherwise be painted off-cadence and read as stutter even at 60fps average.
  private latestFrame: VideoFrame | null = null;
  private rafId: number | null = null;

  // WebCodecs — Audio
  private audioDecoder: AudioDecoder | null = null;
  private audioDecoderReady = false;
  private pendingAudioChunks: EncodedAudioChunk[] = [];
  private audioCtx: AudioContext | null = null;
  private audioFrameCount = 0;
  private audioOutputCount = 0; // DEBUG: count decoded audio frames output
  private audioNextTime = 0;    // Precise scheduling timestamp for gapless playback

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
        body: JSON.stringify({ system: this.systemType, rom: rom.path, mode: this.mode }),
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
    this.mode = "pvp";
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

  /** Set the session mode (cpu or pvp). Call before loadRom/connectAsHost. */
  setMode(mode: "cpu" | "pvp"): void {
    this.mode = mode;
  }

  /** Plan A: set (or clear) the RTMP ingest URL used for a live broadcast. Must be called
   *  before connectAsHost so it lands in the init message. Passing null/"" disables streaming. */
  setStreamKey(rtmpUrl: string | null): void {
    const trimmed = rtmpUrl?.trim() || "";
    this.rtmpUrl = trimmed.length > 0 ? trimmed : null;
  }

  /** Public session ID for stats lookup. */
  get currentSessionId(): string | null {
    return this.sessionId;
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
          console.log(`[Cloud:${this.systemType}] ✅ WebSocket OPEN (readyState=${this.ws?.readyState})`);
          const initMessage = mode === "join" ? {
            type: "join", sessionId: this.sessionId, token: "",
          } : {
            type: "init", sessionId: this.sessionId, token: "",
            system: this.systemType, rom: this._currentRom,
            mode: this.mode,
            // Only include when a stream key is set (explicit setter or the paste-key registry) —
            // omitted otherwise, so the default behaviour is unchanged.
            ...(() => {
              const url = this.rtmpUrl ?? getStreamKey();
              return url ? { rtmpUrl: url } : {};
            })(),
          };
          // Guard: onopen can fire before readyState transitions to OPEN in some browsers
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(initMessage));
            this.startPing();
          } else {
            console.warn(`[Cloud:${this.systemType}] ⚠️ onopen fired but readyState=${this.ws?.readyState}, deferring send`);
            // Delay send to let the browser finish the state transition
            const trySend = () => {
              if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify(initMessage));
                this.startPing();
              } else {
                console.error(`[Cloud:${this.systemType}] ❌ WebSocket never reached OPEN state`);
              }
            };
            setTimeout(trySend, 10);
          }
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

        this.ws.onerror = (event) => {
          const target = event.target as WebSocket | null;
          console.error(`[Cloud:${this.systemType}] ❌ WebSocket ERROR`, {
            url: wsUrl,
            readyState: target?.readyState ?? this.ws?.readyState,
            hint: "Vérifie que le game-server tourne (docker compose up -d dans apps/game-server)",
          });
          // Only reject on initial connect; reconnection errors are logged but not fatal
          if (this._status === "loading") {
            reject(new Error(`WebSocket connection failed to ${wsUrl} — game server down or unreachable`));
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
      this.lastDecoderInitConfig = config;
      this.streamWidth = config.width;
      this.streamHeight = config.height;

      // Check: do we have SPS + PPS + IDR buffered?
      const hasSps = this.pendingVideoChunks.some(p => p.nalType === 7);
      const hasPps = this.pendingVideoChunks.some(p => p.nalType === 8);
      const idrEntry = this.pendingVideoChunks.find(p => p.nalType === 5);

      if (hasSps && hasPps && idrEntry) {
        // Complete cold-start data available — create decoder and feed immediately.
        // This mirrors P1's startup path where SPS+PPS+IDR arrive together.
        await this.createAndPrimeDecoder(config, idrEntry.chunk);
      } else {
        // Missing initialization data — defer. handleBinaryMessage will trigger
        // creation when SPS+PPS+IDR are all buffered.
        console.log(`[Cloud:${this.systemType}] ⏳ Deferring decoder — need SPS+PPS+IDR ` +
          `(have: SPS=${hasSps} PPS=${hasPps} IDR=${!!idrEntry}, buffered=${this.pendingVideoChunks.length})`);
        this.pendingVideoConfig = config;
      }
    } catch (err) {
      console.error(`[Cloud:${this.systemType}] Failed to init VideoDecoder:`, err);
    }
  }

  /** Create the VideoDecoder and immediately feed SPS → PPS → IDR. */
  private async createAndPrimeDecoder(
    config: { codec: string; width: number; height: number; framerate: number },
    idrChunk: EncodedVideoChunk,
  ): Promise<void> {
    const init: VideoDecoderInit = {
      output: (frame: VideoFrame) => {
        if (this.latestFrame) this.latestFrame.close();
        this.latestFrame = frame;

        this.frameCount++;
        const now = performance.now();
        if (now - this.lastFpsTime >= 5000) {
          console.log(`[Video] FPS: ${Math.round(this.frameCount / 5)}`);
          this.frameCount = 0;
          this.lastFpsTime = now;
        }
      },
      error: (err) => {
        console.warn(`[Cloud:${this.systemType}] VideoDecoder error — recreating:`, err);
        this.videoNeedsKeyframe = true;
        try { this.videoDecoder?.close(); } catch {}
        this.videoDecoder = null;
        this.videoDecoderReady = false;
        queueMicrotask(() => {
          if (!this.lastDecoderInitConfig) {
            console.warn(`[Cloud:${this.systemType}] No saved config — waiting for next codec config`);
            return;
          }
          this.initVideoDecoder(this.lastDecoderInitConfig).catch(e => {
            console.error(`[Cloud:${this.systemType}] Decoder re-creation failed:`, e);
          });
        });
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
    this.videoDecoder.configure(support.config!);
    this.lastVideoDecoderConfig = support.config!;
    this.hasConfigExtradata = false;
    this.videoDecoderReady = true;
    this.videoNeedsKeyframe = false; // we're feeding SPS+PPS+IDR right now
    this.startPaintLoop();

    // Feed SPS + PPS from buffer, then the IDR keyframe
    const spsPps = this.pendingVideoChunks.filter(p => p.nalType === 7 || p.nalType === 8);
    let fed = 0;
    for (const p of spsPps) {
      try { this.videoDecoder.decode(p.chunk); fed++; } catch { break; }
    }
    try { this.videoDecoder.decode(idrChunk); fed++; } catch { /* ok */ }

    // Clear all buffered frames — we've started from a clean keyframe
    this.pendingVideoChunks = [];

    console.log(`[Cloud:${this.systemType}] 🎬 VideoDecoder primed: ${config.codec} ${config.width}x${config.height}` +
      ` (fed ${fed} chunks: ${spsPps.length} SPS/PPS + IDR)`);
  }

  /** Extract the NAL unit payload without the Annex B start code (00 00 00 01 or 00 00 01). */
  private extractNalPayload(nalUnit: Uint8Array): Uint8Array {
    if (nalUnit.length >= 4 &&
        nalUnit[0] === 0x00 && nalUnit[1] === 0x00 && nalUnit[2] === 0x00 && nalUnit[3] === 0x01) {
      return nalUnit.subarray(4);
    }
    if (nalUnit.length >= 3 &&
        nalUnit[0] === 0x00 && nalUnit[1] === 0x00 && nalUnit[2] === 0x01) {
      return nalUnit.subarray(3);
    }
    return nalUnit; // no start code — return as-is
  }

  /** Build AVCDecoderConfigurationRecord (ISO/IEC 14496-15 §5.2.4.1.1) from SPS and PPS NAL units. */
  private buildAvccRecord(spsNal: Uint8Array, ppsNal: Uint8Array): Uint8Array {
    const sps = this.extractNalPayload(spsNal);
    const pps = this.extractNalPayload(ppsNal);

    // 8 bytes (header + SPS length) + SPS + 3 bytes (PPS count + PPS length) + PPS
    const totalSize = 8 + sps.length + 3 + pps.length;
    const buf = new Uint8Array(totalSize);
    let o = 0;

    buf[o++] = 1;                     // configurationVersion
    buf[o++] = sps[1];                // AVCProfileIndication
    buf[o++] = sps[2];                // profile_compatibility
    buf[o++] = sps[3];                // AVCLevelIndication
    buf[o++] = 0xFF;                  // 6 bits reserved(1) + 2 bits lengthSizeMinusOne(3 = 4-byte lengths)
    buf[o++] = 0xE1;                  // 3 bits reserved(1) + 5 bits numOfSequenceParameterSets(1)
    buf[o++] = (sps.length >> 8) & 0xFF;  // SPS length (big-endian u16)
    buf[o++] = sps.length & 0xFF;
    buf.set(sps, o); o += sps.length;
    buf[o++] = 0x01;                  // numOfPictureParameterSets
    buf[o++] = (pps.length >> 8) & 0xFF;  // PPS length (big-endian u16)
    buf[o++] = pps.length & 0xFF;
    buf.set(pps, o);

    return buf;
  }

  private async initAudioDecoder(config: { codec: string; sampleRate: number; channels: number }): Promise<void> {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new AudioContext({ sampleRate: 48000 });
      }

      const init: AudioDecoderInit = {
        output: (data: AudioData) => {
          // DEBUG: log first 5 decoded audio outputs
          this.audioOutputCount++;
          if (this.audioOutputCount <= 5) {
            console.log(`[Cloud:${this.systemType}] 🔊 Audio output #${this.audioOutputCount}: ` +
              `frames=${data.numberOfFrames} ch=${data.numberOfChannels} ` +
              `sampleRate=${data.sampleRate} duration=${data.duration}µs ` +
              `ctxState=${this.audioCtx?.state} muted=${this._isMuted}`);
          }
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

            // ── Precise scheduling with jitter buffer ──────────────────
            // Schedule at audioNextTime. When we first start or fall behind
            // (underrun), add a short look-ahead (40ms) to absorb network
            // jitter and prevent gaps that cause scratchy audio.
            const now = this.audioCtx.currentTime;
            const LOOKAHEAD = 0.04; // 40ms buffer against jitter
            if (this.audioNextTime < now) {
              // Underrun detected — this is what causes scratchy gaps.
              // Log first few occurrences to help diagnose jitter severity.
              if (this.audioOutputCount <= 10) {
                console.log(`[Cloud:${this.systemType}] 🔄 Audio underrun #${this.audioOutputCount}: ` +
                  `nextTime=${this.audioNextTime.toFixed(3)} now=${now.toFixed(3)} gap=${(now - this.audioNextTime).toFixed(3)}s`);
              }
              this.audioNextTime = now + LOOKAHEAD;
            }
            source.start(this.audioNextTime);
            // Advance by the exact duration of this audio chunk (µs → s)
            this.audioNextTime += data.duration / 1_000_000;

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

  /** Play raw s16le PCM chunk directly via Web Audio API (no Opus decoder). */
  private playPcmChunk(pcmData: Uint8Array): void {
    if (!this.audioCtx || this._isMuted) return;

    try {
      const sampleCount = pcmData.length / 2; // s16le = 2 bytes/sample
      const buffer = this.audioCtx.createBuffer(1, sampleCount, 48000);
      const channelData = buffer.getChannelData(0);

      // Convert s16le → float32
      const view = new DataView(pcmData.buffer, pcmData.byteOffset, pcmData.length);
      for (let i = 0; i < sampleCount; i++) {
        const s16 = view.getInt16(i * 2, true); // little-endian
        channelData[i] = s16 / 32768;
      }

      const source = this.audioCtx.createBufferSource();
      source.buffer = buffer;
      const gain = this.audioCtx.createGain();
      gain.gain.value = this._volume;
      source.connect(gain).connect(this.audioCtx.destination);

      // Precise scheduling with drift protection
      // LOOKAHEAD: small buffer to absorb network jitter (20ms for local, tune up for remote)
      // MAX_BUFFER: hard cap to prevent clock-drift accumulation over long sessions
      const now = this.audioCtx.currentTime;
      const LOOKAHEAD = 0.02;
      const MAX_BUFFER = 0.08;

      if (this.audioNextTime < now) {
        // Underrun — reset scheduling with small lookahead
        if (this.audioOutputCount <= 10) {
          console.log(`[Cloud:${this.systemType}] 🔄 PCM underrun #${this.audioOutputCount}: ` +
            `nextTime=${this.audioNextTime.toFixed(3)} now=${now.toFixed(3)} gap=${(now - this.audioNextTime).toFixed(3)}s`);
        }
        this.audioOutputCount++;
        this.audioNextTime = now + LOOKAHEAD;
      } else if (this.audioNextTime > now + MAX_BUFFER) {
        // Clock drift or burst — buffer too far ahead, reset to prevent growing latency
        if (this.audioFrameCount <= 500) {
          console.log(`[Cloud:${this.systemType}] 🔄 Audio drift reset: ` +
            `buffer=${(this.audioNextTime - now).toFixed(3)}s → capped at ${MAX_BUFFER}s`);
        }
        this.audioNextTime = now + LOOKAHEAD;
      }
      source.start(this.audioNextTime);
      this.audioNextTime += sampleCount / 48000; // advance by exact duration

      if (this.audioFrameCount === 0) {
        console.log(`[Cloud:${this.systemType}] 🎵 PCM audio started: ${sampleCount} samples, ${pcmData.length}B`);
      }
      this.audioFrameCount++;
    } catch (err) {
      console.warn(`[Cloud:${this.systemType}] PCM playback error:`, err);
    }
  }

  /** Paint the newest decoded frame once per display refresh (vsync-synced).
   *  Decoupling paint from decode absorbs bursty network arrival into smooth motion. */
  private startPaintLoop(): void {
    if (this.rafId !== null) return;
    if (typeof requestAnimationFrame !== "function") return; // SSR / non-browser guard
    const paint = () => {
      const frame = this.latestFrame;
      if (frame && this.ctx && this.canvasEl) {
        if (this.canvasEl.width !== frame.displayWidth || this.canvasEl.height !== frame.displayHeight) {
          this.canvasEl.width = frame.displayWidth;
          this.canvasEl.height = frame.displayHeight;
        }
        this.ctx.drawImage(frame, 0, 0);
        frame.close();
        this.latestFrame = null;
      }
      this.rafId = requestAnimationFrame(paint);
    };
    this.rafId = requestAnimationFrame(paint);
  }

  private stopPaintLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.latestFrame) {
      this.latestFrame.close();
      this.latestFrame = null;
    }
  }

  private closeDecoders(): void {
    this.stopPaintLoop();
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
    this.audioNextTime = 0;
    this.frameCount = 0;
    this.pendingVideoConfig = null;
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
          // Signal back to the server that this client is fully loaded (dual-client ready guard)
          this.ws?.send(JSON.stringify({ type: "client_ready" }));
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
          const rrData = msg as unknown as { loser: number; winner: number; p1Losses: number; p2Losses: number; koType?: string };
          console.log(`[Cloud:${this.systemType}] 🏆 Round result: P${rrData.winner} wins! P${rrData.loser} KO (${rrData.koType || "normal"}). Losses: P1=${rrData.p1Losses} P2=${rrData.p2Losses}`);
          this.callbacks.onRoundResult?.(
            rrData.loser, rrData.winner, rrData.p1Losses, rrData.p2Losses, rrData.koType,
          );
          break;
        }
        case "match_end": {
          const meData = msg as unknown as { winner: number; loser: number; p1Losses: number; p2Losses: number; matchNumber?: number; totalRounds?: number; perfectKos?: number; perfectKoDetails?: { round: number; player: number }[]; p1TeamIds?: number[]; p2TeamIds?: number[]; p1SelectOrder?: number[]; p2SelectOrder?: number[]; p1Mode?: "ADVANCED" | "EXTRA"; p2Mode?: "ADVANCED" | "EXTRA"; p1PlayMode?: "Auto" | "Manual"; p2PlayMode?: "Auto" | "Manual"; p1CharWins?: Record<number, number>; p2CharWins?: Record<number, number>; p1CharName?: string; p2CharName?: string };
          console.log(`[Cloud:${this.systemType}] 🏁 MATCH #${meData.matchNumber || "?"} OVER! P${meData.winner} wins! Losses: P1=${meData.p1Losses} P2=${meData.p2Losses}`);
          // Capture character names from match_end for stat display
          if (meData.p1CharName) { this.p1CharName = meData.p1CharName; }
          if (meData.p2CharName) { this.p2CharName = meData.p2CharName; }
          this.callbacks.onMatchEnd?.(
            meData.winner, meData.loser, meData.p1Losses, meData.p2Losses, meData.matchNumber, meData.totalRounds, meData.perfectKos,
            {
              p1TeamIds: meData.p1TeamIds, p2TeamIds: meData.p2TeamIds,
              p1SelectOrder: meData.p1SelectOrder, p2SelectOrder: meData.p2SelectOrder,
              p1Mode: meData.p1Mode, p2Mode: meData.p2Mode,
              p1PlayMode: meData.p1PlayMode, p2PlayMode: meData.p2PlayMode,
              p1CharWins: meData.p1CharWins, p2CharWins: meData.p2CharWins,
              p1CharName: meData.p1CharName, p2CharName: meData.p2CharName,
              perfectKoDetails: meData.perfectKoDetails,
            },
          );
          break;
        }
        case "rematch_starting": {
          console.log(`[Cloud:${this.systemType}] 🔄 Rematch starting`);
          this.callbacks.onRematchStarting?.();
          break;
        }
        case "auto_rematch": {
          const arData = msg as unknown as { matchNumber: number; totalMatches: number };
          console.log(`[Cloud:${this.systemType}] 🔄 Auto-rematch ${arData.matchNumber}/${arData.totalMatches}`);
          this.callbacks.onAutoRematch?.(arData.matchNumber, arData.totalMatches);
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
        case "match_state": {
          this.callbacks.onMatchState?.(msg as unknown as MatchStateData);
          break;
        }
        case "char_selected": {
          // No longer sent by the server — D-pad cursor tracking removed.
          // Character names now come exclusively from match_started (RAM-based).
          break;
        }
        case "match_started": {
          const msData = msg as unknown as { p1CharName?: string; p2CharName?: string };
          if (msData.p1CharName && !this.p1CharName) {
            this.p1CharName = msData.p1CharName;
            this.callbacks.onCharSelected?.(1, -1, msData.p1CharName);
          }
          if (msData.p2CharName && !this.p2CharName) {
            this.p2CharName = msData.p2CharName;
            this.callbacks.onCharSelected?.(2, -1, msData.p2CharName);
          }
          console.log(`[Cloud:${this.systemType}] 🎬 Match started — P1=${msData.p1CharName ?? this.p1CharName ?? "?"} P2=${msData.p2CharName ?? this.p2CharName ?? "?"}`);
          break;
        }
        case "gift_notify": {
          this.callbacks.onGiftNotify?.(msg as unknown as {
            gift: { id: string; name: string; iconUrl: string; animationUrl?: string; category: string };
            from: { username: string; avatar?: string };
            quantity: number;
            diamondAmount: number;
            message?: string;
          });
          break;
        }
        case "paused": {
          const pData = msg as unknown as { player: 1 | 2; countdown: number };
          console.log(`[Cloud:${this.systemType}] ⏸ Paused by P${pData.player} — ${pData.countdown}s`);
          this._status = "paused";
          this.callbacks.onStatusChange("paused");
          this.callbacks.onPaused?.(pData.player, pData.countdown);
          break;
        }
        case "resumed": {
          const rData = msg as unknown as { initiator: 1 | 2 | 0 };
          console.log(`[Cloud:${this.systemType}] ▶ Resumed (initiator: ${rData.initiator === 0 ? "auto" : `P${rData.initiator}`})`);
          this._status = "running";
          this.callbacks.onStatusChange("running");
          this.callbacks.onResumed?.();
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
            // Always feed buffered SPS/PPS before the first keyframe.
            // Chrome needs in-band parameter sets even when AVCDecoderConfigurationRecord
            // (extradata) was provided in configure().
            const pendingSpsPps = this.pendingVideoChunks.filter(p => p.nalType === 7 || p.nalType === 8);
            for (const p of pendingSpsPps) {
              try { this.videoDecoder.decode(p.chunk); } catch { /* decoder closed */ }
            }
            try { this.videoDecoder.decode(chunk); } catch { /* decoder closed */ }
            this.videoNeedsKeyframe = false;
            this.pendingVideoChunks = [];
          } else if (nalUnitType === 7 || nalUnitType === 8) {
            // Stocker SPS/PPS pour plus tard
            this.pendingVideoChunks.push({ chunk, nalType: nalUnitType, nalData });
          }
          // Ignorer les delta avant la première keyframe
        } else {
          if (this.videoDecoder.decodeQueueSize < MAX_DECODE_QUEUE) {
            try { this.videoDecoder.decode(chunk); } catch { /* decoder closed */ }
          }
        }
      } else {
        this.pendingVideoChunks.push({ chunk, nalType: nalUnitType, nalData });
        if (this.pendingVideoChunks.length > 300) {
          this.pendingVideoChunks.shift();
        }

        // Deferred decoder creation: we have a pending config and now have
        // SPS+PPS+IDR — create and prime the decoder immediately.
        if (this.pendingVideoConfig && !this.videoDecoder) {
          const hasSps = this.pendingVideoChunks.some(p => p.nalType === 7);
          const hasPps = this.pendingVideoChunks.some(p => p.nalType === 8);
          const idrEntry = this.pendingVideoChunks.find(p => p.nalType === 5);
          if (hasSps && hasPps && idrEntry) {
            const cfg = this.pendingVideoConfig;
            this.pendingVideoConfig = null;
            console.log(`[Cloud:${this.systemType}] 🎯 SPS+PPS+IDR buffered — creating primed decoder`);
            this.createAndPrimeDecoder(cfg, idrEntry.chunk);
          }
        }
      }

      if (this.canvasEl && this.streamWidth > 0) {
        if (this.canvasEl.width !== this.streamWidth || this.canvasEl.height !== this.streamHeight) {
          this.canvasEl.width = this.streamWidth;
          this.canvasEl.height = this.streamHeight;
        }
      }

    } else if (magic === 0x02) {
      // PCM audio: raw s16le samples, 20ms chunks (960 samples at 48kHz)
      if (data.byteLength < AUDIO_HEADER_SIZE) return;

      const pcmLen = view.getUint32(1, true);
      if (pcmLen === 0 || AUDIO_HEADER_SIZE + pcmLen > data.byteLength) return;

      const pcmData = new Uint8Array(data, AUDIO_HEADER_SIZE, pcmLen);
      if (pcmData.length < 2) return;

      // Play PCM directly via Web Audio API — no decoder needed
      this.playPcmChunk(pcmData);

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

        // Only init AudioDecoder for Opus; PCM plays directly via Web Audio API
        if (audioCfg.codec === "pcm_s16le") {
          console.log(`[Cloud:${this.systemType}] PCM audio mode — no decoder needed`);
          if (!this.audioCtx) {
            this.audioCtx = new AudioContext({ sampleRate: audioCfg.sampleRate || 48000 });
          }
          this.audioDecoderReady = true; // fake readiness for PCM
        } else {
          this.initAudioDecoder(audioCfg);
        }
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
    view.setUint16(10, 120, true);
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

  /** Accept the rematch — same session, no session info needed. The server unlocks input. */
  acceptRematch(): void {
    this.ws?.send(JSON.stringify({ type: "rematch_accept" }));
  }

  /** P2 declines the rematch. */
  declineRematch(): void {
    this.ws?.send(JSON.stringify({ type: "rematch_decline" }));
  }

  /** Auto-rematch for multi-match modes — skip the request/accept dance. */
  autoRematch(matchNumber: number, totalMatches: number): void {
    this.ws?.send(JSON.stringify({ type: "auto_rematch", matchNumber, totalMatches }));
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
    // Reset character selections for the new session
    this.p1CharName = null;
    this.p2CharName = null;
    this.p1CharId = -1;
    this.p2CharId = -1;
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
  onRoundResult?: (loser: number, winner: number, p1Losses: number, p2Losses: number, koType?: string) => void;
  /** Called when the match is over (one player has accumulated 2+ losses). */
  onMatchEnd?: (
    winner: number, loser: number, p1Losses: number, p2Losses: number,
    matchNumber?: number, totalRounds?: number, perfectKos?: number,
    meta?: {
      p1TeamIds?: number[]; p2TeamIds?: number[];
      p1SelectOrder?: number[]; p2SelectOrder?: number[];
      p1Mode?: "ADVANCED" | "EXTRA"; p2Mode?: "ADVANCED" | "EXTRA";
      p1PlayMode?: "Auto" | "Manual"; p2PlayMode?: "Auto" | "Manual";
      p1CharWins?: Record<number, number>; p2CharWins?: Record<number, number>;
      p1CharName?: string; p2CharName?: string;
      perfectKoDetails?: { round: number; player: number }[];
    },
  ) => void;
  /** Called when the opponent requests a rematch. */
  onRematchRequested?: () => void;
  /** Called when the opponent accepts the rematch (new session info provided). */
  onRematchAccepted?: (newSessionId: string, newWsUrl: string, newRoomCode: string) => void;
  /** Called when the opponent declines the rematch. */
  onRematchDeclined?: () => void;
  /** Called when a rematch is starting (server has reset the game — legacy same-session). */
  onRematchStarting?: () => void;
  /** Auto-rematch for multi-match modes — skip overlay, next match starting. */
  onAutoRematch?: (matchNumber: number, totalMatches: number) => void;
  /** Called when the server closes the session — all players should return to lobby. */
  onSessionClosed?: () => void;
  /** Live in-match state (teams, active char, gauge mode) — about every 500ms during combat. */
  onMatchState?: (data: MatchStateData) => void;
  /** Called when a player locks in a character during the character select phase. */
  onCharSelected?: (player: 1 | 2, charId: number, charName: string) => void;
  /** Called when the game is paused (by either player). player = who initiated, countdown = initial seconds. */
  onPaused?: (player: 1 | 2, countdown: number) => void;
  /** Called when the game resumes after a pause. */
  onResumed?: () => void;
  /** Called when a gift notification is received from the game-server (real-time overlay). */
  onGiftNotify?: (data: {
    gift: { id: string; name: string; iconUrl: string; animationUrl?: string; category: string };
    from: { username: string; avatar?: string };
    quantity: number;
    diamondAmount: number;
    message?: string;
  }) => void;
}