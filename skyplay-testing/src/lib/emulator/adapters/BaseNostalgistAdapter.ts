import type { Nostalgist } from "nostalgist";
import type { EmulatorAdapter } from "../EmulatorAdapter";
import type { EmulatorStatus, RomEntry, SystemType } from "../types";
import { SYSTEM_CONFIGS } from "../EmulatorAdapter";

/** RetroArch button name for each generic button index. */
const INDEX_TO_RETROARCH: Record<number, string> = {
  0: "b",
  1: "y",
  2: "select",
  3: "start",
  4: "up",
  5: "down",
  6: "left",
  7: "right",
  8: "a",
  9: "x",
  10: "l",
  11: "r",
};

export interface NostalgistCallbacks {
  onStatusChange: (status: EmulatorStatus) => void;
}

/**
 * Base adapter for any system emulated via Nostalgist.js (RetroArch WASM).
 *
 * Subclasses only need to provide `systemType` and `coreName`.
 * Nostalgist.js manages its own render loop — there is no custom
 * rAF game loop or circular buffer. Pause/resume is delegated
 * to the RetroArch instance.
 */
export abstract class BaseNostalgistAdapter implements EmulatorAdapter {
  readonly systemType: SystemType;
  abstract readonly coreName: string;

  protected nostalgist: Nostalgist | null = null;
  protected canvasEl: HTMLCanvasElement | null = null;
  protected _status: EmulatorStatus = "idle";
  protected _currentRom: string | null = null;
  protected _volume: number = 1;
  protected _isMuted: boolean = false;
  protected _buttonMap: Record<number, string>;

  private callbacks: NostalgistCallbacks;
  private gainNode: GainNode | null = null;
  private audioCtx: AudioContext | null = null;

  constructor(systemType: SystemType, callbacks: NostalgistCallbacks) {
    this.systemType = systemType;
    this.callbacks = callbacks;
    // Build button index → RetroArch name mapping from system config
    const cfg = SYSTEM_CONFIGS[systemType];
    this._buttonMap = {};
    for (const btn of cfg.buttons) {
      this._buttonMap[btn.index] =
        INDEX_TO_RETROARCH[btn.index] ?? btn.id.toLowerCase();
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  async loadRom(rom: RomEntry): Promise<void> {
    // Exit previous instance
    this.exit();

    this._status = "loading";
    this.callbacks.onStatusChange("loading");
    this._currentRom = rom.name;

    try {
      const { Nostalgist } = await import("nostalgist");

      // Create canvas if none was set externally
      if (!this.canvasEl) {
        this.canvasEl = document.createElement("canvas");
      }
      this.canvasEl.style.width = "100%";
      this.canvasEl.style.height = "100%";

      this.nostalgist = await Nostalgist.launch({
        core: this.coreName,
        rom: rom.path,
        element: this.canvasEl,
      });

      this._status = "running";
      this.callbacks.onStatusChange("running");
    } catch (err) {
      console.error(`[${this.systemType}] Failed to load ROM:`, err);
      this._status = "error";
      this.callbacks.onStatusChange("error");
    }
  }

  /** Load ROM from raw bytes (used by desktop app via Tauri file dialog). */
  async loadRomFromBytes(romData: Uint8Array, romName: string): Promise<void> {
    this.exit();

    this._status = "loading";
    this.callbacks.onStatusChange("loading");
    this._currentRom = romName;

    try {
      const { Nostalgist } = await import("nostalgist");

      if (!this.canvasEl) {
        this.canvasEl = document.createElement("canvas");
      }
      this.canvasEl.style.width = "100%";
      this.canvasEl.style.height = "100%";

      this.nostalgist = await Nostalgist.launch({
        core: this.coreName,
        rom: romData,
        element: this.canvasEl,
      });

      this._status = "running";
      this.callbacks.onStatusChange("running");
    } catch (err) {
      console.error(`[${this.systemType}] Failed to load ROM from bytes:`, err);
      this._status = "error";
      this.callbacks.onStatusChange("error");
    }
  }

  exit(): void {
    try {
      this.nostalgist?.exit();
    } catch {
      // Nostalgist may throw if already exited
    }
    this.nostalgist = null;
    if (this.canvasEl?.parentNode) {
      this.canvasEl.parentNode.removeChild(this.canvasEl);
    }
    this.canvasEl = null;
    this._status = "idle";
    this.callbacks.onStatusChange("idle");
  }

  /** Get the canvas element (creates one if needed). */
  getCanvas(): HTMLCanvasElement | null {
    return this.canvasEl;
  }

  /** Set an existing canvas element for the emulator to render into. */
  setCanvas(canvas: HTMLCanvasElement): void {
    this.canvasEl = canvas;
  }

  /** Attach canvas to a DOM container. */
  attachCanvas(container: HTMLElement): void {
    if (this.canvasEl && this.canvasEl.parentNode !== container) {
      container.appendChild(this.canvasEl);
    }
  }

  // ── Playback ──────────────────────────────────────────────────

  pause(): void {
    if (this._status !== "running") return;
    this.nostalgist?.pause();
    this._status = "paused";
    this.callbacks.onStatusChange("paused");
  }

  resume(): void {
    if (this._status !== "paused") return;
    this.nostalgist?.resume();
    this._status = "running";
    this.callbacks.onStatusChange("running");
  }

  reset(): void {
    if (!this.nostalgist) return;
    this.nostalgist.restart();
    if (this._status === "paused") {
      // restart() resumes — re-pause if needed
      this.nostalgist.pause();
    }
  }

  // ── Input ─────────────────────────────────────────────────────

  buttonDown(player: 1 | 2, button: number): void {
    const name = this._buttonMap[button];
    if (name && this.nostalgist) {
      this.nostalgist.pressDown({ button: name, player });
    }
  }

  buttonUp(player: 1 | 2, button: number): void {
    const name = this._buttonMap[button];
    if (name && this.nostalgist) {
      this.nostalgist.pressUp({ button: name, player });
    }
  }

  // ── Volume ────────────────────────────────────────────────────

  get volume(): number {
    return this._volume;
  }

  get isMuted(): boolean {
    return this._isMuted;
  }

  setVolume(v: number): void {
    this._volume = Math.max(0, Math.min(1, v));
    this._isMuted = v === 0;
    // Apply via Web Audio gain node if available
    if (this.gainNode) {
      this.gainNode.gain.value = v;
    }
  }

  /** Set up a GainNode wrapper around the canvas audio for volume control. */
  setupAudioGain(): void {
    if (this.gainNode) return;
    try {
      const ctx = new AudioContext();
      const gain = ctx.createGain();
      gain.gain.value = this._volume;
      gain.connect(ctx.destination);
      this.gainNode = gain;
      this.audioCtx = ctx;
    } catch {
      // Audio not available
    }
  }

  // ── State accessors ──────────────────────────────────────────

  get status(): EmulatorStatus {
    return this._status;
  }

  get fps(): number {
    return 60; // Nostalgist.js targets 60fps internally
  }

  get currentRom(): string | null {
    return this._currentRom;
  }

  /**
   * Read the emulated system's RAM via RetroArch's libretro API.
   *
   * Uses retro_get_memory_data(RETRO_MEMORY_SYSTEM_RAM = 0)
   * to get a pointer into WASM linear memory, then copies the
   * bytes into a fresh Uint8Array.
   */
  readRam(): Uint8Array | null {
    try {
      const nostalgist = this.nostalgist;
      if (!nostalgist) return null;

      const module = nostalgist.getEmscriptenModule?.() as any;
      if (!module?.asm) return null;

      // Try different naming conventions for retro_get_memory_data
      const getData =
        module.asm.retro_get_memory_data ||
        module.asm._retro_get_memory_data ||
        module.asm.__retro_get_memory_data;

      const getSize =
        module.asm.retro_get_memory_size ||
        module.asm._retro_get_memory_size ||
        module.asm.__retro_get_memory_size;

      if (typeof getData !== "function" || typeof getSize !== "function") {
        return null;
      }

      // RETRO_MEMORY_SYSTEM_RAM = 0
      const ptr = getData(0);
      const size = getSize(0);

      if (!ptr || size <= 0 || size > 128 * 1024 * 1024) {
        return null; // Invalid pointer or unreasonable size
      }

      // Copy from WASM heap into a standalone Uint8Array
      const buffer = new Uint8Array(size);
      const heap = module.HEAPU8 as Uint8Array | undefined;
      if (heap) {
        buffer.set(heap.subarray(ptr, ptr + size));
      }
      return buffer;
    } catch {
      return null;
    }
  }
}
