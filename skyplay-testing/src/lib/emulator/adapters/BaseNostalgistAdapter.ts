import type { Nostalgist } from "nostalgist";
import type { EmulatorAdapter } from "../EmulatorAdapter";
import type { EmulatorStatus, RomEntry, SystemType } from "../types";
import { SYSTEM_CONFIGS, SYSTEM_KEY_MAPS } from "../EmulatorAdapter";

/**
 * Map of KeyboardEvent.code → deprecated keyCode value.
 *
 * The KeyboardEvent constructor DOES NOT auto-compute keyCode from code —
 * it defaults to 0. Emscripten's JSEvents keyboard handlers (compiled from C)
 * often check event.keyCode, so we must provide it explicitly.
 *
 * This covers every code used in SYSTEM_KEY_MAPS across all systems.
 */
const CODE_TO_KEYCODE: Record<string, number> = {
  Enter: 13, NumpadEnter: 13,
  ShiftRight: 16, ShiftLeft: 16,
  Space: 32, Tab: 9, Escape: 27, Backspace: 8,
  ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
  KeyA: 65, KeyB: 66, KeyC: 67, KeyD: 68, KeyE: 69,
  KeyF: 70, KeyG: 71, KeyH: 72, KeyI: 73, KeyJ: 74,
  KeyK: 75, KeyL: 76, KeyM: 77, KeyN: 78, KeyO: 79,
  KeyP: 80, KeyQ: 81, KeyR: 82, KeyS: 83, KeyT: 84,
  KeyU: 85, KeyV: 86, KeyW: 87, KeyX: 88, KeyY: 89, KeyZ: 90,
  Digit0: 48, Digit1: 49, Digit2: 50, Digit3: 51, Digit4: 52,
  Digit5: 53, Digit6: 54, Digit7: 55, Digit8: 56, Digit9: 57,
  Numpad0: 96, Numpad1: 97, Numpad2: 98, Numpad3: 99,
  Numpad4: 100, Numpad5: 101, Numpad6: 102, Numpad7: 103,
  Numpad8: 104, Numpad9: 105,
  NumpadAdd: 107, NumpadSubtract: 109,
  NumpadMultiply: 106, NumpadDivide: 111, NumpadDecimal: 110,
  F1: 112, F2: 113, F3: 114, F4: 115,
  F5: 116, F6: 117, F7: 118, F8: 119,
  F9: 120, F10: 121, F11: 122, F12: 123,
  Comma: 188, Period: 190, Semicolon: 186, Quote: 222,
  BracketLeft: 219, BracketRight: 221, Backquote: 192,
  Slash: 191, Backslash: 220, Minus: 189, Equal: 187,
  AltLeft: 18, AltRight: 18, ControlLeft: 17, ControlRight: 17,
  CapsLock: 20, NumLock: 144, ScrollLock: 145, Pause: 19,
  Home: 36, End: 35, PageUp: 33, PageDown: 34,
  Insert: 45, Delete: 46, PrintScreen: 44,
};

/** Derive a plausible event.key string from a KeyboardEvent.code value. */
function codeToKey(code: string): string {
  if (code.startsWith("Key")) return code[3].toLowerCase();        // KeyA → a
  if (code.startsWith("Digit")) return code[5];                     // Digit1 → 1
  if (code.startsWith("Numpad")) return code.substring(6);          // Numpad1 → 1
  if (code.startsWith("Arrow")) return code;                        // ArrowUp → ArrowUp
  return code; // Enter → Enter, ShiftLeft → ShiftLeft, etc.
}

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

      // Write keyboard→gamepad mappings so pressDown/pressUp work
      this.writeRetroArchInputConfig();

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

      // Write keyboard→gamepad mappings so pressDown/pressUp work
      this.writeRetroArchInputConfig();

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
   * Inject a real DOM KeyboardEvent dispatched on the canvas element.
   *
   * Nostalgist's pressDown/pressUp → fireKeyboardEvent creates a plain
   * object { code, target } and passes it directly to Emscripten's
   * JSEvents eventListenerFunc. That function expects a full DOM
   * KeyboardEvent with keyCode, which, key, etc. — when those are
   * missing (undefined), the WASM handler sees keyCode=0 → no key.
   *
   * This method constructs a proper KeyboardEvent (with keyCode and
   * all modifiers) and dispatches it through the normal browser event
   * pipeline. After updateKeyboardEventHandlers(), Nostalgist registers
   * the keyboard handlers on the canvas element, so dispatching on
   * canvas guarantees event.target === element and the handlers fire.
   */
  injectRawKey(code: string, pressed: boolean): void {
    if (!this.canvasEl) return;
    try {
      const keyCode = CODE_TO_KEYCODE[code] ?? 0;
      const event = new KeyboardEvent(pressed ? "keydown" : "keyup", {
        code,
        key: codeToKey(code),
        keyCode,
        which: keyCode,
        bubbles: true,
        cancelable: true,
        view: window,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        repeat: false,
      });
      this.canvasEl.dispatchEvent(event);
    } catch (err) {
      console.warn(`[${this.systemType}] injectRawKey failed:`, err);
    }
  }

  /**
   * Convert a JS KeyboardEvent.code value to a RetroArch config key name.
   * This is the reverse of Nostalgist's getKeyboardCode logic.
   *
   * Examples: "Enter" → "enter", "ArrowUp" → "up", "KeyX" → "x",
   *           "NumpadEnter" → "kp_enter", "ShiftRight" → "rshift"
   */
  private jsCodeToRetroarchKey(code: string): string | null {
    // Single letter keys: KeyX → x, KeyA → a
    if (/^Key[A-Z]$/.test(code)) return code[3].toLowerCase();
    // Digit keys: Digit0 → keypad0
    if (/^Digit\d$/.test(code)) return "keypad" + code[5];
    // Numpad digits: Numpad0 → num0
    if (/^Numpad\d$/.test(code)) return "num" + code[6];
    // F-keys: F1 → f1
    if (/^F\d+$/.test(code)) return code.toLowerCase();

    // Reverse of Nostalgist's keyboardCodeMap
    const reverseMap: Record<string, string> = {
      NumpadAdd: "add",
      AltLeft: "alt",
      Backquote: "backquote",
      Backspace: "backspace",
      CapsLock: "capslock",
      Comma: "comma",
      ControlLeft: "ctrl",
      Delete: "del",
      NumpadDivide: "divide",
      ArrowDown: "down",
      End: "end",
      Enter: "enter",
      Equal: "equals",
      Escape: "escape",
      Home: "home",
      Insert: "insert",
      NumpadEnter: "kp_enter",
      NumpadEquals: "kp_equals",
      NumpadSubtract: "subtract",
      NumpadDecimal: "kp_period",
      ArrowLeft: "left",
      BracketLeft: "leftbracket",
      Minus: "minus",
      NumpadMultiply: "multiply",
      NumLock: "numlock",
      PageDown: "pagedown",
      PageUp: "pageup",
      Pause: "pause",
      Period: "period",
      PrintScreen: "print_screen",
      Quote: "quote",
      AltRight: "ralt",
      ControlRight: "rctrl",
      ArrowRight: "right",
      BracketRight: "rightbracket",
      ShiftRight: "rshift",
      ScrollLock: "scroll_lock",
      Semicolon: "semicolon",
      ShiftLeft: "shift",
      Slash: "slash",
      Space: "space",
      Tab: "tab",
      ArrowUp: "up",
    };
    return reverseMap[code] ?? null;
  }

  /**
   * Write keyboard-to-gamepad mappings to the RetroArch config file
   * on the Emscripten virtual filesystem.
   *
   * Nostalgist's pressDown/pressUp (and therefore buttonDown/buttonUp)
   * rely on RetroArch config mappings to translate button names to
   * keyboard keys. The default config maps EVERYTHING to "nul", so
   * all programmatic input silently fails.
   *
   * This method reads SYSTEM_KEY_MAPS for the current system and
   * writes the corresponding RetroArch config entries so that
   * pressDown("start", 1) → find "enter" in config → inject Enter key
   * → RetroArch maps Enter to P1 Start.
   */
  writeRetroArchInputConfig(): void {
    try {
      const module = this.nostalgist?.getEmscriptenModule?.();
      if (!module?.FS) {
        console.warn(
          `[${this.systemType}] Cannot write RetroArch config — no FS access`,
        );
        return;
      }

      const configPath = "/home/web_user/retroarch/userdata/retroarch.cfg";
      const keyMap = SYSTEM_KEY_MAPS[this.systemType];
      if (!keyMap) return;

      // Read existing config (may not exist on first launch)
      let configContent = "";
      try {
        configContent = module.FS.readFile(configPath, { encoding: "utf8" });
      } catch {
        // Config doesn't exist yet — start fresh
      }

      // Build RetroArch keyboard mappings from SYSTEM_KEY_MAPS
      const newMappings: string[] = [];
      const seen = new Set<string>();

      for (const [jsCode, mapping] of Object.entries(keyMap)) {
        const retroarchKey = this.jsCodeToRetroarchKey(jsCode);
        if (!retroarchKey) continue;

        const buttonName = INDEX_TO_RETROARCH[mapping.button];
        if (!buttonName) continue;

        const configKey = `input_player${mapping.player}_${buttonName}`;
        if (seen.has(configKey)) continue; // First mapping wins
        seen.add(configKey);

        newMappings.push(`${configKey} = ${retroarchKey}`);
      }

      // Remove any previous Skyplay section and all input_player lines
      const marker = "# Skyplay keyboard mappings (auto-generated)";
      const lines = configContent.split("\n").filter(
        (line) =>
          !line.startsWith("# Skyplay keyboard mappings") &&
          !line.startsWith("input_player"),
      );

      const finalConfig =
        [...lines.filter((l) => l.trim()), "", marker, ...newMappings, ""].join(
          "\n",
        );

      module.FS.writeFile(configPath, finalConfig);
      console.log(
        `[${this.systemType}] ✅ RetroArch config written — ${newMappings.length} key mappings`,
      );
    } catch (err) {
      console.warn(
        `[${this.systemType}] Failed to write RetroArch config:`,
        err,
      );
    }
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
