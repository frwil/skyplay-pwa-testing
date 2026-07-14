"use client";

import { Trophy, Zap, Crown } from "lucide-react";
import { useTranslation } from "@/lib/i18n/TranslationContext";
import type { ResolvedDuelGame } from "@/lib/duel/useDuelGames";

interface DuelGameMode {
  id: string;
  modeKey: string;
  label: string;
  matchCount: number;
  entryFee: number;
}

interface DuelModeSelectorProps {
  modes: DuelGameMode[];
  selectedModeId: string;
  onSelect: (modeId: string) => void;
  game: ResolvedDuelGame;
}

/** Visual definition for each mode key. */
const MODE_DEFS: Record<string, { icon: React.ReactNode; color: string; bg: string; ring: string }> = {
  standard: {
    icon: <Trophy className="w-8 h-8" />,
    color: "#4ade80",
    bg: "rgba(74,222,128,0.08)",
    ring: "rgba(74,222,128,0.3)",
  },
  xl: {
    icon: <Zap className="w-8 h-8" />,
    color: "#facc15",
    bg: "rgba(250,204,21,0.08)",
    ring: "rgba(250,204,21,0.3)",
  },
  fighter: {
    icon: <Crown className="w-8 h-8" />,
    color: "#f15bb5",
    bg: "rgba(241,91,181,0.08)",
    ring: "rgba(241,91,181,0.3)",
  },
};

export default function DuelModeSelector({
  modes,
  selectedModeId,
  onSelect,
  game,
}: DuelModeSelectorProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      {/* Selected game header */}
      <div
        className="rounded-2xl border p-4 flex items-center gap-4"
        style={{
          backgroundColor: "rgba(13,27,46,0.6)",
          borderColor: "rgba(255,255,255,0.08)",
        }}
      >
        {/* Mini cover */}
        <div
          className="w-16 h-16 rounded-xl flex-shrink-0 flex items-center justify-center overflow-hidden"
          style={{
            background: game.coverImage
              ? "transparent"
              : "linear-gradient(135deg, #1a1a2e 0%, #2d1b4e 30%, #4a2060 60%, #6b2a7a 100%)",
          }}
        >
          {game.coverImage ? (
            <img
              src={game.coverImage}
              alt={game.label}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-xl font-black text-white/15">
              {game.label.charAt(0)}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-white">{game.label}</h3>
          {game.description && (
            <p className="text-[11px] text-white/35 leading-relaxed line-clamp-1 mt-0.5">
              {game.description}
            </p>
          )}
          <span className="inline-block mt-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-white/30 bg-white/5">
            {game.system}
          </span>
        </div>
      </div>

      {/* Mode cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {modes.map((mode) => {
          const def = MODE_DEFS[mode.modeKey] ?? MODE_DEFS.standard;
          const isSelected = selectedModeId === mode.id;

          return (
            <button
              key={mode.id}
              onClick={() => onSelect(mode.id)}
              className="rounded-2xl border p-5 text-left transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{
                backgroundColor: isSelected ? def.bg : "rgba(13,27,46,0.6)",
                borderColor: isSelected ? def.color : "rgba(255,255,255,0.06)",
                boxShadow: isSelected
                  ? `0 0 25px ${def.ring}`
                  : "none",
              }}
            >
              {/* Icon */}
              <div className="mb-3" style={{ color: isSelected ? def.color : "rgba(255,255,255,0.15)" }}>
                {def.icon}
              </div>

              {/* Mode name */}
              <h4
                className="text-sm font-bold mb-1"
                style={{ color: isSelected ? def.color : "rgba(255,255,255,0.7)" }}
              >
                {mode.modeKey === "standard"
                  ? (t.duel.mode?.standard ?? "Standard")
                  : mode.modeKey === "xl"
                    ? (t.duel.mode?.xl ?? "XL")
                    : (t.duel.mode?.fighter ?? "Fighter")}
              </h4>

              {/* Match count */}
              <p className="text-[11px] text-white/30 mb-2">
                {t.duel.mode?.matches?.(mode.matchCount) ?? `${mode.matchCount} match${mode.matchCount > 1 ? "es" : ""}`}
              </p>

              {/* Entry fee */}
              <div
                className="rounded-full px-3 py-1 text-xs font-bold inline-block"
                style={{
                  backgroundColor: isSelected ? `${def.color}20` : "rgba(255,255,255,0.04)",
                  color: isSelected ? def.color : "rgba(255,255,255,0.4)",
                }}
              >
                {t.duel.mode?.entryFee?.(mode.entryFee) ?? `${mode.entryFee} SKY`}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
