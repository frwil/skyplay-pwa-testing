import { useRef, useCallback, useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  EmulatorStatus,
  RomEntry,
  EmulatorState as _EmulatorState,
  SystemType,
} from "@/lib/emulator/types";
import type { EmulatorAdapter } from "@/lib/emulator/EmulatorAdapter";
import { SYSTEM_CONFIGS } from "@/lib/emulator/EmulatorAdapter";
import { useKeyboard } from "@/lib/emulator/hooks/useKeyboard";
import { useGamepad } from "@/lib/emulator/hooks/useGamepad";
import {
  NES_WIDTH,
  NES_HEIGHT,
  TARGET_FPS,
  FRAME_TIME_MS,
  BUTTON_INDEX_TO_BIT,
} from "@/lib/emulator/constants";
import { SnesEmulatorAdapter } from "@/lib/emulator/adapters/SnesAdapter";
import { GbEmulatorAdapter } from "@/lib/emulator/adapters/GbAdapter";
import { GbaEmulatorAdapter } from "@/lib/emulator/adapters/GbaAdapter";

// ─── Desktop Emulator State (subset of PWA's EmulatorState) ──────
// The desktop doesn't use circular buffers (no rollback),
// doesn't have a ROM list from an API, and manages ROM paths directly.

interface DesktopEmulatorState {
  status: EmulatorStatus;
  fps: number;
  currentRom: string | null;
  system: SystemType;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  loadRomFromDialog: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  reset: () => void;
  exit: () => void;
  setVolume: (v: number) => void;
  volume: number;
  isMuted: boolean;
  buttonDown: (player: 1 | 2, button: number) => void;
  buttonUp: (player: 1 | 2, button: number) => void;
}

// ─── jsnes (NES) support ─────────────────────────────────────────

interface JsnesNes {
  loadROM(data: Uint8Array): void;
  frame(): void;
  reset(): void;
  buttonDown(player: number, button: number): void;
  buttonUp(player: number, button: number): void;
  toJSON(): Record<string, unknown>;
  fromJSON(state: Record<string, unknown>): void;
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
  const mod = await import("jsnes");
  Jsnes = mod.NES as unknown as JsnesConstructor;
  return Jsnes;
}

// ─── Hook ─────────────────────────────────────────────────────────

export function useEmulatorDesktop(system: SystemType): DesktopEmulatorState {
  const isNes = system === "nes";

  // Refs for NES (jsnes) path
  const nesRef = useRef<JsnesNes | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const frameCountRef = useRef(0);
  const lastFrameTimeRef = useRef(0);
  const rafIdRef = useRef(0);
  const runningRef = useRef(false);
  const fpsFrameCountRef = useRef(0);

  // Nostalgist adapter ref (non-NES systems)
  const adapterRef = useRef<EmulatorAdapter | null>(null);

  // State
  const [status, setStatus] = useState<EmulatorStatus>("idle");
  const [fps, setFps] = useState(0);
  const [currentRom, setCurrentRom] = useState<string | null>(null);

  // Volume state (simplified — no audio engine for desktop NES yet)
  const [volume, setVolumeState] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  // Button handlers
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

  // Input hooks
  const enabled = status === "running";
  useKeyboard(buttonDown, buttonUp, system, enabled);
  useGamepad(buttonDown, buttonUp, system, enabled);

  // Canvas render for NES
  const renderFrame = useCallback((frameBuffer: Uint32Array) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const imageData = ctx.createImageData(NES_WIDTH, NES_HEIGHT);
    const buf32 = new Uint32Array(imageData.data.buffer);
    for (let i = 0; i < frameBuffer.length; i++) {
      buf32[i] = 0xff000000 | frameBuffer[i];
    }
    ctx.putImageData(imageData, 0, 0);
  }, []);

  // Game loop (NES only)
  const gameLoop = useCallback((timestamp: DOMHighResTimeStamp) => {
    if (!runningRef.current) return;
    rafIdRef.current = requestAnimationFrame(gameLoop);

    const elapsed = timestamp - lastFrameTimeRef.current;
    if (elapsed < FRAME_TIME_MS - 1) return;
    if (elapsed > 200) {
      lastFrameTimeRef.current = timestamp - FRAME_TIME_MS;
    }

    try {
      const nes = nesRef.current;
      if (!nes) return;
      nes.frame();
      frameCountRef.current++;
      lastFrameTimeRef.current = timestamp;
      fpsFrameCountRef.current++;
    } catch (err) {
      console.error("Game loop error:", err);
      lastFrameTimeRef.current = timestamp;
    }
  }, []);

  // FPS counter
  useEffect(() => {
    const timer = window.setInterval(() => {
      setFps(fpsFrameCountRef.current);
      fpsFrameCountRef.current = 0;
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Canvas init
  const initNesCanvas = useCallback(() => {
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

  // Load ROM from file dialog
  const loadRomFromDialog = useCallback(async () => {
    // Determine ROM file filters
    const cfg = SYSTEM_CONFIGS[system];
    const extName = system.toUpperCase();
    const extensions = cfg.romExtensions.map((e) => e.replace(".", ""));

    const file = await open({
      multiple: false,
      filters: [{ name: `${extName} ROM`, extensions }],
    });

    if (!file) return; // User cancelled

    setStatus("loading");
    setCurrentRom(file as string);

    // ── Non-NES path ──────────────────────────────────────────
    if (!isNes) {
      try {
        adapterRef.current?.exit();
        adapterRef.current = null;

        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = cfg.width;
          canvas.height = cfg.height;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.imageSmoothingEnabled = false;
            ctxRef.current = ctx;
          }
        }

        // Read ROM file via Tauri fs
        const romData = await invoke<number[]>("read_rom_file", {
          path: file,
        });
        const romBytes = new Uint8Array(romData);

        // Create adapter
        let adapter: EmulatorAdapter | null = null;
        switch (system) {
          case "snes":
            adapter = new SnesEmulatorAdapter({ onStatusChange: setStatus });
            break;
          case "gb":
          case "gbc":
            adapter = new GbEmulatorAdapter(system, { onStatusChange: setStatus });
            break;
          case "gba":
            adapter = new GbaEmulatorAdapter({ onStatusChange: setStatus });
            break;
          default:
            throw new Error(`Unknown system: ${system}`);
        }

        adapterRef.current = adapter;
        if (canvas) {
          adapter.setCanvas?.(canvas);
        }

        // Load ROM from bytes (desktop path)
        await adapter.loadRomFromBytes!(romBytes, file as string);

        setStatus(adapter.status);
      } catch (err) {
        console.error(`Failed to load ${system} ROM:`, err);
        setStatus("error");
      }
      return;
    }

    // ── NES path ──────────────────────────────────────────────
    try {
      // Read ROM file
      const romData = await invoke<number[]>("read_rom_file", { path: file });
      const romBytes = new Uint8Array(romData);

      // Load jsnes
      const JsnesClass = await loadJsnes();

      // Destroy previous instance
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
      nesRef.current = null;

      initNesCanvas();

      const nes = new JsnesClass({
        onFrame: renderFrame,
        onAudioSample: () => {
          /* Audio not implemented for desktop NES yet */
        },
        emulateSound: false,
      });

      nes.loadROM(romBytes);
      nesRef.current = nes;

      frameCountRef.current = 0;
      runningRef.current = true;
      lastFrameTimeRef.current = performance.now();
      rafIdRef.current = requestAnimationFrame(gameLoop);

      setStatus("running");
    } catch (err) {
      console.error("Failed to load NES ROM:", err);
      setStatus("error");
    }
  }, [gameLoop, initNesCanvas, renderFrame, isNes, system]);

  // Pause / Resume / Reset
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

  const reset = useCallback(() => {
    if (!isNes) {
      adapterRef.current?.reset();
      return;
    }
    nesRef.current?.reset();
    frameCountRef.current = 0;
    lastFrameTimeRef.current = performance.now();
  }, [isNes]);

  // Exit
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
    nesRef.current = null;
    setStatus("idle");
    setCurrentRom(null);
    setFps(0);
  }, [isNes]);

  // readRam
  const readRam = useCallback((): Uint8Array | null => {
    if (isNes) {
      try {
        const state = nesRef.current?.toJSON();
        if (!state) return null;
        const cpu = state.cpu as { mem?: number[] };
        if (!cpu?.mem) return null;
        return new Uint8Array(cpu.mem.slice(0, 0x800));
      } catch {
        return null;
      }
    }
    return adapterRef.current?.readRam?.() ?? null;
  }, [isNes]);

  // Volume
  const setVolume = useCallback((v: number) => {
    const vol = Math.max(0, Math.min(1, v));
    setVolumeState(vol);
    setIsMuted(vol === 0);
    if (!isNes) {
      adapterRef.current?.setVolume(vol);
    }
  }, [isNes]);

  // Cleanup
  useEffect(() => {
    return () => {
      runningRef.current = false;
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
      nesRef.current = null;
      adapterRef.current?.exit();
    };
  }, []);

  return {
    status,
    fps,
    currentRom,
    system,
    canvasRef: canvasRef as React.RefObject<HTMLCanvasElement | null>,
    loadRomFromDialog,
    pause,
    resume,
    reset,
    exit,
    setVolume,
    volume,
    isMuted,
    buttonDown,
    buttonUp,
    readRam,
  };
}
