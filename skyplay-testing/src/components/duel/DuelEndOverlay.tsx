"use client";

import { useState } from "react";
import type { DuelMatchResult } from "@/lib/emulator/types";
import { charName } from "@/lib/emulator/kof98Characters";
import { useTranslation } from "@/lib/i18n/TranslationContext";
import type { Dictionary } from "@/lib/i18n/types";
import AnimatedNumber from "./AnimatedNumber";
import PlayerBadge from "@/components/PlayerBadge";
import { Swords, Trophy, Loader2, Check, X, Minus, ChevronDown, ChevronUp } from "lucide-react";

export type RevengePhase = "stats" | "requesting" | "incoming" | "declined";

/** Minimal player identity for badges (avatar + nationality). */
export interface PlayerProfile {
  username: string;
  avatar: string | null;
  country: string | null;
}

/** One player's SKY movement for this match, used by the animated balance row. */
export interface BalanceMove {
  /** Pre-match balance (null when unlimited/unknown). */
  before: number | null;
  /** Post-settlement balance (null when unlimited). */
  after: number | null;
  /** Net session movement (−1000 stake / +500 win / −1000 draw); 0 for admins. */
  delta: number;
  /** True for admins (unlimited SKY). */
  unlimited: boolean;
}

interface DuelEndOverlayProps {
  result: DuelMatchResult;
  matchHistory: DuelMatchResult[];
  /** The local player's side (1 = host/P1, 2 = guest/P2). */
  localSide: 1 | 2;
  isWinner: boolean;
  sessionId: string;
  phase: RevengePhase;
  countdown: number;
  /** Entry fee (SKY) required to (re)play — used to gate the revenge/accept buttons. */
  entryFee: number;
  /** Local player's SKY balance after this match's settlement; null when unlimited/unknown. */
  localBalance: number | null;
  /** True for admins (unlimited SKY). */
  unlimitedSky: boolean;
  /** Whether the local player can afford a rematch (admins always can). */
  canRematch: boolean;
  /** Post-settlement balances for the animated balance row; null until the result POST resolves. */
  settlement?: { you: BalanceMove | null; opp: BalanceMove | null } | null;
  /** Local + opponent player profiles (avatar/nationality) for the team badges. */
  youProfile?: PlayerProfile;
  oppProfile?: PlayerProfile;
  onRequestRevenge: () => void;
  onAcceptRevenge: () => void;
  onDeclineRevenge: () => void;
  onExit: () => void;
}

/**
 * Ordered roster for display: the full team (3 slots — reliable) ordered by the
 * known selection order first, then any remaining roster characters. Selection
 * order is only applied when known (it fills in as players enter rounds).
 */
function orderedRoster(team?: number[], select?: number[]): number[] {
  const roster = (team || []).filter((id) => id >= 0x00 && id <= 0x25);
  const order = (select || []).filter((id) => id >= 0x00 && id <= 0x25);
  if (!order.length) return roster;
  const seen = new Set(order);
  return [...order, ...roster.filter((id) => !seen.has(id))];
}

/**
 * Blocking full-screen end-of-match overlay for PvP duels. Shows the finished
 * match's teams (roster + per-character round wins) + gauge mode + perfect KOs,
 * a countdown, and the revenge flow. A draw match (winner === 0) has no revenge —
 * both players lose and auto-return to the Cage after the countdown. Real input
 * blocking is enforced server-side (matchInputLocked + paused emulator).
 */
export default function DuelEndOverlay({
  result, matchHistory, localSide, isWinner,
  phase, countdown, entryFee, localBalance, unlimitedSky, canRematch, settlement,
  youProfile, oppProfile,
  onRequestRevenge, onAcceptRevenge, onDeclineRevenge, onExit,
}: DuelEndOverlayProps) {
  const { t } = useTranslation();
  const [showDetails, setShowDetails] = useState(false);

  const isDraw = result.winner === 0;
  const p1Wins = matchHistory.filter((r) => r.winner === 1).length;
  const p2Wins = matchHistory.filter((r) => r.winner === 2).length;
  const youWins = localSide === 1 ? p1Wins : p2Wins;
  const oppWins = localSide === 1 ? p2Wins : p1Wins;
  const totalPerfectKos = matchHistory.reduce((s, r) => s + (r.perfectKos || 0), 0);

  const headColor = isDraw ? "#fbbf24" : isWinner ? "#34d399" : "#f87171";
  const headBg = isDraw ? "rgba(251,191,36,0.12)" : isWinner ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.12)";

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(3,4,12,0.82)", backdropFilter: "blur(6px)" }}
    >
      <div
        className="w-full max-w-lg rounded-3xl border p-6 flex flex-col gap-5"
        style={{
          backgroundColor: "rgba(13,15,28,0.96)",
          borderColor: "rgba(255,255,255,0.1)",
          boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div className="flex flex-col items-center gap-2 text-center">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-2xl"
            style={{ backgroundColor: headBg }}
          >
            {isDraw
              ? <Minus size={24} style={{ color: headColor }} />
              : isWinner
                ? <Trophy size={24} style={{ color: headColor }} />
                : <Swords size={24} style={{ color: headColor }} />}
          </div>
          <h2 className="text-xl font-bold text-white">{t.duel.endTitle}</h2>
          <p className="text-sm font-semibold" style={{ color: headColor }}>
            {isDraw ? t.duel.bothLose : isWinner ? t.duel.youWin : t.duel.youLose}
          </p>
          <p className="text-lg font-bold text-white/90 tabular-nums">
            {t.duel.you} {youWins} — {oppWins} {t.duel.opponent}
          </p>
        </div>

        {/* SKY balance — animated before→after per player once the match settles, else a
            static line while the result POST is in flight. */}
        <BalancePanel
          t={t}
          entryFee={entryFee}
          localBalance={localBalance}
          unlimitedSky={unlimitedSky}
          settlement={settlement}
        />

        {/* Teams — roster + per-character round wins + gauge mode */}
        <div className="grid grid-cols-2 gap-3">
          <TeamColumn
            title={localSide === 1 ? t.duel.you : t.duel.opponent}
            profile={localSide === 1 ? youProfile : oppProfile}
            highlight={localSide === 1}
            mode={result.p1Mode}
            roster={orderedRoster(result.p1TeamIds, result.p1SelectOrder)}
            select={result.p1SelectOrder}
            charWins={result.p1CharWins}
            winsLabel={t.duel.wins}
          />
          <TeamColumn
            title={localSide === 2 ? t.duel.you : t.duel.opponent}
            profile={localSide === 2 ? youProfile : oppProfile}
            highlight={localSide === 2}
            mode={result.p2Mode}
            roster={orderedRoster(result.p2TeamIds, result.p2SelectOrder)}
            select={result.p2SelectOrder}
            charWins={result.p2CharWins}
            winsLabel={t.duel.wins}
          />
        </div>

        <div className="flex items-center justify-between text-xs text-white/60">
          <span>{t.duel.perfectKos}: <span className="font-bold text-white/90">{totalPerfectKos}</span></span>
          {matchHistory.length > 0 && (
            <button
              onClick={() => setShowDetails((v) => !v)}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1 font-semibold transition-colors"
              style={{ backgroundColor: "rgba(96,165,250,0.15)", color: "#93c5fd" }}
            >
              {showDetails ? t.duel.hideDetailedStats : t.duel.viewDetailedStats}
              {showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
        </div>

        {/* Detailed match-by-match breakdown — revealed in place (no navigation, so the
            same-session rematch flow survives). Built from the in-memory match history. */}
        {showDetails && (
          <MatchBreakdown matchHistory={matchHistory} localSide={localSide} />
        )}

        {/* Action zone — depends on phase + winner/loser/draw */}
        <div className="flex flex-col gap-3 pt-1">
          {phase === "stats" && (
            <>
              {/* Draw = both lose, no revenge — just auto-redirect. Only the loser of a
                  decisive match gets the revenge / new-duel buttons. */}
              {!isDraw && !isWinner && (
                <div className="flex gap-3">
                  <button
                    onClick={onRequestRevenge}
                    disabled={!canRematch}
                    title={!canRematch ? t.duel.insufficientSky : undefined}
                    className="flex-1 rounded-xl px-4 py-3 font-bold text-white transition-transform hover:scale-[1.02] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
                    style={{ background: "linear-gradient(135deg,#fd2e5f,#b91c4b)" }}
                  >
                    {canRematch ? t.duel.takeRevenge : t.duel.insufficientSky}
                  </button>
                  <button
                    onClick={onExit}
                    className="flex-1 rounded-xl border px-4 py-3 font-semibold text-white/80 transition-colors"
                    style={{ borderColor: "rgba(255,255,255,0.15)", backgroundColor: "rgba(255,255,255,0.04)" }}
                  >
                    {t.duel.newDuel}
                  </button>
                </div>
              )}
              <p className="text-center text-xs text-white/50">
                {t.duel.redirectingIn(countdown)}
              </p>
            </>
          )}

          {phase === "requesting" && (
            <div className="flex flex-col items-center gap-2 py-2">
              <Loader2 size={22} className="animate-spin text-white/70" />
              <p className="text-sm text-white/70">{t.duel.waitingOpponent}</p>
            </div>
          )}

          {phase === "incoming" && (
            <div className="flex flex-col gap-3">
              <p className="text-center text-sm font-semibold text-white/90">
                {t.duel.opponentWantsRevenge}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={onAcceptRevenge}
                  disabled={!canRematch}
                  title={!canRematch ? t.duel.insufficientSky : undefined}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 font-bold text-white transition-transform hover:scale-[1.02] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
                  style={{ background: "linear-gradient(135deg,#34d399,#059669)" }}
                >
                  <Check size={18} /> {canRematch ? t.duel.accept : t.duel.insufficientSky}
                </button>
                <button
                  onClick={onDeclineRevenge}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-3 font-semibold text-white/80 transition-colors"
                  style={{ borderColor: "rgba(248,113,113,0.4)", backgroundColor: "rgba(248,113,113,0.08)" }}
                >
                  <X size={18} /> {t.duel.decline}
                </button>
              </div>
            </div>
          )}

          {phase === "declined" && (
            <div className="flex flex-col items-center gap-2 py-2">
              <X size={22} style={{ color: "#f87171" }} />
              <p className="text-sm text-white/80">{t.duel.revengeDeclined}</p>
              <p className="text-xs text-white/50">{t.duel.redirectingIn(countdown)}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * SKY balance panel shown under the score. Before the result POST resolves, `settlement`
 * is null and a single static line (local balance + stake notice) is shown. Once settled,
 * both players' balances animate from `before` → `after` with a colored net-delta badge
 * (loser −1000 red, winner +500 green, draw −1000 red for both; admins show ∞, no animation).
 */
function BalancePanel({
  t, entryFee, localBalance, unlimitedSky, settlement,
}: {
  t: Dictionary;
  entryFee: number;
  localBalance: number | null;
  unlimitedSky: boolean;
  settlement?: { you: BalanceMove | null; opp: BalanceMove | null } | null;
}) {
  // Fallback: no settlement data yet (POST in flight) → single static line.
  if (!settlement || (!settlement.you && !settlement.opp)) {
    return (
      <p className="text-center text-xs text-white/50">
        {t.duel.balanceLabel}:{" "}
        <span className="font-bold text-white/90 tabular-nums">{unlimitedSky ? "∞" : (localBalance ?? "—")} SKY</span>
        <span className="text-white/30"> · {t.duel.entryFeeNotice(entryFee)}</span>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3">
        <BalanceCell t={t} label={t.duel.you} move={settlement.you} highlight />
        <BalanceCell t={t} label={t.duel.opponent} move={settlement.opp} highlight={false} />
      </div>
      <p className="text-center text-[10px] text-white/30">{t.duel.entryFeeNotice(entryFee)}</p>
    </div>
  );
}

/** One player's animated balance cell (before→after + net-delta badge). */
function BalanceCell({
  t, label, move, highlight,
}: {
  t: Dictionary;
  label: string;
  move: BalanceMove | null;
  highlight: boolean;
}) {
  const border = highlight ? "rgba(96,165,250,0.35)" : "rgba(255,255,255,0.08)";
  const bg = highlight ? "rgba(96,165,250,0.06)" : "rgba(255,255,255,0.02)";

  return (
    <div className="rounded-2xl border px-3 py-2 text-center" style={{ borderColor: border, backgroundColor: bg }}>
      <div className="text-[10px] uppercase tracking-wide text-white/40">
        {label} · {t.duel.balanceLabel}
      </div>
      {!move || move.unlimited ? (
        <div className="text-base font-bold text-white/90 tabular-nums">∞ SKY</div>
      ) : (
        <>
          <div className="text-base font-bold text-white/90 tabular-nums">
            <AnimatedNumber from={move.before ?? move.after ?? 0} to={move.after ?? 0} /> SKY
          </div>
          {move.delta !== 0 && (
            <div
              className="mt-0.5 text-[11px] font-bold tabular-nums"
              style={{ color: move.delta > 0 ? "#34d399" : "#f87171" }}
            >
              {move.delta > 0 ? "+" : ""}{move.delta.toLocaleString()} SKY
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TeamColumn({
  title, profile, highlight, mode, roster, select, charWins, winsLabel,
}: {
  title: string;
  profile?: PlayerProfile;
  highlight: boolean;
  mode?: "ADVANCED" | "EXTRA";
  roster: number[];
  select?: number[];
  charWins?: Record<number, number>;
  winsLabel: string;
}) {
  const modeColor = mode === "ADVANCED" ? "#60a5fa" : "#fbbf24";
  const order = (select || []).filter((id) => id >= 0x00 && id <= 0x25);
  const wins = charWins || {};
  // A character "participated" if it entered a round (selection order) or has any win.
  const participated = (id: number) => order.includes(id) || (wins[id] ?? 0) > 0;

  return (
    <div
      className="rounded-2xl border p-3"
      style={{
        borderColor: highlight ? "rgba(253,46,95,0.35)" : "rgba(255,255,255,0.08)",
        backgroundColor: highlight ? "rgba(253,46,95,0.06)" : "rgba(255,255,255,0.02)",
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        {profile ? (
          <PlayerBadge
            username={profile.username || title}
            avatar={profile.avatar}
            country={profile.country}
            size={22}
            accent={highlight ? "#fd2e5f" : "#94a3b8"}
            className="min-w-0"
          />
        ) : (
          <span className="text-xs font-bold text-white/90">{title}</span>
        )}
        {mode && (
          <span
            className="rounded-full px-2 py-0.5 text-[9px] font-bold shrink-0"
            style={{ backgroundColor: "rgba(0,0,0,0.4)", color: modeColor, border: `1px solid ${modeColor}55` }}
          >
            {mode}
          </span>
        )}
      </div>
      <div className="mb-1 flex items-center justify-between text-[9px] uppercase tracking-wide text-white/40">
        <span>{title}</span>
        <span>{winsLabel}</span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {roster.length === 0 && <li className="text-[11px] text-white/40">—</li>}
        {roster.map((id, i) => {
          const w = wins[id] ?? 0;
          return (
            <li key={`${id}-${i}`} className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-white/85">{charName(id)}</span>
              {participated(id) ? (
                <span className="flex items-center gap-0.5 text-[11px] font-bold tabular-nums text-white/90">
                  <Trophy size={10} style={{ color: "#fbbf24" }} /> {w}
                </span>
              ) : (
                <span className="text-[11px] text-white/30">—</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Detailed match-by-match breakdown, built entirely from the in-memory match history
 * (no navigation, no DB fetch — so it works even when the DB stats page can't resolve
 * the duel session, and it keeps the same-session rematch flow alive). Each row shows the
 * match result from the local player's perspective, the KO score, perfect count, and both
 * rosters with per-character round wins + gauge mode.
 */
function MatchBreakdown({ matchHistory, localSide }: {
  matchHistory: DuelMatchResult[];
  localSide: 1 | 2;
}) {
  const { t } = useTranslation();

  const rosterLine = (team?: number[], select?: number[], wins?: Record<number, number>): string => {
    const ids = orderedRoster(team, select);
    if (ids.length === 0) return "—";
    const w = wins || {};
    return ids.map((id) => ((w[id] ?? 0) > 0 ? `${charName(id)}·${w[id]}` : charName(id))).join(", ");
  };

  return (
    <div className="-mt-2 flex max-h-56 flex-col gap-2 overflow-y-auto pr-1">
      {matchHistory.map((m, i) => {
        const drawn = m.winner === 0;
        const won = m.winner === localSide;
        const color = drawn ? "#fbbf24" : won ? "#34d399" : "#f87171";
        const bg = drawn ? "rgba(251,191,36,0.07)" : won ? "rgba(52,211,153,0.07)" : "rgba(248,113,113,0.07)";
        const youLost = localSide === 1 ? m.p1Losses : m.p2Losses;
        const oppLost = localSide === 1 ? m.p2Losses : m.p1Losses;
        const perfect = m.perfectKos || 0;
        const youTeam = localSide === 1 ? m.p1TeamIds : m.p2TeamIds;
        const youOrder = localSide === 1 ? m.p1SelectOrder : m.p2SelectOrder;
        const youWins = localSide === 1 ? m.p1CharWins : m.p2CharWins;
        const youMode = localSide === 1 ? m.p1Mode : m.p2Mode;
        const oppTeam = localSide === 1 ? m.p2TeamIds : m.p1TeamIds;
        const oppOrder = localSide === 1 ? m.p2SelectOrder : m.p1SelectOrder;
        const oppWins = localSide === 1 ? m.p2CharWins : m.p1CharWins;
        const oppMode = localSide === 1 ? m.p2Mode : m.p1Mode;
        return (
          <div key={i} className="rounded-xl border px-3 py-2" style={{ borderColor: `${color}33`, backgroundColor: bg }}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-white/80">{t.duel.matchLabel} #{m.matchNumber ?? i + 1}</span>
              <div className="flex items-center gap-2">
                {perfect > 0 && (
                  <span className="flex items-center gap-0.5 text-[10px] font-bold" style={{ color: "#fbbf24" }}>
                    <Trophy size={9} /> {perfect}
                  </span>
                )}
                <span className="flex items-center gap-1 text-[11px] font-bold" style={{ color }}>
                  {drawn ? <Minus size={11} /> : won ? <Trophy size={11} /> : <Swords size={11} />}
                  <span className="tabular-nums">{oppLost}–{youLost}</span>
                </span>
              </div>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-2 text-[10px]">
              <div>
                <span className="text-[9px] font-semibold uppercase tracking-wide text-white/35">
                  {t.duel.you}{youMode ? ` · ${youMode}` : ""}
                </span>
                <div className="text-white/70">{rosterLine(youTeam, youOrder, youWins)}</div>
              </div>
              <div className="text-right">
                <span className="text-[9px] font-semibold uppercase tracking-wide text-white/35">
                  {t.duel.opponent}{oppMode ? ` · ${oppMode}` : ""}
                </span>
                <div className="text-white/70">{rosterLine(oppTeam, oppOrder, oppWins)}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
