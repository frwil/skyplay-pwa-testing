"use client";

import { useRef, useCallback, useState, useEffect } from "react";
import type { EmulatorStatus, RomEntry, EmulatorState } from "../types";
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
export function useEmulator() {
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

  // ─── State ─────────────────────────────────────────────────────
  const [status, setStatus] = useState<EmulatorStatus>("idle");
  const [fps, setFps] = useState(0);
  const [currentRom, setCurrentRom] = useState<string | null>(null);
  const [romList, setRomList] = useState<RomEntry[]>([]);

  // ─── Buffers ───────────────────────────────────────────────────
  const stateBufferRef = useRef<StateBuffer>(new StateBuffer());
  const inputBufferRef = useRef<InputBuffer>(new InputBuffer());

  // ─── Audio ─────────────────────────────────────────────────────
  const audio = useNesAudio();

  // ─── Input bitmask helpers ─────────────────────────────────────
  const kbBitmaskRef = useRef<() => number>(() => 0);
  const gpBitmaskRef = useRef<() => number>(() => 0);

  // ─── Button handlers (wired to jsnes) ──────────────────────────
  const buttonDown = useCallback((player: 1 | 2, button: number) => {
    nesRef.current?.buttonDown(player, button);
  }, []);

  const buttonUp = useCallback((player: 1 | 2, button: number) => {
    nesRef.current?.buttonUp(player, button);
  }, []);

  // ─── Input hooks ───────────────────────────────────────────────
  const enabled = status === "running";
  const keyboard = useKeyboard(buttonDown, buttonUp, enabled);
  const gamepad = useGamepad(buttonDown, buttonUp, enabled);

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
        const localInput =
          kbBitmaskRef.current() | gpBitmaskRef.current();

        // 2. TODO P2P: Send localInput to peer via WebRTC DataChannel

        // 3. Read predicted P2 input (copy last known, or 0 if none)
        const predictedP2 =
          inputBufferRef.current.get(0)?.p2 ?? 0;

        // 4. Push input record
        inputBufferRef.current.push(
          frameCountRef.current,
          localInput,
          predictedP2,
        );

        // 5. Save state BEFORE advancing (for rollback)
        const state = nes.toJSON();
        stateBufferRef.current.push(state);

        // 6. Inject inputs into jsnes (edge-detection to avoid redundant calls)
        applyInputsRef.current(1, localInput, prevP1BitmaskRef.current);
        applyInputsRef.current(2, predictedP2, prevP2BitmaskRef.current);
        prevP1BitmaskRef.current = localInput;
        prevP2BitmaskRef.current = predictedP2;

        // 7. Advance one frame
        nes.frame();
        frameCountRef.current++;
        lastFrameTimeRef.current = timestamp;

        // 8. Poll gamepad synchronously
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

  // ─── Load ROM ──────────────────────────────────────────────────
  const loadRom = useCallback(
    async (rom: RomEntry) => {
      setStatus("loading");
      setCurrentRom(rom.name);

      try {
        // Ensure jsnes is loaded
        console.log("[useEmulator] Loading jsnes...");
        const JsnesClass = await loadJsnes();
        console.log("[useEmulator] jsnes loaded:", !!JsnesClass);

        // Initialize audio on user gesture
        audio.init();
        await audio.resume();
        console.log("[useEmulator] Audio initialized, ctx state:", audio.audioContext.current?.state);

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
          onAudioSample: audio.enqueueSample,
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
    [audio, gameLoop, initCanvas, renderFrame],
  );

  // ─── Pause / Resume ────────────────────────────────────────────
  const pause = useCallback(() => {
    runningRef.current = false;
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }
    setStatus("paused");
  }, []);

  const resume = useCallback(() => {
    if (!nesRef.current) return;
    runningRef.current = true;
    lastFrameTimeRef.current = performance.now();
    rafIdRef.current = requestAnimationFrame(gameLoop);
    setStatus("running");
  }, [gameLoop]);

  // ─── Reset ─────────────────────────────────────────────────────
  const reset = useCallback(() => {
    nesRef.current?.reset();
    stateBufferRef.current.clear();
    inputBufferRef.current.clear();
    frameCountRef.current = 0;
    prevP1BitmaskRef.current = 0;
    prevP2BitmaskRef.current = 0;
    lastFrameTimeRef.current = performance.now();
  }, []);

  // ─── Fetch ROM list ─────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/roms")
      .then((r) => r.json())
      .then((data) => setRomList(data.roms ?? []))
      .catch(() => setRomList([]));
  }, []);

  // ─── Cleanup on unmount ────────────────────────────────────────
  useEffect(() => {
    return () => {
      runningRef.current = false;
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
      audio.destroy();
      nesRef.current = null;
    };
  }, [audio]);

  // ─── Volume wrapper ────────────────────────────────────────────
  const setVolume = useCallback(
    (v: number) => audio.setVolume(v),
    [audio],
  );

  // ─── Exposed State ─────────────────────────────────────────────
  const emulatorState: EmulatorState = {
    status,
    fps,
    currentRom,
    romList,
    canvasRef: canvasRef as React.RefObject<HTMLCanvasElement | null>,
    loadRom,
    pause,
    resume,
    reset,
    setVolume,
    volume: audio.volume,
    isMuted: audio.isMuted,
    buttonDown,
    buttonUp,
    stateBuffer: stateBufferRef.current,
    inputBuffer: inputBufferRef.current,
  };

  return emulatorState;
}
