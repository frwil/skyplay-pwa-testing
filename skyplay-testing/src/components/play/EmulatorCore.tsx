"use client";

import { useState, useCallback, useEffect } from "react";
import type { EmulatorState, SystemType } from "@/lib/emulator/types";
import { SYSTEM_CONFIGS } from "@/lib/emulator/EmulatorAdapter";
import { useTranslation } from "@/lib/i18n/TranslationContext";
import { Gamepad2, Pause, RotateCcw, Maximize2, Minimize2, Info, Activity, Zap, Wifi, Cloud, Copy, Users } from "lucide-react";
import GameControls from "./GameControls";
import TouchControls from "./TouchControls";
import AutoDetectBanner from "./AutoDetectBanner";
import { KofMatchHUD } from "./KofMatchHUD";
import { useAutoDetect } from "@/lib/emulator/hooks/useAutoDetect";
import { useFullscreen } from "@/lib/emulator/hooks/useFullscreen";
import type { DetectedResult } from "@/lib/emulator/memory-watcher";

export interface NetplayInfoOverlay {
  /** Current netplay status: idle/connecting/connected/countdown/playing/finished/error */
  status?: string;
  /** Round-trip latency in ms */
  latency?: number;
  /** Total rollback count (NES) or input delay mode indicator */
  rollbacks?: number;
  /** Connection type: "rollback" | "input_delay" | null */
  mode?: "rollback" | "input_delay" | null;
  /** Opponent name */
  opponentName?: string | null;
}

interface EmulatorCoreProps {
  emu: EmulatorState;
  system: SystemType;
  onSystemChange: (s: SystemType) => void;
  /** Called when memory watcher detects a result and user confirms */
  onAutoDetectConfirm?: (result: DetectedResult) => void;
  /** Real-time netplay info for the overlay */
  netplayInfo?: NetplayInfoOverlay;
  /** Whether we're in a popup window (minimal UI). */
  isPopup?: boolean;
  /** Called when the user clicks "Open in Popup". */
  onOpenPopup?: () => void;
}

/**
 * Main emulator display component.
 *
 * Renders the canvas, toolbar, touch overlay, placeholder states,
 * landscape hint, fullscreen button, and real-time info overlay.
 */
export default function EmulatorCore({
  emu,
  system,
  onSystemChange,
  onAutoDetectConfirm,
  netplayInfo,
  isPopup,
  onOpenPopup,
}: EmulatorCoreProps) {
  const { t } = useTranslation();
  const cfg = SYSTEM_CONFIGS[system];

  // ─── Memory Auto-Detection ──────────────────────────────
  const autoDetect = useAutoDetect(
    emu.readRam,
    emu.currentRom,
    system,
    emu.status === "running",
  );

  // ─── Fullscreen ─────────────────────────────────────────
  const { isFullscreen, toggle } = useFullscreen();

  const toggleFullscreen = useCallback(() => {
    void toggle(document.getElementById("emulator-canvas-container"));
  }, [toggle]);

  // Keyboard shortcut: F = fullscreen, I = toggle info
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleFullscreen]);

  // ─── Info Overlay ───────────────────────────────────────
  const [showInfo, setShowInfo] = useState(true);

  // ─── Room Code Join ─────────────────────────────────────
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Auto-join via URL parameter: ?roomCode=ABC123
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const codeFromUrl = params.get("roomCode");
    if (codeFromUrl && emu.isCloud && emu.status === "idle") {
      setJoining(true);
      emu.joinSession(codeFromUrl).catch((err) => {
        setJoinError(err instanceof Error ? err.message : "Join failed");
      }).finally(() => setJoining(false));
    }
  }, [emu.isCloud, emu.status]);

  // Toggle info overlay with I key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        setShowInfo((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Show the idle/loading/error overlay
  const showPlaceholder =
    emu.status === "idle" || emu.status === "loading" || emu.status === "error";
  const showTouchControls = emu.status === "running";
  const gameActive = emu.status === "running" || emu.status === "paused";
  const isNetplayActive =
    netplayInfo?.status === "playing" || netplayInfo?.status === "countdown";

  return (
    <div className={isPopup ? "w-full mx-auto" : "w-full max-w-full mx-auto"}>
      {/* ─── Toolbar ──────────────────────────────────────────── */}
      <GameControls
        romList={emu.romList}
        currentRom={emu.currentRom}
        status={emu.status}
        fps={emu.fps}
        volume={emu.volume}
        isMuted={emu.isMuted}
        system={system}
        onSystemChange={onSystemChange}
        onLoadRom={emu.loadRom}
        onPause={emu.pause}
        onResume={emu.resume}
        onReset={emu.reset}
        onVolumeChange={emu.setVolume}
        onOpenPopup={onOpenPopup}
        isPopup={isPopup}
      />

      {/* ─── Landscape Hint (mobile portrait) ────────────────── */}
      {gameActive && (
        <div
          className="md:hidden rounded-xl border px-3 py-2 mb-4 text-center"
          style={{
            backgroundColor: "rgba(255,215,0,0.08)",
            borderColor: "rgba(255,215,0,0.2)",
          }}
        >
          <p
            className="text-xs font-medium flex items-center justify-center gap-2"
            style={{ color: "rgba(255,215,0,0.8)" }}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {t.play.rotateHint}
          </p>
        </div>
      )}

      {/* ─── Canvas Container ────────────────────────────────── */}
      <div
        id="emulator-canvas-container"
        className="relative rounded-3xl border overflow-hidden mx-auto group/canvas"
        style={{
          backgroundColor: "rgba(13,27,46,0.85)",
          borderColor: gameActive
            ? "rgba(0,200,255,0.25)"
            : "rgba(255,255,255,0.08)",
          boxShadow: gameActive
            ? "0 0 40px rgba(0,200,255,0.15), inset 0 0 40px rgba(0,200,255,0.03)"
            : "0 0 20px rgba(0,0,0,0.3)",
          aspectRatio: isFullscreen ? undefined : `${cfg.width} / ${cfg.height}`,
          width: isFullscreen ? "100vw" : undefined,
          height: isFullscreen ? "100vh" : undefined,
        }}
      >
        {/* Canvas always visible so Nostalgist measures correct dimensions. The placeholder overlay (absolute inset-0) covers it during loading. */}
        <canvas
          ref={emu.canvasRef}
          className="absolute inset-0 w-full h-full block"
          style={{
            imageRendering: "pixelated",
          }}
        />

        {/* Scanline overlay */}
        <div
          className="absolute inset-0 pointer-events-none z-10"
          style={{
            background: `repeating-linear-gradient(
              0deg,
              transparent,
              transparent 2px,
              rgba(0,0,0,0.06) 2px,
              rgba(0,0,0,0.06) 4px
            )`,
            display: gameActive ? "block" : "none",
          }}
        />

        {/* ─── Fullscreen Button ───────────────────────────── */}
        {gameActive && (
          <button
            onClick={toggleFullscreen}
            className="absolute top-3 right-3 z-30 p-2 rounded-lg opacity-0 group-hover/canvas:opacity-100 transition-opacity hover:bg-white/10"
            style={{ color: "rgba(255,255,255,0.5)" }}
            title={isFullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)"}
          >
            {isFullscreen ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>
        )}

        {/* ─── Info Overlay ────────────────────────────────── */}
        {gameActive && showInfo && (
          <div
            className="absolute top-3 left-3 z-30 flex flex-col gap-1 pointer-events-none"
            style={{ fontFamily: "monospace" }}
          >
            {/* FPS */}
            <div
              className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold"
              style={{
                backgroundColor: "rgba(0,0,0,0.6)",
                backdropFilter: "blur(4px)",
                color: emu.fps >= 55 ? "#4ade80" : emu.fps >= 30 ? "#ffd700" : "#fd2e5f",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <Activity className="w-2.5 h-2.5" />
              {emu.fps} FPS
            </div>

            {/* System */}
            <div
              className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold"
              style={{
                backgroundColor: "rgba(0,0,0,0.6)",
                backdropFilter: "blur(4px)",
                color: "rgba(255,255,255,0.6)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <Gamepad2 className="w-2.5 h-2.5" />
              {system.toUpperCase()}
            </div>

            {/* Cloud badge */}
            {cfg.cloud && (
              <div
                className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold"
                style={{
                  backgroundColor: "rgba(139,92,246,0.15)",
                  backdropFilter: "blur(4px)",
                  color: "rgba(139,92,246,0.8)",
                  border: "1px solid rgba(139,92,246,0.25)",
                }}
              >
                <Cloud className="w-2.5 h-2.5" />
                Cloud
              </div>
            )}

            {/* Room code badge (P1 — cloud mode, game active, room code available) */}
            {cfg.cloud && emu.roomCode && gameActive && (
              <div
                className="flex items-center gap-1.5 rounded-full pl-2.5 pr-1.5 py-0.5 text-[10px] font-bold pointer-events-auto cursor-pointer"
                style={{
                  backgroundColor: "rgba(34,197,94,0.15)",
                  backdropFilter: "blur(4px)",
                  color: "rgba(34,197,94,0.8)",
                  border: "1px solid rgba(34,197,94,0.25)",
                }}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(emu.roomCode!);
                  } catch { /* clipboard denied */ }
                }}
                title="Click to copy room code"
              >
                <Users className="w-2.5 h-2.5" />
                {emu.roomCode}
                <Copy className="w-2.5 h-2.5 ml-0.5 opacity-60" />
              </div>
            )}

            {/* Netplay status */}
            {netplayInfo?.status && netplayInfo.status !== "idle" && (
              <div
                className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold"
                style={{
                  backgroundColor: "rgba(0,0,0,0.6)",
                  backdropFilter: "blur(4px)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color:
                    netplayInfo.status === "playing"
                      ? "#4ade80"
                      : netplayInfo.status === "error"
                        ? "#fd2e5f"
                        : "#ffd700",
                }}
              >
                <Wifi className="w-2.5 h-2.5" />
                {netplayInfo.mode === "input_delay" ? "InputDelay" : "Rollback"}
                {netplayInfo.opponentName && ` vs ${netplayInfo.opponentName}`}
              </div>
            )}

            {/* Latency */}
            {netplayInfo?.latency != null && netplayInfo.latency > 0 && (
              <div
                className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold"
                style={{
                  backgroundColor: "rgba(0,0,0,0.6)",
                  backdropFilter: "blur(4px)",
                  color:
                    netplayInfo.latency < 50
                      ? "#4ade80"
                      : netplayInfo.latency < 100
                        ? "#ffd700"
                        : "#fd2e5f",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <Zap className="w-2.5 h-2.5" />
                {netplayInfo.latency}ms
              </div>
            )}
          </div>
        )}

        {/* Live in-match HUD (KOF98 cloud): teams + active char + gauge mode */}
        {gameActive && <KofMatchHUD state={emu.matchState} />}

        {/* Paused overlay */}
        {emu.status === "paused" && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
            <div className="flex flex-col items-center gap-3">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{
                  backgroundColor: "rgba(255,215,0,0.15)",
                  border: "2px solid rgba(255,215,0,0.4)",
                }}
              >
                <Pause
                  className="w-7 h-7"
                  style={{ color: "#ffd700" }}
                />
              </div>
              <p
                className="text-sm font-bold uppercase tracking-wider"
                style={{ color: "#ffd700" }}
              >
                {t.play.pause}
              </p>
            </div>
          </div>
        )}

        {/* Touch Controls Overlay */}
        <TouchControls
          system={system}
          onButtonDown={emu.buttonDown}
          onButtonUp={emu.buttonUp}
          visible={showTouchControls}
        />

        {/* ─── Placeholder / Idle / Loading / Error ──────────── */}
        {showPlaceholder && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
            {emu.status === "loading" ? (
              <>
                <div
                  className="w-12 h-12 rounded-full border-2 border-t-transparent animate-spin mb-4"
                  style={{
                    borderColor: "rgba(0,200,255,0.3)",
                    borderTopColor: "transparent",
                  }}
                />
                <p
                  className="text-sm font-medium"
                  style={{ color: "rgba(0,200,255,0.7)" }}
                >
                  {emu.currentRom}
                </p>
              </>
            ) : emu.status === "error" ? (
              <>
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
                  style={{
                    backgroundColor: "rgba(253,46,95,0.1)",
                    border: "1px solid rgba(253,46,95,0.3)",
                  }}
                >
                  <span style={{ color: "#fd2e5f", fontSize: "24px" }}>!</span>
                </div>
                <p
                  className="text-sm font-semibold mb-1"
                  style={{ color: "#fd2e5f" }}
                >
                  Failed to load ROM
                </p>
                <p
                  className="text-xs"
                  style={{ color: "rgba(255,255,255,0.3)" }}
                >
                  Check that the ROM file is valid and try again.
                </p>
              </>
            ) : (
              /* idle */
              <>
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
                  style={{
                    backgroundColor: "rgba(0,200,255,0.05)",
                    border: "1px solid rgba(0,200,255,0.1)",
                  }}
                >
                  <Gamepad2
                    className="w-8 h-8"
                    style={{ color: "rgba(0,200,255,0.3)" }}
                  />
                </div>
                <p
                  className="text-sm font-semibold mb-1"
                  style={{ color: "rgba(255,255,255,0.5)" }}
                >
                  {t.play.noRomLoaded}
                </p>
                <p
                  className="text-xs max-w-[280px]"
                  style={{ color: "rgba(255,255,255,0.25)" }}
                >
                  {t.play.noRomDescription}
                </p>

                {/* P2 Join by Room Code (cloud mode, idle only) */}
                {emu.isCloud && (
                  <div className="mt-6 flex flex-col items-center gap-2">
                    <div
                      className="text-[10px] font-bold uppercase tracking-wider mb-1"
                      style={{ color: "rgba(255,255,255,0.3)" }}
                    >
                      <Users className="w-3 h-3 inline mr-1" />
                      Join a game
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={joinCode}
                        onChange={(e) => {
                          setJoinCode(e.target.value.toUpperCase().slice(0, 6));
                          setJoinError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && joinCode.length === 6 && !joining) {
                            setJoining(true);
                            setJoinError(null);
                            emu.joinSession(joinCode).catch((err) => {
                              setJoinError(err instanceof Error ? err.message : "Join failed");
                            }).finally(() => setJoining(false));
                          }
                        }}
                        placeholder="ABC123"
                        maxLength={6}
                        disabled={joining}
                        className="w-24 px-3 py-1.5 rounded-lg text-center text-sm font-mono font-bold uppercase tracking-widest
                                  focus:outline-none disabled:opacity-50"
                        style={{
                          backgroundColor: "rgba(255,255,255,0.05)",
                          border: "1px solid rgba(255,255,255,0.12)",
                          color: "rgba(0,200,255,0.8)",
                        }}
                      />
                      <button
                        onClick={() => {
                          if (joinCode.length !== 6 || joining) return;
                          setJoining(true);
                          setJoinError(null);
                          emu.joinSession(joinCode).catch((err) => {
                            setJoinError(err instanceof Error ? err.message : "Join failed");
                          }).finally(() => setJoining(false));
                        }}
                        disabled={joinCode.length !== 6 || joining}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-40"
                        style={{
                          backgroundColor: joining ? "rgba(0,200,255,0.1)" : "rgba(0,200,255,0.2)",
                          border: "1px solid rgba(0,200,255,0.3)",
                          color: "rgba(0,200,255,0.9)",
                        }}
                      >
                        {joining ? "..." : "Join"}
                      </button>
                    </div>
                    {joinError && (
                      <p className="text-[10px]" style={{ color: "#fd2e5f" }}>
                        {joinError}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ─── Shortcut hint ───────────────────────────────── */}
      {gameActive && !isFullscreen && (
        <div className="mt-2 flex items-center justify-center">
          <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.15)" }}>
            <kbd className="px-1 rounded text-[10px]" style={{ backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>F</kbd> fullscreen ·{" "}
            <kbd className="px-1 rounded text-[10px]" style={{ backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>I</kbd> info overlay
          </p>
        </div>
      )}

      {/* ─── Keyboard Controls Hint (per system) ────────────── */}
      {gameActive && (
        <div
          className="mt-4 rounded-2xl border p-4 hidden md:block"
          style={{
            backgroundColor: "rgba(13,27,46,0.6)",
            borderColor: "rgba(255,255,255,0.06)",
          }}
        >
          <p
            className="text-[10px] font-bold uppercase tracking-wider mb-2"
            style={{ color: "rgba(255,255,255,0.25)" }}
          >
            {t.play.controls.title}
          </p>
          <div className="grid grid-cols-4 gap-x-4 gap-y-1">
            <ControlKey label={t.play.controls.dpad} keys="↑ ↓ ← →" />
            <ControlKey label={t.play.controls.a} keys="X" />
            <ControlKey label={t.play.controls.b} keys="Z" />
            <ControlKey label={t.play.controls.start} keys="Enter" />
            <ControlKey label={t.play.controls.select} keys="Shift" />
            {(system === "snes" || system === "gba") && (
              <>
                {system === "snes" && (
                  <>
                    <ControlKey label={t.play.controls.x} keys="C" />
                    <ControlKey label={t.play.controls.y} keys="V" />
                  </>
                )}
                <ControlKey label={t.play.controls.l} keys="A" />
                <ControlKey label={t.play.controls.r} keys="S" />
              </>
            )}
            <ControlKey label="Fullscreen" keys="F" />
            <ControlKey label="Info" keys="I" />
          </div>
        </div>
      )}

      {/* ─── Auto-Detect Banner ─────────────────────────── */}
      <AutoDetectBanner
        detected={autoDetect.pending}
        onConfirm={(result) => onAutoDetectConfirm?.(result)}
        onDismiss={autoDetect.dismiss}
      />
    </div>
  );
}

/** Small key binding display row */
function ControlKey({ label, keys }: { label: string; keys: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span
        className="text-[11px]"
        style={{ color: "rgba(255,255,255,0.35)" }}
      >
        {label}
      </span>
      <span
        className="rounded-md px-2 py-0.5 text-[10px] font-mono font-bold"
        style={{
          backgroundColor: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.1)",
          color: "rgba(0,200,255,0.7)",
        }}
      >
        {keys}
      </span>
    </div>
  );
}
