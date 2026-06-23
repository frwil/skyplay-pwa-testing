"use client";

import type { EmulatorState, SystemType } from "@/lib/emulator/types";
import { SYSTEM_CONFIGS } from "@/lib/emulator/EmulatorAdapter";
import { useTranslation } from "@/lib/i18n/TranslationContext";
import { Gamepad2, Pause, RotateCcw } from "lucide-react";
import GameControls from "./GameControls";
import TouchControls from "./TouchControls";

interface EmulatorCoreProps {
  emu: EmulatorState;
  system: SystemType;
  onSystemChange: (s: SystemType) => void;
}

/**
 * Main emulator display component.
 *
 * Renders the canvas, toolbar, touch overlay, placeholder states,
 * and landscape hint. Uses the exact same card/glow design patterns
 * as the rest of the app.
 */
export default function EmulatorCore({ emu, system, onSystemChange }: EmulatorCoreProps) {
  const { t } = useTranslation();
  const cfg = SYSTEM_CONFIGS[system];

  // Show the idle/loading/error overlay
  const showPlaceholder =
    emu.status === "idle" || emu.status === "loading" || emu.status === "error";
  const showTouchControls = emu.status === "running";
  const gameActive = emu.status === "running" || emu.status === "paused";

  return (
    <div className="w-full max-w-[800px] mx-auto">
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
        className="relative rounded-3xl border overflow-hidden mx-auto"
        style={{
          backgroundColor: "rgba(13,27,46,0.85)",
          borderColor:
            gameActive
              ? "rgba(0,200,255,0.25)"
              : "rgba(255,255,255,0.08)",
          boxShadow:
            gameActive
              ? "0 0 40px rgba(0,200,255,0.15), inset 0 0 40px rgba(0,200,255,0.03)"
              : "0 0 20px rgba(0,0,0,0.3)",
          aspectRatio: `${cfg.width} / ${cfg.height}`,
        }}
      >
        {/* Canvas — hidden only during idle/loading/error */}
        <canvas
          ref={emu.canvasRef}
          className="absolute inset-0 w-full h-full block"
          style={{
            imageRendering: "pixelated",
            display: showPlaceholder ? "none" : "block",
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
              </>
            )}
          </div>
        )}
      </div>

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
          </div>
        </div>
      )}
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
