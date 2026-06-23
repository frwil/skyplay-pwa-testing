"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "@/lib/i18n/TranslationContext";
import type { SystemType } from "@/lib/emulator/types";
import {
  Trophy,
  Clock,
  Users,
  Coins,
  Camera,
  Send,
  CheckCircle2,
  X,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────

interface Challenge {
  id: number;
  title: string;
  description: string;
  system: string;
  romName: string;
  criteria: string;
  reward: number;
  startsAt: string;
  endsAt: string;
  submissionCount: number;
}

interface ChallengeSubmission {
  id: number;
  userId: number;
  username: string;
  result: string;
  status: string;
  submittedAt: string;
}

interface ChallengeDetail {
  challenge: Challenge;
  submissions: ChallengeSubmission[];
  userSubmission: { id: number; result: string; status: string; submittedAt: string } | null;
}

interface ChallengePanelProps {
  currentSystem: SystemType;
  onPlayChallenge: (system: SystemType, romName: string) => void;
}

/**
 * Displays active challenges on the /play page.
 * Users can view leaderboards and submit results with a screenshot.
 */
export default function ChallengePanel({ currentSystem, onPlayChallenge }: ChallengePanelProps) {
  const { t } = useTranslation();
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ChallengeDetail | null>(null);
  const [showSubmit, setShowSubmit] = useState(false);
  const [result, setResult] = useState("");
  const [screenshot, setScreenshot] = useState("");
  const [submitStatus, setSubmitStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [submitError, setSubmitError] = useState("");

  // ── Fetch challenges ──────────────────────────────────────

  const fetchChallenges = useCallback(async () => {
    try {
      const res = await fetch("/api/challenges?status=active");
      if (res.ok) {
        const data = await res.json();
        setChallenges(data.challenges);
      }
    } catch {
      // Ignore fetch errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChallenges();
  }, [fetchChallenges]);

  // ── Fetch challenge detail + leaderboard ──────────────────

  const openDetail = async (challengeId: number) => {
    try {
      const res = await fetch(`/api/challenges/${challengeId}`);
      if (res.ok) {
        const data = await res.json();
        setSelected(data);
      }
    } catch {
      // ignore
    }
  };

  // ── Screenshot handler ────────────────────────────────────

  const handleScreenshot = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setSubmitError("L'image ne doit pas dépasser 5 Mo");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => setScreenshot(reader.result as string);
    reader.readAsDataURL(file);
  };

  // ── Submit result ─────────────────────────────────────────

  const handleSubmit = async () => {
    if (!selected || !result) return;

    setSubmitStatus("loading");
    setSubmitError("");

    try {
      const res = await fetch(`/api/challenges/${selected.challenge.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result, screenshot: screenshot || undefined }),
        credentials: "include",
      });

      if (!res.ok) {
        const data = await res.json();
        setSubmitError(data.error || t.play.challenges.submitModal.errorGeneric);
        setSubmitStatus("error");
        return;
      }

      setSubmitStatus("success");
      setShowSubmit(false);
      // Refresh detail
      openDetail(selected.challenge.id);
    } catch {
      setSubmitError(t.play.challenges.submitModal.errorGeneric);
      setSubmitStatus("error");
    }
  };

  // ── Render ────────────────────────────────────────────────

  const now = new Date();

  if (loading) return null;

  // Filter challenges for current system + others
  const systemChallenges = challenges.filter(
    (c) => c.system === currentSystem
  );

  return (
    <div className="mb-6">
      {/* ─── Challenge Cards ─────────────────────────────── */}
      {challenges.length === 0 ? (
        <div className="text-center py-4">
          <Trophy className="w-5 h-5 mx-auto mb-1" style={{ color: "rgba(255,255,255,0.15)" }} />
          <p className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>
            {t.play.challenges.noActive}
          </p>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {challenges.map((ch) => {
            const isCurrentSystem = ch.system === currentSystem;
            const endsIn = getTimeRemaining(new Date(ch.endsAt), now);

            return (
              <button
                key={ch.id}
                onClick={() => openDetail(ch.id)}
                className={`text-left rounded-2xl border p-4 transition hover:scale-[1.02] ${
                  isCurrentSystem ? "border-cyan-500/30" : "border-white/10"
                }`}
                style={{
                  backgroundColor: isCurrentSystem
                    ? "rgba(0,200,255,0.08)"
                    : "rgba(13,27,46,0.6)",
                  borderColor: isCurrentSystem
                    ? "rgba(0,200,255,0.3)"
                    : "rgba(255,255,255,0.08)",
                }}
              >
                <div className="flex items-start justify-between mb-2">
                  <h4 className="text-sm font-bold text-white leading-tight">
                    {ch.title}
                  </h4>
                  <span
                    className="px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ml-2"
                    style={{
                      backgroundColor: "rgba(0,200,255,0.1)",
                      color: "#00c8ff",
                    }}
                  >
                    {ch.system.toUpperCase()}
                  </span>
                </div>

                <p className="text-[11px] mb-3 line-clamp-2" style={{ color: "rgba(255,255,255,0.4)" }}>
                  {ch.description || ch.romName}
                </p>

                <div className="flex items-center gap-3 text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {endsIn}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {ch.submissionCount}
                  </span>
                  <span className="flex items-center gap-1" style={{ color: "#ffd700" }}>
                    <Coins className="w-3 h-3" />
                    {ch.reward}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ─── Leaderboard Modal ────────────────────────────── */}
      {selected && !showSubmit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => { setSelected(null); setSubmitStatus("idle"); }}>
          <div
            className="rounded-3xl border w-full max-w-lg max-h-[80vh] overflow-y-auto p-6"
            style={{
              backgroundColor: "rgba(13,27,46,0.98)",
              borderColor: "rgba(255,255,255,0.1)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-5">
              <div>
                <h3 className="text-lg font-black text-white mb-1">
                  {selected.challenge.title}
                </h3>
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                  {selected.challenge.romName} • {selected.challenge.system.toUpperCase()} • {selected.challenge.reward} Sky
                </p>
              </div>
              <button onClick={() => { setSelected(null); setSubmitStatus("idle"); }} className="p-1.5 rounded-lg" style={{ color: "rgba(255,255,255,0.3)" }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Actions */}
            {!selected.userSubmission ? (
              <button
                onClick={() => { setShowSubmit(true); setResult(""); setScreenshot(""); setSubmitError(""); }}
                className="w-full rounded-xl px-4 py-3 text-sm font-bold flex items-center justify-center gap-2 mb-5 transition"
                style={{
                  backgroundColor: "rgba(0,200,255,0.15)",
                  border: "1px solid rgba(0,200,255,0.3)",
                  color: "#00c8ff",
                }}
              >
                <Send className="w-4 h-4" />
                {t.play.challenges.submit}
              </button>
            ) : (
              <div
                className="w-full rounded-xl px-4 py-3 text-sm font-bold flex items-center justify-center gap-2 mb-5"
                style={{
                  backgroundColor: "rgba(0,200,255,0.06)",
                  border: "1px solid rgba(0,200,255,0.15)",
                  color: "rgba(0,200,255,0.5)",
                }}
              >
                <CheckCircle2 className="w-4 h-4" />
                {t.play.challenges.submitted} — {t.play.challenges.status[selected.userSubmission.status.toLowerCase() as keyof typeof t.play.challenges.status] || selected.userSubmission.status}
              </div>
            )}

            {/* Leaderboard */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "rgba(255,255,255,0.3)" }}>
                {t.play.challenges.leaderboard.title}
              </h4>

              {selected.submissions.length === 0 ? (
                <p className="text-xs py-4 text-center" style={{ color: "rgba(255,255,255,0.25)" }}>
                  {t.play.challenges.leaderboard.noSubmissions}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {selected.submissions
                    .filter((s) => s.status === "APPROVED")
                    .map((s, i) => (
                      <div
                        key={s.id}
                        className="flex items-center gap-3 rounded-xl px-4 py-2.5"
                        style={{
                          backgroundColor: i === 0 ? "rgba(255,215,0,0.08)" : "rgba(255,255,255,0.03)",
                        }}
                      >
                        <span
                          className="w-6 text-center text-xs font-black"
                          style={{
                            color: i === 0 ? "#ffd700" : i === 1 ? "#c0c0c0" : i === 2 ? "#cd7f32" : "rgba(255,255,255,0.3)",
                          }}
                        >
                          {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
                        </span>
                        <span className="flex-1 text-xs font-medium text-white truncate">
                          {s.username}
                        </span>
                        <span
                          className="text-xs font-bold"
                          style={{
                            color:
                              s.result === "win"
                                ? "#4ade80"
                                : s.result === "loss"
                                  ? "#fd2e5f"
                                  : s.result === "draw"
                                    ? "#facc15"
                                    : "rgba(255,255,255,0.7)",
                          }}
                        >
                          {formatResult(s.result, t)}
                        </span>
                      </div>
                    ))}

                  {/* Pending submissions */}
                  {selected.submissions.filter((s) => s.status === "PENDING").length > 0 && (
                    <div className="mt-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "rgba(255,255,255,0.2)" }}>
                        {t.play.challenges.status.pending}
                      </p>
                      {selected.submissions.filter((s) => s.status === "PENDING").map((s) => (
                        <div key={s.id} className="flex items-center gap-3 rounded-xl px-4 py-2"
                          style={{ backgroundColor: "rgba(255,255,255,0.02)" }}>
                          <span className="flex-1 truncate text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>{s.username}</span>
                          <span className="text-xs font-medium" style={{ color: "rgba(255,255,255,0.3)" }}>
                            {formatResult(s.result, t)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Submit Modal ─────────────────────────────────── */}
      {selected && showSubmit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowSubmit(false)}>
          <div
            className="rounded-3xl border w-full max-w-md p-6"
            style={{
              backgroundColor: "rgba(13,27,46,0.98)",
              borderColor: "rgba(255,255,255,0.1)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-5">
              <h3 className="text-lg font-black text-white">
                {t.play.challenges.submitModal.title}
              </h3>
              <button onClick={() => setShowSubmit(false)} className="p-1.5 rounded-lg" style={{ color: "rgba(255,255,255,0.3)" }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Result selector (for winloss criteria) */}
            {selected.challenge.criteria === "winloss" ? (
              <div className="mb-4">
                <label className="text-xs font-bold uppercase tracking-wider mb-2 block" style={{ color: "rgba(255,255,255,0.5)" }}>
                  {t.play.challenges.submitModal.result}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(["win", "loss", "draw"] as const).map((r) => (
                    <button
                      key={r}
                      onClick={() => setResult(r)}
                      className={`rounded-xl py-3 text-sm font-bold transition ${
                        result === r
                          ? "border-cyan-500/50 bg-cyan-500/20 text-cyan-400"
                          : "border-white/10 bg-transparent text-white/40"
                      }`}
                      style={{ border: "1px solid", borderColor: result === r ? "rgba(0,200,255,0.5)" : "rgba(255,255,255,0.1)" }}
                    >
                      {r === "win"
                        ? t.play.challenges.submitModal.resultWin
                        : r === "loss"
                          ? t.play.challenges.submitModal.resultLoss
                          : t.play.challenges.submitModal.resultDraw}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mb-4">
                <label className="text-xs font-bold uppercase tracking-wider mb-2 block" style={{ color: "rgba(255,255,255,0.5)" }}>
                  {t.play.challenges.submitModal.result}
                </label>
                <input
                  type="text"
                  value={result}
                  onChange={(e) => setResult(e.target.value)}
                  placeholder={t.play.challenges.submitModal.resultPlaceholder}
                  className="w-full rounded-xl px-4 py-3 text-sm font-medium outline-none"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "#fff",
                  }}
                />
              </div>
            )}

            {/* Screenshot */}
            <div className="mb-4">
              <label className="text-xs font-bold uppercase tracking-wider mb-2 block" style={{ color: "rgba(255,255,255,0.5)" }}>
                {t.play.challenges.submitModal.screenshotLabel}
              </label>
              <label
                className="w-full rounded-xl border border-dashed p-6 flex flex-col items-center gap-2 cursor-pointer transition hover:border-cyan-500/30"
                style={{
                  borderColor: screenshot ? "rgba(0,200,255,0.3)" : "rgba(255,255,255,0.1)",
                  backgroundColor: screenshot ? "rgba(0,200,255,0.05)" : "transparent",
                }}
              >
                {screenshot ? (
                  <img src={screenshot} alt="Preview" className="max-h-32 rounded-lg object-contain" />
                ) : (
                  <>
                    <Camera className="w-6 h-6" style={{ color: "rgba(255,255,255,0.3)" }} />
                    <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                      {t.play.challenges.submitModal.screenshotHint}
                    </span>
                  </>
                )}
                <input type="file" accept="image/*" onChange={handleScreenshot} className="hidden" />
              </label>
            </div>

            {/* Submit button */}
            {submitError && (
              <p className="text-xs mb-3 text-center" style={{ color: "#fd2e5f" }}>
                {submitError}
              </p>
            )}

            {submitStatus === "success" ? (
              <p className="text-sm font-bold text-center" style={{ color: "#4ade80" }}>
                {t.play.challenges.submitModal.success}
              </p>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!result || submitStatus === "loading"}
                className="w-full rounded-xl px-4 py-3 text-sm font-bold flex items-center justify-center gap-2 transition disabled:opacity-30"
                style={{
                  backgroundColor: "rgba(0,200,255,0.15)",
                  border: "1px solid rgba(0,200,255,0.3)",
                  color: "#00c8ff",
                }}
              >
                <Send className="w-4 h-4" />
                {submitStatus === "loading" ? t.play.challenges.submitModal.submitting : t.play.challenges.submitModal.submit}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────

function getTimeRemaining(end: Date, now: Date): string {
  const diff = end.getTime() - now.getTime();
  if (diff <= 0) return "Terminé";

  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);

  if (days > 0) return `${days}j ${hours}h`;
  if (hours > 0) return `${hours}h`;
  return `${Math.floor(diff / 60000)}m`;
}

function formatResult(result: string, t: any): string {
  if (result === "win") return t.play.challenges.leaderboard.win;
  if (result === "loss") return t.play.challenges.leaderboard.loss;
  if (result === "draw") return t.play.challenges.leaderboard.draw;
  return result;
}
