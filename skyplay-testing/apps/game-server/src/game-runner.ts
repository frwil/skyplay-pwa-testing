import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { SYSTEM_CORES, SYSTEM_RESOLUTIONS, UPSCALE, XDOTOOL_KEY_MAP, XDOTOOL_KEY_MAP_P2, BUTTON_TO_RETROARCH, buildRetroarchKeyConfig } from "./config.js";

export interface GameRunnerEvents {
  onFrame: (jpegData: Buffer, width: number, height: number) => void;
  onAudio: (opusData: Buffer) => void;
  onExit: (code: number | null) => void;
  onError: (err: Error) => void;
}

/**
 * Manages RetroArch + FFmpeg lifecycle inside the Docker container.
 *
 * Spawns three processes:
 * 1. Xvfb — virtual framebuffer for headless rendering
 * 2. RetroArch — runs the libretro core with the ROM on the virtual display
 * 3. FFmpeg — captures Xvfb display, encodes to MJPEG, pipes to stdout
 *
 * Audio capture is TODO (Phase 2).
 */
export class GameRunner extends EventEmitter {
  private xvfb: ChildProcess | null = null;
  private retroarch: ChildProcess | null = null;
  private ffmpeg: ChildProcess | null = null;
  private system: string;
  private rom: string;
  private sessionId: string;
  private displayNum: number;
  private running = false;
  private frameId = 0;
  private ffmpegBuffer = Buffer.alloc(0);

  constructor(system: string, rom: string, sessionId: string) {
    super();
    this.system = system;
    this.rom = rom;
    this.sessionId = sessionId;
    this.displayNum = 99; // Use :99 for Xvfb
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

    // 0. Start D-Bus daemon (needed by RetroArch to avoid SIGABRT)
    await this.startDbus();

    // 1. Start Xvfb
    await this.startXvfb(displayW, displayH);

    // 2. Start RetroArch
    await this.startRetroArch(`${coresDir}/${core}`, `${romsDir}/${this.rom}`, displayW, displayH);

    // 3. Start FFmpeg capture
    this.startFfmpeg(displayW, displayH);

    this.running = true;
    console.log(`[game-runner] All processes started for session ${this.sessionId}`);

    return { width: resolution.w, height: resolution.h };
  }

  /** Start D-Bus daemon if not already running. */
  private async startDbus(): Promise<void> {
    return new Promise((resolve) => {
      const proc = spawn("dbus-daemon", ["--system", "--fork"], {
        stdio: "ignore",
      });
      proc.on("close", () => {
        // dbus-daemon --fork exits immediately after forking
        setTimeout(resolve, 200);
      });
      proc.on("error", () => {
        // dbus might already be running or not installed — non-fatal
        resolve();
      });
      // Timeout safety
      setTimeout(resolve, 1000);
    });
  }

  private async startXvfb(w: number, h: number): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use Xvfb or Xdummy if Xvfb isn't available
      // Xdummy uses the dummy video driver and doesn't need /dev/fb or GPU
      const useXdummy = process.env.USE_XDUMMY === "1";

      if (useXdummy) {
        // Xdummy requires a config file
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

      // Xvfb doesn't have a "ready" signal — just wait a bit
      setTimeout(() => {
        resolve();
      }, 500);
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
        // Video
        "--set-shader", "",
        "-v",
        // Config
        "--appendconfig", "/dev/stdin",
      ];

      this.retroarch = spawn(retroarchBin, args, {
        env: {
          ...process.env,
          DISPLAY: this.display,
          SDL_VIDEODRIVER: "x11",
          SDL_AUDIODRIVER: "dummy", // Skip audio for now
          SDL_RENDER_DRIVER: "software",
          LIBGL_ALWAYS_SOFTWARE: "1", // Use llvmpipe software renderer
        },
        stdio: ["pipe", "ignore", "pipe"],
      });

      // Send RetroArch config via stdin
      const config = this.buildRetroarchConfig(w, h);
      this.retroarch.stdin?.write(config);
      this.retroarch.stdin?.end();

      this.retroarch.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
        // RetroArch logs to stderr
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

      // Wait for RetroArch to initialize
      setTimeout(() => resolve(), 2000);
    });
  }

  private startFfmpeg(w: number, h: number): void {
    const quality = process.env.FRAME_ENCODE_QUALITY || "5";
    // quality: 2-31 for mjpeg, lower = better. 5 = very good quality.

    this.ffmpeg = spawn("ffmpeg", [
      "-f", "x11grab",
      "-framerate", "60",
      "-video_size", `${w}x${h}`,
      "-i", `${this.display}.0`,
      "-f", "image2pipe",
      "-q:v", quality,
      "-vcodec", "mjpeg",
      "-avioflags", "direct",  // Reduce buffering
      "-flush_packets", "1",
      "-",
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, DISPLAY: this.display },
    });

    this.ffmpeg.stdout?.on("data", (chunk: Buffer) => {
      this.handleFfmpegChunk(chunk);
    });

    this.ffmpeg.stderr?.on("data", (data: Buffer) => {
      // FFmpeg outputs stats to stderr
      const text = data.toString();
      if (text.includes("Error") || text.includes("error")) {
        console.error(`[ffmpeg] ${text.trim()}`);
      }
    });

    this.ffmpeg.on("error", (err) => {
      console.error(`[ffmpeg] Process error:`, err);
      this.emit("error", err);
    });

    this.ffmpeg.on("exit", (code) => {
      console.log(`[ffmpeg] Exited with code ${code}`);
    });
  }

  /**
   * FFmpeg outputs MJPEG frames in image2pipe format.
   * Each frame starts with FF D8 and ends with FF D9 (JPEG markers).
   * We buffer and split on these markers to get individual frames.
   */
  private handleFfmpegChunk(chunk: Buffer): void {
    this.ffmpegBuffer = Buffer.concat([this.ffmpegBuffer, chunk]);

    // Find complete JPEG frames (FF D8 ... FF D9)
    let startIdx = 0;
    while (startIdx < this.ffmpegBuffer.length - 1) {
      const soiIdx = this.ffmpegBuffer.indexOf(0xff, startIdx);
      if (soiIdx === -1) break;
      if (soiIdx + 1 >= this.ffmpegBuffer.length) break;
      if (this.ffmpegBuffer[soiIdx + 1] !== 0xd8) {
        startIdx = soiIdx + 2;
        continue;
      }

      // Found SOI (FF D8), look for EOI (FF D9) after it
      const eoiIdx = this.findEoi(this.ffmpegBuffer, soiIdx + 2);
      if (eoiIdx === -1) break; // Frame incomplete, wait for more data

      // Extract complete frame from SOI to EOI+2
      const frameEnd = eoiIdx + 2;
      const frame = this.ffmpegBuffer.subarray(soiIdx, frameEnd);
      const resolution = SYSTEM_RESOLUTIONS[this.system];
      if (resolution) {
        this.frameId++;
        this.emit("frame", frame, resolution.w, resolution.h);
      }

      startIdx = frameEnd;
    }

    // Trim processed data from buffer
    if (startIdx > 0) {
      this.ffmpegBuffer = this.ffmpegBuffer.subarray(startIdx);
    }

    // Prevent buffer from growing unbounded if parsing breaks
    if (this.ffmpegBuffer.length > 10 * 1024 * 1024) {
      console.warn("[game-runner] FFmpeg buffer exceeded 10MB — resetting");
      this.ffmpegBuffer = Buffer.alloc(0);
    }
  }

  /** Find the end-of-image marker FF D9 after a start-of-image marker. */
  private findEoi(buf: Buffer, fromIdx: number): number {
    for (let i = fromIdx; i < buf.length - 1; i++) {
      if (buf[i] === 0xff && buf[i + 1] === 0xd9) return i;
    }
    return -1;
  }

  /** Inject a keyboard input into RetroArch via xdotool.
   *  @param player 1 or 2 — selects the correct key map (non-overlapping keys).
   *  @param button Button index (0-13), maps to RetroArch config name.
   *  @param pressed true = keydown, false = keyup.
   */
  injectInput(player: number, button: number, pressed: boolean): void {
    if (!this.running) return;

    const retroarchName = BUTTON_TO_RETROARCH[button];
    if (!retroarchName) return;

    const keyMap = player === 1 ? XDOTOOL_KEY_MAP : XDOTOOL_KEY_MAP_P2;
    const xdoKey = keyMap[retroarchName];
    if (!xdoKey) return;

    const action = pressed ? "keydown" : "keyup";

    // xdotool sends keystrokes to the focused window on the Xvfb display.
    // RetroArch runs fullscreen so it should always have focus.
    // Using `keydown`/`keyup` directly (no `search`) avoids issues with
    // window class name mismatches (e.g. "RetroArch" vs "retroarch").
    // P1 and P2 use different physical keys — RetroArch decodes them to
    // the correct player port via `input_player1_*` / `input_player2_*` config.
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

  /** Pause RetroArch (send pause key). */
  pause(): void {
    spawn("xdotool", ["key", "p"], {
      env: { ...process.env, DISPLAY: this.display },
      stdio: "ignore",
    });
  }

  /** Resume RetroArch. */
  resume(): void {
    spawn("xdotool", ["key", "p"], {
      env: { ...process.env, DISPLAY: this.display },
      stdio: "ignore",
    });
  }

  /** Stop all processes. */
  stop(): void {
    console.log(`[game-runner] Stopping all processes for session ${this.sessionId}`);
    this.running = false;

    // Kill in reverse order
    this.ffmpeg?.kill("SIGTERM");
    this.retroarch?.kill("SIGTERM");
    this.xvfb?.kill("SIGTERM");

    // Force kill after 2 seconds
    setTimeout(() => {
      this.ffmpeg?.kill("SIGKILL");
      this.retroarch?.kill("SIGKILL");
      this.xvfb?.kill("SIGKILL");
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
      `aspect_ratio_index = "0"`, // 1:1 PAR
      `video_scale_integer = "false"`,
      `video_smooth = "false"`,
      `video_threaded = "true"`,
      `video_max_swapchain_images = "2"`,
      `video_frame_delay = "0"`,
      `video_hard_sync = "false"`,
      `video_vsync = "false"`,
      // Audio
      `audio_enable = "false"`,
      // Input
      `input_driver = "sdl2"`,
      `input_joypad_driver = "null"`,
      // Performance — audio_sync=true is REQUIRED for real-time speed
      // even when audio is disabled (RetroArch uses its audio clock for
      // frame pacing; without it + vsync off = uncapped speed).
      `audio_sync = "true"`,
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

    // Keyboard mappings for P1
    const keyConfig = buildRetroarchKeyConfig();
    for (const [key, value] of Object.entries(keyConfig)) {
      lines.push(`${key} = "${value}"`);
    }

    return lines.join("\n") + "\n";
  }
}
