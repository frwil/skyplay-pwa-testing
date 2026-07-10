"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { charName } from "@/lib/emulator/kof98Characters";
import { useTranslation } from "@/lib/i18n/TranslationContext";
import PlayerBadge from "@/components/PlayerBadge";

/** Minimal player identity for the nominative badges (name + avatar + flag). */
interface PlayerProfile {
  id?: number;
  username: string;
  avatar: string | null;
  country: string | null;
}

interface SessionStats {
  session: {
    sessionId: string;
    mode: string;
    system: string;
    rom: string;
    totalMatches: number;
    playerWins: number;
    playerLosses: number;
    playerPerfectKos: number;
    pointsEarned: number;
    startedAt: string;
    endedAt: string;
  };
  players?: { p1: PlayerProfile | null; p2: PlayerProfile | null };
  matches: MatchWithRounds[];
}

interface MatchWithRounds {
  id: number;
  match_number: number;
  winner: number;
  loser: number;
  p1_losses: number;
  p2_losses: number;
  perfect_ko_count: number;
  rounds: RoundInfo[];
  /** Character metadata (null for older matches saved before this was tracked). */
  p1Team: number[] | null;
  p2Team: number[] | null;
  p1SelectionOrder: number[] | null;
  p2SelectionOrder: number[] | null;
  p1GaugeMode: string | null;
  p2GaugeMode: string | null;
}

interface RoundInfo {
  id: number;
  round_number: number;
  loser: number;
  winner: number;
  ko_type: string;
}

export default function StatsPage() {
  const { t } = useTranslation();
  const params = useParams();
  const sessionId = params?.sessionId as string;
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Signed-in viewer identity — used as the P1 fallback for CPU sessions (no duel row to resolve).
  const [viewer, setViewer] = useState<PlayerProfile | null>(null);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.user) setViewer({ id: d.user.id, username: d.user.username || "", avatar: d.user.avatar ?? null, country: d.user.country ?? null });
      })
      .catch(() => { /* not signed in — P1 stays a generic label */ });
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/stats/session/${sessionId}`)
      .then(res => {
        if (!res.ok) throw new Error(res.status === 404 ? "Session not found" : "Failed to load");
        return res.json();
      })
      .then(data => {
        setStats(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [sessionId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="text-xl animate-pulse">{t.statsPage.loading}</div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-2xl font-bold text-red-400 mb-4">{t.statsPage.unavailableTitle}</div>
          <div className="text-gray-400">{error || t.statsPage.noData}</div>
          <a href="/play" className="mt-6 inline-block px-4 py-2 bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors">
            {t.statsPage.backToPlay}
          </a>
        </div>
      </div>
    );
  }

  const { session, matches } = stats;
  const winRate = session.totalMatches > 0
    ? Math.round((session.playerWins / session.totalMatches) * 100)
    : 0;

  // Nominative identities: prefer the resolved duel players; for a CPU session fall back to the
  // signed-in viewer as P1 and a CPU label as P2, so the page never shows a bare "P1"/"P2".
  const isCpu = session.mode !== "pvp";
  const p1Profile: PlayerProfile | null =
    stats.players?.p1 ?? (isCpu && viewer ? viewer : null);
  const p2Profile: PlayerProfile | null =
    stats.players?.p2 ?? (isCpu ? { username: t.statsPage.cpu, avatar: null, country: null } : null);

  return (
    <div className="min-h-screen bg-gray-950 text-white p-4 md:p-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <a href="/play" className="text-blue-400 hover:text-blue-300 text-sm mb-4 inline-block">
            ← {t.statsPage.backToPlay}
          </a>
          <h1 className="text-3xl font-bold">{t.statsPage.title}</h1>
          <div className="text-gray-400 mt-2 space-y-1">
            <div>{t.statsPage.game}: <span className="text-white font-mono">{session.rom}</span></div>
            <div>{t.statsPage.mode}: <span className="text-white capitalize">{session.mode === "pvp" ? t.statsPage.pvpDuel : t.statsPage.vsCpu}</span></div>
            <div>
              {session.startedAt && new Date(session.startedAt).toLocaleDateString()}{" "}
              {session.startedAt && new Date(session.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        </div>

        {/* Players — nominative banner (names + avatars + flags) */}
        {(p1Profile || p2Profile) && (
          <div className="mb-8 flex items-center justify-center gap-4 rounded-2xl border border-gray-800 bg-gray-900 p-4">
            <div className="flex-1 flex justify-end">
              {p1Profile
                ? <PlayerBadge username={p1Profile.username} avatar={p1Profile.avatar} country={p1Profile.country} size={40} accent="#34d399" />
                : <span className="text-sm font-bold text-green-300">P1</span>}
            </div>
            <span className="text-xs font-black text-gray-500">{t.statsPage.vs}</span>
            <div className="flex-1 flex justify-start">
              {p2Profile
                ? <PlayerBadge username={p2Profile.username} avatar={p2Profile.avatar} country={p2Profile.country} size={40} accent="#f87171" />
                : <span className="text-sm font-bold text-red-300">P2</span>}
            </div>
          </div>
        )}

        {/* Scoreboard */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard label={t.statsPage.matchesPlayed} value={session.totalMatches} />
          <StatCard label={t.statsPage.wins} value={session.playerWins} color="text-green-400" />
          <StatCard label={t.statsPage.losses} value={session.playerLosses} color="text-red-400" />
          <StatCard label={t.statsPage.winRate} value={`${winRate}%`} color={winRate >= 50 ? "text-green-400" : "text-yellow-400"} />
        </div>

        <div className="grid grid-cols-2 gap-4 mb-8">
          <StatCard label={t.statsPage.perfectKos} value={session.playerPerfectKos} color="text-yellow-400" />
          <StatCard label={t.statsPage.pointsEarned} value={session.pointsEarned} color="text-blue-400" />
        </div>

        {/* Match-by-Match Breakdown */}
        <h2 className="text-2xl font-bold mb-4">{t.statsPage.matchBreakdown}</h2>
        {matches.length === 0 ? (
          <div className="text-gray-500 italic">{t.statsPage.noMatches}</div>
        ) : (
          <div className="space-y-4">
            {matches.map(match => (
              <MatchCard key={match.id} match={match} p1Profile={p1Profile} p2Profile={p2Profile} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color = "text-white" }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
      <div className="text-sm text-gray-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function MatchCard({ match, p1Profile, p2Profile }: { match: MatchWithRounds; p1Profile: PlayerProfile | null; p2Profile: PlayerProfile | null }) {
  const { t } = useTranslation();
  const playerWon = match.winner === 1;
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      <div className={`px-4 py-3 flex items-center justify-between ${playerWon ? "bg-green-900/30" : "bg-red-900/30"}`}>
        <div className="font-bold">
          {t.statsPage.matchNumber(match.match_number)}
        </div>
        <div className={`text-sm font-semibold ${playerWon ? "text-green-400" : "text-red-400"}`}>
          {playerWon ? t.statsPage.win : t.statsPage.loss} ({match.p1_losses}-{match.p2_losses})
        </div>
      </div>
      <div className="px-4 py-3">
        <div className="text-xs text-gray-500 mb-2">
          {t.statsPage.perfectKosInline}: {match.perfect_ko_count}
        </div>
        <TeamsSection match={match} p1Profile={p1Profile} p2Profile={p2Profile} />
        {match.rounds.length > 0 ? (
          <div className="space-y-1">
            {match.rounds.map(round => {
              const roundWon = round.winner === 1;
              return (
                <div key={round.id} className="flex items-center gap-2 text-sm">
                  <span className={`inline-block w-2 h-2 rounded-full ${roundWon ? "bg-green-400" : round.loser === 0 ? "bg-yellow-400" : "bg-red-400"}`} />
                  <span className="text-gray-400">{t.statsPage.round(round.round_number)}:</span>
                  <span className={roundWon ? "text-green-300" : round.loser === 0 ? "text-yellow-300" : "text-red-300"}>
                    {round.loser === 0 ? t.statsPage.draw : roundWon ? t.statsPage.won : t.statsPage.lost}
                  </span>
                  {round.ko_type === "perfect" && (
                    <span className="px-1.5 py-0.5 bg-yellow-900/50 text-yellow-400 text-xs rounded font-bold">
                      {t.statsPage.badgePerfect}
                    </span>
                  )}
                  {round.ko_type === "timeout" && (
                    <span className="px-1.5 py-0.5 bg-blue-900/50 text-blue-400 text-xs rounded font-bold">
                      {t.statsPage.badgeTime}
                    </span>
                  )}
                  {round.ko_type === "draw" && (
                    <span className="px-1.5 py-0.5 bg-gray-700/50 text-gray-400 text-xs rounded font-bold">
                      {t.statsPage.badgeDraw}
                    </span>
                  )}
                  <span className="text-gray-500 text-xs">
                    ({round.loser === 0 ? t.statsPage.doubleKo : t.statsPage.beats(round.winner, round.loser)})
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-gray-500 text-sm italic">{t.statsPage.noRoundDetails}</div>
        )}
      </div>
    </div>
  );
}

/** Per-player team roster, selection order (1→2→3) and gauge mode for a match. */
function TeamsSection({ match, p1Profile, p2Profile }: { match: MatchWithRounds; p1Profile: PlayerProfile | null; p2Profile: PlayerProfile | null }) {
  const hasData =
    match.p1Team?.length || match.p2Team?.length ||
    match.p1SelectionOrder?.length || match.p2SelectionOrder?.length;
  if (!hasData) return null;

  return (
    <div className="grid grid-cols-2 gap-3 mb-3">
      <PlayerColumn
        label="P1"
        accent="text-green-300"
        badgeAccent="#34d399"
        profile={p1Profile}
        team={match.p1Team}
        order={match.p1SelectionOrder}
        mode={match.p1GaugeMode}
      />
      <PlayerColumn
        label="P2"
        accent="text-red-300"
        badgeAccent="#f87171"
        profile={p2Profile}
        team={match.p2Team}
        order={match.p2SelectionOrder}
        mode={match.p2GaugeMode}
      />
    </div>
  );
}

function PlayerColumn({
  label,
  accent,
  badgeAccent,
  profile,
  team,
  order,
  mode,
}: {
  label: string;
  accent: string;
  badgeAccent: string;
  profile: PlayerProfile | null;
  team: number[] | null;
  order: number[] | null;
  mode: string | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="bg-gray-950/60 rounded-lg p-3 border border-gray-800">
      <div className="flex items-center justify-between mb-1.5">
        {profile ? (
          <PlayerBadge username={profile.username} avatar={profile.avatar} country={profile.country} size={24} accent={badgeAccent} className="min-w-0" />
        ) : (
          <span className={`text-sm font-bold ${accent}`}>{label}</span>
        )}
        {mode && (
          <span
            className={`px-1.5 py-0.5 text-[10px] rounded font-bold ${
              mode === "ADVANCED"
                ? "bg-blue-900/50 text-blue-300"
                : "bg-yellow-900/50 text-yellow-300"
            }`}
          >
            {mode}
          </span>
        )}
      </div>
      {team && team.length > 0 && (
        <div className="text-xs text-gray-300 mb-1">
          <span className="text-gray-500">{t.statsPage.team}: </span>
          {team.map(charName).join(", ")}
        </div>
      )}
      {order && order.length > 0 && (
        <div className="text-xs text-gray-400">
          <span className="text-gray-500">{t.statsPage.order}: </span>
          {order.map((id, i) => (
            <span key={`${id}-${i}`}>
              {i > 0 && <span className="text-gray-600"> → </span>}
              <span className="text-gray-200">{i + 1}. {charName(id)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
