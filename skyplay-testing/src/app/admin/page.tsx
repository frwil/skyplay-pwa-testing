"use client";

import { useState, useEffect, useCallback } from "react";
import AdminCard from "@/components/AdminCard";
import GlowBackground from "@/components/GlowBackground";
import { useTranslation } from "@/lib/i18n/TranslationContext";
import LanguageSwitcher from "@/components/LanguageSwitcher";
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
  Clock,
} from "lucide-react";

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
  participation_bonus: number;
  bonus_status: string | null;
  completed_phases: string | null;
}

interface OverviewStats {
  total_users: number;
  total_submissions: number;
  approved_count: number;
  pending_count: number;
  rejected_count: number;
  total_sky_distributed: number;
  pending_bonus_count: number;
}

interface AdminUser {
  id: number;
  username: string;
  role: string;
}

export default function AdminPage() {
  const { t, locale } = useTranslation();
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
  const [tab, setTab] = useState<"dashboard" | "submissions" | "campagne">("dashboard");

  // Campaign state
  const [activeCampaign, setActiveCampaign] = useState<{
    id: number;
    name: string;
    deadline: string;
    createdAt: string;
    expired?: boolean;
    remainingMs?: number;
  } | null>(null);
  const [newDeadline, setNewDeadline] = useState("");
  const [extendLoading, setExtendLoading] = useState(false);
  const [extendError, setExtendError] = useState<string | null>(null);
  const [extendSuccess, setExtendSuccess] = useState<string | null>(null);
  // Create campaign state (superadmin only)
  const [newCampaignName, setNewCampaignName] = useState("");
  const [newCampaignDeadline, setNewCampaignDeadline] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

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
      const [subsRes, statsRes, campaignRes] = await Promise.all([
        fetch("/api/admin/submissions", { credentials: "same-origin" }),
        fetch("/api/admin/stats", { credentials: "same-origin" }),
        fetch("/api/campaign"),
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
        setError(subsData.error || t.admin.login.loadError);
      }

      if (statsRes.ok) {
        setPhases(statsData.phases);
        setUsers(statsData.users);
        setOverview(statsData.overview);
      }

      if (campaignRes.ok) {
        const campaignData = await campaignRes.json();
        setActiveCampaign(campaignData.campaign);
        if (campaignData.campaign?.deadline) {
          setNewDeadline(
            new Date(campaignData.campaign.deadline).toISOString().slice(0, 16)
          );
        }
      }
    } catch {
      setError(t.admin.login.networkError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (adminUser) fetchData();
  }, [adminUser, fetchData]);

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setLoginError(t.admin.login.allFieldsRequired);
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
        setLoginError(data.error || t.admin.login.errorAuth);
      }
    } catch {
      setLoginError(t.admin.login.networkError);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleExtend = async () => {
    setExtendLoading(true);
    setExtendError(null);
    setExtendSuccess(null);
    try {
      const res = await fetch("/api/admin/campaign", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ deadline: new Date(newDeadline).toISOString() }),
      });
      const data = await res.json();
      if (res.ok) {
        setActiveCampaign(data.campaign);
        setExtendSuccess(t.admin.campaign.extendSuccess);
        setTimeout(() => setExtendSuccess(null), 3000);
      } else {
        setExtendError(data.error || t.admin.campaign.extendError);
      }
    } catch {
      setExtendError(t.admin.campaign.networkError);
    } finally {
      setExtendLoading(false);
    }
  };

  const handleApproveBonus = async (userId: number) => {
    try {
      const res = await fetch("/api/admin/approve-bonus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (res.ok) {
        // Refresh data to reflect the change
        fetchData();
      } else {
        alert(data.error || t.admin.dashboard.bonusApproveError);
      }
    } catch {
      alert(t.admin.dashboard.networkError);
    }
  };

  const handleCreateCampaign = async () => {
    setCreateLoading(true);
    setCreateError(null);
    setCreateSuccess(null);
    try {
      const res = await fetch("/api/admin/campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          name: newCampaignName || t.admin.campaign.defaultName,
          deadline: new Date(newCampaignDeadline).toISOString(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setActiveCampaign(data.campaign);
        setNewCampaignName("");
        setNewCampaignDeadline("");
        setCreateSuccess(t.admin.campaign.createSuccess);
        setTimeout(() => setCreateSuccess(null), 3000);
      } else {
        setCreateError(data.error || t.admin.campaign.createError);
      }
    } catch {
      setCreateError(t.admin.campaign.networkError);
    } finally {
      setCreateLoading(false);
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
    setActiveCampaign(null);
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
              {t.admin.login.panelSubtitle}
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
                {t.admin.login.heading}
              </h2>
            </div>

            <input
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setLoginError(null); }}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              placeholder={t.admin.login.usernamePlaceholder}
              autoComplete="username"
              className="w-full bg-[#0d1b2e] border border-white/10 rounded-xl p-3.5 text-white placeholder:text-white/25 focus:outline-none focus:border-[#ffd700]/50 focus:ring-1 focus:ring-[#ffd700]/30 transition"
            />

            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setLoginError(null); }}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              placeholder={t.admin.login.passwordPlaceholder}
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
              {loginLoading ? t.admin.login.submitting : t.admin.login.submit}
            </button>

            <p className="text-[10px] text-white/20 text-center">
              {t.admin.login.adminOnlyHint}
            </p>
          </div>

          <a
            href="/"
            className="block text-center text-xs text-white/30 hover:text-white/60 transition mt-6"
          >
            {t.admin.login.backToForm}
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
              {adminUser.role === "superadmin" ? t.admin.dashboard.superadmin : t.admin.dashboard.adminRole}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <span className="text-xs text-white/40 hidden sm:inline">
              {adminUser.username}
            </span>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white transition"
            >
              <LogOut className="w-3.5 h-3.5" />
              {t.admin.dashboard.logout}
            </button>
          </div>
        </div>
      </header>

      <div className="relative z-10 max-w-6xl mx-auto px-4 py-8">
        {/* Tab Navigation */}
        <div className="flex gap-1 p-1 rounded-2xl bg-white/[0.04] border border-white/5 mb-8 max-w-md">
          {([
            { key: "dashboard", label: t.admin.dashboard.tabs.dashboard, icon: BarChart3 },
            { key: "submissions", label: t.admin.dashboard.tabs.submissions, icon: Activity },
            { key: "campagne", label: t.admin.dashboard.tabs.campagne, icon: Clock },
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
                  { label: t.admin.dashboard.overview.testers, value: overview.total_users, color: "#00c8ff", icon: Users },
                  { label: t.admin.dashboard.overview.answers, value: overview.total_submissions, color: "#ffd700", icon: Activity },
                  { label: t.admin.dashboard.overview.approved, value: overview.approved_count, color: "#2ecc71", icon: Shield },
                  { label: t.admin.dashboard.overview.pending, value: overview.pending_count, color: "#e67e22" },
                  { label: t.admin.dashboard.overview.rejected, value: overview.rejected_count, color: "#FD2E5F" },
                  { label: t.admin.dashboard.overview.skyDistributed, value: `⚡ ${overview.total_sky_distributed}`, color: "#ffd700", icon: Trophy },
                  { label: t.admin.dashboard.overview.pendingBonus, value: overview.pending_bonus_count || 0, color: "#e67e22" },
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
                  {t.admin.dashboard.phaseBreakdown}
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
                            {t.admin.dashboard.phasePrefix(phase.slug)} — {phase.title}
                          </h3>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#ffd700]/10 text-[#ffd700]">
                            ⚡ {phase.total_rewards} Sky
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-3 text-center mb-3">
                          {[
                            { label: t.admin.dashboard.overview.answers, value: phase.total_submissions, color: "#00c8ff" },
                            { label: t.admin.dashboard.overview.approved, value: phase.approved, color: "#2ecc71" },
                            { label: t.admin.dashboard.overview.pending, value: phase.pending, color: "#e67e22" },
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
                            <span className="text-white/30">{t.admin.dashboard.approvalRate}</span>
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
                  {t.admin.dashboard.leaderboard}
                </h2>
                <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-white/5 bg-white/[0.02]">
                        {[
                          t.admin.dashboard.leaderboardHeaders.rank,
                          t.admin.dashboard.leaderboardHeaders.user,
                          t.admin.dashboard.leaderboardHeaders.email,
                          t.admin.dashboard.leaderboardHeaders.answers,
                          t.admin.dashboard.leaderboardHeaders.approved,
                          t.admin.dashboard.leaderboardHeaders.skyEarned,
                          t.admin.dashboard.leaderboardHeaders.bonus,
                          t.admin.dashboard.leaderboardHeaders.milestones,
                        ].map((h) => (
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
                          </td>
                          <td className="px-4 py-3 text-white/50 text-[11px]">

                            {u.email}
                          </td>
                          <td className="px-4 py-3 text-white/60">{u.total_submissions || 0}</td>
                          <td className="px-4 py-3">
                            <span className="text-[#2ecc71] font-bold">{u.approved_submissions || 0}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-[#ffd700] font-bold">⚡ {u.total_rewards || 0}</span>
                          </td>
                          <td className="px-4 py-3">
                            {u.bonus_status === "APPROVED" ? (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#2ecc71]/10 text-[#2ecc71] inline-flex items-center gap-1">
                                ✅ {u.participation_bonus || 250} ⚡
                              </span>
                            ) : u.completed_phases && u.completed_phases.includes("jalon_1") ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#e67e22]/10 text-[#e67e22]">
                                  {u.participation_bonus || 250} ⚡
                                </span>
                                <button
                                  onClick={() => handleApproveBonus(u.id)}
                                  className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#e67e22]/10 text-[#e67e22] border border-[#e67e22]/20 hover:bg-[#e67e22]/25 transition"
                                >
                                  {t.admin.dashboard.validate}
                                </button>
                              </div>
                            ) : (
                              <span className="text-white/50 text-[9px] leading-tight max-w-[140px] inline-block">
                                {t.admin.dashboard.pendingAccount}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-1">
                              {u.completed_phases
                                ? u.completed_phases.split(",").map((slug) => (
                                    <span
                                      key={slug}
                                      className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#2ecc71]/10 text-[#2ecc71]"
                                    >
                                      {t.admin.dashboard.milePrefix(slug)}
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
                  { label: t.admin.submissions.total, value: stats.total, color: "#00c8ff" },
                  { label: t.admin.submissions.pending, value: stats.pending, color: "#e67e22" },
                  { label: t.admin.submissions.approved, value: stats.approved, color: "#2ecc71" },
                  { label: t.admin.submissions.rejected, value: stats.rejected, color: "#FD2E5F" },
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
                {t.admin.submissions.title}
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
                    {f === "ALL" ? t.admin.submissions.all : f}
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
                      {slug === "ALL" ? t.admin.submissions.allSteps : t.admin.submissions.stepPrefix(slug)}
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
                <p className="text-white/40 text-sm">{t.admin.submissions.loading}</p>
              </div>
            ) : filteredSubmissions.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-white/20 text-lg font-bold">
                  {t.admin.submissions.noSubmissions}{" "}
                  {filter !== "ALL" || stepFilter !== "ALL" ? t.admin.submissions.withFilters : ""}
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

        {/* ═══════════ CAMPAGNE TAB ═══════════ */}
        {tab === "campagne" && (
          <div className="space-y-6">
            {/* Current campaign info */}
            {activeCampaign ? (
              <div
                className="rounded-2xl border p-6"
                style={{
                  backgroundColor: "rgba(13,27,46,0.6)",
                  borderColor: "rgba(255,255,255,0.06)",
                }}
              >
                <h2 className="text-lg font-black text-white mb-4 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-[#00c8ff]" />
                  {t.admin.campaign.active}
                </h2>

                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  {[
                    { label: t.admin.campaign.campaignNameLabel, value: activeCampaign.name, color: "#00c8ff" },
                    {
                      label: t.admin.campaign.deadline,
                      value: new Date(activeCampaign.deadline).toLocaleDateString(locale || "fr", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      }),
                      color: "#ffd700",
                    },
                    {
                      label: t.admin.campaign.status,
                      value: activeCampaign.expired ? t.admin.campaign.endedStatus : t.admin.campaign.activeStatus,
                      color: activeCampaign.expired ? "#FD2E5F" : "#2ecc71",
                    },
                    {
                      label: t.admin.campaign.createdAt,
                      value: new Date(activeCampaign.createdAt).toLocaleDateString(locale || "fr", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      }),
                      color: "rgba(255,255,255,0.4)",
                    },
                  ].map((item) => (
                    <div key={item.label}>
                      <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">
                        {item.label}
                      </p>
                      <p
                        className="text-sm font-black"
                        style={{ color: item.color }}
                      >
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Extend deadline form */}
                <div className="pt-6 border-t border-white/5">
                  <h3 className="text-sm font-black text-white mb-3">
                    {t.admin.campaign.extend}
                  </h3>
                  <div className="flex items-end gap-3 flex-wrap">
                    <div className="flex-1 min-w-[220px]">
                      <label className="block text-[10px] text-white/30 uppercase tracking-wider mb-1">
                        {t.admin.campaign.newDeadline}
                      </label>
                      <input
                        type="datetime-local"
                        value={newDeadline}
                        onChange={(e) => {
                          setNewDeadline(e.target.value);
                          setExtendError(null);
                          setExtendSuccess(null);
                        }}
                        className="w-full bg-[#0d1b2e] border border-white/10 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-[#ffd700]/50 focus:ring-1 focus:ring-[#ffd700]/30 transition"
                      />
                    </div>
                    <button
                      onClick={handleExtend}
                      disabled={extendLoading}
                      className="px-5 py-3 rounded-full font-black text-sm uppercase tracking-wider bg-[#ffd700]/15 border border-[#ffd700]/30 text-[#ffd700] hover:bg-[#ffd700]/25 transition disabled:opacity-50"
                    >
                      {extendLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        t.admin.campaign.extendButton
                      )}
                    </button>
                  </div>

                  {extendError && (
                    <div className="mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium">
                      {extendError}
                    </div>
                  )}
                  {extendSuccess && (
                    <div className="mt-3 p-3 rounded-xl bg-[#2ecc71]/10 border border-[#2ecc71]/20 text-[#2ecc71] text-xs font-medium">
                      {extendSuccess}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div
                className="rounded-2xl border p-8 text-center"
                style={{
                  backgroundColor: "rgba(13,27,46,0.6)",
                  borderColor: "rgba(255,255,255,0.06)",
                }}
              >
                <Clock className="w-10 h-10 mx-auto mb-3 text-white/15" />
                <p className="text-white/40 font-medium">
                  {t.admin.campaign.noActive}
                </p>
              </div>
            )}

            {/* Create new campaign — superadmin only */}
            {adminUser.role === "superadmin" && (
              <div
                className="rounded-2xl border p-6"
                style={{
                  backgroundColor: "rgba(13,27,46,0.6)",
                  borderColor: "rgba(255,215,0,0.15)",
                }}
              >
                <h2 className="text-sm font-black text-white mb-4 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-[#ffd700]" />
                  {t.admin.campaign.newCampaign}
                  <span className="text-[10px] text-[#ffd700]/60 font-normal">
                    {t.admin.campaign.superadminOnly}
                  </span>
                </h2>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] text-white/30 uppercase tracking-wider mb-1">
                      {t.admin.campaign.campaignName}
                    </label>
                    <input
                      type="text"
                      value={newCampaignName}
                      onChange={(e) => {
                        setNewCampaignName(e.target.value);
                        setCreateError(null);
                      }}
                      placeholder={t.admin.campaign.campaignNamePlaceholder}
                      className="w-full bg-[#0d1b2e] border border-white/10 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-[#ffd700]/50 focus:ring-1 focus:ring-[#ffd700]/30 transition"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] text-white/30 uppercase tracking-wider mb-1">
                      {t.admin.campaign.deadlineMin}
                    </label>
                    <input
                      type="datetime-local"
                      value={newCampaignDeadline}
                      onChange={(e) => {
                        setNewCampaignDeadline(e.target.value);
                        setCreateError(null);
                      }}
                      min={new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                        .toISOString()
                        .slice(0, 16)}
                      className="w-full bg-[#0d1b2e] border border-white/10 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-[#ffd700]/50 focus:ring-1 focus:ring-[#ffd700]/30 transition"
                    />
                  </div>

                  <button
                    onClick={handleCreateCampaign}
                    disabled={createLoading || !newCampaignDeadline}
                    className="w-full py-3 rounded-full font-black text-sm uppercase tracking-wider bg-[#ffd700]/15 border border-[#ffd700]/30 text-[#ffd700] hover:bg-[#ffd700]/25 transition disabled:opacity-50"
                  >
                    {createLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                    ) : (
                      t.admin.campaign.createButton
                    )}
                  </button>

                  {createError && (
                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium">
                      {createError}
                    </div>
                  )}
                  {createSuccess && (
                    <div className="p-3 rounded-xl bg-[#2ecc71]/10 border border-[#2ecc71]/20 text-[#2ecc71] text-xs font-medium">
                      {createSuccess}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
