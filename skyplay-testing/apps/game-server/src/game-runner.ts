import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SYSTEM_CORES, SYSTEM_RESOLUTIONS, UPSCALE, XDOTOOL_KEY_MAP, XDOTOOL_KEY_MAP_P2, getButtonToRetroarch, buildRetroarchKeyConfig } from "./config.js";

export interface GameRunnerEvents {
  onFrame: (jpegData: Buffer, width: number, height: number) => void;
  onAudio: (opusData: Buffer) => void;
  onExit: (code: number | null) => void;
  onError: (err: Error) => void;
  /** H.264 codec config — sent once before the first video frame. */
  onCodecConfig: (videoDesc: Uint8Array, audioDesc: Uint8Array) => void;
}

/** RetroArch network command port (NCI). */
const RA_CMD_PORT = 55355;

/**
 * Manages RetroArch + FFmpeg lifecycle inside the Docker container.
 *
 * Spawns:
 * 1. Xvfb — virtual framebuffer for headless rendering
 * 2. PulseAudio — virtual audio device (null sink)
 * 3. RetroArch — runs the libretro core with the ROM
 * 4. FFmpeg (video) — captures Xvfb, encodes H.264, pipes to stdout
 * 5. FFmpeg (audio) — captures PulseAudio monitor, encodes Opus, pipes to stdout
 *
 * Video uses H.264 baseline profile (WebCodecs-compatible).
 * Audio uses Opus 32kbps mono.
 */
export class GameRunner extends EventEmitter {
  private xvfb: ChildProcess | null = null;
  private retroarch: ChildProcess | null = null;
  private ffmpegVideo: ChildProcess | null = null;
  private ffmpegAudio: ChildProcess | null = null;
  private system: string;
  private rom: string;
  private sessionId: string;
  private displayNum: number;
  private running = false;
  private frameId = 0;
  private videoBuffer = Buffer.alloc(0);
  private audioBuffer = Buffer.alloc(0);
  private codecConfigSent = false;
  private audioPacketsSkipped = 0; // Skip OpusHead + OpusTags Ogg pages
  private ongoingOpusPacket: Buffer[] = []; // Cross-page Opus packet assembly
  private retroarchWindowId: string | null = null;
  private configPath: string | null = null;

  // ── Round win/loss detection via screenshot pixel analysis (health bars) ──
  private healthFfmpeg: ChildProcess | null = null;
  private healthPollTimer: ReturnType<typeof setInterval> | null = null;
  private healthPollEnabled = false;
  private healthFrameBuf = Buffer.alloc(0);
  private healthPollErrorCount = 0;
  private previousP1Health = -1;
  private previousP2Health = -1;
  private koDetected = false;
  private p1Losses = 0;
  private p2Losses = 0;
  private matchEnded = false;
  private healthStableFrames = 0; // frames with stable health readings
  private healthDetectionArmed = false; // KO detection enabled after warmup
  private lastKoTimestamp = 0; // prevent double-triggers within cooldown window
  private koCooldownFrames = 0; // countdown after KO before re-arming detection
  /** Width of the upscaled display (set when game starts). */
  private displayW = 0;
  private displayH = 0;

  constructor(system: string, rom: string, sessionId: string) {
    super();
    this.system = system;
    this.rom = rom;
    this.sessionId = sessionId;
    this.displayNum = 99;
  }

  get display(): string {
    return `:${this.displayNum}`;
  }

  async start(): Promise<{ width: number; height: number }> {
    const resolution = SYSTEM_RESOLUTIONS[this.system];
    if (!resolution) throw new Error(`Unknown system: ${this.system}`);
    const core = SYSTEM_CORES[this.system];
    if (!core) throw new Error(`No core for system: ${this.system}`);

    const displayW = resolution.w * UPSCALE;
    const displayH = resolution.h * UPSCALE;
    const coresDir = process.env.RETROARCH_CORES_DIR || "/usr/lib/libretro";
    const romsDir = process.env.ROMS_DIR || "/roms";

    console.log(`[game-runner] Starting ${this.system} — ${displayW}x${displayH}`);

    // 0. Start D-Bus (needed by PulseAudio and RetroArch)
    await this.startDbus();

    // 1. Start PulseAudio
    await this.startPulseAudio();

    // 2. Start Xvfb
    await this.startXvfb(displayW, displayH);

    // 3. Start RetroArch (with audio enabled)
    await this.startRetroArch(`${coresDir}/${core}`, `${romsDir}/${this.rom}`, displayW, displayH);

    // 4. Start FFmpeg video capture (H.264)
    this.startFfmpegVideo(displayW, displayH);

    // 5. Start FFmpeg audio capture (Opus)
    this.startFfmpegAudio();

    // Send codec config via next tick (FFmpeg needs time to start)
    setTimeout(() => {
      if (!this.codecConfigSent && this.running) {
        this.sendCodecConfig();
      }
    }, 1500);

    this.running = true;
    console.log(`[game-runner] All processes started for session ${this.sessionId}`);

    // Start health bar watcher (ffmpeg-based pixel capture)
    this.startHealthBarCapture();

    return { width: resolution.w, height: resolution.h };
  }

  // ─────────────────────────────────────────────────────────────────
  //  Health bar watcher (screenshot-based round detection)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Start an ffmpeg process that captures a thin horizontal stripe at the
   * top of the screen (where KOF '98 health bars are) at 2 fps.
   * Raw RGB24 pixels are parsed to detect health bar presence/absence.
   */
  private startHealthBarCapture(): void {
    this.displayW = (SYSTEM_RESOLUTIONS[this.system]?.w ?? 320) * UPSCALE;
    this.displayH = (SYSTEM_RESOLUTIONS[this.system]?.h ?? 224) * UPSCALE;

    // Capture a 6-pixel-high stripe where health bars are (top area).
    // KOF '98 health bars at 3x upscale (960x672): y=24, height ~12.
    // That's ~3.6% from top — use 4% to be safe.
    const stripeY = Math.floor(this.displayH * 0.04); // ~4% from top
    const stripeH = 10;

    try {
      this.healthFfmpeg = spawn("ffmpeg", [
        "-f", "x11grab",
        "-framerate", "2",
        "-video_size", `${this.displayW}x${stripeH}`,
        "-i", `${this.display}.0+0,${stripeY}`,
        "-f", "rawvideo",
        "-pix_fmt", "rgb24",
        "-loglevel", "quiet",
        "pipe:1",
      ], {
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, DISPLAY: this.display },
      });

      this.healthFfmpeg.stdout?.on("data", (chunk: Buffer) => {
        this.healthFrameBuf = Buffer.concat([this.healthFrameBuf, chunk]);
        const frameSize = this.displayW * stripeH * 3; // RGB = 3 bytes/pixel
        while (this.healthFrameBuf.length >= frameSize) {
          const frame = this.healthFrameBuf.subarray(0, frameSize);
          this.healthFrameBuf = this.healthFrameBuf.subarray(frameSize);
          this.analyzeHealthFrame(frame, this.displayW, stripeH);
        }
        // Safety: prevent unbounded buffer growth
        if (this.healthFrameBuf.length > frameSize * 3) {
          this.healthFrameBuf = Buffer.alloc(0);
        }
      });

      this.healthFfmpeg.on("error", (err) => {
        if (this.healthPollErrorCount < 3) {
          console.warn("[game-runner] 🧠 Health bar ffmpeg error:", err.message);
        }
        this.healthPollErrorCount++;
      });

      console.log(`[game-runner] 🧠 Health bar capture started: ${this.displayW}x${stripeH} at y=${stripeY}`);
    } catch (err) {
      console.warn("[game-runner] 🧠 Failed to start health bar capture:", err);
    }
  }

  /** Analyze a raw RGB24 frame of the health bar stripe. */
  private analyzeHealthFrame(frame: Buffer, width: number, height: number): void {
    if (!this.running || this.matchEnded) return;
    if (this.healthPollErrorCount >= 10) return;
    this.healthPollErrorCount = 0;

    // Divide the stripe into left half (P2) and right half (P1).
    // In KOF '98, P1's health bar is on the right, P2's on the left.
    const midX = Math.floor(width / 2);

    const p2Pixels = this.countHealthPixels(frame, width, 0, 0, midX, height);
    const p1Pixels = this.countHealthPixels(frame, width, midX, 0, width - midX, height);

    // Normalize to "health percentage" based on max observed bright pixels
    const maxPixels = midX * height * 0.3;
    const p1Health = Math.min(103, Math.round((p1Pixels / Math.max(1, maxPixels)) * 103));
    const p2Health = Math.min(103, Math.round((p2Pixels / Math.max(1, maxPixels)) * 103));

    // ── Warmup: require N consecutive stable frames before arming KO detection ──
    const WARMUP_FRAMES = 20; // ~10 seconds at 2fps
    const HEALTHYTHRESHOLD = 30;

    if (!this.healthDetectionArmed) {
      // Check if both health bars are in a "healthy" state (game is in a round)
      const bothHealthy = p1Health >= HEALTHYTHRESHOLD && p2Health >= HEALTHYTHRESHOLD;
      if (bothHealthy) {
        this.healthStableFrames++;
      } else {
        // Only reset after 3+ consecutive bad frames (tolerate brief dips)
        if (this.healthStableFrames > 0) {
          this.healthStableFrames = Math.max(0, this.healthStableFrames - 1);
        }
      }

      if (this.healthStableFrames === 1) {
        console.log(`[game-runner] 🧠 Warmup: health bars detected (P1=${p1Health}% P2=${p2Health}%), arming in ${WARMUP_FRAMES} frames...`);
      } else if (this.healthStableFrames > 0 && this.healthStableFrames % 10 === 0) {
        console.log(`[game-runner] 🧠 Warmup: ${this.healthStableFrames}/${WARMUP_FRAMES} stable frames`);
      }

      if (this.healthStableFrames >= WARMUP_FRAMES) {
        this.healthDetectionArmed = true;
        this.previousP1Health = p1Health;
        this.previousP2Health = p2Health;
        console.log(`[game-runner] 🧠 KO detection ARMED — health stable after ${WARMUP_FRAMES} frames: P1=${p1Health}% P2=${p2Health}%`);
        return;
      }
      return;
    }

    // ── KO Detection (armed) ──────────────────────────────────────
    const KOTHRESHOLD = 10;
    const KO_COOLDOWN_FRAMES = 10; // ~5 seconds at 2fps — prevents double-triggers

    // Count down cooldown after a KO
    if (this.koCooldownFrames > 0) {
      this.koCooldownFrames--;
    }

    if (!this.koDetected && this.koCooldownFrames === 0) {
      if (this.previousP1Health > HEALTHYTHRESHOLD && p1Health <= KOTHRESHOLD) {
        this.koDetected = true;
        this.p1Losses++;
        this.koCooldownFrames = KO_COOLDOWN_FRAMES;
        console.log(`[game-runner] 🧠 P1 KO'd! P2 wins round. P1=${p1Health}% P2=${p2Health}% Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
        this.emit("roundResult", { loser: 1, winner: 2, p1Losses: this.p1Losses, p2Losses: this.p2Losses });
      } else if (this.previousP2Health > HEALTHYTHRESHOLD && p2Health <= KOTHRESHOLD) {
        this.koDetected = true;
        this.p2Losses++;
        this.koCooldownFrames = KO_COOLDOWN_FRAMES;
        console.log(`[game-runner] 🧠 P2 KO'd! P1 wins round. P1=${p1Health}% P2=${p2Health}% Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
        this.emit("roundResult", { loser: 2, winner: 1, p1Losses: this.p1Losses, p2Losses: this.p2Losses });
      }
    }

    // ── Detect new round (both health bars back high) ─────────────
    if (this.koDetected && p1Health >= HEALTHYTHRESHOLD && p2Health >= HEALTHYTHRESHOLD) {
      this.koDetected = false;
      console.log(`[game-runner] 🧠 New round: P1=${p1Health}% P2=${p2Health}%`);
    }

    // ── Check match end ───────────────────────────────────────────
    if (!this.matchEnded && (this.p1Losses >= 2 || this.p2Losses >= 2)) {
      this.matchEnded = true;
      const winner = this.p1Losses >= 2 ? 2 : 1;
      const loser = winner === 1 ? 2 : 1;
      console.log(`[game-runner] 🧠 MATCH OVER! Winner: P${winner} Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
      this.emit("matchEnd", { winner, loser, p1Losses: this.p1Losses, p2Losses: this.p2Losses });

      // Auto-continue: reset state after 8s, insert coins + start
      setTimeout(() => {
        if (!this.running) return;
        console.log("[game-runner] 🔄 Auto-continue: resetting for new match...");
        this.p1Losses = 0;
        this.p2Losses = 0;
        this.matchEnded = false;
        this.koDetected = false;
        this.koCooldownFrames = 0;
        this.healthStableFrames = 0;
        this.healthDetectionArmed = false;
        this.previousP1Health = -1;
        this.previousP2Health = -1;

        // Insert 2 coins via P1 (sequential — no overlapping calls)
        console.log("[game-runner] 🪙 Auto-continue: inserting coins...");
        this.ensureFocus();
        // Coin 1: DOWN → UP
        this.injectInput(1, 4, true);
        setTimeout(() => { this.injectInput(1, 4, false); }, 200);
        // Coin 2: DOWN → UP (400ms after coin 1)
        setTimeout(() => { this.injectInput(1, 4, true); }, 400);
        setTimeout(() => { this.injectInput(1, 4, false); }, 600);

        // Start for both players after coins (5s total)
        setTimeout(() => {
          if (!this.running) return;
          console.log("[game-runner] ▶️  Auto-continue: pressing START...");
          this.ensureFocus();
          this.injectInput(1, 5, true);
          setTimeout(() => { this.injectInput(2, 5, true); }, 100);
          setTimeout(() => {
            this.injectInput(1, 5, false);
            this.injectInput(2, 5, false);
            // Restart health monitoring
            this.startMemoryWatcher();
          }, 300);
        }, 5000);
      }, 8000);
    }

    // Update previous values
    this.previousP1Health = p1Health;
    this.previousP2Health = p2Health;
  }

  /** Count non-dark pixels in a region (pixels that are part of a health bar). */
  private countHealthPixels(
    frame: Buffer, frameWidth: number,
    startX: number, startY: number, regionW: number, regionH: number,
  ): number {
    let count = 0;
    const MIN_BRIGHTNESS = 80; // RGB sum threshold for "not dark"

    for (let y = startY; y < startY + regionH; y++) {
      for (let x = startX; x < startX + regionW; x++) {
        const idx = (y * frameWidth + x) * 3;
        const r = frame[idx] ?? 0;
        const g = frame[idx + 1] ?? 0;
        const b = frame[idx + 2] ?? 0;
        // Health bar pixels in KOF '98 are yellow/green/red — all have R+G+B > threshold
        if (r + g + b > MIN_BRIGHTNESS * 3) {
          count++;
        }
      }
    }
    return count;
  }

  /** Start the round detection polling (kept for API compatibility, actual detection is ffmpeg-driven). */
  startMemoryWatcher(): void {
    if (this.matchEnded) return;
    // If already polling, clear old timer before restarting
    if (this.healthPollTimer) {
      clearInterval(this.healthPollTimer);
      this.healthPollTimer = null;
    }
    this.healthPollEnabled = true;
    console.log("[game-runner] 🧠 Round detection activated (screenshot-based)");

    // Reset state
    this.previousP1Health = -1;
    this.previousP2Health = -1;
    this.koDetected = false;
    this.p1Losses = 0;
    this.p2Losses = 0;
    this.matchEnded = false;
    this.healthStableFrames = 0;
    this.healthDetectionArmed = false;
    this.koCooldownFrames = 0;

    // Log periodic debug info every 10s
    this.healthPollTimer = setInterval(() => {
      if (!this.running || this.matchEnded) return;
      if (this.previousP1Health >= 0) {
        console.log(`[game-runner] 🧠 Health: P1=${this.previousP1Health}% P2=${this.previousP2Health}% ko=${this.koDetected} losses: P1=${this.p1Losses} P2=${this.p2Losses}`);
      }
    }, 10000);
  }

  /** Stop the health watcher. */
  stopHealthWatcher(): void {
    this.healthPollEnabled = false;
    if (this.healthPollTimer) {
      clearInterval(this.healthPollTimer);
      this.healthPollTimer = null;
    }
    console.log("[game-runner] 🧠 Round detection stopped");
  }

  // (keep stopMemoryWatcher for backwards compat)
  stopMemoryWatcher(): void {
    this.stopHealthWatcher();
  }

  /** Send H.264 + Opus codec configuration to the client. */
  private sendCodecConfig(): void {
    this.codecConfigSent = true;
    const resolution = SYSTEM_RESOLUTIONS[this.system];
    const w = resolution.w * UPSCALE;
    const h = resolution.h * UPSCALE;

    // H.264 AVC decoder description: AVCC record
    // For baseline profile, we provide a minimal AVCC with SPS/PPS extracted from FFmpeg.
    // We'll use default values that FFmpeg + libx264 produce.
    // The actual SPS/PPS will be extracted from the first IDR frame by the browser.
    const videoDesc = Buffer.from(JSON.stringify({
      codec: "avc1.42001E", // H.264 baseline, level 3.0
      width: w,
      height: h,
      framerate: 60,
      bitrate: 2000000,
    }), "utf-8");

    const audioDesc = Buffer.from(JSON.stringify({
      codec: "opus",
      sampleRate: 48000,
      channels: 1,
      bitrate: 32000,
    }), "utf-8");

    console.log(`[game-runner] Sending codec config: ${w}x${h} H.264 + Opus 32kbps`);
    this.emit("codecConfig", videoDesc, audioDesc);
    this.emit("audio", Buffer.alloc(0)); // kick audio pipeline
  }

  /** Start D-Bus daemon if not already running. */
  private async startDbus(): Promise<void> {
    return new Promise((resolve) => {
      const proc = spawn("dbus-daemon", ["--system", "--fork"], { stdio: "ignore" });
      proc.on("close", () => setTimeout(resolve, 300));
      proc.on("error", () => resolve());
      setTimeout(resolve, 1500);
    });
  }

  /** Start PulseAudio with a null sink for headless audio. */
  private async startPulseAudio(): Promise<void> {
    return new Promise((resolve) => {
      // Kill any existing pulseaudio
      spawn("pulseaudio", ["--kill"], { stdio: "ignore" }).on("close", () => {
        // Start pulseaudio daemon
        const pa = spawn("pulseaudio", [
          "--start",
          "--exit-idle-time=-1",
          "--disallow-module-loading=0",
          "--disallow-exit=1",
          "--log-target=stderr",
        ], { stdio: "ignore" });

        pa.on("close", (code) => {
          console.log(`[game-runner] PulseAudio started (code ${code})`);
          // Create null sink for game audio
          setTimeout(() => {
            spawn("pactl", [
              "load-module", "module-null-sink",
              "sink_name=game_sink",
              "sink_properties=device.description=GameAudio",
            ], { stdio: "ignore" }).on("close", () => {
              // Set as default sink
              spawn("pactl", ["set-default-sink", "game_sink"], { stdio: "ignore" })
                .on("close", () => {
                  console.log("[game-runner] PulseAudio null sink ready");
                  resolve();
                });
            });
          }, 500);
        });

        pa.on("error", () => {
          console.warn("[game-runner] PulseAudio failed to start — audio disabled");
          resolve();
        });

        setTimeout(resolve, 3000);
      });
    });
  }

  private async startXvfb(w: number, h: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const useXdummy = process.env.USE_XDUMMY === "1";

      if (useXdummy) {
        this.xvfb = spawn("Xorg", [
          this.display,
          "-config", "/etc/X11/xorg-dummy.conf",
          "-noreset",
          "+extension", "GLX",
          "+extension", "RANDR",
          "+extension", "RENDER",
        ], { stdio: ["ignore", "ignore", "pipe"] });
      } else {
        this.xvfb = spawn("Xvfb", [
          this.display,
          "-screen", "0", `${w}x${h}x24`,
          "-nolisten", "tcp",
          "+extension", "GLX",
        ], { stdio: ["ignore", "ignore", "pipe"] });
      }

      this.xvfb.on("error", reject);
      setTimeout(() => resolve(), 500);
    });
  }

  private async startRetroArch(
    corePath: string,
    romPath: string,
    w: number,
    h: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const retroarchBin = process.env.RETROARCH_BIN || "retroarch";

      // Write config to a temp file instead of stdin.
      // stdin piping with --appendconfig is unreliable — RetroArch may
      // read stdin before the config is fully written. A temp file is
      // guaranteed to be available when RetroArch processes --appendconfig.
      const config = this.buildRetroarchConfig(w, h);
      this.configPath = join(tmpdir(), `retroarch-${this.sessionId}.cfg`);
      writeFileSync(this.configPath, config, "utf-8");
      console.log(`[game-runner] Config written to ${this.configPath} (${config.length} bytes)`);

      const args = [
        "-L", corePath,
        romPath,
        "--set-shader", "",
        "-v",
        "--appendconfig", this.configPath!,
      ];

      this.retroarch = spawn(retroarchBin, args, {
        env: {
          ...process.env,
          DISPLAY: this.display,
          SDL_VIDEODRIVER: "x11",
          SDL_AUDIODRIVER: "pulseaudio",
          SDL_RENDER_DRIVER: "software",
          LIBGL_ALWAYS_SOFTWARE: "1",
          PULSE_SINK: "game_sink",
        },
        stdio: ["ignore", "ignore", "pipe"],
      });

      this.retroarch.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
        if (text.includes("ERROR") || text.includes("error")) {
          console.error(`[retroarch] ${text.trim()}`);
        }
      });

      this.retroarch.on("error", reject);
      this.retroarch.on("exit", (code) => {
        console.log(`[retroarch] Exited with code ${code}`);
        this.running = false;
        this.emit("exit", code);
      });

      setTimeout(() => {
        // Find RetroArch window for focused xdotool input
        this.findRetroarchWindow();
        resolve();
      }, 2000);
    });
  }

  /** Find the RetroArch X11 window ID for targeted xdotool input. */
  private findRetroarchWindow(): void {
    const proc = spawn("xdotool", ["search", "--onlyvisible", "--class", "retroarch"], {
      env: { ...process.env, DISPLAY: this.display },
      stdio: "pipe",
    });
    let output = "";
    proc.stdout?.on("data", (d: Buffer) => { output += d.toString(); });
    proc.on("close", (code) => {
      const wid = output.trim().split("\n")[0]?.trim();
      if (wid && /^\d+$/.test(wid)) {
        this.retroarchWindowId = wid;
        console.log(`[game-runner] 🪟 RetroArch window ID: ${wid}`);
        // Also focus it
        spawn("xdotool", ["windowactivate", "--sync", wid], {
          env: { ...process.env, DISPLAY: this.display },
          stdio: "ignore",
        });
      } else {
        console.warn(`[game-runner] ⚠️ Could not find RetroArch window (code ${code}, output: "${output.trim()}")`);
      }
    });
  }

  /** FFmpeg video: captures Xvfb, encodes H.264 baseline, outputs to stdout. */
  private startFfmpegVideo(w: number, h: number): void {
    this.ffmpegVideo = spawn("ffmpeg", [
      "-f", "x11grab",
      "-framerate", "60",
      "-video_size", `${w}x${h}`,
      "-i", `${this.display}.0`,
      // H.264 baseline — WebCodecs compatible
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-tune", "zerolatency",
      "-profile:v", "baseline",
      "-level", "3.0",
      "-pix_fmt", "yuv420p",
      "-b:v", "2M",
      "-maxrate", "3M",
      "-bufsize", "1M",
      "-g", "120",         // keyframe every 2s at 60fps
      "-keyint_min", "60",
      "-sc_threshold", "0",
      "-refs", "1",
      "-x264-params", "sliced-threads=0:sync-lookahead=0:rc-lookahead=0",
      // Output Annex B format (raw NAL units)
      "-f", "h264",
      "-avioflags", "direct",
      "-flush_packets", "1",
      "pipe:1",
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, DISPLAY: this.display },
    });

    this.ffmpegVideo.stdout?.on("data", (chunk: Buffer) => {
      this.handleVideoChunk(chunk);
    });

    this.ffmpegVideo.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      if (text.includes("Error") || text.includes("error")) {
        console.error(`[ffmpeg:video] ${text.trim()}`);
      }
    });

    this.ffmpegVideo.on("error", (err) => {
      console.error(`[ffmpeg:video] Process error:`, err);
      this.emit("error", err);
    });

    this.ffmpegVideo.on("exit", (code) => {
      console.log(`[ffmpeg:video] Exited with code ${code}`);
    });
  }

  /** FFmpeg audio: captures PulseAudio monitor, encodes Opus, outputs to stdout. */
  private startFfmpegAudio(): void {
    this.ffmpegAudio = spawn("ffmpeg", [
      "-f", "pulse",
      "-i", "game_sink.monitor",
      "-c:a", "libopus",
      "-b:a", "32k",
      "-ar", "48000",
      "-ac", "1",
      "-application", "lowdelay",
      "-frame_duration", "20",
      "-packet_loss", "0",
      "-f", "opus",
      "-flush_packets", "1",
      "pipe:1",
    ], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.ffmpegAudio.stdout?.on("data", (chunk: Buffer) => {
      this.handleAudioChunk(chunk);
    });

    this.ffmpegAudio.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      if (text.includes("Error") || text.includes("error")) {
        console.error(`[ffmpeg:audio] ${text.trim()}`);
      }
    });

    this.ffmpegAudio.on("error", (err) => {
      console.error(`[ffmpeg:audio] Process error:`, err);
      // Audio is non-critical — don't crash
    });

    this.ffmpegAudio.on("exit", (code) => {
      console.log(`[ffmpeg:audio] Exited with code ${code}`);
    });
  }

  /**
   * Parse H.264 Annex B stream into NAL units.
   * Each NAL unit starts with 0x00 0x00 0x00 0x01 or 0x00 0x00 0x01.
   * We emit complete NAL units (including start code) as video frames.
   */
  private handleVideoChunk(chunk: Buffer): void {
    this.videoBuffer = Buffer.concat([this.videoBuffer, chunk]);

    const resolution = SYSTEM_RESOLUTIONS[this.system];
    if (!resolution) return;

    // Search for NAL start codes in the buffer
    let pos = 0;
    while (pos < this.videoBuffer.length - 3) {
      // Find next start code
      let scLen = 0;
      if (this.videoBuffer[pos] === 0x00 && this.videoBuffer[pos + 1] === 0x00) {
        if (this.videoBuffer[pos + 2] === 0x01) {
          scLen = 3;
        } else if (this.videoBuffer[pos + 2] === 0x00 && pos + 3 < this.videoBuffer.length && this.videoBuffer[pos + 3] === 0x01) {
          scLen = 4;
        }
      }

      if (scLen > 0) {
        // Found a start code at `pos`
        // Find the NEXT start code to delimit this NAL unit
        let nextPos = pos + scLen;
        let nextScLen = 0;
        while (nextPos < this.videoBuffer.length - 3) {
          if (this.videoBuffer[nextPos] === 0x00 && this.videoBuffer[nextPos + 1] === 0x00) {
            if (this.videoBuffer[nextPos + 2] === 0x01) {
              nextScLen = 3;
              break;
            } else if (this.videoBuffer[nextPos + 2] === 0x00 && nextPos + 3 < this.videoBuffer.length && this.videoBuffer[nextPos + 3] === 0x01) {
              nextScLen = 4;
              break;
            }
          }
          nextPos++;
        }

        if (nextScLen > 0 && nextPos > pos + scLen) {
          // Complete NAL unit from pos to nextPos
          const nalUnit = this.videoBuffer.subarray(pos, nextPos);
          this.frameId++;
          this.emit("frame", nalUnit, resolution.w, resolution.h);
          pos = nextPos; // Continue from next start code
        } else if (nextScLen === 0) {
          // No next start code found — wait for more data
          break;
        } else {
          pos += scLen;
        }
      } else {
        pos++;
      }
    }

    // Trim processed data
    if (pos > 0 && pos < this.videoBuffer.length) {
      // Keep unprocessed tail
      this.videoBuffer = this.videoBuffer.subarray(pos);
    } else if (pos >= this.videoBuffer.length) {
      this.videoBuffer = Buffer.alloc(0);
    }

    // Safety: prevent unbounded buffer growth
    if (this.videoBuffer.length > 10 * 1024 * 1024) {
      console.warn("[game-runner] Video buffer exceeded 10MB — resetting");
      this.videoBuffer = Buffer.alloc(0);
    }
  }

  /**
   * Parse raw Opus packets from FFmpeg's Ogg container output.
   *
   * FFmpeg `-f opus` writes Ogg pages to stdout, NOT raw Opus packets.
   * Each Ogg page has a header (27+ bytes) followed by segment data.
   * Opus packets are framed inside Ogg segments:
   *  - segment length 255 = packet continues in next segment
   *  - segment length < 255 = end of current packet
   *
   * We skip the first two Ogg pages (OpusHead + OpusTags) because the
   * browser's AudioDecoder is configured with its own OpusHead.
   *
   * Ogg page structure:
   *   0-3:   "OggS" magic
   *   4:     version (0)
   *   5:     header_type flags
   *   6-13:  granule_position (int64 LE)
   *   14-17: serial number (uint32 LE)
   *   18-21: page sequence (uint32 LE)
   *   22-25: checksum (uint32)
   *   26:    page_segments count (N)
   *   27:    segment_table (N bytes)
   *   27+N:  segment data (sum of segment_table bytes)
   */
  private handleAudioChunk(chunk: Buffer): void {
    if (chunk.length === 0) return;

    // Accumulate data — FFmpeg stdout may deliver partial pages
    this.audioBuffer = Buffer.concat([this.audioBuffer, chunk]);

    // Parse complete Ogg pages from the buffer
    while (this.audioBuffer.length >= 27) {
      // Locate next Ogg page marker
      const oggsIdx = this.audioBuffer.indexOf("OggS");
      if (oggsIdx === -1) {
        if (this.audioBuffer.length > 65536) {
          console.warn("[game-runner] No OggS in 64KB audio buffer — resetting");
          this.audioBuffer = Buffer.alloc(0);
        }
        break;
      }

      if (oggsIdx > 0) {
        console.warn(`[game-runner] Discarding ${oggsIdx}B before OggS`);
        this.audioBuffer = this.audioBuffer.subarray(oggsIdx);
      }

      // Parse Ogg page header (27 bytes fixed)
      const version = this.audioBuffer[4];
      if (version !== 0) {
        console.warn(`[game-runner] Bad Ogg version ${version} — skipping byte`);
        this.audioBuffer = this.audioBuffer.subarray(1);
        continue;
      }

      const numSegments = this.audioBuffer[26];
      const headerSize = 27 + numSegments;

      if (this.audioBuffer.length < headerSize) break; // segment table incomplete

      // Sum segment sizes to get total page size
      let dataSize = 0;
      for (let i = 0; i < numSegments; i++) {
        dataSize += this.audioBuffer[27 + i];
      }

      const totalPageSize = headerSize + dataSize;
      if (this.audioBuffer.length < totalPageSize) break; // page data incomplete

      // ── Skip OpusHead + OpusTags (first 2 Ogg pages) ──
      if (this.audioPacketsSkipped < 2) {
        this.audioPacketsSkipped++;
        const label = this.audioPacketsSkipped === 1 ? "OpusHead" : "OpusTags";
        console.log(`[game-runner] Skipping Ogg ${label} page (${totalPageSize}B, ${numSegments} segs)`);
        this.audioBuffer = this.audioBuffer.subarray(totalPageSize);
        continue;
      }

      // ── Extract raw Opus packets from Ogg segments ──
      // header_type bit 0 (0x01) = continuation of packet from previous page
      const headerType = this.audioBuffer[5];
      if (!(headerType & 0x01)) {
        // No continuation — flush any stale partial packet (shouldn't happen)
        if (this.ongoingOpusPacket.length > 0) {
          console.warn("[game-runner] Flushing stale partial Opus packet (missing continuation flag)");
          const stale = Buffer.concat(this.ongoingOpusPacket);
          if (stale.length > 0) this.emit("audio", stale);
          this.ongoingOpusPacket = [];
        }
      }

      let cursor = 27;

      for (let i = 0; i < numSegments; i++) {
        const segLen = this.audioBuffer[cursor];
        cursor++;

        if (segLen > 0) {
          this.ongoingOpusPacket.push(
            Buffer.from(this.audioBuffer.subarray(cursor, cursor + segLen))
          );
        }
        cursor += segLen;

        // A segment shorter than 255 marks the end of an Opus packet.
        // 255 means the packet continues into the next segment (or next page).
        if (segLen < 255) {
          if (this.ongoingOpusPacket.length > 0) {
            const opusPacket = this.ongoingOpusPacket.length === 1
              ? this.ongoingOpusPacket[0]
              : Buffer.concat(this.ongoingOpusPacket);
            // Validate TOC byte before emitting
            if (opusPacket.length > 0 && ((opusPacket[0] >> 3) & 0x1f) <= 15) {
              this.emit("audio", opusPacket);
            }
            this.ongoingOpusPacket = [];
          }
        }
      }

      // Advance past the consumed page
      this.audioBuffer = this.audioBuffer.subarray(totalPageSize);
    }

    // Safety: prevent unbounded buffer growth
    if (this.audioBuffer.length > 65536) {
      console.warn("[game-runner] Audio buffer exceeded 64KB — resetting");
      this.audioBuffer = Buffer.alloc(0);
    }
  }

  /** Inject a keyboard input into RetroArch via xdotool. */
  injectInput(player: number, button: number, pressed: boolean): void {
    if (!this.running) return;

    const buttonToRetroarch = getButtonToRetroarch(this.system);
    const retroarchName = buttonToRetroarch[button];
    if (!retroarchName) return;

    const keyMap = player === 1 ? XDOTOOL_KEY_MAP : XDOTOOL_KEY_MAP_P2;
    const xdoKey = keyMap[retroarchName];
    if (!xdoKey) return;

    const action = pressed ? "keydown" : "keyup";

    console.log(`[game-runner] 🕹️  xdotool ${action} ${xdoKey} (P${player} btn=${button})`);

    const proc = spawn("xdotool", [action, xdoKey], {
      env: { ...process.env, DISPLAY: this.display },
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("error", (err) => {
      console.error(`[game-runner] ❌ xdotool error (P${player} btn=${button} key=${xdoKey}):`, err.message);
    });

    proc.on("close", (code) => {
      if (code !== 0 || stderr) {
        console.warn(`[game-runner] ⚠️  xdotool exit=${code} stderr="${stderr.trim()}" (P${player} btn=${button} key=${xdoKey})`);
      }
    });
  }

  /** Focus the RetroArch window (call once before a key sequence, not per-input). */
  ensureFocus(): void {
    if (!this.retroarchWindowId) return;
    spawn("xdotool", ["windowactivate", "--sync", this.retroarchWindowId], {
      env: { ...process.env, DISPLAY: this.display },
      stdio: "ignore",
    });
  }

  pause(): void {
    spawn("xdotool", ["key", "p"], {
      env: { ...process.env, DISPLAY: this.display },
      stdio: "ignore",
    });
  }

  resume(): void {
    spawn("xdotool", ["key", "p"], {
      env: { ...process.env, DISPLAY: this.display },
      stdio: "ignore",
    });
  }

  stop(): void {
    console.log(`[game-runner] Stopping all processes for session ${this.sessionId}`);
    this.running = false;

    // Stop health watcher
    this.stopHealthWatcher();

    // Stop health bar ffmpeg
    if (this.healthFfmpeg) {
      this.healthFfmpeg.kill("SIGTERM");
      this.healthFfmpeg = null;
    }

    this.ffmpegAudio?.kill("SIGTERM");
    this.ffmpegVideo?.kill("SIGTERM");
    this.retroarch?.kill("SIGTERM");
    this.xvfb?.kill("SIGTERM");

    // Clean up temp config file
    if (this.configPath) {
      try { unlinkSync(this.configPath); } catch { /* ok */ }
    }

    setTimeout(() => {
      this.ffmpegAudio?.kill("SIGKILL");
      this.ffmpegVideo?.kill("SIGKILL");
      this.retroarch?.kill("SIGKILL");
      this.xvfb?.kill("SIGKILL");
      spawn("pulseaudio", ["--kill"], { stdio: "ignore" });
    }, 2000);
  }

  private buildRetroarchConfig(w: number, h: number): string {
    const lines: string[] = [
      `video_driver = "gl"`,
      `video_fullscreen = "true"`,
      `video_fullscreen_x = "${w}"`,
      `video_fullscreen_y = "${h}"`,
      `video_windowed_fullscreen = "true"`,
      `custom_viewport_width = "${w / UPSCALE}"`,
      `custom_viewport_height = "${h / UPSCALE}"`,
      `aspect_ratio_index = "0"`,
      `video_scale_integer = "false"`,
      `video_smooth = "false"`,
      `video_threaded = "true"`,
      `video_max_swapchain_images = "2"`,
      `video_frame_delay = "0"`,
      `video_hard_sync = "false"`,
      `video_vsync = "false"`,
      // Audio — enabled via PulseAudio
      `audio_enable = "true"`,
      `audio_driver = "pulse"`,
      `audio_rate = "48000"`,
      `audio_out_rate = "48000"`,
      `audio_sync = "true"`,
      // Input
      `input_driver = "sdl2"`,
      `input_joypad_driver = "null"`,
      `input_player2_joypad_index = "1"`,
      // Performance
      `fastforward_ratio = "1.0"`,
      `rewind_enable = "false"`,
      // Menu
      `menu_driver = "null"`,
      `savestate_auto_load = "false"`,
      `savestate_auto_save = "false"`,
      `auto_remaps_enable = "false"`,
      `config_save_on_exit = "false"`,
      `content_show_override = "false"`,
      // Network commands — allows reading core memory via UDP
      `network_cmd_enable = "true"`,
      `network_cmd_port = "${RA_CMD_PORT}"`,
    ];

    // Keyboard mappings for both players
    const keyConfig = buildRetroarchKeyConfig();
    // 🔍 DEBUG: Log P2 bindings
    const p2Bindings = Object.entries(keyConfig).filter(([k]) => k.startsWith("input_player2_"));
    console.log(`[game-runner] 🎮 P2 RetroArch bindings:`, Object.fromEntries(p2Bindings));
    for (const [key, value] of Object.entries(keyConfig)) {
      lines.push(`${key} = "${value}"`);
    }

    return lines.join("\n") + "\n";
  }
}
