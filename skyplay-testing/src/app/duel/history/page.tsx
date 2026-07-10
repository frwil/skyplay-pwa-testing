"use client";

import { useEffect, useState } from "react";
import GlowBackground from "@/components/GlowBackground";
import PlayerBadge from "@/components/PlayerBadge";
import { useTranslation } from "@/lib/i18n/TranslationContext";
import { Swords, Trophy, ArrowLeft, Loader2, Minus } from "lucide-react";

interface DuelHistoryRow {
  sessionId: string | null;
  opponent: string;
  opponentAvatar: string | null;
  opponentCountry: string | null;
  won: boolean;
  p1Losses: number;
  p2Losses: number;
  perfectKoCount: number;
  system: string;
  rom: string;
  createdAt: string | null;
}

/** Resolve a dev identity (local dev without JWT) from the same localStorage keys as the duel page. */
function devQuery(): string {
  if (typeof window === "undefined") return "";
  const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  if (!isLocalhost) return "";
  try {
    const id = localStorage.getItem("skyplay_dev_userId");
    const name = localStorage.getItem("skyplay_dev_username");
    if (id) return `?devUserId=${id}&devUsername=${encodeURIComponent(name || "")}`;
  } catch { /* storage blocked */ }
  return "";
}

export default function DuelHistoryPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<DuelHistoryRow[] | null>(null);
  const [summary, setSummary] = useState<{ wins: number; losses: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/duel/history${devQuery()}`, { credentials: "include" });
        if (!res.ok) { if (!cancelled) setRows([]); return; }
        const data = await res.json();
        if (cancelled) return;
        setRows(Array.isArray(data.results) ? data.results : []);
        if (data.summary) setSummary({ wins: data.summary.wins ?? 0, losses: data.summary.losses ?? 0 });
      } catch {
        if (!cancelled) setRows([]);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="relative min-h-screen">
      <GlowBackground />

      {/* Header */}
      <header className="relative z-10 border-b border-white/5 bg-[#070f1e]/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/" className="block">
              <div
                className="font-black text-xl uppercase tracking-[3px]"
                style={{
                  background: "linear-gradient(135deg, #f15bb5 0%, #9b5de5 50%, #00d2ff 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                SKY PLAY
              </div>
            </a>
          </div>
          <a href="/duel" className="text-xs text-white/40 hover:text-white transition font-medium flex items-center gap-1">
            <ArrowLeft className="w-3 h-3" />
            {t.duel.history.backToDuel}
          </a>
        </div>
      </header>

      <section className="relative z-10 max-w-3xl mx-auto px-4 py-8 pb-20">
        {/* Title */}
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-white flex items-center gap-2">
              <Swords className="w-6 h-6" style={{ color: "#f15bb5" }} />
              {t.duel.history.title}
            </h1>
            <p className="text-sm text-white/40 mt-1">{t.duel.history.subtitle}</p>
          </div>
          {summary && (
            <span
              className="rounded-full px-3 py-1 text-xs font-bold tabular-nums whitespace-nowrap"
              style={{ backgroundColor: "rgba(96,165,250,0.15)", color: "#93c5fd", border: "1px solid rgba(96,165,250,0.3)" }}
            >
              {t.duel.history.summary(summary.wins, summary.losses)}
            </span>
          )}
        </div>

        {/* Loading */}
        {rows === null && (
          <div className="flex flex-col items-center gap-3 py-16">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: "rgba(255,255,255,0.2)" }} />
            <p className="text-sm text-white/30">{t.duel.history.loading}</p>
          </div>
        )}

        {/* Empty */}
        {rows !== null && rows.length === 0 && (
          <div
            className="rounded-2xl border p-10 text-center"
            style={{ backgroundColor: "rgba(13,27,46,0.7)", borderColor: "rgba(255,255,255,0.08)" }}
          >
            <Swords className="w-10 h-10 mx-auto mb-3" style={{ color: "rgba(241,91,181,0.3)" }} />
            <p className="text-sm text-white/40">{t.duel.history.empty}</p>
          </div>
        )}

        {/* List */}
        {rows !== null && rows.length > 0 && (
          <div className="flex flex-col gap-2.5">
            {rows.map((r, i) => (
              <HistoryCard key={`${r.sessionId ?? "s"}-${i}`} row={r} t={t} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function HistoryCard({ row, t }: { row: DuelHistoryRow; t: ReturnType<typeof useTranslation>["t"] }) {
  const color = row.won ? "#34d399" : "#f87171";
  const bg = row.won ? "rgba(52,211,153,0.07)" : "rgba(248,113,113,0.07)";
  return (
    <div className="rounded-2xl border px-4 py-3" style={{ borderColor: `${color}33`, backgroundColor: bg }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl shrink-0"
            style={{ backgroundColor: `${color}1f`, border: `1px solid ${color}44` }}
          >
            {row.won ? <Trophy size={16} style={{ color }} /> : <Swords size={16} style={{ color }} />}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold truncate" style={{ color }}>
              {row.won ? t.duel.history.won : t.duel.history.lost}
            </p>
            <div className="flex items-center gap-1.5 text-[11px] text-white/45">
              <span>{t.duel.opponent}:</span>
              <PlayerBadge
                username={row.opponent}
                avatar={row.opponentAvatar}
                country={row.opponentCountry}
                size={18}
                accent={color}
              />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {row.perfectKoCount > 0 && (
            <span className="flex items-center gap-0.5 text-[11px] font-bold" style={{ color: "#fbbf24" }}>
              <Trophy size={11} /> {row.perfectKoCount}
            </span>
          )}
          <span className="text-sm font-bold tabular-nums text-white/85">
            {row.p1Losses}<Minus size={10} className="inline mx-0.5 text-white/30" />{row.p2Losses}
          </span>
          <span className="text-[10px] text-white/30 whitespace-nowrap">{formatDate(row.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  // Stored as UTC "YYYY-MM-DD HH:MM:SS"; normalize to an ISO instant for the local-time display.
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}
