"use client";

import { Swords, Clock, Loader2 } from "lucide-react";
import type { DuelPlayer } from "@/lib/emulator/hooks/useDuelLobby";
import { useTranslation } from "@/lib/i18n/TranslationContext";
import PlayerBadge from "@/components/PlayerBadge";

interface DuelLobbyProps {
  players: DuelPlayer[];
  inLobby: boolean;
  isSending: boolean;
  onChallenge: (targetUserId: number) => void;
  onJoinLobby: () => void;
  /** Whether the local player can afford the duel stake (admins always can). */
  canChallenge: boolean;
  /** Entry fee (SKY) per player, shown as the stake notice. */
  entryFee: number;
  /** Local player's SKY balance; null when unlimited (admin) or unknown. */
  balance: number | null;
  /** True for admins (unlimited SKY → shown as ∞). */
  unlimitedSky: boolean;
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
  canChallenge,
  entryFee,
  balance,
  unlimitedSky,
}: DuelLobbyProps) {
  const { t } = useTranslation();
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
            {t.duel.lobbyTitle}
          </h2>
          <p className="text-xs text-white/30 mt-1">
            {t.duel.lobbySubtitle}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* SKY balance + stake notice */}
          <div className="flex flex-col items-end">
            <span
              className="rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums"
              style={{ backgroundColor: "rgba(96,165,250,0.15)", color: "#93c5fd", border: "1px solid rgba(96,165,250,0.3)" }}
            >
              {unlimitedSky ? "∞" : (balance ?? "—")} SKY
            </span>
            <span className="text-[9px] text-white/30 mt-0.5">{t.duel.entryFeeNotice(entryFee)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{
                backgroundColor: inLobby ? "#4ade80" : "rgba(255,255,255,0.2)",
              }}
            />
            <span className="text-xs text-white/40">
              {inLobby ? t.duel.lobbyPlayers(players.length) : t.duel.lobbyNotJoined}
            </span>
          </div>
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
            {t.duel.lobbyJoin}
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
            {t.duel.lobbyJoinAction}
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
            {t.duel.lobbyWaiting}
          </p>
          <p className="text-xs text-white/15 mt-1">
            {t.duel.lobbyWaitingHint}
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
              canChallenge={canChallenge}
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
  canChallenge,
  onChallenge,
}: {
  player: DuelPlayer;
  isSending: boolean;
  canChallenge: boolean;
  onChallenge: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-3"
      style={{
        backgroundColor: "rgba(255,255,255,0.03)",
        borderColor: "rgba(255,255,255,0.08)",
      }}
    >
      <div className="flex items-center gap-3">
        <PlayerBadge
          username={player.username}
          avatar={player.avatar}
          country={player.country}
          size={40}
          hideName
        />
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
        disabled={isSending || !canChallenge}
        title={!canChallenge ? t.duel.insufficientSky : undefined}
        className="w-full py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          backgroundColor: "rgba(241,91,181,0.12)",
          border: "1px solid rgba(241,91,181,0.25)",
          color: "#f15bb5",
        }}
      >
        <Swords className="w-3 h-3 inline mr-1.5" />
        {canChallenge ? t.duel.lobbyChallenge : t.duel.insufficientSky}
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
