"use client";

import { useState, useEffect, useCallback } from "react";
import AdminCard from "@/components/AdminCard";
import GlowBackground from "@/components/GlowBackground";
import {
  Shield,
  RefreshCw,
  Filter,
  LogOut,
  Loader2,
  BarChart3,
  Users,
  Trophy,
  Activity,
} from "lucide-react";

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

interface Stats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
}

interface PhaseStats {
  id: number;
  slug: string;
  title: string;
  total_questions: number;
  total_submissions: number;
  approved: number;
  pending: number;
  rejected: number;
  total_rewards: number;
}

interface UserStats {
  id: number;
  username: string;
  email: string;
  total_submissions: number;
  approved_submissions: number;
  total_rewards: number;
  completed_phases: string | null;
}

interface OverviewStats {
  total_users: number;
  total_submissions: number;
  approved_count: number;
  pending_count: number;
  rejected_count: number;
  total_sky_distributed: number;
}

interface AdminUser {
  id: number;
  username: string;
  role: string;
}

export default function AdminPage() {
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [phases, setPhases] = useState<PhaseStats[]>([]);
  const [users, setUsers] = useState<UserStats[]>([]);
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"ALL" | "PENDING" | "APPROVED" | "REJECTED">("ALL");
  const [stepFilter, setStepFilter] = useState<string>("ALL");
  const [tab, setTab] = useState<"dashboard" | "submissions">("dashboard");

  // Try to restore session on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "same-origin" });
        if (res.ok) {
          const data = await res.json();
          setAdminUser(data.user);
        }
      } catch { /* not logged in */ }
    };
    checkAuth();
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [subsRes, statsRes] = await Promise.all([
        fetch("/api/admin/submissions", { credentials: "same-origin" }),
        fetch("/api/admin/stats", { credentials: "same-origin" }),
      ]);

      if (subsRes.status === 401 || statsRes.status === 401) {
        setAdminUser(null);
        return;
      }

      const subsData = await subsRes.json();
      const statsData = await statsRes.json();

      if (subsRes.ok) {
        setSubmissions(subsData.submissions);
        setStats(subsData.stats);
      } else {
        setError(subsData.error || "Erreur de chargement");
      }

      if (statsRes.ok) {
        setPhases(statsData.phases);
        setUsers(statsData.users);
        setOverview(statsData.overview);
      }
    } catch {
      setError("Erreur réseau");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (adminUser) fetchData();
  }, [adminUser, fetchData]);

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setLoginError("Tous les champs sont requis");
      return;
    }
    setLoginLoading(true);
    setLoginError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (res.ok) {
        setAdminUser(data.user);
      } else {
        setLoginError(data.error || "Échec de connexion");
      }
    } catch {
      setLoginError("Erreur réseau");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    setAdminUser(null);
    setUsername("");
    setPassword("");
    setSubmissions([]);
    setStats(null);
    setPhases([]);
    setUsers([]);
    setOverview(null);
  };

  const stepSlugs = ["ALL", ...new Set(submissions.map((s) => s.step_slug))];
  const filteredSubmissions = submissions.filter((s) => {
    const matchStatus = filter === "ALL" || s.status === filter;
    const matchStep = stepFilter === "ALL" || s.step_slug === stepFilter;
    return matchStatus && matchStep;
  });

  // ── Login Screen ──
  if (!adminUser) {
    return (
      <main className="relative min-h-screen flex items-center justify-center px-4">
        <GlowBackground />
        <div className="relative z-10 w-full max-w-sm">
          <div className="text-center mb-8">
            <div
              className="font-black text-2xl uppercase tracking-[3px] mb-1"
              style={{
                background: "linear-gradient(135deg, #00d2ff 0%, #9b5de5 50%, #f15bb5 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              SKYPLAY
            </div>
            <p className="text-xs text-white/40 uppercase tracking-[3px]">
              Admin Panel
            </p>
          </div>

          <div
            className="rounded-2xl border p-6 space-y-4"
            style={{
              backgroundColor: "rgba(13,27,46,0.85)",
              borderColor: "rgba(255,255,255,0.08)",
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Shield className="w-5 h-5 text-[#ffd700]" />
              <h2 className="text-sm font-black uppercase tracking-wider text-white/60">
                Authentification Admin
              </h2>
            </div>

            <input
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setLoginError(null); }}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              placeholder="Nom d'utilisateur"
              autoComplete="username"
              className="w-full bg-[#0d1b2e] border border-white/10 rounded-xl p-3.5 text-white placeholder:text-white/25 focus:outline-none focus:border-[#ffd700]/50 focus:ring-1 focus:ring-[#ffd700]/30 transition"
            />

            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setLoginError(null); }}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              placeholder="Mot de passe"
              autoComplete="current-password"
              className="w-full bg-[#0d1b2e] border border-white/10 rounded-xl p-3.5 text-white placeholder:text-white/25 focus:outline-none focus:border-[#ffd700]/50 focus:ring-1 focus:ring-[#ffd700]/30 transition"
            />

            {loginError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium">
                {loginError}
              </div>
            )}

            <button
              onClick={handleLogin}
              disabled={loginLoading}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full font-black text-base uppercase tracking-wider transition disabled:opacity-50"
              style={{
                background: "linear-gradient(90deg, #ffd700 0%, #e67e22 100%)",
                color: "#070f1e",
                boxShadow: "0 0 20px rgba(255,215,0,0.4)",
              }}
            >
              {loginLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Shield className="w-4 h-4" />
              )}
              {loginLoading ? "Connexion..." : "Se connecter"}
            </button>

            <p className="text-[10px] text-white/20 text-center">
              Comptes admin uniquement — les testeurs n&apos;ont pas accès
            </p>
          </div>

          <a
            href="/"
            className="block text-center text-xs text-white/30 hover:text-white/60 transition mt-6"
          >
            ← Retour au formulaire
          </a>
        </div>
      </main>
    );
  }

  // ── Admin Dashboard ──
  return (
    <main className="relative min-h-screen">
      <GlowBackground />

      <header className="relative z-10 border-b border-white/5 bg-[#070f1e]/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <a href="/" className="block">
              <div
                className="font-black text-lg uppercase tracking-[3px]"
                style={{
                  background: "linear-gradient(135deg, #00d2ff 0%, #9b5de5 50%, #f15bb5 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                SKYPLAY
              </div>
            </a>
            <span
              className="px-2.5 py-1 rounded-full text-xs font-black border"
              style={{
                backgroundColor: adminUser.role === "superadmin" ? "rgba(255,215,0,0.15)" : "rgba(0,200,255,0.1)",
                borderColor: adminUser.role === "superadmin" ? "rgba(255,215,0,0.3)" : "rgba(0,200,255,0.3)",
                color: adminUser.role === "superadmin" ? "#ffd700" : "#00c8ff",
              }}
            >
              {adminUser.role === "superadmin" ? "SUPERADMIN" : "ADMIN"}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-white/40 hidden sm:inline">
              {adminUser.username}
            </span>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white transition"
            >
              <LogOut className="w-3.5 h-3.5" />
              Déconnexion
            </button>
          </div>
        </div>
      </header>

      <div className="relative z-10 max-w-6xl mx-auto px-4 py-8">
        {/* Tab Navigation */}
        <div className="flex gap-1 p-1 rounded-2xl bg-white/[0.04] border border-white/5 mb-8 max-w-xs">
          {([
            { key: "dashboard", label: "Dashboard", icon: BarChart3 },
            { key: "submissions", label: "Soumissions", icon: Activity },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-bold transition ${
                tab === t.key
                  ? "bg-[#00c8ff]/15 text-[#00c8ff]"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>

        {/* ═══════════ DASHBOARD TAB ═══════════ */}
        {tab === "dashboard" && (
          <div className="space-y-8">
            {/* Overview cards */}
            {overview && (
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                {[
                  { label: "Testeurs", value: overview.total_users, color: "#00c8ff", icon: Users },
                  { label: "Réponses", value: overview.total_submissions, color: "#ffd700", icon: Activity },
                  { label: "Approuvés", value: overview.approved_count, color: "#2ecc71", icon: Shield },
                  { label: "En attente", value: overview.pending_count, color: "#e67e22" },
                  { label: "Rejetés", value: overview.rejected_count, color: "#FD2E5F" },
                  { label: "Sky distribués", value: `⚡ ${overview.total_sky_distributed}`, color: "#ffd700", icon: Trophy },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="rounded-2xl border p-4 text-center"
                    style={{
                      backgroundColor: "rgba(13,27,46,0.6)",
                      borderColor: "rgba(255,255,255,0.06)",
                    }}
                  >
                    {s.icon && <s.icon className="w-4 h-4 mx-auto mb-1" style={{ color: s.color }} />}
                    <p className="text-xl sm:text-2xl font-black" style={{ color: s.color }}>
                      {s.value}
                    </p>
                    <p className="text-[10px] text-white/30 uppercase tracking-wider mt-1">
                      {s.label}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Per-phase breakdown */}
            {phases.length > 0 && (
              <div>
                <h2 className="text-lg font-black text-white mb-4 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-[#00c8ff]" />
                  Progression par Jalon
                </h2>
                <div className="grid sm:grid-cols-2 gap-4">
                  {phases.map((phase) => {
                    const approvalRate =
                      phase.total_submissions > 0
                        ? Math.round((phase.approved / phase.total_submissions) * 100)
                        : 0;
                    const completionRate =
                      phase.total_questions > 0
                        ? Math.round((phase.total_submissions / (overview?.total_users || 1) / phase.total_questions) * 100)
                        : 0;

                    return (
                      <div
                        key={phase.id}
                        className="rounded-2xl border p-5"
                        style={{
                          backgroundColor: "rgba(13,27,46,0.6)",
                          borderColor: "rgba(255,255,255,0.06)",
                        }}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-sm font-black text-white">
                            {phase.slug.replace("jalon_", "Jalon ")} — {phase.title}
                          </h3>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#ffd700]/10 text-[#ffd700]">
                            ⚡ {phase.total_rewards} Sky
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-3 text-center mb-3">
                          {[
                            { label: "Réponses", value: phase.total_submissions, color: "#00c8ff" },
                            { label: "Approuvés", value: phase.approved, color: "#2ecc71" },
                            { label: "En attente", value: phase.pending, color: "#e67e22" },
                          ].map((m) => (
                            <div key={m.label}>
                              <p className="text-lg font-black" style={{ color: m.color }}>
                                {m.value}
                              </p>
                              <p className="text-[9px] text-white/30 uppercase">{m.label}</p>
                            </div>
                          ))}
                        </div>

                        {/* Approval bar */}
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px]">
                            <span className="text-white/30">Taux d&apos;approbation</span>
                            <span className="font-bold text-[#2ecc71]">{approvalRate}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${approvalRate}%`,
                                background: "linear-gradient(90deg, #2ecc71, #00c8ff)",
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* User leaderboard */}
            {users.length > 0 && (
              <div>
                <h2 className="text-lg font-black text-white mb-4 flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-[#ffd700]" />
                  Classement des Testeurs
                </h2>
                <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-white/5 bg-white/[0.02]">
                        {["Rang", "Utilisateur", "Réponses", "Approuvés", "Sky gagnés", "Jalons"].map((h) => (
                          <th
                            key={h}
                            className="text-left px-4 py-3 font-bold text-white/30 uppercase tracking-wider"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u, i) => (
                        <tr
                          key={u.id}
                          className="border-b border-white/[0.03] hover:bg-white/[0.02] transition"
                        >
                          <td className="px-4 py-3">
                            <span
                              className="font-black text-sm"
                              style={{
                                color: i === 0 ? "#ffd700" : i === 1 ? "#c0c0c0" : i === 2 ? "#cd7f32" : "rgba(255,255,255,0.3)",
                              }}
                            >
                              {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-medium text-white/80">
                            {u.username}
                            <span className="text-white/20 ml-1 hidden sm:inline">{u.email}</span>
                          </td>
                          <td className="px-4 py-3 text-white/60">{u.total_submissions || 0}</td>
                          <td className="px-4 py-3">
                            <span className="text-[#2ecc71] font-bold">{u.approved_submissions || 0}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-[#ffd700] font-bold">⚡ {u.total_rewards || 0}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-1">
                              {u.completed_phases
                                ? u.completed_phases.split(",").map((slug) => (
                                    <span
                                      key={slug}
                                      className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#2ecc71]/10 text-[#2ecc71]"
                                    >
                                      {slug.replace("jalon_", "J")}
                                    </span>
                                  ))
                                : <span className="text-white/15">—</span>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {loading && (
              <div className="text-center py-10">
                <Loader2 className="w-6 h-6 mx-auto animate-spin text-[#00c8ff]" />
              </div>
            )}
          </div>
        )}

        {/* ═══════════ SUBMISSIONS TAB ═══════════ */}
        {tab === "submissions" && (
          <>
            {/* Stats bar */}
            {stats && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
                {[
                  { label: "Total", value: stats.total, color: "#00c8ff" },
                  { label: "En attente", value: stats.pending, color: "#e67e22" },
                  { label: "Approuvés", value: stats.approved, color: "#2ecc71" },
                  { label: "Rejetés", value: stats.rejected, color: "#FD2E5F" },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="rounded-2xl border p-4 text-center"
                    style={{
                      backgroundColor: "rgba(13,27,46,0.6)",
                      borderColor: "rgba(255,255,255,0.06)",
                    }}
                  >
                    <p className="text-2xl font-black" style={{ color: s.color }}>
                      {s.value}
                    </p>
                    <p className="text-[10px] text-white/30 uppercase tracking-wider mt-1">
                      {s.label}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Toolbar */}
            <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
              <h2 className="text-lg font-black text-white flex items-center gap-2">
                <Filter className="w-5 h-5 text-[#00c8ff]" />
                Soumissions
              </h2>

              <div className="flex items-center gap-2 flex-wrap">
                {(["ALL", "PENDING", "APPROVED", "REJECTED"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold transition ${
                      filter === f
                        ? "bg-white/10 text-white border border-white/20"
                        : "text-white/30 hover:text-white/60 border border-transparent"
                    }`}
                  >
                    {f === "ALL" ? "Tous" : f}
                  </button>
                ))}

                <span className="w-px h-5 bg-white/10 mx-1" />

                <select
                  value={stepFilter}
                  onChange={(e) => setStepFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-full text-xs font-bold bg-white/5 border border-white/10 text-white/60 focus:outline-none focus:border-[#00c8ff]/40"
                >
                  {stepSlugs.map((slug) => (
                    <option key={slug} value={slug} className="bg-[#0d1b2e] text-white">
                      {slug === "ALL" ? "Tous les jalons" : slug.replace("jalon_", "Jalon ")}
                    </option>
                  ))}
                </select>

                <button
                  onClick={fetchData}
                  disabled={loading}
                  className="ml-2 p-2 rounded-full bg-white/5 border border-white/10 text-white/50 hover:text-white hover:border-white/30 transition disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {error && (
              <div className="mb-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-medium">
                {error}
              </div>
            )}

            {/* Submissions list */}
            {loading && submissions.length === 0 ? (
              <div className="text-center py-20">
                <Loader2 className="w-8 h-8 mx-auto mb-4 animate-spin text-[#00c8ff]" />
                <p className="text-white/40 text-sm">Chargement...</p>
              </div>
            ) : filteredSubmissions.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-white/20 text-lg font-bold">
                  Aucune soumission {filter !== "ALL" || stepFilter !== "ALL" ? "avec ces filtres" : ""}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredSubmissions.map((submission) => (
                  <AdminCard
                    key={submission.id}
                    submission={submission}
                    onStatusChange={fetchData}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
