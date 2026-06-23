"use client";

import { useEffect, useState } from "react";
import { X, Trophy, Clock, Users, Coins, CheckCircle2, Loader2, Circle, AlertTriangle } from "lucide-react";
import AuthInlineForm from "./AuthInlineForm";
import type { Participant } from "@/lib/emulator/netplay/hooks/usePresence";

export interface ChallengeInfo {
  id: number;
  title: string;
  description: string;
  system: string;
  romName: string;
  criteria: string;
  reward: number;
  startsAt: string;
  endsAt: string;
}

interface ParticipationDialogProps {
  challenge: ChallengeInfo;
  isOpen: boolean;
  onClose: () => void;
  // Auth
  currentUserId: number | null;
  currentUsername: string | null;
  onAuthenticated: (userId: number, username: string) => void;
  // Participation
  isParticipating: boolean;
  onParticipate: () => void;
  onLeave: () => void;
  // Presence
  participants: Participant[];
  // Matchmaking
  onStartMatchmaking: (opponentId?: number) => void;
  isSearching: boolean;
  /** Error message to display inside the dialog (e.g., auth/netplay errors) */
  error?: string | null;
  /** Called to clear the error */
  onClearError?: () => void;
}

/**
 * Modal dialog shown when a user clicks on a challenge card.
 *
 * Flow:
 * 1. Not authenticated → show AuthInlineForm
 * 2. Authenticated, not participating → "Join" button + challenge info
 * 3. Participating → participants list + "Start Now"
 */
export default function ParticipationDialog({
  challenge,
  isOpen,
  onClose,
  currentUserId,
  currentUsername,
  onAuthenticated,
  isParticipating,
  onParticipate,
  onLeave,
  participants,
  onStartMatchmaking,
  isSearching,
  error,
  onClearError,
}: ParticipationDialogProps) {
  const [selectedOpponent, setSelectedOpponent] = useState<number | null>(null);

  // Reset selection when dialog opens
  useEffect(() => {
    if (isOpen) {
      setSelectedOpponent(null);
    }
  }, [isOpen]);

  // Lock body scroll
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  if (!isOpen) return null;

  const now = new Date();
  const endsIn = getTimeRemaining(new Date(challenge.endsAt), now);
  const onlineParticipants = participants.filter((p) => p.isOnline);
  const offlineParticipants = participants.filter((p) => !p.isOnline);
  const otherParticipants = participants.filter((p) => p.userId !== currentUserId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="rounded-3xl border w-full max-w-md max-h-[85vh] overflow-y-auto p-6"
        style={{ backgroundColor: "rgba(13,27,46,0.98)", borderColor: "rgba(255,255,255,0.1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h3 className="text-lg font-black text-white mb-1">{challenge.title}</h3>
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
              {challenge.romName} • {challenge.system.toUpperCase()}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: "rgba(255,255,255,0.3)" }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Challenge info bar */}
        <div className="flex items-center gap-4 text-[10px] mb-5" style={{ color: "rgba(255,255,255,0.35)" }}>
          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{endsIn}</span>
          <span className="flex items-center gap-1"><Users className="w-3 h-3" />{participants.length}</span>
          <span className="flex items-center gap-1" style={{ color: "#ffd700" }}><Coins className="w-3 h-3" />{challenge.reward} Sky</span>
        </div>

        {/* Error display */}
        {error && (
          <div className="flex items-start gap-2 rounded-xl px-3 py-2.5 mb-4" style={{ backgroundColor: "rgba(253,46,95,0.08)", border: "1px solid rgba(253,46,95,0.2)" }}>
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#fd2e5f" }} />
            <p className="text-xs font-medium" style={{ color: "#fd2e5f" }}>{error}</p>
            {onClearError && (
              <button onClick={onClearError} className="ml-auto shrink-0 p-0.5 rounded" style={{ color: "rgba(255,255,255,0.3)" }}>
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Auth section */}
        {!currentUserId && (
          <div className="mb-5">
            <p className="text-xs font-bold text-white mb-3">Connecte-toi pour participer</p>
            <AuthInlineForm
              onAuthenticated={onAuthenticated}
              currentUserId={currentUserId}
              currentUsername={currentUsername}
            />
          </div>
        )}

        {/* Participation actions */}
        {currentUserId && !isParticipating && (
          <button
            onClick={onParticipate}
            className="w-full rounded-xl px-4 py-3 text-sm font-bold flex items-center justify-center gap-2 mb-5 transition"
            style={{ backgroundColor: "rgba(0,200,255,0.15)", border: "1px solid rgba(0,200,255,0.3)", color: "#00c8ff" }}
          >
            <Trophy className="w-4 h-4" />
            Participer à ce challenge
          </button>
        )}

        {currentUserId && isParticipating && (
          <div className="mb-5">
            <div className="flex items-center gap-2 rounded-xl px-4 py-2.5 mb-4" style={{ backgroundColor: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.15)" }}>
              <CheckCircle2 className="w-4 h-4" style={{ color: "#4ade80" }} />
              <span className="text-xs font-medium" style={{ color: "#4ade80" }}>Tu participes à ce challenge</span>
              <button onClick={onLeave} className="ml-auto text-[10px] font-bold" style={{ color: "rgba(255,255,255,0.3)" }}>
                Quitter
              </button>
            </div>

            {/* Participants list */}
            {participants.length > 0 && (
              <div className="mb-4">
                <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "rgba(255,255,255,0.3)" }}>
                  Participants ({participants.length})
                </h4>

                {/* Online */}
                {onlineParticipants.filter((p) => p.userId !== currentUserId).map((p) => (
                  <div key={p.userId} className="flex items-center gap-3 rounded-xl px-4 py-2.5 mb-1.5" style={{ backgroundColor: "rgba(74,222,128,0.04)", border: "1px solid rgba(74,222,128,0.08)" }}>
                    <Circle className="w-2 h-2 fill-current" style={{ color: "#4ade80" }} />
                    <span className="flex-1 text-xs font-medium text-white truncate">{p.username}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: "rgba(74,222,128,0.1)", color: "#4ade80" }}>
                      En ligne
                    </span>
                  </div>
                ))}

                {/* Offline */}
                {offlineParticipants.filter((p) => p.userId !== currentUserId).map((p) => (
                  <div key={p.userId} className="flex items-center gap-3 rounded-xl px-4 py-2 mb-1" style={{ backgroundColor: "rgba(255,255,255,0.02)" }}>
                    <Circle className="w-2 h-2" style={{ color: "rgba(255,255,255,0.2)" }} />
                    <span className="flex-1 text-xs truncate" style={{ color: "rgba(255,255,255,0.4)" }}>{p.username}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.3)" }}>
                      Hors ligne
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Non-NES warning — netplay only supports NES */}
            {challenge.system !== "nes" && (
              <div className="flex items-start gap-2 rounded-xl px-3 py-2.5 mb-4" style={{ backgroundColor: "rgba(255,165,0,0.08)", border: "1px solid rgba(255,165,0,0.2)" }}>
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#ffa500" }} />
                <div>
                  <p className="text-xs font-bold" style={{ color: "#ffa500" }}>Netplay non disponible</p>
                  <p className="text-[10px] mt-0.5" style={{ color: "rgba(255,165,0,0.7)" }}>
                    Le mode P2P temps réel ne fonctionne qu'avec des jeux NES. Ce challenge est sur {challenge.system.toUpperCase()}.
                  </p>
                </div>
              </div>
            )}

            {/* No other participants */}
            {otherParticipants.length === 0 && (
              <p className="text-xs text-center py-3" style={{ color: "rgba(255,255,255,0.2)" }}>
                Aucun autre participant pour le moment
              </p>
            )}

            {/* Opponent selection */}
            {onlineParticipants.filter((p) => p.userId !== currentUserId).length > 0 && (
              <div className="mb-4">
                <label className="text-[10px] font-bold uppercase tracking-wider mb-2 block" style={{ color: "rgba(255,255,255,0.4)" }}>
                  Choisis ton adversaire
                </label>
                <div className="space-y-1.5">
                  {onlineParticipants
                    .filter((p) => p.userId !== currentUserId)
                    .map((p) => (
                      <button
                        key={p.userId}
                        onClick={() => setSelectedOpponent(p.userId === selectedOpponent ? null : p.userId)}
                        className={`w-full flex items-center gap-3 rounded-xl px-4 py-2.5 text-left transition ${
                          selectedOpponent === p.userId ? "" : ""
                        }`}
                        style={selectedOpponent === p.userId
                          ? { backgroundColor: "rgba(0,200,255,0.08)", border: "1px solid rgba(0,200,255,0.25)" }
                          : { backgroundColor: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }
                        }
                      >
                        <Circle className="w-2 h-2 fill-current" style={{ color: "#4ade80" }} />
                        <span className="flex-1 text-xs font-medium text-white">{p.username}</span>
                        {selectedOpponent === p.userId && (
                          <CheckCircle2 className="w-4 h-4" style={{ color: "#00c8ff" }} />
                        )}
                      </button>
                    ))}
                </div>
              </div>
            )}

            {/* Start Now button — only for NES */}
            {challenge.system === "nes" ? (
              <button
                onClick={() => onStartMatchmaking(selectedOpponent ?? undefined)}
                disabled={isSearching}
                className="w-full rounded-xl px-4 py-3 text-sm font-bold flex items-center justify-center gap-2 transition disabled:opacity-50"
                style={{ backgroundColor: "rgba(0,200,255,0.15)", border: "1px solid rgba(0,200,255,0.3)", color: "#00c8ff" }}
              >
                {isSearching ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Recherche d'un adversaire...
                  </>
                ) : (
                  <>
                    <Trophy className="w-4 h-4" />
                    {selectedOpponent ? "Défier cet adversaire" : "Start Now"}
                  </>
                )}
              </button>
            ) : (
              <div className="text-center py-2">
                <p className="text-[11px] font-medium" style={{ color: "rgba(255,165,0,0.6)" }}>
                  P2P uniquement disponible sur NES
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function getTimeRemaining(end: Date, now: Date): string {
  const diff = end.getTime() - now.getTime();
  if (diff <= 0) return "Terminé";

  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);

  if (days > 0) return `${days}j ${hours}h`;
  if (hours > 0) return `${hours}h`;
  return `${Math.floor(diff / 60000)}m`;
}
