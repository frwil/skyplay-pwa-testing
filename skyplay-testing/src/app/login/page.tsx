"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import GlowBackground from "@/components/GlowBackground";
import {
  LogIn, UserPlus, KeyRound, Mail, User, AlertCircle,
  CheckCircle2, ArrowLeft,
} from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [alreadyAuth, setAlreadyAuth] = useState(false);

  // Check if already authenticated
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.user) {
          setAlreadyAuth(true);
          setUsername(data.user.username || "");
        }
      })
      .catch(() => {});
  }, []);

  // ── Login ──────────────────────────────────────────────────────────

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(
        "/api/users/lookup?username=" +
          encodeURIComponent(username) +
          "&pin=" +
          encodeURIComponent(pin),
        { credentials: "include" }
      );

      if (!res.ok) {
        setError("Nom d'utilisateur ou PIN incorrect");
        setLoading(false);
        return;
      }

      const data = await res.json();
      if (data?.user) {
        // Store identity in localStorage (for dev mode compatibility)
        try {
          localStorage.setItem("skyplay_dev_userId", String(data.user.id));
          localStorage.setItem("skyplay_dev_username", data.user.username);
        } catch { /* storage blocked */ }
        router.push("/play");
      } else {
        setError("Nom d'utilisateur ou PIN incorrect");
      }
    } catch {
      setError("Erreur réseau");
    } finally {
      setLoading(false);
    }
  };

  // ── Register ────────────────────────────────────────────────────────

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (username.length < 3 || username.length > 30) {
      setError("Nom d'utilisateur requis (3-30 caractères)");
      return;
    }

    if (!email.includes("@")) {
      setError("Email invalide");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/users/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email }),
        credentials: "include",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Erreur d'inscription");
        setLoading(false);
        return;
      }

      setSuccess("Compte créé ! Vérifie tes emails pour ton code PIN.");
      setMode("login");
    } catch {
      setError("Erreur réseau");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative min-h-screen">
      <GlowBackground />

      {/* Header */}
      <header className="relative z-10 border-b border-white/5 bg-[#070f1e]/80 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <a href="/" className="block">
            <div
              className="font-black text-xl uppercase tracking-[3px]"
              style={{
                background:
                  "linear-gradient(135deg, #00d2ff 0%, #9b5de5 50%, #f15bb5 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              SKY PLAY
            </div>
          </a>

          <div className="flex items-center gap-4">
            <a
              href="/"
              className="text-xs text-white/40 hover:text-white transition font-medium flex items-center gap-1"
            >
              <ArrowLeft className="w-3 h-3" />
              Retour
            </a>
          </div>
        </div>
      </header>

      {/* Login Form */}
      <section className="relative z-10 max-w-md mx-auto px-4 pt-16 pb-20">
        {alreadyAuth ? (
          <div
            className="rounded-2xl border p-6 text-center"
            style={{
              backgroundColor: "rgba(13,27,46,0.85)",
              borderColor: "rgba(74,222,128,0.3)",
            }}
          >
            <CheckCircle2 className="w-12 h-12 mx-auto mb-3" style={{ color: "#4ade80" }} />
            <h2 className="text-xl font-black text-white mb-2">Déjà connecté</h2>
            <p className="text-sm text-white/40 mb-6">
              Tu es déjà connecté en tant que{" "}
              <span style={{ color: "#00c8ff" }}>{username || "utilisateur"}</span>.
            </p>
            <div className="flex flex-col gap-3">
              <a
                href="/play"
                className="px-6 py-3 rounded-xl text-sm font-bold transition-all hover:scale-105 inline-block"
                style={{
                  backgroundColor: "rgba(0,200,255,0.15)",
                  border: "1px solid rgba(0,200,255,0.3)",
                  color: "#00c8ff",
                }}
              >
                🎮 Aller à Play
              </a>
              <a
                href="/duel"
                className="px-6 py-3 rounded-xl text-sm font-bold transition-all hover:scale-105 inline-block"
                style={{
                  backgroundColor: "rgba(241,91,181,0.1)",
                  border: "1px solid rgba(241,91,181,0.25)",
                  color: "#f15bb5",
                }}
              >
                ⚔️ Aller à Duel
              </a>
            </div>
          </div>
        ) : (
          <div
            className="rounded-2xl border p-6"
            style={{
              backgroundColor: "rgba(13,27,46,0.85)",
              borderColor: "rgba(255,255,255,0.08)",
            }}
          >
            <h2 className="text-xl font-black text-white mb-1 text-center">
              {mode === "login" ? "Connexion" : "Inscription"}
            </h2>
            <p className="text-xs text-white/30 text-center mb-6">
              {mode === "login"
                ? "Entre ton pseudo et ton PIN pour jouer."
                : "Crée ton compte pour commencer à jouer."}
            </p>

            {/* Tabs */}
            <div
              className="flex rounded-xl mb-5 p-0.5"
              style={{ backgroundColor: "rgba(255,255,255,0.04)" }}
            >
              <button
                onClick={() => { setMode("login"); setError(null); setSuccess(null); }}
                className="flex-1 rounded-lg px-3 py-2 text-xs font-bold transition flex items-center justify-center gap-1.5"
                style={
                  mode === "login"
                    ? { backgroundColor: "rgba(0,200,255,0.15)", color: "#00c8ff" }
                    : { color: "rgba(255,255,255,0.3)" }
                }
              >
                <LogIn className="w-3.5 h-3.5" />
                Connexion
              </button>
              <button
                onClick={() => { setMode("register"); setError(null); setSuccess(null); }}
                className="flex-1 rounded-lg px-3 py-2 text-xs font-bold transition flex items-center justify-center gap-1.5"
                style={
                  mode === "register"
                    ? { backgroundColor: "rgba(0,200,255,0.15)", color: "#00c8ff" }
                    : { color: "rgba(255,255,255,0.3)" }
                }
              >
                <UserPlus className="w-3.5 h-3.5" />
                Inscription
              </button>
            </div>

            {/* Success message */}
            {success && (
              <div
                className="flex items-center gap-2 rounded-xl px-3 py-2 mb-4"
                style={{
                  backgroundColor: "rgba(74,222,128,0.08)",
                  border: "1px solid rgba(74,222,128,0.15)",
                }}
              >
                <CheckCircle2 className="w-4 h-4" style={{ color: "#4ade80" }} />
                <p className="text-xs" style={{ color: "#4ade80" }}>{success}</p>
              </div>
            )}

            {/* Form */}
            {mode === "login" ? (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label
                    className="text-[10px] font-bold uppercase tracking-wider block mb-1"
                    style={{ color: "rgba(255,255,255,0.4)" }}
                  >
                    <User className="w-3 h-3 inline mr-1" /> Nom d'utilisateur
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Ton pseudo"
                    className="w-full rounded-xl px-3 py-2.5 text-sm font-medium outline-none"
                    style={{
                      backgroundColor: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      color: "#fff",
                    }}
                    required
                  />
                </div>

                <div>
                  <label
                    className="text-[10px] font-bold uppercase tracking-wider block mb-1"
                    style={{ color: "rgba(255,255,255,0.4)" }}
                  >
                    <KeyRound className="w-3 h-3 inline mr-1" /> Code PIN
                  </label>
                  <input
                    type="password"
                    value={pin}
                    onChange={(e) =>
                      setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
                    }
                    placeholder="••••"
                    maxLength={4}
                    className="w-full rounded-xl px-3 py-2.5 text-sm font-medium outline-none"
                    style={{
                      backgroundColor: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      color: "#fff",
                    }}
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || !username || !pin}
                  className="w-full rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:opacity-30 flex items-center justify-center gap-2"
                  style={{
                    backgroundColor: "rgba(0,200,255,0.15)",
                    border: "1px solid rgba(0,200,255,0.3)",
                    color: "#00c8ff",
                  }}
                >
                  {loading ? "Chargement..." : "Se connecter"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <label
                    className="text-[10px] font-bold uppercase tracking-wider block mb-1"
                    style={{ color: "rgba(255,255,255,0.4)" }}
                  >
                    <User className="w-3 h-3 inline mr-1" /> Nom d'utilisateur
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Ton pseudo"
                    className="w-full rounded-xl px-3 py-2.5 text-sm font-medium outline-none"
                    style={{
                      backgroundColor: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      color: "#fff",
                    }}
                    required
                  />
                  <p
                    className="text-[9px] mt-1"
                    style={{ color: "rgba(255,255,255,0.2)" }}
                  >
                    3-30 caractères, lettres, chiffres, tirets
                  </p>
                </div>

                <div>
                  <label
                    className="text-[10px] font-bold uppercase tracking-wider block mb-1"
                    style={{ color: "rgba(255,255,255,0.4)" }}
                  >
                    <Mail className="w-3 h-3 inline mr-1" /> Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ton@email.com"
                    className="w-full rounded-xl px-3 py-2.5 text-sm font-medium outline-none"
                    style={{
                      backgroundColor: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      color: "#fff",
                    }}
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || !username || !email}
                  className="w-full rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:opacity-30 flex items-center justify-center gap-2"
                  style={{
                    backgroundColor: "rgba(0,200,255,0.15)",
                    border: "1px solid rgba(0,200,255,0.3)",
                    color: "#00c8ff",
                  }}
                >
                  {loading ? "Chargement..." : "S'inscrire"}
                </button>
              </form>
            )}

            {/* Error */}
            {error && (
              <div
                className="flex items-center gap-2 mt-4 rounded-xl px-3 py-2"
                style={{
                  backgroundColor: "rgba(253,46,95,0.08)",
                  border: "1px solid rgba(253,46,95,0.15)",
                }}
              >
                <AlertCircle className="w-4 h-4" style={{ color: "#fd2e5f" }} />
                <p className="text-xs" style={{ color: "#fd2e5f" }}>{error}</p>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
