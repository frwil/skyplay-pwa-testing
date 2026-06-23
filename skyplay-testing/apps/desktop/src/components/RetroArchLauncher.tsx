import { useRetroArch } from "../hooks/useRetroArch";
import { Monitor, Play, Square, AlertTriangle, FolderOpen } from "lucide-react";

interface RetroArchLauncherProps {
  system: string;
  label: string;
}

/**
 * UI for desktop-only systems (Neo Geo, PS1) that use the
 * RetroArch sidecar instead of an in-webview emulator.
 */
export default function RetroArchLauncher({
  system,
  label,
}: RetroArchLauncherProps) {
  const { status, error, selectedRom, pickAndLaunch, stop } =
    useRetroArch(system);

  const isRunning = status === "running";
  const isLaunching = status === "launching";
  const isError = status === "error";

  return (
    <div
      className="rounded-3xl border overflow-hidden p-8"
      style={{
        backgroundColor: "rgba(13,27,46,0.85)",
        borderColor: isRunning
          ? "rgba(0,200,255,0.25)"
          : "rgba(255,255,255,0.08)",
        boxShadow: isRunning
          ? "0 0 40px rgba(0,200,255,0.15), inset 0 0 40px rgba(0,200,255,0.03)"
          : "0 0 20px rgba(0,0,0,0.3)",
        aspectRatio: system === "neogeo" ? "320 / 224" : "640 / 480",
      }}
    >
      <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
        {/* Icon */}
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{
            backgroundColor: isRunning
              ? "rgba(0,200,255,0.1)"
              : isError
                ? "rgba(253,46,95,0.1)"
                : "rgba(0,200,255,0.05)",
            border: isRunning
              ? "1px solid rgba(0,200,255,0.3)"
              : isError
                ? "1px solid rgba(253,46,95,0.3)"
                : "1px solid rgba(0,200,255,0.1)",
          }}
        >
          {isRunning ? (
            <Play className="w-8 h-8" style={{ color: "#00c8ff" }} />
          ) : isLaunching ? (
            <div
              className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
              style={{
                borderColor: "rgba(0,200,255,0.3)",
                borderTopColor: "transparent",
              }}
            />
          ) : isError ? (
            <AlertTriangle className="w-8 h-8" style={{ color: "#fd2e5f" }} />
          ) : (
            <Monitor className="w-8 h-8" style={{ color: "rgba(0,200,255,0.3)" }} />
          )}
        </div>

        {/* Title */}
        <div>
          <h2 className="text-lg font-bold text-white mb-1">{label}</h2>
          <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
            {isRunning
              ? selectedRom
                ? `Running: ${selectedRom.split(/[/\\]/).pop()}`
                : "Game is running"
              : isLaunching
                ? "Launching RetroArch..."
                : "Select a ROM file to launch in RetroArch"}
          </p>
        </div>

        {/* Error */}
        {isError && error && (
          <p className="text-xs" style={{ color: "#fd2e5f" }}>
            {error}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3">
          {isRunning ? (
            <button
              onClick={stop}
              className="rounded-xl px-4 py-2.5 text-sm font-bold flex items-center gap-1.5 transition"
              style={{
                backgroundColor: "rgba(253,46,95,0.1)",
                border: "1px solid rgba(253,46,95,0.3)",
                color: "#fd2e5f",
              }}
            >
              <Square className="w-3.5 h-3.5" />
              Stop Emulator
            </button>
          ) : (
            <button
              onClick={pickAndLaunch}
              disabled={isLaunching}
              className="rounded-xl px-4 py-2.5 text-sm font-bold flex items-center gap-1.5 transition disabled:opacity-30"
              style={{
                backgroundColor: "rgba(0,200,255,0.15)",
                border: "1px solid rgba(0,200,255,0.3)",
                color: "#00c8ff",
              }}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              {isLaunching ? "Launching..." : "Browse ROM"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
