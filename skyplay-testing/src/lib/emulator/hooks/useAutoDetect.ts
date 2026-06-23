"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { SystemType } from "../types";
import type { SystemCategory } from "../game-profiles";
import {
  createMemoryWatcher,
  type MemoryWatcher,
  type DetectedResult,
} from "../memory-watcher";

/**
 * Hook that watches emulated system RAM for known game result patterns.
 *
 * Usage in EmulatorCore or a parent:
 *   const autoDetect = useAutoDetect(emu.readRam, emu.currentRom, system, emu.status === "running");
 *
 * When a result is detected, `autoDetect.pending` is updated with the result.
 */
export function useAutoDetect(
  readRam: () => Uint8Array | null,
  romName: string | null,
  system: SystemType,
  isRunning: boolean,
) {
  const watcherRef = useRef<MemoryWatcher | null>(null);
  const [pending, setPending] = useState<DetectedResult | null>(null);

  // Map SystemType → SystemCategory
  const systemCategory = mapSystem(system);

  // Start/stop watcher based on running state and ROM
  useEffect(() => {
    // Reset pending when ROM changes
    setPending(null);

    if (!isRunning || !romName || !systemCategory) {
      watcherRef.current?.stop();
      watcherRef.current = null;
      return;
    }

    const watcher = createMemoryWatcher({
      readRam,
      romName,
      system: systemCategory,
      onDetect: (result) => {
        setPending(result);
        // Auto-dismiss after 15 seconds if not confirmed
        // (the banner will handle this)
      },
      onError: (err) => {
        console.warn("[AutoDetect]", err);
      },
    });

    watcherRef.current = watcher;
    watcher.start();

    return () => {
      watcher.stop();
      watcherRef.current = null;
    };
  }, [romName, systemCategory, isRunning, readRam]);

  // Clear pending result
  const dismiss = useCallback(() => {
    setPending(null);
  }, []);

  return {
    pending,
    dismiss,
    hasProfile: watcherRef.current?.profile !== null,
    profile: watcherRef.current?.profile ?? null,
  };
}

function mapSystem(system: SystemType): SystemCategory | null {
  switch (system) {
    case "nes":
      return "nes";
    case "snes":
      return "snes";
    case "gb":
    case "gbc":
      return "gb";
    case "gba":
      return "gba";
    default:
      return null; // neogeo/ps1 not supported yet
  }
}
