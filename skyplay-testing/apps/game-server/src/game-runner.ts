import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { SYSTEM_CORES, SYSTEM_RESOLUTIONS, UPSCALE, XDOTOOL_KEY_MAP, XDOTOOL_KEY_MAP_P2, BUTTON_TO_RETROARCH, buildRetroarchKeyConfig } from "./config.js";

export interface GameRunnerEvents {
  onFrame: (jpegData: Buffer, width: number, height: number) => void;
  onAudio: (opusData: Buffer) => void;
  onExit: (code: number | null) => void;
  onError: (err: Error) => void;
  /** H.264 codec config — sent once before the first video frame. */
  onCodecConfig: (videoDesc: Uint8Array, audioDesc: Uint8Array) => void;
}

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

    return { width: resolution.w, height: resolution.h };
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

      const args = [
        "-L", corePath,
        romPath,
        "--set-shader", "",
        "-v",
        "--appendconfig", "/dev/stdin",
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
        stdio: ["pipe", "ignore", "pipe"],
      });

      const config = this.buildRetroarchConfig(w, h);
      this.retroarch.stdin?.write(config);
      this.retroarch.stdin?.end();

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

      setTimeout(() => resolve(), 2000);
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
   * Parse Opus packets from FFmpeg output.
   * FFmpeg `-f opus` outputs raw Opus packets (one per write).
   * We forward them directly as audio frames.
   */
  private handleAudioChunk(chunk: Buffer): void {
    if (chunk.length > 0) {
      this.emit("audio", chunk);
    }
  }

  /** Inject a keyboard input into RetroArch via xdotool. */
  injectInput(player: number, button: number, pressed: boolean): void {
    if (!this.running) return;

    const retroarchName = BUTTON_TO_RETROARCH[button];
    if (!retroarchName) return;

    const keyMap = player === 1 ? XDOTOOL_KEY_MAP : XDOTOOL_KEY_MAP_P2;
    const xdoKey = keyMap[retroarchName];
    if (!xdoKey) return;

    const action = pressed ? "keydown" : "keyup";

    const proc = spawn("xdotool", [action, xdoKey], {
      env: { ...process.env, DISPLAY: this.display },
      stdio: "ignore",
    });

    proc.on("error", (err) => {
      if (this.frameId < 3) {
        console.warn(`[game-runner] xdotool error (P${player}):`, err.message);
      }
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

    this.ffmpegAudio?.kill("SIGTERM");
    this.ffmpegVideo?.kill("SIGTERM");
    this.retroarch?.kill("SIGTERM");
    this.xvfb?.kill("SIGTERM");

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
    ];

    // Keyboard mappings for both players
    const keyConfig = buildRetroarchKeyConfig();
    for (const [key, value] of Object.entries(keyConfig)) {
      lines.push(`${key} = "${value}"`);
    }

    return lines.join("\n") + "\n";
  }
}
