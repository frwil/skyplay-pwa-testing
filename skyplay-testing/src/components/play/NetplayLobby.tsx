"use client";

import { Circle, Loader2, Play, Wifi, WifiOff, Users } from "lucide-react";
import type { Participant } from "@/lib/emulator/netplay/hooks/usePresence";

interface NetplayLobbyProps {
  participants: Participant[];
  currentUserId: number | null;
  isParticipating: boolean;
  isSearching: boolean;
  /** Current netplay status */
  netplayStatus: string;
  onParticipate: () => void;
  onStartMatchmaking: (opponentId?: number) => void;
  onCancelMatchmaking: () => void;
}

/**
 * Inline lobby component embedded in the challenge leaderboard.
 *
 * Shows:
 * - Participant list with online/offline dots
 * - "Start Now" button when participant
 * - Matchmaking status
 */
export default function NetplayLobby({
  participants,
  currentUserId,
  isParticipating,
  isSearching,
  netplayStatus,
  onParticipate,
  onStartMatchmaking,
  onCancelMatchmaking,
}: NetplayLobbyProps) {
  const onlineParticipants = participants.filter((p) => p.isOnline && p.userId !== currentUserId);
  const allOnline = onlineParticipants.length;
  const total = participants.length;

  return (
    <div className="rounded-2xl p-4" style={{ backgroundColor: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Wifi className="w-4 h-4" style={{ color: "#4ade80" }} />
          <h4 className="text-sm font-bold text-white">Netplay</h4>
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)" }}>
          {allOnline}/{total} en ligne
        </span>
      </div>

      {/* Status messages */}
      {netplayStatus === "connecting" && (
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 mb-3" style={{ backgroundColor: "rgba(255,215,0,0.06)", border: "1px solid rgba(255,215,0,0.15)" }}>
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: "#facc15" }} />
          <span className="text-xs" style={{ color: "#facc15" }}>Connexion au pair...</span>
        </div>
      )}

      {netplayStatus === "connected" && (
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 mb-3" style={{ backgroundColor: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.15)" }}>
          <Wifi className="w-4 h-4" style={{ color: "#4ade80" }} />
          <span className="text-xs" style={{ color: "#4ade80" }}>Pair connecté !</span>
        </div>
      )}

      {netplayStatus === "countdown" && (
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 mb-3" style={{ backgroundColor: "rgba(0,200,255,0.08)", border: "1px solid rgba(0,200,255,0.2)" }}>
          <Play className="w-4 h-4" style={{ color: "#00c8ff" }} />
          <span className="text-xs" style={{ color: "#00c8ff" }}>Lancement du jeu...</span>
        </div>
      )}

      {netplayStatus === "playing" && (
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 mb-3" style={{ backgroundColor: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.2)" }}>
          <Play className="w-4 h-4" style={{ color: "#4ade80" }} />
          <span className="text-xs font-bold" style={{ color: "#4ade80" }}>Match en cours</span>
        </div>
      )}

      {netplayStatus === "error" && (
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 mb-3" style={{ backgroundColor: "rgba(253,46,95,0.08)", border: "1px solid rgba(253,46,95,0.15)" }}>
          <WifiOff className="w-4 h-4" style={{ color: "#fd2e5f" }} />
          <span className="text-xs" style={{ color: "#fd2e5f" }}>Erreur de connexion</span>
        </div>
      )}

      {/* Participant list */}
      {participants.length === 0 ? (
        <p className="text-xs py-4 text-center" style={{ color: "rgba(255,255,255,0.2)" }}>
          <Users className="w-4 h-4 mx-auto mb-1 opacity-50" />
          Aucun participant
        </p>
      ) : (
        <div className="space-y-1 mb-4">
          {participants.map((p) => (
            <div key={p.userId} className="flex items-center gap-2 rounded-lg px-3 py-1.5" style={{ backgroundColor: p.userId === currentUserId ? "rgba(0,200,255,0.04)" : "transparent" }}>
              {p.isOnline ? (
                <Circle className="w-2 h-2 fill-current shrink-0" style={{ color: "#4ade80" }} />
              ) : (
                <Circle className="w-2 h-2 shrink-0" style={{ color: "rgba(255,255,255,0.15)" }} />
              )}
              <span className="flex-1 text-xs truncate" style={{ color: p.userId === currentUserId ? "#00c8ff" : "rgba(255,255,255,0.7)" }}>
                {p.username}
                {p.userId === currentUserId && (
                  <span className="text-[9px] ml-1" style={{ color: "rgba(255,255,255,0.3)" }}>(toi)</span>
                )}
              </span>
              <span className="text-[9px] font-medium" style={{ color: p.isOnline ? "rgba(74,222,128,0.7)" : "rgba(255,255,255,0.25)" }}>
                {p.isOnline ? "Online" : "Offline"}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Action */}
      {currentUserId && !isParticipating && (
        <button
          onClick={onParticipate}
          className="w-full rounded-xl px-4 py-2.5 text-xs font-bold flex items-center justify-center gap-2 transition"
          style={{ backgroundColor: "rgba(0,200,255,0.12)", border: "1px solid rgba(0,200,255,0.2)", color: "#00c8ff" }}
        >
          <Play className="w-3.5 h-3.5" />
          Participer au challenge
        </button>
      )}

      {isParticipating && !isSearching && netplayStatus !== "playing" && (
        <button
          onClick={() => onStartMatchmaking()}
          className="w-full rounded-xl px-4 py-2.5 text-xs font-bold flex items-center justify-center gap-2 transition"
          style={{ backgroundColor: "rgba(0,200,255,0.12)", border: "1px solid rgba(0,200,255,0.2)", color: "#00c8ff" }}
        >
          <Play className="w-3.5 h-3.5" />
          Start Now
        </button>
      )}

      {isSearching && (
        <button
          onClick={onCancelMatchmaking}
          className="w-full rounded-xl px-4 py-2.5 text-xs font-bold flex items-center justify-center gap-2 transition"
          style={{ backgroundColor: "rgba(255,215,0,0.08)", border: "1px solid rgba(255,215,0,0.2)", color: "#facc15" }}
        >
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Recherche... (annuler)
        </button>
      )}
    </div>
  );
}
