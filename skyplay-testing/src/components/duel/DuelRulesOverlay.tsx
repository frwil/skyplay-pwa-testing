"use client";

import { useState } from "react";
import { Swords, AlertTriangle, Check } from "lucide-react";
import { useTranslation } from "@/lib/i18n/TranslationContext";

export interface DuelRulesOverlayRules {
  victoryRule: string;
  drawRule: string;
  debitRule: string;
  disputeRule: string;
}

export interface DuelRulesOverlayProps {
  /** e.g. "KOF '98" */
  gameLabel: string;
  /** e.g. "XL", "Fighter" */
  modeLabel: string;
  /** Total number of matches (1, 3, 5) */
  matchCount: number;
  /** Entry fee in SKY per player */
  entryFee: number;
  /** Opponent's display name */
  opponentName: string;
  /** Rules from DB (multilingual, keyed by locale). Falls back to i18n if null. */
  modeRules: Record<string, DuelRulesOverlayRules> | null;
  onAccept: () => void;
  onDecline: () => void;
  isAccepting: boolean;
  isDeclining: boolean;
  /** True when this player confirmed first — overlay stays but button is disabled. */
  isWaiting: boolean;
  error: string | null;
}

/**
 * Full-screen overlay shown after a duel challenge is accepted.
 * Both players must check the "I've read the rules" box and confirm
 * before the match session is created.
 */
export default function DuelRulesOverlay({
  gameLabel,
  modeLabel,
  matchCount,
  entryFee,
  opponentName,
  modeRules,
  onAccept,
  onDecline,
  isAccepting,
  isDeclining,
  isWaiting,
  error,
}: DuelRulesOverlayProps) {
  const { t, locale } = useTranslation();
  const [checked, setChecked] = useState(false);

  // Resolve rules: prefer DB rules for the current locale, fall back to i18n
  const dbRules = modeRules?.[locale] ?? modeRules?.["en"] ?? null;
  const rules = {
    victoryRule: dbRules?.victoryRule ?? t.duel.rules?.victoryRule ?? `The winner is the one who wins the most matches out of ${matchCount}`,
    drawRule: dbRules?.drawRule ?? t.duel.rules?.drawRule ?? "In case of a perfect tie, both players lose their entry fee",
    debitRule: dbRules?.debitRule ?? t.duel.rules?.debitRule ?? "The entry fee is only deducted when the fight actually starts",
    disputeRule: dbRules?.disputeRule ?? t.duel.rules?.disputeRule ?? "In case of a dispute, you can open a claim from the history",
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[115] p-4"
      style={{ backgroundColor: "rgba(5,10,20,0.92)", backdropFilter: "blur(12px)" }}
    >
      <div
        className="rounded-3xl border p-8 w-full max-w-lg"
        style={{
          backgroundColor: "rgba(13,27,46,0.95)",
          borderColor: "rgba(241,91,181,0.25)",
          boxShadow: "0 0 80px rgba(241,91,181,0.08)",
        }}
      >
        {/* Header */}
        <div className="text-center mb-6">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{
              backgroundColor: "rgba(241,91,181,0.1)",
              border: "2px solid rgba(241,91,181,0.3)",
            }}
          >
            <Swords className="w-8 h-8" style={{ color: "#f15bb5" }} />
          </div>
          <h2 className="text-xl font-bold text-white mb-1">
            {t.duel.rules?.title ?? "Règles du duel"}
          </h2>
          <p className="text-sm text-white/50">
            {gameLabel} — {modeLabel} ({matchCount} match{matchCount > 1 ? "s" : ""})
          </p>
          <p className="text-xs text-white/30 mt-1">
            {t.duel.rules?.vs ?? "vs"} <span className="text-white/60 font-semibold">{opponentName}</span>
          </p>
        </div>

        {/* Participation */}
        <div
          className="rounded-xl border p-3 mb-4 text-center"
          style={{
            backgroundColor: "rgba(0,200,255,0.05)",
            borderColor: "rgba(0,200,255,0.15)",
          }}
        >
          <span className="text-sm font-bold" style={{ color: "#00c8ff" }}>
            {t.duel.rules?.participation ?? "Participation"}: {entryFee} SKY
          </span>
          <span className="text-xs text-white/30 block mt-0.5">
            {t.duel.rules?.perPlayer ?? "par joueur"}
          </span>
        </div>

        {/* Rules list */}
        <div className="space-y-3 mb-6">
          <RuleItem icon="🏆" text={rules.victoryRule} />
          <RuleItem icon="🤝" text={rules.drawRule} />
          <RuleItem icon="💰" text={rules.debitRule} />
          <RuleItem icon="⚖️" text={rules.disputeRule} />
        </div>

        {/* Checkbox */}
        <label
          className="flex items-start gap-3 p-3 rounded-xl border cursor-pointer mb-6 transition-all"
          style={{
            backgroundColor: checked ? "rgba(241,91,181,0.08)" : "rgba(255,255,255,0.02)",
            borderColor: checked ? "rgba(241,91,181,0.3)" : "rgba(255,255,255,0.1)",
          }}
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 accent-[#f15bb5]"
          />
          <span className="text-xs text-white/70 leading-relaxed">
            {t.duel.rules?.checkbox ?? "J'ai lu et j'accepte les règles du duel"}
          </span>
        </label>

        {/* Error */}
        {error && (
          <div
            className="flex items-center gap-2 p-3 rounded-xl border mb-4"
            style={{
              backgroundColor: "rgba(253,46,95,0.08)",
              borderColor: "rgba(253,46,95,0.2)",
            }}
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: "#fd2e5f" }} />
            <span className="text-xs text-red-300">{error}</span>
          </div>
        )}

        {/* Waiting state banner */}
        {isWaiting && (
          <div
            className="flex items-center justify-center gap-2 p-3 rounded-xl border mb-4"
            style={{
              backgroundColor: "rgba(250,204,21,0.06)",
              borderColor: "rgba(250,204,21,0.2)",
            }}
          >
            <span className="w-4 h-4 rounded-full animate-spin" style={{ border: "2px solid", borderRightColor: "rgba(250,204,21,0.5)", borderBottomColor: "rgba(250,204,21,0.5)", borderLeftColor: "rgba(250,204,21,0.5)", borderTopColor: "transparent" }} />
            <span className="text-xs text-yellow-200/70">
              En attente de la confirmation de l'adversaire...
            </span>
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onDecline}
            disabled={isDeclining || isWaiting}
            className="flex-1 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
            style={{
              backgroundColor: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "rgba(255,255,255,0.5)",
            }}
          >
            {t.duel.rules?.decline ?? "Refuser"}
          </button>
          <button
            onClick={onAccept}
            disabled={!checked || isAccepting || isWaiting}
            className="flex-1 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            style={{
              backgroundColor: checked && !isWaiting ? "rgba(241,91,181,0.15)" : "rgba(241,91,181,0.05)",
              border: checked && !isWaiting ? "1px solid rgba(241,91,181,0.35)" : "1px solid rgba(241,91,181,0.15)",
              color: checked && !isWaiting ? "#f15bb5" : "rgba(241,91,181,0.3)",
            }}
          >
            {isWaiting ? (
              <span className="w-4 h-4 mr-1 inline-block align-middle rounded-full animate-spin" style={{ border: "2px solid", borderRightColor: "rgba(241,91,181,0.3)", borderBottomColor: "rgba(241,91,181,0.3)", borderLeftColor: "rgba(241,91,181,0.3)", borderTopColor: "transparent" }} />
            ) : isAccepting ? (
              <span className="w-4 h-4 rounded-full animate-spin" style={{ border: "2px solid", borderRightColor: "rgba(241,91,181,0.4)", borderBottomColor: "rgba(241,91,181,0.4)", borderLeftColor: "rgba(241,91,181,0.4)", borderTopColor: "transparent" }} />
            ) : (
              <Check className="w-4 h-4" />
            )}
            {isWaiting ? "En attente..." : (t.duel.rules?.accept ?? "Accepter")}
          </button>
        </div>
      </div>
    </div>
  );
}

function RuleItem({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-lg flex-shrink-0 w-6 text-center">{icon}</span>
      <p className="text-xs text-white/60 leading-relaxed">{text}</p>
    </div>
  );
}
