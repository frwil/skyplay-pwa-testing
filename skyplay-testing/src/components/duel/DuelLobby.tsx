"use client";

import { Swords, User, Clock, Loader2 } from "lucide-react";
import type { DuelPlayer } from "@/lib/emulator/hooks/useDuelLobby";

interface DuelLobbyProps {
  players: DuelPlayer[];
  inLobby: boolean;
  isSending: boolean;
  onChallenge: (targetUserId: number) => void;
  onJoinLobby: () => void;
}

/**
 * Displays players currently waiting in the duel lobby.
 * Each player card has a "Challenge" button.
 */
export default function DuelLobby({
  players,
  inLobby,
  isSending,
  onChallenge,
  onJoinLobby,
}: DuelLobbyProps) {
  return (
    <div
      className="rounded-2xl border p-6"
      style={{
        backgroundColor: "rgba(13,27,46,0.7)",
        borderColor: "rgba(255,255,255,0.08)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Swords className="w-5 h-5" style={{ color: "#f15bb5" }} />
            Duel Lobby
          </h2>
          <p className="text-xs text-white/30 mt-1">
            Players waiting for a KOF &apos;98 duel
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full"
            style={{
              backgroundColor: inLobby ? "#4ade80" : "rgba(255,255,255,0.2)",
            }}
          />
          <span className="text-xs text-white/40">
            {inLobby ? `${players.length + 1} in lobby` : "Not joined"}
          </span>
        </div>
      </div>

      {/* Not in lobby yet */}
      {!inLobby && (
        <div className="text-center py-8">
          <Swords
            className="w-10 h-10 mx-auto mb-3"
            style={{ color: "rgba(241,91,181,0.3)" }}
          />
          <p className="text-sm text-white/30 mb-4">
            Join the lobby to find opponents
          </p>
          <button
            onClick={onJoinLobby}
            className="px-6 py-3 rounded-xl text-sm font-bold transition-all"
            style={{
              backgroundColor: "rgba(241,91,181,0.15)",
              border: "1px solid rgba(241,91,181,0.3)",
              color: "#f15bb5",
            }}
          >
            <Swords className="w-4 h-4 inline mr-2" />
            Join Lobby
          </button>
        </div>
      )}

      {/* In lobby — players list */}
      {inLobby && players.length === 0 && (
        <div className="text-center py-8">
          <Loader2
            className="w-8 h-8 mx-auto mb-3 animate-spin"
            style={{ color: "rgba(255,255,255,0.15)" }}
          />
          <p className="text-sm text-white/25">
            Waiting for players...
          </p>
          <p className="text-xs text-white/15 mt-1">
            Open this page in another tab or share the link
          </p>
        </div>
      )}

      {/* Player cards */}
      {inLobby && players.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {players.map((player) => (
            <DuelPlayerCard
              key={player.userId}
              player={player}
              isSending={isSending}
              onChallenge={() => onChallenge(player.userId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DuelPlayerCard({
  player,
  isSending,
  onChallenge,
}: {
  player: DuelPlayer;
  isSending: boolean;
  onChallenge: () => void;
}) {
  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-3"
      style={{
        backgroundColor: "rgba(255,255,255,0.03)",
        borderColor: "rgba(255,255,255,0.08)",
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center"
          style={{
            backgroundColor: "rgba(241,91,181,0.1)",
            border: "1px solid rgba(241,91,181,0.2)",
          }}
        >
          <User className="w-5 h-5" style={{ color: "#f15bb5" }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white truncate">
            {player.username}
          </p>
          <p className="text-[10px] text-white/30 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatTimeAgo(player.createdAt)}
          </p>
        </div>
      </div>

      <button
        onClick={onChallenge}
        disabled={isSending}
        className="w-full py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-40"
        style={{
          backgroundColor: "rgba(241,91,181,0.12)",
          border: "1px solid rgba(241,91,181,0.25)",
          color: "#f15bb5",
        }}
      >
        <Swords className="w-3 h-3 inline mr-1.5" />
        Challenge
      </button>
    </div>
  );
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}
