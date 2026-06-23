"use client";

import { useState, useRef } from "react";
import type { SystemType } from "@/lib/emulator/types";
import { SYSTEM_CONFIGS } from "@/lib/emulator/EmulatorAdapter";
import { TranslationProvider, useTranslation } from "@/lib/i18n/TranslationContext";
import GlowBackground from "@/components/GlowBackground";
import TouchControls from "@/components/play/TouchControls";
import { Monitor, ChevronDown, Zap, Pause, Play, RotateCcw, Volume2, VolumeX, FolderOpen } from "lucide-react";
import { useEmulatorDesktop } from "./hooks/useEmulator.desktop";
import RetroArchLauncher from "./components/RetroArchLauncher";

const SYSTEM_LIST: SystemType[] = ["nes", "snes", "gb", "gbc", "gba", "neogeo", "ps1"];

export default function App() {
  return (
    <TranslationProvider>
      <DesktopPlay />
    </TranslationProvider>
  );
}

function DesktopPlay() {
  const { t } = useTranslation();
  const [system, setSystem] = useState<SystemType>("snes");
  const isDesktopOnly = SYSTEM_CONFIGS[system]?.desktopOnly ?? false;

  return (
    <main className="relative min-h-screen overflow-hidden">
      <GlowBackground />

      {/* ─── Header ─────────────────────────────────────────── */}
      <header
        className="relative z-10 border-b border-white/5"
        style={{ backgroundColor: "rgba(7,15,30,0.8)", backdropFilter: "blur(12px)" }}
      >
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <div
              className="font-black text-xl uppercase tracking-[3px]"
              style={{
                background: "linear-gradient(135deg, #00d2ff 0%, #9b5de5 50%, #f15bb5 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              {t.common.siteTitle}
            </div>
            <div
              className="uppercase tracking-[4px] mt-0.5"
              style={{ fontSize: "8px", color: "rgba(255,255,255,0.4)" }}
            >
              Desktop Edition
            </div>
          </div>

          <span
            className="px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5"
            style={{
              backgroundColor: "rgba(0,200,255,0.1)",
              border: "1px solid rgba(0,200,255,0.3)",
              color: "#00c8ff",
            }}
          >
            <Monitor className="w-3 h-3" />
            DESKTOP
          </span>
        </div>
      </header>

      {/* ─── Content ────────────────────────────────────────── */}
      <section className="relative z-10 max-w-4xl mx-auto px-4 py-8 pb-20">
        {/* System Selector */}
        <div className="flex items-center justify-center mb-8 gap-4">
          <div className="relative">
            <select
              className="w-full appearance-none rounded-xl px-4 py-2.5 pr-10 text-sm font-bold cursor-pointer"
              style={{
                backgroundColor: "rgba(0,200,255,0.1)",
                border: "1px solid rgba(0,200,255,0.3)",
                color: "#00c8ff",
              }}
              value={system}
              onChange={(e) => setSystem(e.target.value as SystemType)}
            >
              {SYSTEM_LIST.map((s) => {
                const label = t.play.systems[s] ?? s.toUpperCase();
                const cfg = SYSTEM_CONFIGS[s];
                return (
                  <option key={s} value={s}>
                    {label}{cfg?.desktopOnly ? " (Desktop)" : ""}
                  </option>
                );
              })}
            </select>
            <ChevronDown
              className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: "rgba(0,200,255,0.5)" }}
            />
          </div>
        </div>

        {/* ─── Emulator Area ────────────────────────────────── */}
        {isDesktopOnly ? (
          <RetroArchLauncher
            system={system}
            label={t.play.systems[system] ?? system.toUpperCase()}
          />
        ) : (
          <DesktopEmulatorView system={system} />
        )}
      </section>

      {/* ─── Footer ─────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-white/5 py-6 px-4 text-center">
        <p className="text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>
          SkyPlay Desktop — {t.common.footer}
        </p>
      </footer>
    </main>
  );
}

// ─── Desktop Emulator View (NES→GBA) ───────────────────────

function DesktopEmulatorView({ system }: { system: SystemType }) {
  const { t } = useTranslation();
  const emu = useEmulatorDesktop(system);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cfg = SYSTEM_CONFIGS[system];

  const showPlaceholder = emu.status === "idle" || emu.status === "loading" || emu.status === "error";
  const gameActive = emu.status === "running" || emu.status === "paused";
  const isRunning = emu.status === "running";

  return (
    <div className="w-full max-w-[800px] mx-auto">
      {/* ─── Toolbar ────────────────────────────────────────── */}
      <div
        className="rounded-2xl border p-4 mb-4 flex flex-wrap items-center gap-3"
        style={{
          backgroundColor: "rgba(13,27,46,0.85)",
          borderColor: "rgba(255,255,255,0.08)",
        }}
      >
        {/* File Picker Button */}
        <button
          onClick={emu.loadRomFromDialog}
          disabled={emu.status === "loading"}
          className="rounded-xl px-4 py-2.5 text-sm font-bold transition flex items-center gap-1.5 disabled:opacity-30"
          style={{
            backgroundColor: "rgba(0,200,255,0.15)",
            border: "1px solid rgba(0,200,255,0.3)",
            color: "#00c8ff",
          }}
        >
          <FolderOpen className="w-3.5 h-3.5" />
          {t.play.loadRom}
        </button>

        {/* Play/Pause */}
        <button
          onClick={() => (isRunning ? emu.pause() : emu.resume())}
          disabled={!gameActive && emu.status !== "paused"}
          className="rounded-xl px-4 py-2.5 text-sm font-bold transition flex items-center gap-1.5 disabled:opacity-30"
          style={{
            backgroundColor: isRunning ? "rgba(255,215,0,0.15)" : "rgba(0,200,255,0.15)",
            border: isRunning ? "1px solid rgba(255,215,0,0.3)" : "1px solid rgba(0,200,255,0.3)",
            color: isRunning ? "#ffd700" : "#00c8ff",
          }}
        >
          {isRunning ? (
            <><Pause className="w-3.5 h-3.5" />{t.play.pause}</>
          ) : (
            <><Play className="w-3.5 h-3.5" />{t.play.resume}</>
          )}
        </button>

        {/* Reset */}
        <button
          onClick={emu.reset}
          disabled={!gameActive}
          className="rounded-xl px-4 py-2.5 text-sm font-bold transition flex items-center gap-1.5 disabled:opacity-30"
          style={{
            backgroundColor: "rgba(253,46,95,0.1)",
            border: "1px solid rgba(253,46,95,0.25)",
            color: "#fd2e5f",
          }}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {t.play.reset}
        </button>

        {/* Volume */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => emu.setVolume(emu.isMuted ? 0.5 : 0)}
            className="p-2 rounded-lg transition"
            style={{ color: emu.isMuted || emu.volume === 0 ? "rgba(255,255,255,0.2)" : "#00c8ff" }}
          >
            {emu.isMuted || emu.volume === 0 ? (
              <VolumeX className="w-4 h-4" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={emu.volume}
            onChange={(e) => emu.setVolume(parseFloat(e.target.value))}
            className="w-20 h-1.5 rounded-full appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, #00c8ff ${emu.volume * 100}%, rgba(255,255,255,0.1) ${emu.volume * 100}%)`,
              accentColor: "#00c8ff",
            }}
          />
        </div>

        {/* FPS */}
        <div
          className="rounded-lg px-2.5 py-1 text-xs font-mono"
          style={{ backgroundColor: "rgba(0,200,255,0.08)", color: "rgba(0,200,255,0.6)" }}
        >
          {emu.fps} {t.play.fps}
        </div>

        {/* Current ROM name */}
        {emu.currentRom && (
          <span className="text-xs ml-auto" style={{ color: "rgba(255,255,255,0.4)" }}>
            {emu.currentRom.split(/[/\\]/).pop()}
          </span>
        )}
      </div>

      {/* ─── Canvas Container ────────────────────────────────── */}
      <div
        className="relative rounded-3xl border overflow-hidden mx-auto"
        style={{
          backgroundColor: "rgba(13,27,46,0.85)",
          borderColor: gameActive ? "rgba(0,200,255,0.25)" : "rgba(255,255,255,0.08)",
          boxShadow: gameActive
            ? "0 0 40px rgba(0,200,255,0.15), inset 0 0 40px rgba(0,200,255,0.03)"
            : "0 0 20px rgba(0,0,0,0.3)",
          aspectRatio: `${cfg.width} / ${cfg.height}`,
        }}
      >
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
            background: `repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.06) 2px, rgba(0,0,0,0.06) 4px)`,
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
                <Pause className="w-7 h-7" style={{ color: "#ffd700" }} />
              </div>
              <p className="text-sm font-bold uppercase tracking-wider" style={{ color: "#ffd700" }}>
                {t.play.pause}
              </p>
            </div>
          </div>
        )}

        {/* Touch Controls */}
        <TouchControls
          system={system}
          onButtonDown={emu.buttonDown}
          onButtonUp={emu.buttonUp}
          visible={emu.status === "running"}
        />

        {/* Placeholder (idle / loading / error) */}
        {showPlaceholder && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
            {emu.status === "loading" ? (
              <>
                <div
                  className="w-12 h-12 rounded-full border-2 border-t-transparent animate-spin mb-4"
                  style={{ borderColor: "rgba(0,200,255,0.3)", borderTopColor: "transparent" }}
                />
                <p className="text-sm font-medium" style={{ color: "rgba(0,200,255,0.7)" }}>
                  {emu.currentRom?.split(/[/\\]/).pop() ?? "Loading..."}
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
                <p className="text-sm font-semibold mb-1" style={{ color: "#fd2e5f" }}>
                  Failed to load ROM
                </p>
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
                  Check that the ROM file is valid and try again.
                </p>
              </>
            ) : (
              <>
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
                  style={{
                    backgroundColor: "rgba(0,200,255,0.05)",
                    border: "1px solid rgba(0,200,255,0.1)",
                  }}
                >
                  <Monitor className="w-8 h-8" style={{ color: "rgba(0,200,255,0.3)" }} />
                </div>
                <p className="text-sm font-semibold mb-1" style={{ color: "rgba(255,255,255,0.5)" }}>
                  {t.play.noRomLoaded}
                </p>
                <p className="text-xs max-w-[280px]" style={{ color: "rgba(255,255,255,0.25)" }}>
                  Click &quot;{t.play.loadRom}&quot; to select a ROM file from your computer.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* ─── Keyboard Controls ──────────────────────────────── */}
      {gameActive && (
        <div
          className="mt-4 rounded-2xl border p-4"
          style={{
            backgroundColor: "rgba(13,27,46,0.6)",
            borderColor: "rgba(255,255,255,0.06)",
          }}
        >
          <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "rgba(255,255,255,0.25)" }}>
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

// ─── Helpers ────────────────────────────────────────────────

function ControlKey({ label, keys }: { label: string; keys: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.35)" }}>
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
