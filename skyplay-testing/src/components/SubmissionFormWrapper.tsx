"use client";

import { useState, useEffect } from "react";
import SubmissionForm from "./SubmissionForm";
import { LogIn, UserPlus } from "lucide-react";

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

interface SubmissionFormWrapperProps {
  steps: StepWithQuestions[];
}

export default function SubmissionFormWrapper({
  steps,
}: SubmissionFormWrapperProps) {
  const [userId, setUserId] = useState<number | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [registeredPin, setRegisteredPin] = useState<string | null>(null);
  const [showResetEmail, setShowResetEmail] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedMap, setCompletedMap] = useState<Map<number, CompletedInfo>>(
    new Map()
  );

  // Load completed submissions for this user
  useEffect(() => {
    if (!userId) {
      setCompletedMap(new Map());
      return;
    }

    const fetchCompleted = async () => {
      try {
        const res = await fetch(
          `/api/users/submissions?userId=${userId}`
        );
        if (res.ok) {
          const data = await res.json();
          const map = new Map<number, CompletedInfo>();
          data.submissions.forEach(
            (s: { question_id: number; id: number; status: string }) => {
              map.set(s.question_id, { id: s.id, status: s.status });
            }
          );
          setCompletedMap(map);
        }
      } catch {
        // Silently fail — will show all questions as unanswered
      }
    };

    fetchCompleted();
  }, [userId]);

  const handleRegister = async () => {
    if (!username.trim() || !email.trim()) {
      setError("Tous les champs sont requis");
      return;
    }

    if (!email.includes("@")) {
      setError("Email invalide");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/users/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          email: email.trim(),
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setUserId(data.user.id);
        setRegisteredPin(data.message); // Show email confirmation message
      } else {
        setError(data.error || "Erreur d'inscription");
      }
    } catch {
      setError("Erreur réseau");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!username.trim() || !pin.trim()) {
      setError("Nom d'utilisateur et code PIN requis");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        username: username.trim(),
        pin: pin.trim(),
      });
      const res = await fetch(`/api/users/lookup?${params}`);
      const data = await res.json();

      if (res.ok && data.user) {
        setUserId(data.user.id);
      } else {
        setError(data.error || "Identifiants invalides");
      }
    } catch {
      setError("Erreur réseau");
    } finally {
      setLoading(false);
    }
  };

  // Auth screen
  if (!userId) {
    return (
      <div className="space-y-5">
        <div className="flex gap-1 p-1 rounded-2xl bg-white/[0.04] border border-white/5">
          <button
            onClick={() => {
              setMode("login");
              setError(null);
            }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-bold transition ${
              mode === "login"
                ? "bg-[#00c8ff]/15 text-[#00c8ff]"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            <LogIn className="w-4 h-4" />
            Connexion
          </button>
          <button
            onClick={() => {
              setMode("register");
              setError(null);
            }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-bold transition ${
              mode === "register"
                ? "bg-[#00c8ff]/15 text-[#00c8ff]"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            <UserPlus className="w-4 h-4" />
            Inscription
          </button>
        </div>

        <div className="space-y-3">
          <input
            type="text"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setError(null);
            }}
            placeholder="Nom d'utilisateur"
            className="w-full bg-[#0d1b2e] border border-white/10 rounded-2xl p-3.5 text-white placeholder:text-white/25 focus:outline-none focus:border-[#00c8ff]/50 focus:ring-1 focus:ring-[#00c8ff]/30 transition"
          />

          {mode === "register" && (
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              placeholder="Email"
              className="w-full bg-[#0d1b2e] border border-white/10 rounded-2xl p-3.5 text-white placeholder:text-white/25 focus:outline-none focus:border-[#00c8ff]/50 focus:ring-1 focus:ring-[#00c8ff]/30 transition"
              style={{ animation: "fadeInUp 0.3s ease-out" }}
            />
          )}

          {/* PIN field — only for login */}
          {mode === "login" && (
            <div className="space-y-1.5">
              {/* Success message after PIN reset */}
              {resetSuccess ? (
                <div
                  className="p-3 rounded-xl border text-center animate-fade-in-up"
                  style={{ backgroundColor: "rgba(46,204,113,0.08)", borderColor: "rgba(46,204,113,0.3)" }}
                >
                  <p className="text-xs text-[#2ecc71] font-bold">✅ Email envoyé</p>
                  <p className="text-[11px] text-white/50 mt-1">
                    Vérifie tes emails et reconnecte-toi avec ton nouveau PIN.
                  </p>
                  <button
                    type="button"
                    onClick={() => { setResetSuccess(false); setPin(""); setShowResetEmail(false); setEmail(""); }}
                    className="mt-2 text-xs text-[#00c8ff] hover:underline"
                  >
                    Revenir à la connexion
                  </button>
                </div>
              ) : showResetEmail ? (
                /* Reset email form */
                <div className="space-y-2 p-3 rounded-xl bg-white/[0.02] border border-white/5" style={{ animation: "fadeInUp 0.3s ease-out" }}>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(null); }}
                    placeholder="Ton email d'inscription"
                    className="w-full bg-[#0d1b2e] border border-white/10 rounded-xl p-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#ffd700]/50 transition"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        if (!email.trim()) { setError("Email requis"); return; }
                        setLoading(true); setError(null);
                        try {
                          const res = await fetch("/api/users/reset-pin", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ username: username.trim(), email: email.trim() }),
                          });
                          const data = await res.json();
                          if (res.ok) {
                            setResetSuccess(true);
                          } else {
                            setError(data.error || "Réinitialisation impossible");
                          }
                        } catch { setError("Erreur réseau"); }
                        finally { setLoading(false); }
                      }}
                      disabled={loading}
                      className="flex-1 py-2 rounded-full text-xs font-bold bg-[#ffd700]/15 border border-[#ffd700]/30 text-[#ffd700] hover:bg-[#ffd700]/25 transition disabled:opacity-50"
                    >
                      Réinitialiser mon PIN
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowResetEmail(false); setEmail(""); }}
                      className="py-2 px-3 rounded-full text-xs text-white/30 hover:text-white/60 transition"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              ) : (
                /* Normal PIN input */
                <>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    pattern="[0-9]{4}"
                    value={pin}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "").slice(0, 4);
                      setPin(v);
                      setError(null);
                    }}
                    placeholder="Code PIN (4 chiffres)"
                    autoComplete="off"
                    className="w-full bg-[#0d1b2e] border border-white/10 rounded-2xl p-3.5 text-white placeholder:text-white/25 focus:outline-none focus:border-[#ffd700]/50 focus:ring-1 focus:ring-[#ffd700]/30 transition font-mono tracking-[4px] text-center text-lg"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetEmail(true)}
                    className="text-[10px] text-white/20 hover:text-[#ffd700]/60 transition text-left"
                  >
                    PIN oublié ?
                  </button>
                </>
              )}
            </div>
          )}

          {/* Show confirmation after registration */}
          {registeredPin && (
            <div
              className="p-4 rounded-xl border space-y-2 text-center animate-fade-in-up"
              style={{
                backgroundColor: "rgba(46,204,113,0.08)",
                borderColor: "rgba(46,204,113,0.3)",
              }}
            >
              <p className="text-xs text-[#2ecc71] font-bold uppercase tracking-wider">
                ✅ Compte créé
              </p>
              <p className="text-sm text-white/70">
                {registeredPin}
              </p>
              <p className="text-[10px] text-white/30">
                Vérifie tes emails (spams inclus)
              </p>
            </div>
          )}

          {error && (
            <div
              className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium"
              style={{ animation: "fadeInUp 0.3s ease-out" }}
            >
              {error}
            </div>
          )}

          <button
            onClick={mode === "login" ? handleLogin : handleRegister}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full font-black text-base uppercase tracking-wider transition disabled:opacity-50"
            style={{
              background: "linear-gradient(90deg, #00c8ff 0%, #0097fc 100%)",
              color: "#070f1e",
              boxShadow: "0 0 20px rgba(0,200,255,0.4)",
            }}
          >
            {loading ? (
              <span className="animate-pulse">Chargement...</span>
            ) : mode === "login" ? (
              "Se connecter"
            ) : (
              "S'inscrire"
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        className="flex items-center justify-between mb-5 p-3 rounded-2xl border"
        style={{
          backgroundColor: "rgba(46,204,113,0.08)",
          borderColor: "rgba(46,204,113,0.25)",
        }}
      >
        <span className="text-sm text-[#2ecc71] font-medium">
          ✅ Connecté en tant que{" "}
          <span className="font-bold">{username}</span>
        </span>
        <button
          onClick={() => {
            setUserId(null);
            setUsername("");
            setEmail("");
          }}
          className="text-xs text-white/40 hover:text-white transition"
        >
          Déconnexion
        </button>
      </div>
      <SubmissionForm
        userId={userId}
        steps={steps}
        completedMap={completedMap}
      />
    </div>
  );
}
