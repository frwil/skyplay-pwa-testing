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

      // Set canvas attributes to scaled size BEFORE launch so RetroArch
      // initializes its WebGL viewport at the correct resolution.
      // Nostalgist's postRun resize happens AFTER callMain, which can
      // leave the viewport misaligned if it was initialized at a
      // different resolution (e.g. 256×224 native set by useEmulator).
      const size = this.buildCanvasSize();
      this.canvasEl.width = size.width;
      this.canvasEl.height = size.height;
      this.canvasEl.style.width = "100%";
      this.canvasEl.style.height = "100%";
      this.canvasEl.style.display = "block";

      this.nostalgist = await Nostalgist.launch({
        core: this.coreName,
        rom: rom.path,
        element: this.canvasEl,
        retroarchConfig: this.buildRetroarchConfig(),
        size,
      });

      // Emscripten's Module.setCanvasSize() (called by Nostalgist.postRun)
      // sets CSS width/height to pixel values (e.g. "768px"/"672px"),
      // overwriting our "100%" settings. Reset to percentage so the
      // canvas fills the aspect-ratio container correctly.
      if (this.canvasEl) {
        this.canvasEl.style.width = "100%";
        this.canvasEl.style.height = "100%";
        this.canvasEl.style.display = "block";
      }

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

      const size = this.buildCanvasSize();
      this.canvasEl.width = size.width;
      this.canvasEl.height = size.height;
      this.canvasEl.style.width = "100%";
      this.canvasEl.style.height = "100%";
      this.canvasEl.style.display = "block";

      this.nostalgist = await Nostalgist.launch({
        core: this.coreName,
        rom: romData,
        element: this.canvasEl,
        retroarchConfig: this.buildRetroarchConfig(),
        size,
      });

      // Reset CSS after launch — Emscripten may have set pixel values
      if (this.canvasEl) {
        this.canvasEl.style.width = "100%";
        this.canvasEl.style.height = "100%";
        this.canvasEl.style.display = "block";
      }

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
   * Build RetroArch keyboard→gamepad config from SYSTEM_KEY_MAPS.
   *
   * This is passed as the `retroarchConfig` option to Nostalgist.launch().
   * Nostalgist writes it to retroarch.cfg BEFORE RetroArch starts (in
   * setupRaConfigFiles → line 2719), so RetroArch's internal keyboard
   * mapping is correct from initialization.
   *
   * Our earlier approach (writeRetroArchInputConfig AFTER launch) ran
   * too late — RetroArch had already read the config and set up its
   * internal mapping with defaults (all "nul" for P2). By passing the
   * config here, Nostalgist writes it before Module.callMain() runs.
   */
  private buildRetroarchConfig(): Record<string, string> {
    const config: Record<string, string> = {};
    const keyMap = SYSTEM_KEY_MAPS[this.systemType];
    if (!keyMap) return config;

    const seen = new Set<string>();
    for (const [jsCode, mapping] of Object.entries(keyMap)) {
      const retroarchKey = this.jsCodeToRetroarchKey(jsCode);
      if (!retroarchKey) continue;

      const buttonName = INDEX_TO_RETROARCH[mapping.button];
      if (!buttonName) continue;

      const configKey = `input_player${mapping.player}_${buttonName}`;
      if (seen.has(configKey)) continue; // First mapping wins
      seen.add(configKey);

      config[configKey] = retroarchKey;
    }

    console.log(
      `[${this.systemType}] 🎮 Built retroarchConfig: ${Object.keys(config).length} mappings`,
    );
    return config;
  }

  /**
   * Compute an explicit canvas size for Nostalgist's initial viewport.
   *
   * Nostalgist auto-detects size via element.offsetWidth/offsetHeight.
   * When the canvas uses CSS aspect-ratio + absolute positioning inside
   * a flex/grid layout, those values can be 0 or wrong. Passing an
   * explicit `size` bypasses auto-detection and ensures the WebGL
   * viewport is correctly sized from the start.
   *
   * Uses a 3x scale of the native resolution for most systems (2x for
   * higher-res like PS1), matching the game's aspect ratio exactly.
   */
  private buildCanvasSize(): { width: number; height: number } {
    const cfg = SYSTEM_CONFIGS[this.systemType];
    const scale = this.systemType === "ps1" ? 2 : 3;
    const size = { width: cfg.width * scale, height: cfg.height * scale };
    console.log(
      `[${this.systemType}] 📐 Canvas size: ${size.width}x${size.height} (${scale}x native)`,
    );
    return size;
  }

  /**
   * Inject a keyboard event into the emulator.
   *
   * Uses TWO approaches:
   *
   * 1. **DOM dispatchEvent** (primary) — Creates a real KeyboardEvent and
   *    dispatches it on the canvas. Nostalgist's updateKeyboardEventHandlers()
   *    rewired keyboard handlers to `document` with a wrapper that checks
   *    `!isInteractable(event.target)`. Since canvas is not interactable,
   *    the check passes and the event reaches the Emscripten handler.
   *    Using a native KeyboardEvent ensures ALL properties/methods that
   *    Emscripten's C-compiled handler expects are present.
   *
   * 2. **Direct JSEvents call** (fallback) — Calls Emscripten's
   *    JSEvents.eventListenerFunc directly with a complete event-like
   *    object (keyCode, which, code, key, target, etc.). This is a
   *    safety net for environments where KeyboardEvent constructor
   *    is unavailable (e.g., JSDOM in tests).
   *
   * Previous attempts:
   * - Commit 221a236: dispatchEvent on canvas — didn't work because
   *   retroarchConfig was written AFTER RetroArch started (timing bug).
   * - Commit 20fff86: Direct JSEvents call only — may have been calling
   *   the handler but with a plain object that the C handler couldn't
   *   fully process (isTrusted checks? missing native methods?).
   *
   * By combining BOTH approaches (DOM dispatch + direct JSEvents fallback)
   * with the retroarchConfig timing fix already in place, we maximize
   * the chance of the event reaching RetroArch.
   */
  injectRawKey(code: string, pressed: boolean): void {
    if (!this.nostalgist) return;
    const eventType = pressed ? "keydown" : "keyup";
    const keyCode = CODE_TO_KEYCODE[code] ?? 0;

    // ── Approach 1: Real KeyboardEvent dispatched on canvas ──
    try {
      if (this.canvasEl && typeof KeyboardEvent !== "undefined") {
        const domEvent = new KeyboardEvent(eventType, {
          code,
          key: codeToKey(code),
          keyCode,
          which: keyCode,
          charCode: pressed ? keyCode : 0,
          bubbles: true,
          cancelable: true,
          shiftKey: false,
          ctrlKey: false,
          altKey: false,
          metaKey: false,
          repeat: false,
        });
        // Some browsers ignore deprecated props (keyCode/which/charCode)
        // in the KeyboardEvent constructor. Force them via defineProperty
        // so Emscripten's C handler can read them.
        if (keyCode !== 0) {
          try {
            Object.defineProperty(domEvent, "keyCode", { value: keyCode });
            Object.defineProperty(domEvent, "which", { value: keyCode });
            Object.defineProperty(domEvent, "charCode", { value: pressed ? keyCode : 0 });
          } catch {
            // defineProperty may fail if the browser freezes the property
          }
        }
        this.canvasEl.dispatchEvent(domEvent);
        console.log(
          `[${this.systemType}] injectRawKey: dispatched ${eventType} code=${code} keyCode=${keyCode} on canvas`,
        );
      }
    } catch (err) {
      console.warn(
        `[${this.systemType}] injectRawKey DOM dispatch failed:`,
        err,
      );
    }

    // ── Approach 2: Direct JSEvents call (fallback) ──
    try {
      const module = this.nostalgist.getEmscripten?.() as any;
      if (!module?.JSEvents?.eventHandlers) return;

      const event: Record<string, unknown> = {
        code,
        key: codeToKey(code),
        keyCode,
        which: keyCode,
        charCode: pressed ? keyCode : 0,
        target: this.canvasEl,
        currentTarget: this.canvasEl,
        srcElement: this.canvasEl,
        type: eventType,
        bubbles: true,
        cancelable: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        repeat: false,
        location: 0,
        isComposing: false,
        isTrusted: false,
        defaultPrevented: false,
        returnValue: true,
        timeStamp: Date.now(),
        view: typeof window !== "undefined" ? window : null,
        detail: 0,
        layerX: 0,
        layerY: 0,
        pageX: 0,
        pageY: 0,
        preventDefault: () => {},
        stopPropagation: () => {},
        stopImmediatePropagation: () => {},
        getModifierState: () => false,
        composed: () => false,
        initKeyboardEvent: () => {},
      };

      let called = 0;
      for (const handler of module.JSEvents.eventHandlers) {
        if (handler.eventTypeString === eventType) {
          try {
            handler.eventListenerFunc(event);
            called++;
          } catch {
            // Silently ignore errors
          }
        }
      }

      if (called === 0) {
        console.warn(
          `[${this.systemType}] injectRawKey: no "${eventType}" JSEvents handlers found`,
        );
      } else {
        console.log(
          `[${this.systemType}] injectRawKey: called ${called} JSEvents "${eventType}" handlers for code=${code}`,
        );
      }
    } catch (err) {
      console.warn(`[${this.systemType}] injectRawKey JSEvents failed:`, err);
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
