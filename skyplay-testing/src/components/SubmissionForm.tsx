"use client";

import { useState, useRef, useEffect } from "react";
import {
  Camera,
  Video,
  Send,
  CheckCircle,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Trophy,
  Circle,
  Check,
  X,
  ChevronLeft,
} from "lucide-react";

interface Question {
  id: number;
  question_text: string;
  reward_amount: number;
  sort_order: number;
}

interface StepWithQuestions {
  id: number;
  slug: string;
  title: string;
  questions: Question[];
}

interface CompletedInfo {
  id: number;
  status: string;
}

interface SubmissionFormProps {
  userId: number;
  steps: StepWithQuestions[];
  completedMap: Map<number, CompletedInfo>;
  apiUrl?: string;
}

export default function SubmissionForm({
  userId,
  steps,
  completedMap,
  apiUrl = "/api/submit",
}: SubmissionFormProps) {
  const [activeQuestionId, setActiveQuestionId] = useState<number | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<"image" | "video" | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(
    new Set([1])
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoCameraInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const allQuestions = steps.flatMap((s) =>
    s.questions.map((q) => ({
      ...q,
      stepId: s.id,
      stepSlug: s.slug,
      stepTitle: s.title,
    }))
  );
  const totalQuestions = allQuestions.length;
  const completedCount = Array.from(completedMap.values()).filter(
    (c) => c.status === "APPROVED" || c.status === "PENDING"
  ).length;
  const progressPct =
    totalQuestions > 0 ? (completedCount / totalQuestions) * 100 : 0;
  const allCompleted = totalQuestions > 0 && completedCount >= totalQuestions;

  const activeQuestion = allQuestions.find((q) => q.id === activeQuestionId);
  const activeStep = steps.find((s) => s.id === activeQuestion?.stepId);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (activeQuestionId !== null) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [activeQuestionId]);

  // Close modal on Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActiveQuestionId(null);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const getQuestionStatus = (questionId: number | null) => {
    if (questionId === null) return "idle";
    const info = completedMap.get(questionId);
    if (!info) return "idle";
    if (info.status === "APPROVED") return "approved";
    if (info.status === "REJECTED") return "rejected";
    return "pending";
  };

  const getStepProgress = (stepId: number) => {
    const step = steps.find((s) => s.id === stepId);
    if (!step) return { done: 0, total: 0 };
    const total = step.questions.length;
    const done = step.questions.filter((q) => {
      const s = getQuestionStatus(q.id);
      return s === "approved" || s === "pending";
    }).length;
    return { done, total };
  };

  const toggleStep = (stepId: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  };

  const openQuestion = (questionId: number) => {
    const q = allQuestions.find((x) => x.id === questionId);
    if (!q) return;
    // Bloquer l'ouverture si la question a déjà été répondue
    if (getQuestionStatus(questionId) !== "idle") return;
    setActiveQuestionId(questionId);
    setAnswerText("");
    setScreenshot(null);
    setMediaType(null);
    setResult(null);
    setExpandedSteps((prev) => new Set(prev).add(q.stepId));
  };

  const closeModal = () => {
    setActiveQuestionId(null);
    setAnswerText("");
    setScreenshot(null);
    setMediaType(null);
    setResult(null);
  };

  const navigateQuestion = (direction: "prev" | "next") => {
    if (!activeQuestionId) return;
    const currentIdx = allQuestions.findIndex(
      (q) => q.id === activeQuestionId
    );
    const newIdx = direction === "next" ? currentIdx + 1 : currentIdx - 1;
    if (newIdx >= 0 && newIdx < allQuestions.length) {
      openQuestion(allQuestions[newIdx].id);
    }
  };

  const currentIdx = allQuestions.findIndex((q) => q.id === activeQuestionId);
  const canGoPrev = currentIdx > 0;
  const canGoNext = currentIdx < allQuestions.length - 1;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isVideo = file.type.startsWith("video/");
    const isImage = file.type.startsWith("image/");

    if (!isImage && !isVideo) {
      setResult({
        type: "error",
        message: "Format non supporté. Utilise une image ou une vidéo.",
      });
      return;
    }

    // Size limits: 10 MB for images, 40 MB for videos
    const maxSize = isVideo ? 40 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxSize) {
      setResult({
        type: "error",
        message: isVideo
          ? "La vidéo ne doit pas dépasser 40 Mo"
          : "L'image ne doit pas dépasser 10 Mo",
      });
      return;
    }

    // For videos, check duration
    if (isVideo) {
      const videoEl = document.createElement("video");
      videoEl.preload = "metadata";
      videoEl.onloadedmetadata = () => {
        if (videoEl.duration > 10) {
          setResult({
            type: "error",
            message: `La vidéo dure ${Math.round(videoEl.duration)}s. Maximum autorisé : 10 secondes.`,
          });
          URL.revokeObjectURL(videoEl.src);
          return;
        }
        // Duration OK, read as base64
        URL.revokeObjectURL(videoEl.src);
        readFileAsBase64(file, "video");
      };
      videoEl.onerror = () => {
        URL.revokeObjectURL(videoEl.src);
        setResult({
          type: "error",
          message: "Impossible de lire cette vidéo. Vérifie le format.",
        });
      };
      videoEl.src = URL.createObjectURL(file);
      return;
    }

    // Image: read directly
    readFileAsBase64(file, "image");
  };

  const readFileAsBase64 = (file: File, type: "image" | "video") => {
    const reader = new FileReader();
    reader.onload = () => {
      setScreenshot(reader.result as string);
      setMediaType(type);
      setResult(null);
    };
    reader.onerror = () => {
      setResult({
        type: "error",
        message: "Erreur lors de la lecture du fichier.",
      });
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!activeQuestionId) {
      setResult({
        type: "error",
        message: "Sélectionne une question à répondre",
      });
      return;
    }

    if (!answerText.trim()) {
      setResult({ type: "error", message: "Rédige ta réponse" });
      return;
    }

    if (!screenshot) {
      setResult({
        type: "error",
        message: "Ajoute une capture d'écran comme preuve",
      });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          questionId: activeQuestionId,
          answerText: answerText.trim(),
          screenshot,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        completedMap.set(activeQuestionId, {
          id: data.submission.id,
          status: "PENDING",
        });
        setResult({
          type: "success",
          message: `Réponse soumise ! +${data.submission.reward} Sky — En attente de validation.`,
        });
        setAnswerText("");
        setScreenshot(null);
      } else {
        setResult({
          type: "error",
          message: data.error || "Erreur lors de la soumission",
        });
      }
    } catch {
      setResult({
        type: "error",
        message: "Erreur réseau. Vérifie ta connexion.",
      });
    } finally {
      setLoading(false);
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "approved":
        return <CheckCircle className="w-4 h-4 text-[#2ecc71]" />;
      case "pending":
        return (
          <div className="w-4 h-4 rounded-full border-2 border-[#e67e22] flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-[#e67e22] animate-pulse" />
          </div>
        );
      case "rejected":
        return <AlertCircle className="w-4 h-4 text-[#FD2E5F]" />;
      default:
        return <Circle className="w-4 h-4 text-white/15" />;
    }
  };

  return (
    <div className="space-y-6 relative z-10">
      {/* ── Global progress bar ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-white/40 uppercase tracking-[2px] font-bold">
            🏆 Progression
          </span>
          <span className="font-black" style={{ color: "#ffd700" }}>
            {completedCount}/{totalQuestions} questions
          </span>
        </div>
        <div className="h-2 rounded-full bg-white/[0.05] overflow-hidden border border-white/5">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${progressPct}%`,
              background: "linear-gradient(90deg, #00c8ff, #2ecc71)",
              boxShadow: "0 0 10px rgba(0,200,255,0.4)",
            }}
          />
        </div>
      </div>

      {/* ── Congratulations banner ── */}
      {allCompleted && (
        <div
          className="p-5 rounded-2xl border text-center space-y-3 animate-fade-in-up"
          style={{
            background: "linear-gradient(135deg, rgba(0,200,255,0.08) 0%, rgba(46,204,113,0.08) 100%)",
            borderColor: "rgba(46,204,113,0.3)",
          }}
        >
          <div className="text-4xl">🎉</div>
          <h3 className="text-lg font-black text-white">
            Félicitations&nbsp;!
          </h3>
          <p className="text-sm text-white/70 leading-relaxed">
            Tu as répondu aux <span className="font-bold text-[#ffd700]">16 questions</span> du
            programme de test. Merci pour ta précieuse contribution&nbsp;!
          </p>
          <p className="text-xs text-white/40 leading-relaxed">
            L&rsquo;équipe <span className="font-bold text-[#00c8ff]">skyplay.cloud</span> va
            examiner tes réponses. Tu recevras une notification très bientôt avec le
            récapitulatif de tes gains en <span style={{ color: "#ffd700" }}>Sky</span>.
          </p>
          <div
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold"
            style={{
              backgroundColor: "rgba(46,204,113,0.1)",
              border: "1px solid rgba(46,204,113,0.3)",
              color: "#2ecc71",
            }}
          >
            <Trophy className="w-4 h-4" />
            Test terminé — en attente de validation
          </div>
        </div>
      )}

      {/* ── Jalons accordion ── */}
      <div className="space-y-2">
        {steps.map((step) => {
          const { done, total } = getStepProgress(step.id);
          const isExpanded = expandedSteps.has(step.id);
          const stepComplete = done === total && total > 0;

          return (
            <div
              key={step.id}
              className="rounded-2xl border overflow-hidden transition-all duration-200"
              style={{
                backgroundColor: isExpanded
                  ? "rgba(13,27,46,0.8)"
                  : "rgba(13,27,46,0.4)",
                borderColor: stepComplete
                  ? "rgba(46,204,113,0.3)"
                  : isExpanded
                  ? "rgba(255,255,255,0.12)"
                  : "rgba(255,255,255,0.05)",
              }}
            >
              {/* Step header */}
              <button
                onClick={() => toggleStep(step.id)}
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/[0.02] transition min-h-[52px]"
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-black shrink-0 ${
                    stepComplete
                      ? "bg-[#2ecc71]/15 text-[#2ecc71]"
                      : "bg-white/5 text-white/40"
                  }`}
                >
                  {stepComplete ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    step.slug.replace("jalon_", "")
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-black text-white truncate">
                    {step.title}
                  </h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <div className="h-1 flex-1 max-w-[80px] rounded-full bg-white/[0.06] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#00c8ff] transition-all"
                        style={{
                          width: `${total > 0 ? (done / total) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <span className="text-[10px] text-white/30 font-medium">
                      {done}/{total}
                    </span>
                  </div>
                </div>
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-white/30" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-white/30" />
                )}
              </button>

              {/* Questions list */}
              {isExpanded && (
                <div className="border-t border-white/5 px-3 sm:px-4 pb-3 pt-1.5 space-y-1.5">
                  {step.questions.map((q) => {
                    const qStatus = getQuestionStatus(q.id);
                    const isDone =
                      qStatus === "approved" || qStatus === "pending";

                    return (
                      <button
                        key={q.id}
                        onClick={() => openQuestion(q.id)}
                        disabled={isDone}
                        className={`w-full flex items-start gap-3 p-3 rounded-xl text-left transition-all duration-200 min-h-[48px] ${
                          isDone
                            ? "bg-white/[0.02] border border-transparent cursor-default opacity-60"
                            : "bg-white/[0.01] border border-transparent hover:bg-white/[0.04] active:bg-[#00c8ff]/10 cursor-pointer"
                        }`}
                      >
                        <div className="shrink-0 mt-0.5">
                          {statusIcon(qStatus)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p
                            className={`text-xs leading-snug ${
                              isDone
                                ? "text-white/50 line-clamp-3"
                                : "text-white/70 line-clamp-3"
                            }`}
                          >
                            <span className="font-bold text-white/60">
                              Q{q.sort_order}.
                            </span>{" "}
                            {q.question_text}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 text-[10px] font-black px-2 py-0.5 rounded-full mt-0.5 ${
                            isDone
                              ? "bg-white/5 text-white/25"
                              : "bg-[#ffd700]/10 text-[#ffd700]"
                          }`}
                        >
                          +{q.reward_amount} ⚡
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ═══════════════════════════════════════════
         MODAL — Full-screen question/answer form
         ═══════════════════════════════════════════ */}
      {activeQuestion && activeStep && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          aria-modal="true"
          role="dialog"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={closeModal}
          />

          {/* Modal panel — slides up on mobile */}
          <div
            ref={modalRef}
            className="relative w-full sm:max-w-lg sm:rounded-3xl max-h-[95vh] overflow-y-auto flex flex-col shadow-2xl animate-fade-in-up"
            style={{
              backgroundColor: "#0d1b2e",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            {/* ── Top bar ── */}
            <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-white/5 bg-[#0d1b2e]/95 backdrop-blur-sm rounded-t-3xl">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-black"
                  style={{
                    backgroundColor: "rgba(0,200,255,0.1)",
                    color: "#00c8ff",
                  }}
                >
                  {activeStep.slug.replace("jalon_", "JALON ")}
                </span>
                <span className="text-[10px] text-white/30 truncate">
                  Q{activeQuestion.sort_order}/{activeStep.questions.length}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {/* Prev/Next arrows in top bar */}
                <button
                  onClick={() => navigateQuestion("prev")}
                  disabled={!canGoPrev}
                  className="p-2 rounded-full text-white/30 hover:text-white hover:bg-white/5 transition disabled:opacity-20"
                  aria-label="Question précédente"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={() => navigateQuestion("next")}
                  disabled={!canGoNext}
                  className="p-2 rounded-full text-white/30 hover:text-white hover:bg-white/5 transition disabled:opacity-20"
                  aria-label="Question suivante"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
                <button
                  onClick={closeModal}
                  className="p-2 rounded-full text-white/40 hover:text-white hover:bg-white/5 transition ml-1"
                  aria-label="Fermer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* ── Scrollable body ── */}
            <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-5 space-y-5">
              {/* Full question text */}
              <div>
                <p className="text-sm sm:text-base text-white/90 leading-relaxed font-medium">
                  {activeQuestion.question_text}
                </p>
                <div className="flex items-center gap-1.5 mt-3">
                  <Trophy
                    className="w-4 h-4"
                    style={{ color: "#ffd700" }}
                  />
                  <span
                    className="text-sm font-black"
                    style={{ color: "#ffd700" }}
                  >
                    +{activeQuestion.reward_amount} Sky
                  </span>
                </div>
              </div>

              {/* Answer text */}
              <div className="space-y-1.5">
                <label className="block text-[11px] font-bold uppercase tracking-[2px] text-white/30">
                  Ta réponse
                </label>
                <textarea
                  rows={4}
                  value={answerText}
                  onChange={(e) => {
                    setAnswerText(e.target.value);
                    setResult(null);
                  }}
                  placeholder="Écris ta réponse ici..."
                  className="w-full bg-[#070f1e] border border-white/10 rounded-xl p-3.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#00c8ff]/50 focus:ring-1 focus:ring-[#00c8ff]/30 transition resize-none"
                />
              </div>

              {/* Media upload (image or short video) */}
              <div className="space-y-1.5">
                <label className="block text-[11px] font-bold uppercase tracking-[2px] text-white/30">
                  Preuve (capture d&apos;écran ou courte vidéo)
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
                {/* Hidden inputs */}
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <input
                  ref={videoCameraInputRef}
                  type="file"
                  accept="video/*"
                  capture="environment"
                  onChange={handleFileChange}
                  className="hidden"
                />
                {screenshot ? (
                  <div className="relative rounded-xl overflow-hidden border border-[#2ecc71]/30">
                    {mediaType === "video" ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <video
                        src={screenshot}
                        controls
                        className="w-full max-h-56 bg-black/30"
                        preload="metadata"
                      />
                    ) : (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={screenshot}
                        alt="Capture"
                        className="w-full max-h-56 object-contain bg-black/30"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setScreenshot(null);
                        setMediaType(null);
                        if (fileInputRef.current)
                          fileInputRef.current.value = "";
                        if (cameraInputRef.current)
                          cameraInputRef.current.value = "";
                        if (videoCameraInputRef.current)
                          videoCameraInputRef.current.value = "";
                      }}
                      className="absolute top-2 right-2 px-3 py-1.5 rounded-full bg-red-500/80 text-white text-xs font-bold hover:bg-red-600 transition z-10"
                    >
                      ✕ Supprimer
                    </button>
                    <div className="absolute bottom-2 left-2 px-3 py-1 rounded-full bg-[#2ecc71]/20 border border-[#2ecc71]/40 text-[#2ecc71] text-[10px] font-bold flex items-center gap-1">
                      {mediaType === "video" ? (
                        <Video className="w-3 h-3" />
                      ) : (
                        <CheckCircle className="w-3 h-3" />
                      )}
                      {mediaType === "video" ? "Vidéo prête" : "Capture prête"}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Photo + Video camera buttons */}
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        className="flex flex-col items-center justify-center gap-2 py-7 rounded-xl border-2 border-dashed border-[#00c8ff]/25 hover:border-[#00c8ff]/50 hover:bg-[#00c8ff]/5 transition active:bg-[#00c8ff]/10 group"
                      >
                        <Camera className="w-8 h-8 text-[#00c8ff]/60 group-hover:text-[#00c8ff] transition" />
                        <span className="text-xs font-bold text-white/50 group-hover:text-white transition">
                          Photo
                        </span>
                        <span className="text-[10px] text-white/20">
                          Appareil photo
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => videoCameraInputRef.current?.click()}
                        className="flex flex-col items-center justify-center gap-2 py-7 rounded-xl border-2 border-dashed border-[#FD2E5F]/20 hover:border-[#FD2E5F]/40 hover:bg-[#FD2E5F]/5 transition active:bg-[#FD2E5F]/10 group"
                      >
                        <Video className="w-8 h-8 text-[#FD2E5F]/50 group-hover:text-[#FD2E5F] transition" />
                        <span className="text-xs font-bold text-white/50 group-hover:text-white transition">
                          Vidéo
                        </span>
                        <span className="text-[10px] text-white/20">
                          Max 10 secondes
                        </span>
                      </button>
                    </div>

                    {/* Gallery fallback */}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full py-3 rounded-xl text-xs text-white/25 hover:text-white/50 transition text-center"
                    >
                      ou choisir depuis la galerie…
                    </button>
                  </div>
                )}
              </div>

              {/* Result feedback */}
              {result && (
                <div
                  className={`flex items-start gap-2.5 p-3.5 rounded-xl border text-xs ${
                    result.type === "success"
                      ? "bg-[#2ecc71]/10 border-[#2ecc71]/25 text-[#2ecc71]"
                      : "bg-red-500/10 border-red-500/25 text-red-400"
                  }`}
                >
                  {result.type === "success" ? (
                    <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <span className="font-medium">{result.message}</span>
                </div>
              )}
            </div>

            {/* ── Bottom bar (submit) ── */}
            <div className="sticky bottom-0 px-4 sm:px-5 py-4 border-t border-white/5 bg-[#0d1b2e]/95 backdrop-blur-sm rounded-b-3xl">
              {/* Desktop: inline row */}
              <div className="hidden sm:flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => navigateQuestion("prev")}
                  disabled={!canGoPrev}
                  className="shrink-0 flex items-center justify-center w-11 h-11 rounded-full text-white/40 hover:text-white border border-white/10 hover:border-white/20 transition disabled:opacity-15"
                  aria-label="Précédente"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>

                <button
                  type="submit"
                  onClick={handleSubmit}
                  disabled={
                    loading ||
                    getQuestionStatus(activeQuestionId) !== "idle"
                  }
                  className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-full font-black text-sm uppercase tracking-wider transition disabled:opacity-40 disabled:cursor-not-allowed min-h-[48px]"
                  style={{
                    background:
                      "linear-gradient(90deg, #00c8ff 0%, #0097fc 100%)",
                    color: "#070f1e",
                    boxShadow: "0 0 20px rgba(0,200,255,0.4)",
                  }}
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Envoi...
                    </>
                  ) : getQuestionStatus(activeQuestionId) !== "idle" ? (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      Déjà répondu
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Soumettre +{activeQuestion.reward_amount} Sky
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => navigateQuestion("next")}
                  disabled={!canGoNext}
                  className="shrink-0 flex items-center justify-center w-11 h-11 rounded-full text-white/40 hover:text-white border border-white/10 hover:border-white/20 transition disabled:opacity-15"
                  aria-label="Suivante"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>

              {/* Mobile: stacked layout */}
              <div className="flex flex-col gap-2 sm:hidden">
                <button
                  type="submit"
                  onClick={handleSubmit}
                  disabled={
                    loading ||
                    getQuestionStatus(activeQuestionId) !== "idle"
                  }
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full font-black text-sm uppercase tracking-wider transition disabled:opacity-40 disabled:cursor-not-allowed min-h-[48px]"
                  style={{
                    background:
                      "linear-gradient(90deg, #00c8ff 0%, #0097fc 100%)",
                    color: "#070f1e",
                    boxShadow: "0 0 20px rgba(0,200,255,0.4)",
                  }}
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Envoi...
                    </>
                  ) : getQuestionStatus(activeQuestionId) !== "idle" ? (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      Déjà répondu
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Soumettre +{activeQuestion.reward_amount} Sky
                    </>
                  )}
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => navigateQuestion("prev")}
                    disabled={!canGoPrev}
                    className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-full text-sm font-bold text-white/50 hover:text-white border border-white/10 hover:border-white/20 transition disabled:opacity-15 min-h-[44px]"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Précédente
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateQuestion("next")}
                    disabled={!canGoNext}
                    className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-full text-sm font-bold text-white/50 hover:text-white border border-white/10 hover:border-white/20 transition disabled:opacity-15 min-h-[44px]"
                  >
                    Suivante
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
