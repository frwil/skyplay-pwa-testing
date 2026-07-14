"use client";

import { useState, useEffect, useRef } from "react";
import { Pause, Play } from "lucide-react";
import { useTranslation } from "@/lib/i18n/TranslationContext";

export interface DuelPauseOverlayProps {
  /** Which player initiated the pause (1 or 2). */
  pausedBy: 1 | 2;
  /** My player side (1 or 2). */
  localSide: 1 | 2;
  /** Initial countdown value from the server. */
  countdown: number;
  /** Called when I want to resume (only available to the player who paused). */
  onResume: () => void;
}

/**
 * Full-screen overlay shown during a duel pause. Displays who paused,
 * a countdown timer, and a resume button for the pausing player.
 */
export default function DuelPauseOverlay({
  pausedBy,
  localSide,
  countdown: initialCountdown,
  onResume,
}: DuelPauseOverlayProps) {
  const { t } = useTranslation();
  const [remaining, setRemaining] = useState(initialCountdown);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Local countdown tick — the server auto-resumes at 0, but we show it too
  useEffect(() => {
    setRemaining(initialCountdown);
    intervalRef.current = setInterval(() => {
      setRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [initialCountdown]);

  const isMe = pausedBy === localSide;

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center"
      style={{
        backgroundColor: "rgba(5,10,20,0.82)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        className="rounded-2xl border p-8 w-full max-w-sm text-center"
        style={{
          backgroundColor: "rgba(13,27,46,0.95)",
          borderColor: "rgba(255,215,0,0.25)",
          boxShadow: "0 0 80px rgba(255,215,0,0.08)",
        }}
      >
        {/* Icon */}
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{
            backgroundColor: "rgba(255,215,0,0.1)",
            border: "2px solid rgba(255,215,0,0.3)",
          }}
        >
          <Pause className="w-8 h-8" style={{ color: "#ffd700" }} />
        </div>

        {/* Title */}
        <h2 className="text-xl font-bold text-white mb-1">
          {t.duel?.pause?.title ?? "Pause"}
        </h2>
        <p className="text-sm text-white/50 mb-6">
          {isMe
            ? (t.duel?.pause?.pausedByYou ?? "Vous avez mis le jeu en pause")
            : (t.duel?.pause?.pausedByOpponent ?? "L'adversaire a mis le jeu en pause")}
        </p>

        {/* Countdown */}
        <div className="mb-6">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center mx-auto border-2"
            style={{
              backgroundColor: remaining <= 5 ? "rgba(253,46,95,0.12)" : "rgba(255,215,0,0.08)",
              borderColor: remaining <= 5 ? "rgba(253,46,95,0.4)" : "rgba(255,215,0,0.3)",
              color: remaining <= 5 ? "#fd2e5f" : "#ffd700",
            }}
          >
            <span className="text-3xl font-black tabular-nums">{remaining}</span>
          </div>
          <p className="text-[10px] text-white/25 mt-2">
            {t.duel?.pause?.autoResume ?? "Reprise automatique"}
          </p>
        </div>

        {/* Resume button (only for the player who paused) */}
        {isMe && (
          <button
            onClick={onResume}
            className="w-full py-3 rounded-xl text-sm font-bold transition-all hover:scale-105 flex items-center justify-center gap-2"
            style={{
              backgroundColor: "rgba(255,215,0,0.15)",
              border: "1px solid rgba(255,215,0,0.35)",
              color: "#ffd700",
            }}
          >
            <Play className="w-4 h-4" />
            {t.duel?.pause?.resume ?? "Reprendre"}
          </button>
        )}
      </div>
    </div>
  );
}
