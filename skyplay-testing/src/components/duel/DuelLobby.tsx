"use client";

import { useState, useEffect } from "react";
import { Swords, Clock, Loader2, Radio, Copy, Check } from "lucide-react";
import type { DuelPlayer } from "@/lib/emulator/hooks/useDuelLobby";
import { useTranslation } from "@/lib/i18n/TranslationContext";
import { getStreamKey, setStreamKey } from "@/lib/emulator/streamKey";
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
  /** Currently selected game label (e.g. "KOF '98"). */
  gameLabel?: string;
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
  gameLabel,
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
            {t.duel.lobbySubtitle(gameLabel ?? "KOF '98")}
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

      {/* Not in lobby yet — show join button + paste invite link */}
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
          <div className="mt-6 pt-5 border-t border-white/5">
            <p className="text-xs text-white/20 mb-2">
              {t.duel.lobbyPasteInvite ?? "Ou colle un lien d'invitation :"}
            </p>
            <InvitePasteField onJoin={onJoinLobby} />
          </div>
        </div>
      )}

      {/* In lobby — players list */}
      {inLobby && (
        <>
          <StreamKeyField />
          {/* Always show the shareable link so it's available even with players present */}
          <div className="mb-4">
            <ShareLink />
          </div>
          {players.length === 0 ? (
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
          ) : (
            <PlayerList
              players={players}
              isSending={isSending}
              canChallenge={canChallenge}
              onChallenge={onChallenge}
            />
          )}
        </>
      )}
    </div>
  );
}

/** Player list with a search filter — essential when the lobby has dozens of players. */
function PlayerList({
  players,
  isSending,
  canChallenge,
  onChallenge,
}: {
  players: DuelPlayer[];
  isSending: boolean;
  canChallenge: boolean;
  onChallenge: (userId: number) => void;
}) {
  const [filter, setFilter] = useState("");
  const { t } = useTranslation();

  const lower = filter.toLowerCase().trim();
  const filtered = lower
    ? players.filter((p) => p.username.toLowerCase().includes(lower))
    : players;

  return (
    <>
      {/* Search filter */}
      <div className="mb-3">
        <input
          type="text"
          placeholder={t.duel.lobbyFilterPlaceholder ?? "Filtrer par pseudo..."}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white/60 outline-none focus:border-white/20 placeholder:text-white/15"
        />
      </div>

      {/* Filtered player cards */}
      {filtered.length === 0 ? (
        <p className="text-center text-xs text-white/20 py-6">
          {filter
            ? (t.duel.lobbyNoMatch ?? "Aucun joueur ne correspond à ce filtre")
            : (t.duel.lobbyWaiting ?? "En attente de joueurs...")}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((player) => (
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
      {filter && filtered.length > 0 && (
        <p className="text-[10px] text-white/20 text-center mt-2">
          {filtered.length} / {players.length} joueur{players.length > 1 ? "s" : ""} visible{players.length > 1 ? "s" : ""}
        </p>
      )}
    </>
  );
}

/** Paste field for invite links — always visible so anyone can join at any time. */
function InvitePasteField({ onJoin }: { onJoin: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState<"idle" | "joining" | "ok">("idle");

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0 && status !== "joining";

  const handlePaste = async () => {
    setError("");
    setStatus("joining");
    if (!trimmed) { setStatus("idle"); return; }

    try {
      const url = new URL(trimmed);
      // Only accept same-origin URLs for security
      if (url.origin !== window.location.origin) {
        setError("Ce lien ne vient pas de SkyPlay");
        setStatus("idle");
        return;
      }
      // Navigate to the path (e.g. /duel) and join
      if (url.pathname !== window.location.pathname) {
        window.location.href = url.pathname + url.search;
        return; // page unloads
      }
      // Already on the right page — just join
      await onJoin();
      setStatus("ok");
      setValue("");
      setTimeout(() => setStatus("idle"), 2500);
    } catch {
      setError("Lien invalide");
      setStatus("idle");
    }
  };

  return (
    <div className="inline-flex flex-col items-center gap-1.5">
      <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
        <input
          type="text"
          placeholder="https://..."
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(""); setStatus("idle"); }}
          onKeyDown={(e) => { if (e.key === "Enter" && canSubmit) handlePaste(); }}
          className="bg-transparent text-xs text-white/50 outline-none w-52 placeholder:text-white/15"
        />
        <button
          onClick={handlePaste}
          disabled={!canSubmit}
          className="shrink-0 px-3 py-1 rounded text-xs font-bold transition-all"
          style={status === "ok"
            ? { backgroundColor: "rgba(34,197,94,0.2)", border: "1px solid rgba(34,197,94,0.35)", color: "#22c55e" }
            : canSubmit
              ? { backgroundColor: "rgba(0,200,255,0.2)", border: "1px solid rgba(0,200,255,0.35)", color: "#00c8ff" }
              : { backgroundColor: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.15)", cursor: "not-allowed" }
          }
        >
          {status === "joining" ? "..." : status === "ok" ? "✓" : "Go"}
        </button>
      </div>
      {error && <span className="text-[10px] text-red-400/70">{error}</span>}
      {status === "ok" && (
        <span className="text-[10px] text-green-400/70">Lobby rejoint ! Tu apparais dans la cage.</span>
      )}
    </div>
  );
}

/** Small copyable link shown when the lobby is empty so the user can share it. */
function ShareLink() {
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState("");

  useEffect(() => {
    setUrl(window.location.href);
  }, []);

  if (!url) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: select the input text
    }
  };

  return (
    <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2 max-w-full">
      <input
        type="text"
        readOnly
        value={url}
        onClick={(e) => (e.target as HTMLInputElement).select()}
        className="bg-transparent text-xs text-white/50 outline-none truncate min-w-0"
        style={{ maxWidth: "280px" }}
      />
      <button
        onClick={copy}
        className="shrink-0 p-1 rounded hover:bg-white/10 transition-colors"
        title="Copier le lien"
      >
        {copied
          ? <Check className="w-3.5 h-3.5 text-green-400" />
          : <Copy className="w-3.5 h-3.5 text-white/30" />
        }
      </button>
    </div>
  );
}

/**
 * Plan A (MVP) — paste-key field for a live RTMP broadcast. Self-contained: it reads/writes the
 * module-level stream-key registry (src/lib/emulator/streamKey) that CloudAdapter consults when
 * building the WS init message. Fully inert unless a host pastes a URL AND the game-server has
 * STREAMING_ENABLED=1 (after a Docker rebuild).
 */
function StreamKeyField() {
  const { t } = useTranslation();
  const [open, setOpen] = useState<boolean>(() => !!getStreamKey());
  const [value, setValue] = useState<string>(() => getStreamKey() ?? "");
  const active = !!getStreamKey();

  return (
    <div
      className="mb-4 rounded-xl border p-3"
      style={{ backgroundColor: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)" }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="flex items-center gap-2 text-xs font-bold text-white/70">
          <Radio className="w-3.5 h-3.5" style={{ color: active ? "#ef4444" : "rgba(255,255,255,0.4)" }} />
          {t.duel.streamTitle}
        </span>
        {active && (
          <span className="text-[10px] font-bold" style={{ color: "#ef4444" }}>● {t.duel.streamActive}</span>
        )}
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-[10px] text-white/30">{t.duel.streamHint}</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t.duel.streamPlaceholder}
              className="flex-1 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none"
              style={{ backgroundColor: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.1)" }}
            />
            <button
              onClick={() => setStreamKey(value)}
              className="rounded-lg px-3 py-1.5 text-xs font-bold text-white transition"
              style={{ backgroundColor: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.35)", color: "#f87171" }}
            >
              {t.duel.streamSave}
            </button>
            <button
              onClick={() => { setValue(""); setStreamKey(null); }}
              className="rounded-lg px-3 py-1.5 text-xs font-bold transition"
              style={{ backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)" }}
            >
              {t.duel.streamClear}
            </button>
          </div>
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
