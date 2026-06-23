"use client";

import { useState } from "react";
import type { RomEntry, SystemType } from "@/lib/emulator/types";
import { useTranslation } from "@/lib/i18n/TranslationContext";
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  ChevronDown,
  Zap,
  ExternalLink,
} from "lucide-react";

const SYSTEM_LIST: SystemType[] = ["nes", "snes", "gb", "gbc", "gba", "neogeo", "ps1"];

interface GameControlsProps {
  romList: RomEntry[];
  currentRom: string | null;
  status: string;
  fps: number;
  volume: number;
  isMuted: boolean;
  system: SystemType;
  onSystemChange: (s: SystemType) => void;
  onLoadRom: (rom: RomEntry) => void;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
  onVolumeChange: (v: number) => void;
  /** Called when user clicks the "Open in Popup" button. */
  onOpenPopup?: () => void;
  /** Whether we're already in a popup window (hides the button). */
  isPopup?: boolean;
}

export default function GameControls({
  romList,
  currentRom,
  status,
  fps,
  volume,
  isMuted,
  system,
  onSystemChange,
  onLoadRom,
  onPause,
  onResume,
  onReset,
  onVolumeChange,
  onOpenPopup,
  isPopup,
}: GameControlsProps) {
  const { t } = useTranslation();
  const [selectedRom, setSelectedRom] = useState<string>("");

  const isRunning = status === "running";
  const isLoading = status === "loading";
  const canInteract = status === "running" || status === "paused";

  // Filter ROMs by current system
  const filteredRoms = romList.filter((r) => r.system === system);

  const handleLaunch = () => {
    const rom = filteredRoms.find((r) => r.name === selectedRom);
    if (rom) onLoadRom(rom);
  };

  return (
    <div
      className="rounded-2xl border p-4 mb-4 flex flex-wrap items-center gap-3"
      style={{
        backgroundColor: "rgba(13,27,46,0.85)",
        borderColor: "rgba(255,255,255,0.08)",
      }}
    >
      {/* System Selector */}
      <div className="flex items-center gap-2">
        <div className="relative">
          <select
            className="w-full appearance-none rounded-xl px-4 py-2.5 pr-10 text-sm font-bold cursor-pointer"
            style={{
              backgroundColor: "rgba(0,200,255,0.1)",
              border: "1px solid rgba(0,200,255,0.3)",
              color: "#00c8ff",
            }}
            value={system}
            onChange={(e) => {
              onSystemChange(e.target.value as SystemType);
              setSelectedRom("");
            }}
            disabled={isLoading}
          >
            {SYSTEM_LIST.map((s) => {
              const label = t.play.systems[s] ?? s.toUpperCase();
              return (
                <option key={s} value={s}>
                  {label}
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

      {/* ROM Selector */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="relative flex-1 min-w-0">
          <select
            className="w-full appearance-none rounded-xl px-4 py-2.5 pr-10 text-sm font-medium cursor-pointer truncate"
            style={{
              backgroundColor: "rgba(7,15,30,0.6)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: selectedRom ? "#fff" : "rgba(255,255,255,0.4)",
            }}
            value={selectedRom}
            onChange={(e) => setSelectedRom(e.target.value)}
            disabled={isLoading}
          >
            <option value="" disabled>
              {t.play.selectRom}
            </option>
            {filteredRoms.map((rom) => (
              <option key={rom.name} value={rom.name}>
                {rom.name}
              </option>
            ))}
          </select>
          <ChevronDown
            className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: "rgba(255,255,255,0.3)" }}
          />
        </div>
      </div>

      {/* Launch Button */}
      <button
        onClick={handleLaunch}
        disabled={!selectedRom || isLoading}
        className="rounded-xl px-4 py-2.5 text-sm font-bold transition-all duration-200 flex items-center gap-1.5 disabled:opacity-30"
        style={{
          backgroundColor: "rgba(0,200,255,0.15)",
          border: "1px solid rgba(0,200,255,0.3)",
          color: "#00c8ff",
        }}
      >
        <Zap className="w-3.5 h-3.5" />
        {t.play.loadRom}
      </button>

      {/* Play/Pause */}
      <button
        onClick={() => (isRunning ? onPause() : onResume())}
        disabled={!canInteract && status !== "paused"}
        className="rounded-xl px-4 py-2.5 text-sm font-bold transition-all duration-200 flex items-center gap-1.5 disabled:opacity-30"
        style={{
          backgroundColor: isRunning
            ? "rgba(255,215,0,0.15)"
            : "rgba(0,200,255,0.15)",
          border: isRunning
            ? "1px solid rgba(255,215,0,0.3)"
            : "1px solid rgba(0,200,255,0.3)",
          color: isRunning ? "#ffd700" : "#00c8ff",
        }}
      >
        {isRunning ? (
          <>
            <Pause className="w-3.5 h-3.5" />
            {t.play.pause}
          </>
        ) : (
          <>
            <Play className="w-3.5 h-3.5" />
            {t.play.resume}
          </>
        )}
      </button>

      {/* Reset */}
      <button
        onClick={onReset}
        disabled={!canInteract}
        className="rounded-xl px-4 py-2.5 text-sm font-bold transition-all duration-200 flex items-center gap-1.5 disabled:opacity-30"
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
          onClick={() => onVolumeChange(isMuted ? 0.5 : 0)}
          className="p-2 rounded-lg transition"
          style={{ color: isMuted ? "rgba(255,255,255,0.2)" : "#00c8ff" }}
        >
          {isMuted || volume === 0 ? (
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
          value={volume}
          onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
          className="w-20 h-1.5 rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, #00c8ff ${volume * 100}%, rgba(255,255,255,0.1) ${volume * 100}%)`,
            accentColor: "#00c8ff",
          }}
        />
      </div>

      {/* FPS Counter */}
      <div
        className="rounded-lg px-2.5 py-1 text-xs font-mono"
        style={{
          backgroundColor: "rgba(0,200,255,0.08)",
          color: "rgba(0,200,255,0.6)",
        }}
      >
        {fps} {t.play.fps}
      </div>

      {/* Popup Button (desktop only, hidden when already in popup) */}
      {!isPopup && onOpenPopup && (
        <button
          onClick={onOpenPopup}
          className="rounded-xl px-3 py-2 text-sm font-bold transition hidden md:flex items-center gap-1.5"
          style={{
            backgroundColor: "rgba(0,200,255,0.06)",
            border: "1px solid rgba(0,200,255,0.15)",
            color: "rgba(0,200,255,0.5)",
          }}
          title="Open emulator in a separate popup window"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
