"use client";

import { Trophy, X, Loader2, Swords } from "lucide-react";

interface ChallengeNotificationDialogProps {
  /** The username of the challenger. */
  fromUsername: string;
  onAccept: () => void;
  onDecline: () => void;
  isAccepting: boolean;
  isDeclining: boolean;
  error: string | null;
}

/**
 * Modal overlay shown to P2 when they receive a targeted challenge.
 *
 * Displays "Player X vous a défié !" with Accept and Refuse buttons.
 */
export default function ChallengeNotificationDialog({
  fromUsername,
  onAccept,
  onDecline,
  isAccepting,
  isDeclining,
  error,
}: ChallengeNotificationDialogProps) {
  const busy = isAccepting || isDeclining;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="rounded-3xl border p-8 w-full max-w-sm mx-4 text-center"
        style={{
          backgroundColor: "rgba(13,27,46,0.95)",
          borderColor: "rgba(0,200,255,0.2)",
          boxShadow: "0 0 60px rgba(0,200,255,0.1)",
        }}
      >
        {/* Icon */}
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{
            backgroundColor: "rgba(0,200,255,0.1)",
            border: "2px solid rgba(0,200,255,0.3)",
          }}
        >
          <Swords className="w-7 h-7" style={{ color: "#00c8ff" }} />
        </div>

        {/* Title */}
        <h2 className="text-xl font-black text-white mb-1">Défi reçu !</h2>
        <p className="text-sm mb-6" style={{ color: "rgba(255,255,255,0.5)" }}>
          <span className="font-bold" style={{ color: "#00c8ff" }}>
            {fromUsername}
          </span>{" "}
          vous a défié !
        </p>

        {/* Error */}
        {error && (
          <div
            className="rounded-lg px-3 py-2 text-xs font-bold mb-4"
            style={{
              backgroundColor: "rgba(253,46,95,0.08)",
              border: "1px solid rgba(253,46,95,0.2)",
              color: "#fd2e5f",
            }}
          >
            {error}
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onDecline}
            disabled={busy}
            className="flex-1 rounded-xl px-4 py-3 text-sm font-bold transition-all disabled:opacity-50"
            style={{
              backgroundColor: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "rgba(255,255,255,0.5)",
            }}
          >
            {isDeclining ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Refus...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <X className="w-3.5 h-3.5" />
                Refuser
              </span>
            )}
          </button>

          <button
            onClick={onAccept}
            disabled={busy}
            className="flex-1 rounded-xl px-4 py-3 text-sm font-bold transition-all disabled:opacity-50"
            style={{
              backgroundColor: "rgba(74,222,128,0.15)",
              border: "1px solid rgba(74,222,128,0.4)",
              color: "#4ade80",
            }}
          >
            {isAccepting ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Acceptation...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <Trophy className="w-3.5 h-3.5" />
                Accepter
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
