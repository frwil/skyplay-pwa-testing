import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export type SidecarStatus = "idle" | "launching" | "running" | "error";

export interface RetroArchState {
  status: SidecarStatus;
  error: string | null;
  selectedRom: string | null;
}

const SYSTEM_EXTENSIONS: Record<string, string[]> = {
  neogeo: ["zip", "neo"],
  ps1: ["bin", "cue", "iso", "pbp", "img", "m3u"],
};

/**
 * React hook for managing the RetroArch sidecar lifecycle.
 *
 * Provides:
 * - pickAndLaunch: opens native file dialog, then launches RetroArch
 * - stop: kills the running RetroArch process
 * - state: current status, error, and selected ROM path
 */
export function useRetroArch(system: string) {
  const [state, setState] = useState<RetroArchState>({
    status: "idle",
    error: null,
    selectedRom: null,
  });

  const pickAndLaunch = useCallback(async () => {
    const extensions = SYSTEM_EXTENSIONS[system] ?? [];
    const file = await open({
      multiple: false,
      filters: [
        {
          name: `${system.toUpperCase()} ROM`,
          extensions,
        },
      ],
    });

    if (!file) return; // User cancelled

    setState({ status: "launching", error: null, selectedRom: file as string });
    try {
      await invoke("launch_sidecar", {
        romPath: file,
        system,
      });
      setState({ status: "running", error: null, selectedRom: file as string });
    } catch (e) {
      setState({ status: "error", error: String(e), selectedRom: null });
    }
  }, [system]);

  const stop = useCallback(async () => {
    try {
      await invoke("stop_sidecar");
    } catch {
      // Process may already be dead
    }
    setState({ status: "idle", error: null, selectedRom: null });
  }, []);

  // Poll status while running to detect when user closes RetroArch
  useEffect(() => {
    if (state.status !== "running") return;

    const interval = setInterval(async () => {
      try {
        const running = await invoke<boolean>("sidecar_status");
        if (!running) {
          setState({ status: "idle", error: null, selectedRom: null });
        }
      } catch {
        // Ignore polling errors
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [state.status]);

  return { ...state, pickAndLaunch, stop };
}
