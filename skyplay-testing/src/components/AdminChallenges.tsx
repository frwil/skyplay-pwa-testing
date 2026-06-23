"use client";

import { useState, useEffect, useCallback } from "react";
import { Swords, Plus, X, Check, Ban, Loader2, Trash2 } from "lucide-react";

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
  createdAt: string;
  createdByName: string;
  submissionCount: number;
  approvedCount: number;
  pendingCount: number;
}

interface ChallengeSubmission {
  id: number;
  userId: number;
  username: string;
  result: string;
  screenshotBase64: string | null;
  status: string;
  submittedAt: string;
}

const SYSTEMS = ["nes", "snes", "gb", "gbc", "gba", "neogeo", "ps1"] as const;
const CRITERIA = [
  { key: "winloss", label: "Win/Loss/Draw" },
  { key: "score", label: "Score" },
  { key: "time", label: "Temps" },
];

export default function AdminChallenges() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Form state ────────────────────────────────────────
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [system, setSystem] = useState("snes");
  const [romName, setRomName] = useState("");
  const [criteria, setCriteria] = useState("winloss");
  const [reward, setReward] = useState(500);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // ── Detail / submission review ────────────────────────
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [subDetail, setSubDetail] = useState<{
    challenge: Challenge;
    submissions: ChallengeSubmission[];
  } | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  // ── Fetch challenges ──────────────────────────────────

  const fetchChallenges = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/challenges", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setChallenges(data.challenges);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChallenges();
  }, [fetchChallenges]);

  // ── Fetch challenge detail (submissions) ──────────────

  const fetchDetail = async (id: number) => {
    setSelectedId(id);
    try {
      const res = await fetch(`/api/admin/challenges/${id}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setSubDetail(data);
      }
    } catch {
      // ignore
    }
  };

  // ── Approve / Reject submission ───────────────────────

  const handleReview = async (submissionId: number, status: "APPROVED" | "REJECTED") => {
    setReviewLoading(true);
    try {
      const res = await fetch("/api/admin/challenge-submissions/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId, status }),
        credentials: "include",
      });

      if (res.ok && selectedId) {
        await fetchDetail(selectedId);
        await fetchChallenges(); // Refresh counts
      } else {
        const data = await res.json();
        setError(data.error || "Erreur lors de l'approbation");
      }
    } catch {
      setError("Erreur réseau");
    } finally {
      setReviewLoading(false);
    }
  };

  // ── Create challenge ──────────────────────────────────

  const handleCreate = async () => {
    if (!title || !romName || !startsAt || !endsAt) {
      setFormError("Tous les champs requis doivent être remplis");
      return;
    }

    setFormLoading(true);
    setFormError(null);
    setFormSuccess(null);

    try {
      const res = await fetch("/api/admin/challenges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, description, system, romName, criteria, reward,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
        }),
        credentials: "include",
      });

      if (res.ok) {
        setFormSuccess("Challenge créé avec succès !");
        setTitle(""); setDescription(""); setRomName(""); setReward(500);
        setStartsAt(""); setEndsAt("");
        setShowForm(false);
        fetchChallenges();
      } else {
        const data = await res.json();
        setFormError(data.error || "Erreur lors de la création");
      }
    } catch {
      setFormError("Erreur réseau");
    } finally {
      setFormLoading(false);
    }
  };

  // ── Render ────────────────────────────────────────────

  const now = new Date();

  return (
    <div className="space-y-6">
      {/* Header + Create button */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-black text-white flex items-center gap-2">
          <Swords className="w-5 h-5" style={{ color: "#00c8ff" }} />
          Challenges
        </h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-xl px-4 py-2.5 text-sm font-bold flex items-center gap-1.5 transition"
          style={{
            backgroundColor: showForm ? "rgba(253,46,95,0.1)" : "rgba(0,200,255,0.15)",
            border: showForm ? "1px solid rgba(253,46,95,0.3)" : "1px solid rgba(0,200,255,0.3)",
            color: showForm ? "#fd2e5f" : "#00c8ff",
          }}
        >
          {showForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {showForm ? "Annuler" : "Nouveau Challenge"}
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
          {error}
        </div>
      )}

      {/* ─── Create Form ─────────────────────────────────── */}
      {showForm && (
        <div
          className="rounded-2xl border p-6 space-y-4"
          style={{
            backgroundColor: "rgba(13,27,46,0.6)",
            borderColor: "rgba(0,200,255,0.15)",
          }}
        >
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] text-white/30 uppercase tracking-wider mb-1">Titre *</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="Street Fighter Challenge"
                className="w-full bg-[#0d1b2e] border border-white/10 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-[#00c8ff]/50 transition" />
            </div>
            <div>
              <label className="block text-[10px] text-white/30 uppercase tracking-wider mb-1">Système</label>
              <select value={system} onChange={(e) => setSystem(e.target.value)}
                className="w-full bg-[#0d1b2e] border border-white/10 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-[#00c8ff]/50 transition" >
                {SYSTEMS.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-white/30 uppercase tracking-wider mb-1">Nom du ROM *</label>
              <input type="text" value={romName} onChange={(e) => setRomName(e.target.value)}
                placeholder="Street Fighter 5 (Hack).smc"
                className="w-full bg-[#0d1b2e] border border-white/10 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-[#00c8ff]/50 transition" />
            </div>
            <div>
              <label className="block text-[10px] text-white/30 uppercase tracking-wider mb-1">Critère</label>
              <select value={criteria} onChange={(e) => setCriteria(e.target.value)}
                className="w-full bg-[#0d1b2e] border border-white/10 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-[#00c8ff]/50 transition" >
                {CRITERIA.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-white/30 uppercase tracking-wider mb-1">Récompense (Sky)</label>
              <input type="number" value={reward} onChange={(e) => setReward(Number(e.target.value))}
                className="w-full bg-[#0d1b2e] border border-white/10 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-[#00c8ff]/50 transition" />
            </div>
            <div>
              <label className="block text-[10px] text-white/30 uppercase tracking-wider mb-1">Début *</label>
              <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)}
                className="w-full bg-[#0d1b2e] border border-white/10 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-[#00c8ff]/50 transition" />
            </div>
            <div>
              <label className="block text-[10px] text-white/30 uppercase tracking-wider mb-1">Fin *</label>
              <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)}
                className="w-full bg-[#0d1b2e] border border-white/10 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-[#00c8ff]/50 transition" />
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-white/30 uppercase tracking-wider mb-1">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Décris les règles du challenge…"
              rows={2}
              className="w-full bg-[#0d1b2e] border border-white/10 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-[#00c8ff]/50 transition resize-none" />
          </div>

          {formError && <p className="text-xs text-red-400">{formError}</p>}
          {formSuccess && <p className="text-xs text-green-400">{formSuccess}</p>}

          <button
            onClick={handleCreate}
            disabled={formLoading}
            className="w-full py-3 rounded-xl font-black text-sm uppercase tracking-wider bg-[#00c8ff]/15 border border-[#00c8ff]/30 text-[#00c8ff] hover:bg-[#00c8ff]/25 transition disabled:opacity-50"
          >
            {formLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Créer le Challenge"}
          </button>
        </div>
      )}

      {/* ─── Challenges List ─────────────────────────────── */}
      {loading ? (
        <div className="text-center py-8">
          <Loader2 className="w-6 h-6 animate-spin mx-auto" style={{ color: "rgba(0,200,255,0.5)" }} />
        </div>
      ) : challenges.length === 0 ? (
        <div
          className="rounded-2xl border p-8 text-center"
          style={{
            backgroundColor: "rgba(13,27,46,0.6)",
            borderColor: "rgba(255,255,255,0.06)",
          }}
        >
          <Swords className="w-10 h-10 mx-auto mb-3" style={{ color: "rgba(255,255,255,0.15)" }} />
          <p style={{ color: "rgba(255,255,255,0.4)" }}>Aucun challenge</p>
        </div>
      ) : (
        <div className="space-y-3">
          {challenges.map((ch) => {
            const isActive = new Date(ch.startsAt) <= now && new Date(ch.endsAt) > now;
            return (
              <button
                key={ch.id}
                onClick={() => fetchDetail(ch.id)}
                className="w-full text-left rounded-2xl border p-5 transition hover:scale-[1.01]"
                style={{
                  backgroundColor: "rgba(13,27,46,0.6)",
                  borderColor: selectedId === ch.id ? "rgba(0,200,255,0.3)" : "rgba(255,255,255,0.06)",
                }}
              >
                <div className="flex items-start justify-between flex-wrap gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-black text-white truncate">{ch.title}</h3>
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0"
                        style={{
                          backgroundColor: isActive ? "rgba(46,204,113,0.15)" : "rgba(255,255,255,0.05)",
                          color: isActive ? "#2ecc71" : "rgba(255,255,255,0.4)",
                        }}
                      >
                        {isActive ? "Actif" : "Terminé"}
                      </span>
                    </div>
                    <p className="text-xs mb-2" style={{ color: "rgba(255,255,255,0.3)" }}>
                      {ch.romName} • {ch.system.toUpperCase()} • {ch.criteria}
                    </p>
                  </div>
                  <div className="flex gap-3 text-xs text-right shrink-0">
                    <div>
                      <span className="text-white/30">Soumis</span>
                      <p className="font-bold text-white">{ch.submissionCount}</p>
                    </div>
                    <div>
                      <span className="text-green-400/60">Validés</span>
                      <p className="font-bold text-green-400">{ch.approvedCount}</p>
                    </div>
                    <div>
                      <span className="text-yellow-500/60">En attente</span>
                      <p className="font-bold text-yellow-500">{ch.pendingCount}</p>
                    </div>
                    <div>
                      <span className="text-[#ffd700]/60">Récompense</span>
                      <p className="font-bold" style={{ color: "#ffd700" }}>{ch.reward}</p>
                    </div>
                  </div>
                </div>

                {/* Submission review (inline expand) */}
                {selectedId === ch.id && subDetail && (
                  <div className="mt-4 pt-4 border-t border-white/5" onClick={(e) => e.stopPropagation()}>
                    {subDetail.submissions.length === 0 ? (
                      <p className="text-xs py-3 text-center" style={{ color: "rgba(255,255,255,0.3)" }}>
                        Aucune soumission pour ce challenge
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {subDetail.submissions.map((sub) => (
                          <div
                            key={sub.id}
                            className="rounded-xl p-3 flex items-center gap-3 flex-wrap"
                            style={{ backgroundColor: "rgba(255,255,255,0.03)" }}
                          >
                            <span className="flex-1 min-w-0">
                              <span className="text-xs font-bold text-white block truncate">{sub.username}</span>
                              <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                                {formatAdminResult(sub.result)} • {new Date(sub.submittedAt).toLocaleString("fr")}
                              </span>
                            </span>

                            {/* Screenshot viewer */}
                            {sub.screenshotBase64 && (
                              <a
                                href={sub.screenshotBase64}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] font-bold underline"
                                style={{ color: "rgba(0,200,255,0.5)" }}
                              >
                                Voir capture
                              </a>
                            )}

                            {sub.status === "PENDING" ? (
                              <div className="flex gap-1.5">
                                <button
                                  onClick={() => handleReview(sub.id, "APPROVED")}
                                  disabled={reviewLoading}
                                  className="rounded-lg p-1.5 transition disabled:opacity-30"
                                  style={{ backgroundColor: "rgba(46,204,113,0.1)", color: "#2ecc71" }}
                                  title="Approuver"
                                >
                                  <Check className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleReview(sub.id, "REJECTED")}
                                  disabled={reviewLoading}
                                  className="rounded-lg p-1.5 transition disabled:opacity-30"
                                  style={{ backgroundColor: "rgba(253,46,95,0.1)", color: "#fd2e5f" }}
                                  title="Rejeter"
                                >
                                  <Ban className="w-4 h-4" />
                                </button>
                              </div>
                            ) : (
                              <span
                                className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                                style={{
                                  backgroundColor: sub.status === "APPROVED" ? "rgba(46,204,113,0.15)" : "rgba(253,46,95,0.1)",
                                  color: sub.status === "APPROVED" ? "#2ecc71" : "#fd2e5f",
                                }}
                              >
                                {sub.status === "APPROVED" ? "Validé" : "Refusé"}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatAdminResult(result: string): string {
  if (result === "win") return "Victoire";
  if (result === "loss") return "Défaite";
  if (result === "draw") return "Match nul";
  return result;
}
