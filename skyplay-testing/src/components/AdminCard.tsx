"use client";

import { useState } from "react";
import { Check, X, Loader2, Image as ImageIcon, MessageSquare } from "lucide-react";
import { useTranslation } from "@/lib/i18n/TranslationContext";

interface Submission {
  id: number;
  user_id: number;
  step_id: number;
  question_id: number;
  answer_text: string;
  status: string;
  submitted_at: string;
  username: string;
  email: string;
  step_slug: string;
  step_title: string;
  question_text: string;
  question_reward: number;
}

interface AdminCardProps {
  submission: Submission;
  onStatusChange: () => void;
}

function formatAnswer(answerText: string): React.ReactNode {
  try {
    const parsed = JSON.parse(answerText);
    if (Array.isArray(parsed)) {
      // Checkbox answers — show as badges
      return (
        <div className="flex flex-wrap gap-1.5">
          {(parsed as string[]).map((v) => (
            <span
              key={v}
              className="px-2.5 py-1 rounded-full text-xs font-bold border"
              style={{
                backgroundColor: "rgba(0,200,255,0.1)",
                borderColor: "rgba(0,200,255,0.3)",
                color: "#00c8ff",
              }}
            >
              {v}
            </span>
          ))}
        </div>
      );
    }
    if (typeof parsed === "object" && parsed !== null) {
      // Multi-part answers — show as label/value pairs
      return (
        <div className="space-y-2.5">
          {Object.entries(parsed).map(([label, value]) => (
            <div key={label}>
              <p className="text-xs text-white/40 font-medium mb-0.5">{label}</p>
              <p className="text-sm text-white/80 font-semibold">{String(value ?? "—")}</p>
            </div>
          ))}
        </div>
      );
    }
  } catch {
    // Not JSON — fall through to plain text
  }
  return <span className="text-sm text-white/80 leading-relaxed">{answerText}</span>;
}

export default function AdminCard({ submission, onStatusChange }: AdminCardProps) {
  const { t, locale } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [showScreenshot, setShowScreenshot] = useState(false);
  const [screenshotSrc, setScreenshotSrc] = useState<string | null>(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState<string | null>(null);

  const effectiveStatus = localStatus ?? submission.status;

  const handleAction = async (status: "APPROVED" | "REJECTED") => {
    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch("/api/admin/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ submissionId: submission.id, status }),
      });

      const data = await res.json();

      if (res.ok) {
        setLocalStatus(status);
        setSuccessMsg(data.message || (status === "APPROVED" ? t.admin.dashboard.approveSuccess : t.admin.dashboard.rejectSuccess));
        setLoading(false);
        // Refresh parent data after a brief delay so the user sees the confirmation
        setTimeout(() => {
          onStatusChange();
          setSuccessMsg(null);
        }, 1200);
      } else {
        setError(data.error || t.admin.dashboard.updateError);
        setLoading(false);
      }
    } catch {
      setError(t.admin.dashboard.networkError);
      setLoading(false);
    }
  };

  const statusConfig = {
    PENDING: {
      bg: "rgba(230,126,34,0.15)",
      border: "rgba(230,126,34,0.4)",
      color: "#e67e22",
    },
    APPROVED: {
      bg: "rgba(46,204,113,0.15)",
      border: "rgba(46,204,113,0.4)",
      color: "#2ecc71",
    },
    REJECTED: {
      bg: "rgba(253,46,95,0.15)",
      border: "rgba(253,46,95,0.4)",
      color: "#FD2E5F",
    },
  };

  const statusLabels: Record<string, string> = {
    PENDING: t.admin.dashboard.pendingLabel,
    APPROVED: t.admin.dashboard.approvedLabel,
    REJECTED: t.admin.dashboard.rejectedLabel,
  };

  const config =
    statusConfig[effectiveStatus as keyof typeof statusConfig] ||
    statusConfig.PENDING;

  return (
    <div
      className="rounded-2xl border overflow-hidden transition-all duration-200"
      style={{
        backgroundColor: "rgba(13,27,46,0.8)",
        borderColor: "rgba(255,255,255,0.08)",
      }}
    >
      {/* Header */}
      <div className="p-5 flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="px-2.5 py-1 rounded-full text-xs font-black"
              style={{
                backgroundColor: config.bg,
                border: `1px solid ${config.border}`,
                color: config.color,
              }}
            >
              {statusLabels[effectiveStatus]}
            </span>
            <span className="text-xs font-bold text-white/30 uppercase tracking-wider">
              {`${t.admin.dashboard.step} ${submission.step_slug.replace("jalon_", "")}`}
            </span>
          </div>
          <h3 className="font-black text-white text-base">{submission.step_title}</h3>
          <div className="flex items-center gap-3 text-xs text-white/40 flex-wrap">
            <span className="font-semibold text-white/60">{submission.username}</span>
            <span>·</span>
            <span>{submission.email}</span>
            <span>·</span>
            <span>
              {new Date(submission.submitted_at).toLocaleDateString(locale === "en" ? "en-US" : "fr-FR", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          <p
            className="text-xs flex items-center gap-1 mt-1 font-black"
            style={{ color: "#ffd700" }}
          >
            ⚡ +{submission.question_reward} Sky
          </p>
        </div>

        {/* Actions */}
        {effectiveStatus === "PENDING" && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => handleAction("APPROVED")}
              disabled={loading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-black uppercase tracking-wider transition disabled:opacity-50"
              style={{
                backgroundColor: "rgba(46,204,113,0.15)",
                border: "1px solid rgba(46,204,113,0.4)",
                color: "#2ecc71",
              }}
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              {t.admin.dashboard.approve}
            </button>
            <button
              onClick={() => handleAction("REJECTED")}
              disabled={loading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-black uppercase tracking-wider transition disabled:opacity-50"
              style={{
                backgroundColor: "rgba(253,46,95,0.15)",
                border: "1px solid rgba(253,46,95,0.4)",
                color: "#FD2E5F",
              }}
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <X className="w-3.5 h-3.5" />
              )}
              {t.admin.dashboard.reject}
            </button>
          </div>
        )}
        {effectiveStatus !== "PENDING" && (
          <span className="text-xs text-white/30 italic">{t.admin.dashboard.processed}</span>
        )}
      </div>

      {error && (
        <div className="mx-5 mb-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium animate-fade-in-up">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="mx-5 mb-3 p-3 rounded-xl bg-[#2ecc71]/10 border border-[#2ecc71]/25 text-[#2ecc71] text-xs font-bold animate-fade-in-up flex items-center gap-2">
          <Check className="w-4 h-4" />
          {successMsg}
        </div>
      )}

      {/* Question text */}
      <div className="px-5 pb-1">
        <div className="flex items-start gap-2 p-3 rounded-xl bg-[#00c8ff]/5 border border-[#00c8ff]/10">
          <MessageSquare className="w-4 h-4 text-[#00c8ff] shrink-0 mt-0.5" />
          <p className="text-xs text-white/60 leading-relaxed">
            {submission.question_text}
          </p>
        </div>
      </div>

      {/* Answer */}
      <div className="px-5 pt-3 pb-3">
        <div className="bg-white/[0.03] rounded-xl p-4 border border-white/5">
          {formatAnswer(submission.answer_text)}
        </div>
      </div>

      {/* Screenshot toggle — lazy-loaded on demand */}
      <div className="px-5 pb-5">
        <button
          onClick={() => {
            const newShow = !showScreenshot;
            setShowScreenshot(newShow);
            // Lazy-load screenshot only when first opened
            if (newShow && !screenshotSrc) {
              setScreenshotLoading(true);
              fetch(
                `/api/admin/submissions/${submission.id}/screenshot`,
                { credentials: "same-origin" }
              )
                .then((res) => res.json())
                .then((data) => {
                  if (data.screenshot_base64) {
                    setScreenshotSrc(data.screenshot_base64);
                  }
                })
                .catch(() => { /* silently fail */ })
                .finally(() => setScreenshotLoading(false));
            }
          }}
          className="flex items-center gap-2 text-xs font-bold text-[#00c8ff] hover:text-white transition"
        >
          <ImageIcon className="w-4 h-4" />
          {showScreenshot ? t.admin.dashboard.hideScreenshot : t.admin.dashboard.viewScreenshot}
        </button>

        {showScreenshot && (
          <div className="mt-3 rounded-xl overflow-hidden border border-white/10">
            {screenshotLoading ? (
              <div className="flex items-center justify-center h-32 bg-black/40">
                <Loader2 className="w-6 h-6 animate-spin text-[#00c8ff]" />
              </div>
            ) : screenshotSrc ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={screenshotSrc}
                alt={t.admin.dashboard.viewScreenshot}
                className="w-full max-h-96 object-contain bg-black/40"
              />
            ) : (
              <div className="flex items-center justify-center h-20 bg-black/40 text-white/30 text-xs">
                {t.admin.dashboard.screenshotUnavailable}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
