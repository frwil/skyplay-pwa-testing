"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, Trophy, Loader2 } from "lucide-react";

interface DonorEntry {
  rank: number;
  userId: string;
  username: string;
  avatar: string | null;
  level: number;
  totalCoins: number;
  giftCount: number;
}

type Period = "daily" | "weekly" | "alltime";

const PERIOD_LABELS: Record<Period, string> = {
  daily: "Jour",
  weekly: "Semaine",
  alltime: "All-time",
};

const RANK_MEDALS: Record<number, string> = {
  1: "🥇",
  2: "🥈",
  3: "🥉",
};

const POLL_INTERVAL_MS = 30_000;

export default function DonorRanking() {
  const [collapsed, setCollapsed] = useState(false);
  const [period, setPeriod] = useState<Period>("alltime");
  const [donors, setDonors] = useState<DonorEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLeaderboard = useCallback(async (p: Period) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/gifts/leaderboard?period=${p}&limit=20`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data: DonorEntry[] = await res.json();
      setDonors(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Initial fetch + polling ──────────────────────────
  useEffect(() => {
    fetchLeaderboard(period);
    const timer = setInterval(() => fetchLeaderboard(period), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [period, fetchLeaderboard]);

  const handlePeriodChange = (p: Period) => {
    setPeriod(p);
    fetchLeaderboard(p);
  };

  // ── Render ────────────────────────────────────────────
  return (
    <div
      className="absolute right-2 top-12 z-30 transition-all duration-300"
      style={{ pointerEvents: "auto" }}
    >
      {/* Collapse toggle (always visible) */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className={`absolute ${collapsed ? "-left-8 top-2" : "-left-3 top-3"} z-40 w-6 h-6 rounded-full flex items-center justify-center transition-all`}
        style={{
          backgroundColor: "rgba(0,0,0,0.8)",
          border: "1px solid rgba(255,255,255,0.12)",
        }}
      >
        {collapsed ? (
          <ChevronLeft className="w-3.5 h-3.5 text-white/50" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-white/50" />
        )}
      </button>

      {/* Panel */}
      <div
        className={`overflow-hidden transition-all duration-300 rounded-xl border ${
          collapsed ? "w-0 opacity-0 border-transparent" : "w-60 opacity-100"
        }`}
        style={{
          backgroundColor: "rgba(0,0,0,0.8)",
          backdropFilter: "blur(12px)",
          borderColor: "rgba(255,255,255,0.08)",
        }}
      >
        {/* Header */}
        <div className="px-3 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-1.5 mb-2">
            <Trophy className="w-3.5 h-3.5" style={{ color: "#ffd700" }} />
            <span className="text-[11px] font-black text-white uppercase tracking-wider">
              Top Donateurs
            </span>
          </div>
          {/* Period toggle */}
          <div className="flex gap-0.5">
            {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => handlePeriodChange(p)}
                className={`flex-1 px-1.5 py-0.5 rounded text-[9px] font-bold transition-all ${
                  period === p
                    ? "text-white"
                    : "text-white/30 hover:text-white/50"
                }`}
                style={{
                  backgroundColor: period === p
                    ? "rgba(0,200,255,0.15)"
                    : "transparent",
                }}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="max-h-[50vh] overflow-y-auto">
          {loading && donors.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-4 h-4 animate-spin text-white/20" />
            </div>
          ) : error ? (
            <p className="text-center text-[10px] py-6 px-3" style={{ color: "#fd2e5f" }}>
              {error}
            </p>
          ) : donors.length === 0 ? (
            <p className="text-center text-[10px] py-6 px-3 text-white/25">
              Aucun donateur pour cette période
            </p>
          ) : (
            <div className="py-1">
              {donors.map((donor) => (
                <div
                  key={donor.userId}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-white/[0.02] transition-colors"
                >
                  {/* Rank */}
                  <span className="text-xs font-bold w-5 text-center">
                    {RANK_MEDALS[donor.rank] || (
                      <span className="text-white/20">{donor.rank}</span>
                    )}
                  </span>

                  {/* Avatar */}
                  {donor.avatar ? (
                    <img
                      src={donor.avatar}
                      alt={donor.username}
                      className="w-6 h-6 rounded-full flex-shrink-0"
                    />
                  ) : (
                    <div
                      className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-[8px] font-bold"
                      style={{
                        backgroundColor: "rgba(0,200,255,0.15)",
                        color: "#00c8ff",
                      }}
                    >
                      {donor.username?.slice(0, 2).toUpperCase() || "?"}
                    </div>
                  )}

                  {/* Name + level */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold text-white truncate">
                      {donor.username}
                    </p>
                    <p className="text-[8px] text-white/20">
                      Lv.{donor.level} · {donor.giftCount} cadeaux
                    </p>
                  </div>

                  {/* Coins */}
                  <div className="text-right flex-shrink-0">
                    <p className="text-[10px] font-bold" style={{ color: "#ffd700" }}>
                      🪙 {donor.totalCoins.toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div
          className="px-3 py-2 border-t"
          style={{ borderColor: "rgba(255,255,255,0.06)" }}
        >
          <p className="text-[8px] text-center text-white/15">
            Mise à jour toutes les 30s
          </p>
        </div>
      </div>
    </div>
  );
}
