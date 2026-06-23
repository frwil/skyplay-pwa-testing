"use client";

import { useEffect } from "react";
import { Trophy, X, Check, Gamepad2 } from "lucide-react";
import type { DetectedResult } from "@/lib/emulator/memory-watcher";

interface AutoDetectBannerProps {
  /** The detected result (null = no detection) */
  detected: DetectedResult | null;
  /** Called when user clicks "Confirm" — should open challenge submit flow */
  onConfirm: (result: DetectedResult) => void;
  /** Called when user dismisses the banner */
  onDismiss: () => void;
}

/**
 * Floating banner shown when the memory watcher auto-detects
 * a game result (e.g., "Player 1 Wins!" in Street Fighter).
 *
 * Displays a toast at the bottom of the screen with the result
 * and a "Confirm → Submit to Challenge" CTA.
 * Auto-dismisses after 15 seconds if not confirmed.
 */
export default function AutoDetectBanner({
  detected,
  onConfirm,
  onDismiss,
}: AutoDetectBannerProps) {
  // Auto-dismiss after 15s
  useEffect(() => {
    if (!detected) return;

    const timer = setTimeout(() => {
      onDismiss();
    }, 15000);

    return () => clearTimeout(timer);
  }, [detected, onDismiss]);

  if (!detected) return null;

  const { trigger, profile } = detected;
  const isWin = trigger.result === "win";
  const isLoss = trigger.result === "loss";

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-md animate-in">
      <div
        className="rounded-2xl border p-4 shadow-2xl"
        style={{
          backgroundColor: "rgba(13,27,46,0.98)",
          borderColor: isWin
            ? "rgba(46,204,113,0.4)"
            : isLoss
              ? "rgba(253,46,95,0.4)"
              : "rgba(0,200,255,0.4)",
          boxShadow: isWin
            ? "0 0 30px rgba(46,204,113,0.2)"
            : isLoss
              ? "0 0 30px rgba(253,46,95,0.2)"
              : "0 0 30px rgba(0,200,255,0.2)",
        }}
      >
        {/* Header row */}
        <div className="flex items-start gap-3 mb-3">
          {/* Icon */}
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
            style={{
              backgroundColor: isWin
                ? "rgba(46,204,113,0.15)"
                : isLoss
                  ? "rgba(253,46,95,0.15)"
                  : "rgba(0,200,255,0.15)",
              border: `1px solid ${
                isWin
                  ? "rgba(46,204,113,0.3)"
                  : isLoss
                    ? "rgba(253,46,95,0.3)"
                    : "rgba(0,200,255,0.3)"
              }`,
            }}
          >
            {isWin ? (
              <Trophy className="w-5 h-5" style={{ color: "#ffd700" }} />
            ) : isLoss ? (
              <X className="w-5 h-5" style={{ color: "#fd2e5f" }} />
            ) : (
              <Gamepad2 className="w-5 h-5" style={{ color: "#00c8ff" }} />
            )}
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black text-white mb-0.5">
              {trigger.label}
            </p>
            <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.5)" }}>
              Auto-detected from game memory • {profile.label}
            </p>
          </div>

          {/* Dismiss */}
          <button
            onClick={onDismiss}
            className="p-1 rounded-lg shrink-0"
            style={{ color: "rgba(255,255,255,0.3)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={() => onConfirm(detected)}
            className="flex-1 rounded-xl px-4 py-2.5 text-sm font-bold flex items-center justify-center gap-1.5 transition"
            style={{
              backgroundColor: "rgba(46,204,113,0.15)",
              border: "1px solid rgba(46,204,113,0.3)",
              color: "#2ecc71",
            }}
          >
            <Check className="w-4 h-4" />
            Confirm — Submit Result
          </button>
          <button
            onClick={onDismiss}
            className="rounded-xl px-4 py-2.5 text-sm font-medium transition"
            style={{
              backgroundColor: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "rgba(255,255,255,0.4)",
            }}
          >
            Ignore
          </button>
        </div>
      </div>
    </div>
  );
}
