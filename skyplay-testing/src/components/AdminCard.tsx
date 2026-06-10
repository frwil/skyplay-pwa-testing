"use client";

import { useState } from "react";
import { Check, X, Loader2, Image as ImageIcon, MessageSquare } from "lucide-react";

interface Submission {
  id: number;
  user_id: number;
  step_id: number;
  question_id: number;
  answer_text: string;
  screenshot_base64: string;
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

export default function AdminCard({ submission, onStatusChange }: AdminCardProps) {
  const [loading, setLoading] = useState(false);
  const [showScreenshot, setShowScreenshot] = useState(false);
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
        setSuccessMsg(data.message || (status === "APPROVED" ? "✅ Approuvé !" : "❌ Rejeté"));
        setLoading(false);
        // Refresh parent data after a brief delay so the user sees the confirmation
        setTimeout(() => {
          onStatusChange();
          setSuccessMsg(null);
        }, 1200);
      } else {
        setError(data.error || "Erreur lors de la mise à jour");
        setLoading(false);
      }
    } catch {
      setError("Erreur réseau");
      setLoading(false);
    }
  };

  const statusConfig = {
    PENDING: {
      bg: "rgba(230,126,34,0.15)",
      border: "rgba(230,126,34,0.4)",
      color: "#e67e22",
      label: "EN ATTENTE",
    },
    APPROVED: {
      bg: "rgba(46,204,113,0.15)",
      border: "rgba(46,204,113,0.4)",
      color: "#2ecc71",
      label: "APPROUVÉ",
    },
    REJECTED: {
      bg: "rgba(253,46,95,0.15)",
      border: "rgba(253,46,95,0.4)",
      color: "#FD2E5F",
      label: "REJETÉ",
    },
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
              {config.label}
            </span>
            <span className="text-xs font-bold text-white/30 uppercase tracking-wider">
              {submission.step_slug.replace("jalon_", "JALON ")}
            </span>
          </div>
          <h3 className="font-black text-white text-base">{submission.step_title}</h3>
          <div className="flex items-center gap-3 text-xs text-white/40 flex-wrap">
            <span className="font-semibold text-white/60">{submission.username}</span>
            <span>·</span>
            <span>{submission.email}</span>
            <span>·</span>
            <span>
              {new Date(submission.submitted_at).toLocaleDateString("fr-FR", {
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
              Approuver
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
              Rejeter
            </button>
          </div>
        )}
        {effectiveStatus !== "PENDING" && (
          <span className="text-xs text-white/30 italic">Traité</span>
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
        <p className="text-sm text-white/80 bg-white/[0.03] rounded-xl p-4 border border-white/5 leading-relaxed">
          {submission.answer_text}
        </p>
      </div>

      {/* Screenshot toggle */}
      <div className="px-5 pb-5">
        <button
          onClick={() => setShowScreenshot(!showScreenshot)}
          className="flex items-center gap-2 text-xs font-bold text-[#00c8ff] hover:text-white transition"
        >
          <ImageIcon className="w-4 h-4" />
          {showScreenshot ? "Masquer la capture" : "Voir la capture d'écran"}
        </button>

        {showScreenshot && (
          <div className="mt-3 rounded-xl overflow-hidden border border-white/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={submission.screenshot_base64}
              alt="Capture d'écran"
              className="w-full max-h-96 object-contain bg-black/40"
            />
          </div>
        )}
      </div>
    </div>
  );
}
