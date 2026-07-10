"use client";

import { useTranslation } from "@/lib/i18n/TranslationContext";
import { Trophy, LogOut } from "lucide-react";

/**
 * Blocking full-screen overlay shown to the remaining player when the opponent leaves a
 * match mid-combat (voluntary or network drop). The opponent has already forfeited server-side
 * (a `player_disconnected` event) and the local client has posted the forfeit win; this overlay
 * freezes the view for a short countdown, then auto-returns to the Cage. Being full-screen and
 * blocking, it is the "game freezes for you" the spec asks for.
 */
export default function DuelAbandonOverlay({
  countdown,
  onExit,
}: {
  countdown: number;
  onExit: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(3,4,12,0.9)", backdropFilter: "blur(8px)" }}
    >
      <div
        className="w-full max-w-md rounded-3xl border p-8 flex flex-col items-center gap-4 text-center"
        style={{
          backgroundColor: "rgba(13,15,28,0.97)",
          borderColor: "rgba(52,211,153,0.3)",
          boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
        }}
      >
        <div
          className="flex h-14 w-14 items-center justify-center rounded-2xl"
          style={{ backgroundColor: "rgba(52,211,153,0.15)" }}
        >
          <Trophy size={28} style={{ color: "#34d399" }} />
        </div>
        <h2 className="text-xl font-bold text-white">{t.duel.abandonTitle}</h2>
        <p className="text-base font-semibold" style={{ color: "#34d399" }}>
          {t.duel.abandonWin}
        </p>
        <p className="text-sm text-white/60">{t.duel.abandonDesc}</p>
        <p className="text-xs text-white/40">{t.duel.redirectingIn(countdown)}</p>
        <button
          onClick={onExit}
          className="mt-2 flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 font-semibold text-white transition-transform hover:scale-[1.02]"
          style={{ background: "linear-gradient(135deg,#34d399,#059669)" }}
        >
          <LogOut size={16} /> {t.duel.newDuel}
        </button>
      </div>
    </div>
  );
}
