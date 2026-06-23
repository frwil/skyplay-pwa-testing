"use client";

import { useState } from "react";
import { LogIn, UserPlus, KeyRound, Mail, User, AlertCircle, CheckCircle2 } from "lucide-react";

interface AuthInlineFormProps {
  /** Called when user successfully authenticates (or if already authenticated on mount). */
  onAuthenticated: (userId: number, username: string) => void;
  /** Pre-check: is there an existing auth cookie? */
  currentUserId?: number | null;
  currentUsername?: string | null;
}

/**
 * Inline login/register form for the netplay flow.
 *
 * Embedded inside ParticipationDialog when the user isn't authenticated.
 * Supports login (username + PIN) and register (username + email → PIN by email).
 */
export default function AuthInlineForm({
  onAuthenticated,
  currentUserId,
  currentUsername,
}: AuthInlineFormProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState(currentUsername ?? "");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // ── Already authenticated ────────────────────────────────────────

  if (currentUserId && currentUsername) {
    return (
      <div className="flex items-center gap-3 rounded-xl px-4 py-3" style={{ backgroundColor: "rgba(0,200,255,0.06)", border: "1px solid rgba(0,200,255,0.15)" }}>
        <CheckCircle2 className="w-5 h-5" style={{ color: "#4ade80" }} />
        <div>
          <p className="text-sm font-bold text-white">Connecté en tant que <span style={{ color: "#00c8ff" }}>{currentUsername}</span></p>
          <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>Prêt à participer au challenge</p>
        </div>
      </div>
    );
  }

  // ── Login ────────────────────────────────────────────────────────

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/users/lookup?username=" + encodeURIComponent(username) + "&pin=" + encodeURIComponent(pin), {
        credentials: "include",
      });

      if (!res.ok) {
        setError("Nom d'utilisateur ou PIN incorrect");
        setLoading(false);
        return;
      }

      const data = await res.json();
      if (data && data.user) {
        onAuthenticated(data.user.id, data.user.username);
      } else {
        setError("Nom d'utilisateur ou PIN incorrect");
      }
    } catch {
      setError("Erreur réseau");
    } finally {
      setLoading(false);
    }
  };

  // ── Register ──────────────────────────────────────────────────────

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

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="rounded-2xl p-4" style={{ backgroundColor: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
      {/* Tabs */}
      <div className="flex rounded-xl mb-4 p-0.5" style={{ backgroundColor: "rgba(255,255,255,0.04)" }}>
        <button
          onClick={() => { setMode("login"); setError(null); setSuccess(null); }}
          className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold transition flex items-center justify-center gap-1.5 ${
            mode === "login" ? "" : ""
          }`}
          style={mode === "login" ? { backgroundColor: "rgba(0,200,255,0.15)", color: "#00c8ff" } : { color: "rgba(255,255,255,0.3)" }}
        >
          <LogIn className="w-3.5 h-3.5" />
          Connexion
        </button>
        <button
          onClick={() => { setMode("register"); setError(null); setSuccess(null); }}
          className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold transition flex items-center justify-center gap-1.5 ${
            mode === "register" ? "" : ""
          }`}
          style={mode === "register" ? { backgroundColor: "rgba(0,200,255,0.15)", color: "#00c8ff" } : { color: "rgba(255,255,255,0.3)" }}
        >
          <UserPlus className="w-3.5 h-3.5" />
          Inscription
        </button>
      </div>

      {/* Success message */}
      {success && (
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 mb-3" style={{ backgroundColor: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.15)" }}>
          <CheckCircle2 className="w-4 h-4" style={{ color: "#4ade80" }} />
          <p className="text-xs" style={{ color: "#4ade80" }}>{success}</p>
        </div>
      )}

      {/* Form */}
      {mode === "login" ? (
        <form onSubmit={handleLogin} className="space-y-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: "rgba(255,255,255,0.4)" }}>
              <User className="w-3 h-3 inline mr-1" /> Nom d'utilisateur
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Ton pseudo"
              className="w-full rounded-xl px-3 py-2.5 text-sm font-medium outline-none"
              style={{ backgroundColor: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }}
              required
            />
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: "rgba(255,255,255,0.4)" }}>
              <KeyRound className="w-3 h-3 inline mr-1" /> Code PIN
            </label>
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="••••"
              maxLength={4}
              className="w-full rounded-xl px-3 py-2.5 text-sm font-medium outline-none"
              style={{ backgroundColor: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading || !username || !pin}
            className="w-full rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:opacity-30 flex items-center justify-center gap-2"
            style={{ backgroundColor: "rgba(0,200,255,0.15)", border: "1px solid rgba(0,200,255,0.3)", color: "#00c8ff" }}
          >
            {loading ? "Chargement..." : "Se connecter"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleRegister} className="space-y-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: "rgba(255,255,255,0.4)" }}>
              <User className="w-3 h-3 inline mr-1" /> Nom d'utilisateur
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Ton pseudo"
              className="w-full rounded-xl px-3 py-2.5 text-sm font-medium outline-none"
              style={{ backgroundColor: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }}
              required
            />
            <p className="text-[9px] mt-1" style={{ color: "rgba(255,255,255,0.2)" }}>
              3-30 caractères, lettres, chiffres, tirets
            </p>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: "rgba(255,255,255,0.4)" }}>
              <Mail className="w-3 h-3 inline mr-1" /> Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ton@email.com"
              className="w-full rounded-xl px-3 py-2.5 text-sm font-medium outline-none"
              style={{ backgroundColor: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading || !username || !email}
            className="w-full rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:opacity-30 flex items-center justify-center gap-2"
            style={{ backgroundColor: "rgba(0,200,255,0.15)", border: "1px solid rgba(0,200,255,0.3)", color: "#00c8ff" }}
          >
            {loading ? "Chargement..." : "S'inscrire"}
          </button>
        </form>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 mt-3 rounded-xl px-3 py-2" style={{ backgroundColor: "rgba(253,46,95,0.08)", border: "1px solid rgba(253,46,95,0.15)" }}>
          <AlertCircle className="w-4 h-4" style={{ color: "#fd2e5f" }} />
          <p className="text-xs" style={{ color: "#fd2e5f" }}>{error}</p>
        </div>
      )}
    </div>
  );
}
