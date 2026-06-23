"use client";

import { Trophy, XCircle, Check } from "lucide-react";

interface DisconnectResultDialogProps {
  /** "win" = this player won by disconnect, "loss" = they were disconnected. */
  result: "win" | "loss";
  onClose: () => void;
}

/**
 * Full-screen overlay shown when the netplay match ends due to a disconnect.
 *
 * - Win: "Victoire ! L'adversaire s'est déconnecté"
 * - Loss: "Défaite — vous avez été déconnecté"
 */
export default function DisconnectResultDialog({
  result,
  onClose,
}: DisconnectResultDialogProps) {
  const isWin = result === "win";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="rounded-3xl border p-8 w-full max-w-sm mx-4 text-center"
        style={{
          backgroundColor: "rgba(13,27,46,0.95)",
          borderColor: isWin
            ? "rgba(74,222,128,0.2)"
            : "rgba(253,46,95,0.2)",
          boxShadow: isWin
            ? "0 0 60px rgba(74,222,128,0.1)"
            : "0 0 60px rgba(253,46,95,0.1)",
        }}
      >
        {/* Icon */}
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{
            backgroundColor: isWin
              ? "rgba(74,222,128,0.1)"
              : "rgba(253,46,95,0.1)",
            border: isWin
              ? "2px solid rgba(74,222,128,0.4)"
              : "2px solid rgba(253,46,95,0.4)",
          }}
        >
          {isWin ? (
            <Trophy className="w-7 h-7" style={{ color: "#4ade80" }} />
          ) : (
            <XCircle className="w-7 h-7" style={{ color: "#fd2e5f" }} />
          )}
        </div>

        {/* Title */}
        <h2
          className="text-xl font-black mb-1"
          style={{ color: isWin ? "#4ade80" : "#fd2e5f" }}
        >
          {isWin ? "Victoire !" : "Défaite"}
        </h2>

        <p className="text-sm mb-6" style={{ color: "rgba(255,255,255,0.5)" }}>
          {isWin
            ? "L'adversaire s'est déconnecté. Vous remportez le match !"
            : "Vous avez été déconnecté. L'adversaire remporte le match."}
        </p>

        {/* Continue button */}
        <button
          onClick={onClose}
          className="w-full rounded-xl px-4 py-3 text-sm font-bold transition-all"
          style={{
            backgroundColor: isWin
              ? "rgba(74,222,128,0.15)"
              : "rgba(253,46,95,0.1)",
            border: isWin
              ? "1px solid rgba(74,222,128,0.4)"
              : "1px solid rgba(253,46,95,0.3)",
            color: isWin ? "#4ade80" : "#fd2e5f",
          }}
        >
          <span className="flex items-center justify-center gap-2">
            <Check className="w-3.5 h-3.5" />
            Continuer
          </span>
        </button>
      </div>
    </div>
  );
}
