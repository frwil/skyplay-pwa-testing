"use client";

import { useRef, useCallback, useState, useEffect } from "react";
import type { EmulatorStatus, RomEntry, EmulatorState, SystemType } from "../types";
import type { EmulatorAdapter } from "../EmulatorAdapter";
import { SYSTEM_CONFIGS } from "../EmulatorAdapter";
import { StateBuffer } from "../buffers/StateBuffer";
import { InputBuffer } from "../buffers/InputBuffer";
import {
  NES_WIDTH,
  NES_HEIGHT,
  TARGET_FPS,
  FRAME_TIME_MS,
  BUTTON_INDEX_TO_BIT,
} from "../constants";
import { useNesAudio } from "./useNesAudio";
import { useKeyboard } from "./useKeyboard";
import { useGamepad } from "./useGamepad";
import { SnesEmulatorAdapter } from "../adapters/SnesAdapter";
import { GbEmulatorAdapter } from "../adapters/GbAdapter";
import { GbaEmulatorAdapter } from "../adapters/GbaAdapter";

// jsnes is a CommonJS module with no types — we declare the interface we need
interface JsnesNes {
  loadROM(data: Uint8Array): void;
  frame(): void;
  reset(): void;
  buttonDown(player: number, button: number): void;
  buttonUp(player: number, button: number): void;
  toJSON(): { cpu: object; mmap: object; ppu: object; papu: object; controllers: Record<number, object> };
  fromJSON(state: { cpu: object; mmap: object; ppu: object; papu: object; controllers: Record<number, object> }): void;
}

interface JsnesConstructor {
  new (opts: {
    onFrame: (buffer: Uint32Array) => void;
    onAudioSample: (left: number, right: number) => void;
    emulateSound?: boolean;
    sampleRate?: number;
  }): JsnesNes;
}

let Jsnes: JsnesConstructor | null = null;

async function loadJsnes(): Promise<JsnesConstructor> {
  if (Jsnes) return Jsnes;
  // jsnes exposes window.jsnes in browser or can be imported
  const mod = await import("jsnes");
  Jsnes = mod.NES as unknown as JsnesConstructor;
  return Jsnes;
}

/**
 * Central hook for the NES emulator.
 *
 * Manages:
 * - jsnes instance lifecycle (create, load ROM, destroy)
 * - requestAnimationFrame game loop (throttled to 60Hz)
 * - Canvas rendering (ARGB Int32Array → ImageData → putImageData)
 * - Audio sample routing to useNesAudio ring buffer
 * - StateBuffer & InputBuffer (rollback-ready circular buffers)
 * - Keyboard + Gamepad input capture
 * - Status tracking (idle/loading/running/paused/error)
 * - FPS counter
 */
export function useEmulator(system: SystemType = "nes") {
  const isNes = system === "nes";

  // ─── Refs ──────────────────────────────────────────────────────
  const nesRef = useRef<JsnesNes | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const frameCountRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0);
  const rafIdRef = useRef<number>(0);
  const fpsTimerRef = useRef<number>(0);
  const fpsFrameCountRef = useRef<number>(0);
  const runningRef = useRef<boolean>(false);

  // ─── Nostalgist adapter ref (non-NES systems) ──────────────────
  const adapterRef = useRef<EmulatorAdapter | null>(null);

  // ─── State ─────────────────────────────────────────────────────
  const [status, setStatus] = useState<EmulatorStatus>("idle");
  const [fps, setFps] = useState(0);
  const [currentRom, setCurrentRom] = useState<string | null>(null);
  const [romList, setRomList] = useState<RomEntry[]>([]);

  // ─── Buffers (NES only) ────────────────────────────────────────
  const stateBufferRef = useRef<StateBuffer>(new StateBuffer());
  const inputBufferRef = useRef<InputBuffer>(new InputBuffer());

  // ─── Netplay (P2P) ────────────────────────────────────────────
  const netplayManagerRef = useRef<{
    onFrame: (frame: number, localInput: number) => number;
    afterFrame: (frame: number) => void;
    getState: () => { status: string; latency: number; rollbacks: number };
  } | null>(null);
  const isNetplayRef = useRef(false);

  // ─── Audio (NES only) ──────────────────────────────────────────
  const audio = useNesAudio();

  // ─── Input bitmask helpers ─────────────────────────────────────
  const kbBitmaskRef = useRef<() => number>(() => 0);
  const gpBitmaskRef = useRef<() => number>(() => 0);

  // ─── Button handlers ───────────────────────────────────────────
  const buttonDown = useCallback((player: 1 | 2, button: number) => {
    if (isNes) {
      nesRef.current?.buttonDown(player, button);
    } else {
      adapterRef.current?.buttonDown(player, button);
    }
  }, [isNes]);

  const buttonUp = useCallback((player: 1 | 2, button: number) => {
    if (isNes) {
      nesRef.current?.buttonUp(player, button);
    } else {
      adapterRef.current?.buttonUp(player, button);
    }
  }, [isNes]);

  // ─── Input hooks ───────────────────────────────────────────────
  const enabled = status === "running";
  const keyboard = useKeyboard(buttonDown, buttonUp, system, enabled);
  const gamepad = useGamepad(buttonDown, buttonUp, system, enabled);

  // Wire bitmask getters
  kbBitmaskRef.current = keyboard.getP1Bitmask;
  gpBitmaskRef.current = gamepad.getP1Bitmask;

  // ─── Canvas Render ─────────────────────────────────────────────
  // jsnes provides a Uint32Array with pixels in 0x00BBGGRR format.
  // We overlay it onto an ImageData's buffer (Uint32Array view),
  // add full alpha (0xFF000000), then putImageData.
  // This is the same approach used by jsnes' own Browser/screen.js.
  const renderFrame = useCallback((frameBuffer: Uint32Array) => {
    const ctx = ctxRef.current;
    if (!ctx) return;

    const imageData = ctx.createImageData(NES_WIDTH, NES_HEIGHT);
    const buf32 = new Uint32Array(imageData.data.buffer);
    for (let i = 0; i < frameBuffer.length; i++) {
      buf32[i] = 0xff000000 | frameBuffer[i]; // Full alpha
    }
    ctx.putImageData(imageData, 0, 0);
  }, []);

  // ─── Apply Inputs to jsnes ─────────────────────────────────────
  const applyInputs = useCallback(
    (player: 1 | 2, bitmask: number, prevBitmask: number) => {
      const nes = nesRef.current;
      if (!nes) return;

      for (let btn = 0; btn < 8; btn++) {
        const bit = BUTTON_INDEX_TO_BIT[btn] ?? 0;
        const wasDown = (prevBitmask & bit) !== 0;
        const isDown = (bitmask & bit) !== 0;

        if (isDown && !wasDown) {
          nes.buttonDown(player, btn);
        } else if (!isDown && wasDown) {
          nes.buttonUp(player, btn);
        }
      }
    },
    [],
  );

  // Track previous bitmask per player for edge detection
  const prevP1BitmaskRef = useRef<number>(0);
  const prevP2BitmaskRef = useRef<number>(0);

  // ─── Game Loop ─────────────────────────────────────────────────
  // We store the latest gamepad.poll / applyInputs in refs so the
  // gameLoop callback stays stable across re-renders (gamepad object
  // is a fresh literal every render).
  const gamepadPollRef = useRef(gamepad.poll);
  gamepadPollRef.current = gamepad.poll;
  const applyInputsRef = useRef(applyInputs);
  applyInputsRef.current = applyInputs;

  const gameLoop = useCallback(
    (timestamp: DOMHighResTimeStamp) => {
      if (!runningRef.current) return;

      rafIdRef.current = requestAnimationFrame(gameLoop);

      // Throttle to ~60Hz
      const elapsed = timestamp - lastFrameTimeRef.current;
      if (elapsed < FRAME_TIME_MS - 1) return; // ~15.67ms min
      if (elapsed > 200) {
        // Tab was backgrounded — cap delta to avoid frame avalanche
        lastFrameTimeRef.current = timestamp - FRAME_TIME_MS;
      }

      try {
        const nes = nesRef.current;
        if (!nes) return;

        // 1. Capture local input (keyboard + gamepad → combined bitmask)
        const myInput =
          kbBitmaskRef.current() | gpBitmaskRef.current();

        // 2. Netplay: send my input, get opponent's predicted input
        let opponentInput = 0;
        const netplay = netplayManagerRef.current;
        const isNetplayActive = isNetplayRef.current && netplay !== null;

        if (isNetplayActive) {
          opponentInput = netplay.onFrame(frameCountRef.current, myInput);
        }

        // 3. Determine P1/P2 inputs based on role
        // In solo mode: I am P1, opponent (local P2) is from buffer
        // In netplay mode: opponent input comes from peer, roles may swap
        const p1Input = myInput;       // I always control P1 locally
        const p2Input = isNetplayActive
          ? opponentInput              // Netplay: P2 = remote peer input
          : inputBufferRef.current.get(0)?.p2 ?? 0; // Solo: P2 from buffer

        // 4. Push input record
        inputBufferRef.current.push(
          frameCountRef.current,
          p1Input,
          p2Input,
        );

        // 5. Save state BEFORE advancing (for rollback)
        const state = nes.toJSON();
        stateBufferRef.current.push(state);

        // 6. Inject inputs into jsnes (edge-detection to avoid redundant calls)
        applyInputsRef.current(1, p1Input, prevP1BitmaskRef.current);
        applyInputsRef.current(2, p2Input, prevP2BitmaskRef.current);
        prevP1BitmaskRef.current = p1Input;
        prevP2BitmaskRef.current = p2Input;

        // 7. Advance one frame
        nes.frame();
        frameCountRef.current++;
        lastFrameTimeRef.current = timestamp;

        // 8. Netplay: process late remote inputs (rollback)
        if (isNetplayActive) {
          netplay.afterFrame(frameCountRef.current);
        }

        // 9. Poll gamepad synchronously
        gamepadPollRef.current();

        // 9. FPS tracking
        fpsFrameCountRef.current++;
      } catch (err) {
        console.error("Emulator game loop error:", err);
        // Don't stop the loop — skip this tick and try next frame
        lastFrameTimeRef.current = timestamp;
      }
    },
    [], // stable — all deps accessed via refs
  );

  // ─── FPS Counter (separate 1s interval) ────────────────────────
  useEffect(() => {
    fpsTimerRef.current = window.setInterval(() => {
      setFps(fpsFrameCountRef.current);
      fpsFrameCountRef.current = 0;
    }, 1000);
    return () => window.clearInterval(fpsTimerRef.current);
  }, []);

  // ─── Canvas Init ───────────────────────────────────────────────
  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = NES_WIDTH;
    canvas.height = NES_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      ctxRef.current = ctx;
    }
  }, []);

  // ─── Stable refs for audio values used in loadRom ──────────────
  const audioInitRef = useRef(audio.init);
  audioInitRef.current = audio.init;
  const audioResumeRef = useRef(audio.resume);
  audioResumeRef.current = audio.resume;
  const audioEnqueueRef = useRef(audio.enqueueSample);
  audioEnqueueRef.current = audio.enqueueSample;
  const audioCtxRef_ = useRef(audio.audioContext);
  audioCtxRef_.current = audio.audioContext;

  // ─── Create non-NES adapter ────────────────────────────────────
  const createAdapter = useCallback((): EmulatorAdapter | null => {
    if (isNes) return null;
    switch (system) {
      case "snes":
        return new SnesEmulatorAdapter({ onStatusChange: setStatus });
      case "gb":
      case "gbc":
        return new GbEmulatorAdapter(system, { onStatusChange: setStatus });
      case "gba":
        return new GbaEmulatorAdapter({ onStatusChange: setStatus });
      default:
        return null;
    }
  }, [isNes, system]);

  // ─── Load ROM ──────────────────────────────────────────────────
  const loadRom = useCallback(
    async (rom: RomEntry) => {
      setStatus("loading");
      setCurrentRom(rom.name);

      // ── Non-NES path ──────────────────────────────────────────
      if (!isNes) {
        try {
          // Clean up previous adapter
          adapterRef.current?.exit();
          adapterRef.current = null;

          // Initialize canvas for non-NES (set dimensions from config)
          const canvas = canvasRef.current;
          if (canvas) {
            const cfg = SYSTEM_CONFIGS[system];
            canvas.width = cfg.width;
            canvas.height = cfg.height;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.imageSmoothingEnabled = false;
              ctxRef.current = ctx;
            }
          }

          const adapter = createAdapter();
          if (!adapter) throw new Error(`Unknown system: ${system}`);
          adapterRef.current = adapter;

          // For Nostalgist, we pass the canvas element
          if (canvas) {
            adapter.setCanvas?.(canvas);
          }

          await adapter.loadRom(rom);
          setStatus(adapter.status);
        } catch (err) {
          console.error(`[useEmulator] Failed to load ${system} ROM:`, err);
          setStatus("error");
        }
        return;
      }

      // ── NES path ──────────────────────────────────────────────
      try {
        // Ensure jsnes is loaded
        console.log("[useEmulator] Loading jsnes...");
        const JsnesClass = await loadJsnes();
        console.log("[useEmulator] jsnes loaded:", !!JsnesClass);

        // Initialize audio on user gesture (via stable refs)
        audioInitRef.current();
        await audioResumeRef.current();
        console.log("[useEmulator] Audio initialized, ctx state:", audioCtxRef_.current.current?.state);

        // Destroy previous instance
        if (nesRef.current) {
          nesRef.current = null;
        }

        // Initialize canvas (must be done before NES creation so
        // ctxRef is set when onFrame fires)
        initCanvas();
        console.log("[useEmulator] Canvas ctx ready:", !!ctxRef.current);

        // Fetch ROM
        console.log("[useEmulator] Fetching ROM:", rom.path);
        const response = await fetch(rom.path);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        const romData = new Uint8Array(arrayBuffer);
        console.log("[useEmulator] ROM fetched, size:", romData.length);

        // Create NES instance
        const nes = new JsnesClass({
          onFrame: renderFrame,
          onAudioSample: audioEnqueueRef.current,
          emulateSound: true,
          sampleRate: 48000,
        });

        nes.loadROM(romData);
        nesRef.current = nes;
        console.log("[useEmulator] NES instance created, ROM loaded");

        // Cancel any running game loop before starting a new one
        if (rafIdRef.current) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = 0;
        }

        // Reset buffers and counters
        stateBufferRef.current.clear();
        inputBufferRef.current.clear();
        frameCountRef.current = 0;
        prevP1BitmaskRef.current = 0;
        prevP2BitmaskRef.current = 0;

        // Start game loop
        runningRef.current = true;
        lastFrameTimeRef.current = performance.now();
        rafIdRef.current = requestAnimationFrame(gameLoop);
        console.log("[useEmulator] Game loop started");

        setStatus("running");
      } catch (err) {
        console.error("[useEmulator] Failed to load ROM:", err);
        setStatus("error");
      }
    },
    [gameLoop, initCanvas, renderFrame, isNes, system, createAdapter], // stable — audio accessed via refs
  );

  // ─── Pause / Resume ────────────────────────────────────────────
  const pause = useCallback(() => {
    if (!isNes) {
      adapterRef.current?.pause();
      setStatus(adapterRef.current?.status ?? "paused");
      return;
    }
    runningRef.current = false;
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }
    setStatus("paused");
  }, [isNes]);

  const resume = useCallback(() => {
    if (!isNes) {
      adapterRef.current?.resume();
      setStatus(adapterRef.current?.status ?? "running");
      return;
    }
    if (!nesRef.current) return;
    runningRef.current = true;
    lastFrameTimeRef.current = performance.now();
    rafIdRef.current = requestAnimationFrame(gameLoop);
    setStatus("running");
  }, [gameLoop, isNes]);

  // ─── Reset ─────────────────────────────────────────────────────
  const reset = useCallback(() => {
    if (!isNes) {
      adapterRef.current?.reset();
      return;
    }
    nesRef.current?.reset();
    stateBufferRef.current.clear();
    inputBufferRef.current.clear();
    frameCountRef.current = 0;
    prevP1BitmaskRef.current = 0;
    prevP2BitmaskRef.current = 0;
    lastFrameTimeRef.current = performance.now();
  }, [isNes]);

  // ─── Fetch ROM list ─────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/roms")
      .then((r) => r.json())
      .then((data) => setRomList(data.roms ?? []))
      .catch(() => setRomList([]));
  }, []);

  // ─── Stable refs for values that change identity each render ───
  const audioDestroyRef = useRef(audio.destroy);
  audioDestroyRef.current = audio.destroy;

  // ─── Cleanup on unmount ────────────────────────────────────────
  useEffect(() => {
    return () => {
      runningRef.current = false;
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
      audioDestroyRef.current();
      nesRef.current = null;
    };
  }, []); // Only on unmount — audio destroy is accessed via ref

  // ─── Volume wrapper ────────────────────────────────────────────
  const setVolume = useCallback(
    (v: number) => {
      if (!isNes) {
        adapterRef.current?.setVolume(v);
      } else {
        audio.setVolume(v);
      }
    },
    [audio, isNes],
  );

  // ─── Exit (clean shutdown) ──────────────────────────────────────
  const exit = useCallback(() => {
    if (!isNes) {
      adapterRef.current?.exit();
      adapterRef.current = null;
      setStatus("idle");
      setCurrentRom(null);
      setFps(0);
      return;
    }
    runningRef.current = false;
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }
    audioDestroyRef.current();
    nesRef.current = null;
    stateBufferRef.current.clear();
    inputBufferRef.current.clear();
    setStatus("idle");
    setCurrentRom(null);
    setFps(0);
  }, [isNes]);

  // ─── Exposed State ─────────────────────────────────────────────

  const setNetplayManager = useCallback((manager: unknown) => {
    if (manager === null) {
      netplayManagerRef.current = null;
      isNetplayRef.current = false;
    } else {
      netplayManagerRef.current = manager as typeof netplayManagerRef.current;
      isNetplayRef.current = true;
    }
  }, []);

  const emulatorState: EmulatorState = {
    status,
    fps,
    currentRom,
    romList,
    system,
    canvasRef: canvasRef as React.RefObject<HTMLCanvasElement | null>,
    loadRom,
    pause,
    resume,
    reset,
    exit,
    setVolume,
    volume: isNes ? audio.volume : (adapterRef.current?.volume ?? 1),
    isMuted: isNes ? audio.isMuted : (adapterRef.current?.isMuted ?? false),
    buttonDown,
    buttonUp,
    stateBuffer: isNes ? stateBufferRef.current : null,
    inputBuffer: isNes ? inputBufferRef.current : null,
    setNetplayManager,
    isNetplay: isNetplayRef.current,
    readRam: () => {
      if (isNes) {
        try {
          const state = nesRef.current?.toJSON();
          if (!state) return null;
          // jsnes CPU memory: 64KB array, first 2KB = NES internal RAM ($0000-$07FF)
          const cpu = state.cpu as { mem?: number[] };
          if (!cpu?.mem) return null;
          return new Uint8Array(cpu.mem.slice(0, 0x800));
        } catch {
          return null;
        }
      }
      return adapterRef.current?.readRam?.() ?? null;
    },
  };

  return emulatorState;
}
