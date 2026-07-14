"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import GlowBackground from "@/components/GlowBackground";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import EmulatorCore from "@/components/play/EmulatorCore";
import ChallengePanel from "@/components/play/ChallengePanel";
import CountdownOverlay from "@/components/play/CountdownOverlay";
import ConnectionStatus from "@/components/play/ConnectionStatus";
import ParticipationDialog from "@/components/play/ParticipationDialog";
import ChallengeNotificationDialog from "@/components/play/ChallengeNotificationDialog";
import DisconnectResultDialog from "@/components/play/DisconnectResultDialog";
import type { ChallengeInfo } from "@/components/play/ParticipationDialog";
import { useEmulator } from "@/lib/emulator/hooks/useEmulator";
import { useNetplay } from "@/lib/emulator/netplay/hooks/useNetplay";
import { useChallengeNotifications } from "@/lib/emulator/netplay/hooks/useChallengeNotifications";
import type { NetplayEmulatorDeps } from "@/lib/emulator/netplay/NetplayManager";
import type { InputDelayEmulatorDeps } from "@/lib/emulator/netplay/InputDelayManager";
import { useTranslation } from "@/lib/i18n/TranslationContext";
import { ArrowLeft, Gamepad2, User, LogOut } from "lucide-react";
import type { SystemType } from "@/lib/emulator/types";

export default function PlayPage() {
  const { t } = useTranslation();
  const [system, setSystem] = useState<SystemType>("nes");
  const emu = useEmulator(system);
  const [autoDetectResult, setAutoDetectResult] = useState<{
    result: string;
    romName: string;
  } | null>(null);

  // ── Popup mode detection ────────────────────────────────────────
  const [isPopup, setIsPopup] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      setIsPopup(params.get("popup") === "1");
    }
  }, []);

  const handleOpenPopup = useCallback(() => {
    const params = new URLSearchParams();
    params.set("popup", "1");
    params.set("system", system);
    if (emu.currentRom) params.set("rom", emu.currentRom);
    const url = `/play?${params.toString()}`;
    const w = 1024;
    const h = 768;
    const left = Math.max(0, (screen.width - w) / 2);
    const top = Math.max(0, (screen.height - h) / 2);
    window.open(
      url,
      "skyplay-popup",
      `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`,
    );
  }, [system, emu.currentRom]);

  // ── Auth State ──────────────────────────────────────────────────
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [currentUsername, setCurrentUsername] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          if (data.user) {
            setCurrentUserId(data.user.id);
            setCurrentUsername(data.user.username || null);
          }
        }
      } catch {
        // Not authenticated
      } finally {
        setAuthChecked(true);
      }
    };
    checkAuth();
  }, []);

  // ── Netplay ─────────────────────────────────────────────────────
  const [selectedChallengeId, setSelectedChallengeId] = useState<number | null>(null);

  const netplay = useNetplay({ challengeId: selectedChallengeId, system });

  // ── Post-game session summary (CPU/cloud mode) ──────────────────
  const [sessionSummary, setSessionSummary] = useState<{
    sessionId: string;
    matches: typeof emu.duelMatchHistory;
  } | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const prevStatusRef = useRef(emu.status);

  // Track session ID when cloud game is running
  useEffect(() => {
    if (emu.status === "running" && emu.isCloud && emu.sessionId) {
      activeSessionIdRef.current = emu.sessionId;
    }
  }, [emu.status, emu.isCloud, emu.sessionId]);

  // Detect session end: server closed OR status transition running→idle
  useEffect(() => {
    const wasRunning = prevStatusRef.current === "running";
    const isNowIdle = emu.status === "idle";
    prevStatusRef.current = emu.status;

    // Skip if netplay is active (PvP handled by duel page)
    const isNetplayActive =
      netplay.netplayStatus === "playing" ||
      netplay.netplayStatus === "countdown" ||
      netplay.netplayStatus === "connected";

    if (isNetplayActive) return;

    // Server closed session
    if (emu.duelSessionClosed && activeSessionIdRef.current) {
      const sid = activeSessionIdRef.current;
      const matches = [...emu.duelMatchHistory];
      if (matches.length > 0) {
        setSessionSummary({ sessionId: sid, matches });
      }
      activeSessionIdRef.current = null;
      return;
    }

    // Status transition: was running, now idle (user stopped or loaded new ROM)
    if (wasRunning && isNowIdle && activeSessionIdRef.current) {
      const sid = activeSessionIdRef.current;
      const matches = [...emu.duelMatchHistory];
      if (matches.length > 0) {
        setSessionSummary({ sessionId: sid, matches });
      }
      activeSessionIdRef.current = null;
    }

    // Session ID cleared while running (new ROM loaded)
    if (emu.status === "loading" && activeSessionIdRef.current && emu.isCloud && !emu.sessionId) {
      const sid = activeSessionIdRef.current;
      const matches = [...emu.duelMatchHistory];
      if (matches.length > 0) {
        setSessionSummary({ sessionId: sid, matches });
      }
      activeSessionIdRef.current = null;
    }
  }, [emu.status, emu.duelSessionClosed, emu.isCloud, emu.sessionId, emu.duelMatchHistory, netplay.netplayStatus]);

  // ── Challenge Notifications (poll for incoming challenges) ─────

  const challengeNotifs = useChallengeNotifications({
    userId: currentUserId,
    enabled: !!currentUserId && netplay.participationStatus !== "none",
  });

  // When P2 accepts a challenge via notification dialog
  const handleAcceptChallenge = useCallback(async (sessionId: number) => {
    const challengeId = challengeNotifs.pendingChallenge?.challengeId;
    if (!challengeId) return;

    setSelectedChallengeId(challengeId);
    const result = await challengeNotifs.acceptChallenge(sessionId);
    if (result) {
      // Session is now MATCHED — find and join it.
      // POST /api/netplay/session returns the existing MATCHED session
      // where we're player2 (with ORDER BY DESC for correctness).
      netplay.startMatchmaking();
    }
  }, [challengeNotifs, netplay]);

  const handleDeclineChallenge = useCallback(async (sessionId: number) => {
    await challengeNotifs.declineChallenge(sessionId);
  }, [challengeNotifs]);

  // ── Participation Dialog ─────────────────────────────────────────
  const [participationChallenge, setParticipationChallenge] = useState<ChallengeInfo | null>(null);
  const [showParticipation, setShowParticipation] = useState(false);

  // Fetch challenge info when a challenge is selected (for the participation dialog)
  useEffect(() => {
    if (selectedChallengeId) {
      const fetchChallenge = async () => {
        try {
          const res = await fetch(`/api/challenges/${selectedChallengeId}`);
          if (res.ok) {
            const data = await res.json();
            // Don't open the dialog if the game has already started
            // (P2 accepting a challenge sets selectedChallengeId, but the
            // ParticipationDialog shouldn't flash open during countdown)
            if (data.challenge && netplay.participationStatus !== "in_game") {
              setParticipationChallenge(data.challenge);
              setShowParticipation(true);
            }
          }
        } catch {
          // ignore
        }
      };
      fetchChallenge();
    } else {
      setShowParticipation(false);
      setParticipationChallenge(null);
    }
  }, [selectedChallengeId, netplay.participationStatus]);

  // Auto-close participation dialog when the game starts
  // (so the modal overlay doesn't block the game view)
  useEffect(() => {
    if (netplay.participationStatus === "in_game" && showParticipation) {
      setShowParticipation(false);
    }
  }, [netplay.participationStatus, showParticipation]);

  // Refresh challenge info when participation status changes
  useEffect(() => {
    if (selectedChallengeId && netplay.participationStatus === "participating") {
      // Re-fetch to get updated participant count
      const refresh = async () => {
        try {
          const res = await fetch(`/api/challenges/${selectedChallengeId}`);
          if (res.ok) {
            const data = await res.json();
            if (data.challenge) {
              setParticipationChallenge(data.challenge);
            }
          }
        } catch {
          // ignore
        }
      };
      refresh();
    }
  }, [selectedChallengeId, netplay.participationStatus]);

  // ── Auto-load ROM when a challenge is selected ────────────────────

  const autoLoadedRef = useRef<number | null>(null); // challengeId we auto-loaded for
  const pendingRomRef = useRef<{ name: string; system: string } | null>(null);

  // Step 1: When challenge changes, set the system type
  useEffect(() => {
    if (!participationChallenge) {
      pendingRomRef.current = null;
      return;
    }

    const challenge = participationChallenge;

    // Log mode: NES = rollback, non-NES = input delay
    if (challenge.system !== "nes") {
      console.log("[Netplay:Page] ℹ️ Challenge system is", challenge.system, "— will use Input Delay mode");
    }

    // Switch system first (will trigger re-render, then Step 2 loads ROM)
    if (challenge.system !== system) {
      console.log("[Netplay:Page] Switching system:", system, "→", challenge.system);
      setSystem(challenge.system as SystemType);
    }

    // Store pending ROM info for Step 2
    pendingRomRef.current = { name: challenge.romName, system: challenge.system };
  }, [participationChallenge]);

  // Step 2: When system matches challenge system, load the ROM
  useEffect(() => {
    const pending = pendingRomRef.current;
    if (!pending) return;

    // Wait until the system has been switched
    if (emu.system !== pending.system) {
      console.log("[Netplay:Page] ⏳ Waiting for system switch... current:", emu.system, "target:", pending.system);
      return;
    }

    const alreadyLoaded =
      emu.status === "running" &&
      emu.currentRom &&
      (emu.currentRom === pending.name ||
        emu.currentRom.toLowerCase().includes(pending.name.toLowerCase()) ||
        pending.name.toLowerCase().includes(emu.currentRom.toLowerCase()));

    if (alreadyLoaded && autoLoadedRef.current === participationChallenge?.id) {
      console.log("[Netplay:Page] ROM already loaded, skipping");
      pendingRomRef.current = null;
      return;
    }

    console.log("[Netplay:Page] Looking for ROM:", pending.name, "system:", pending.system);

    const matchingRom = emu.romList.find(
      (r) =>
        r.system === pending.system &&
        (r.name === pending.name ||
          r.name.toLowerCase().includes(pending.name.toLowerCase()) ||
          pending.name.toLowerCase().includes(r.name.toLowerCase())),
    );

    if (matchingRom && emu.status !== "loading") {
      console.log("[Netplay:Page] ✅ Loading ROM:", matchingRom.name);
      autoLoadedRef.current = participationChallenge?.id ?? null;
      pendingRomRef.current = null;
      emu.loadRom(matchingRom);
    } else if (!matchingRom) {
      console.warn("[Netplay:Page] ⚠️ No matching ROM found for:", pending.name);
      pendingRomRef.current = null;
    }
  }, [emu.system, emu.status, emu.currentRom, emu.romList, emu.loadRom, participationChallenge]);

  // ── Bind netplay deps to emulator when running ──────────────────

  const depsBoundRef = useRef(false);

  useEffect(() => {
    // Reset when emulator stops (so we re-bind on next ROM load)
    if (emu.status !== "running") {
      depsBoundRef.current = false;
      return;
    }

    if (depsBoundRef.current) return;

    if (emu.system === "nes" && emu.stateBuffer && emu.inputBuffer) {
      // ── NES: Rollback deps ──────────────────────────────────
      const deps: NetplayEmulatorDeps = {
        getNes: emu.getNes,
        stateBuffer: emu.stateBuffer as NetplayEmulatorDeps["stateBuffer"],
        inputBuffer: emu.inputBuffer as NetplayEmulatorDeps["inputBuffer"],
        muteAudio: emu.muteAudio,
        unmuteAudio: emu.unmuteAudio,
        applyInputs: emu.applyInputs,
        applyButton: emu.applyButton,
        injectKeyEvent: emu.injectKeyEvent,
      };
      console.log("[Netplay:Page] bindEmulator called — NES rollback mode", {
        hasGetNes: typeof deps.getNes === "function",
        hasStateBuffer: !!deps.stateBuffer,
        hasInputBuffer: !!deps.inputBuffer,
        hasMuteAudio: typeof deps.muteAudio === "function",
        hasApplyInputs: typeof deps.applyInputs === "function",
      });
      netplay.bindEmulator(deps);
      depsBoundRef.current = true;
    } else if (emu.system !== "nes") {
      // ── Non-NES: Input Delay deps ───────────────────────────
      const deps: InputDelayEmulatorDeps = {
        applyButton: emu.applyButton,
        injectKeyEvent: emu.injectKeyEvent,
      };
      console.log("[Netplay:Page] bindEmulator called — Input Delay mode", {
        system: emu.system,
        hasApplyButton: typeof deps.applyButton === "function",
      });
      netplay.bindEmulator(deps);
      depsBoundRef.current = true;
    }
  }, [
    emu.status,
    emu.system,
    emu.stateBuffer,
    emu.inputBuffer,
    emu.getNes,
    emu.muteAudio,
    emu.unmuteAudio,
    emu.applyInputs,
    emu.applyButton,
    netplay.bindEmulator,
  ]);

  // ── Wire netplay manager into the emulator when ready ────────────

  const wiredRef = useRef(false);
  useEffect(() => {
    const manager = netplay.manager;
    console.log("[Netplay:Page] manager wiring check", {
      hasManager: !!manager,
      hasSetNetplayManager: typeof emu.setNetplayManager === "function",
      alreadyWired: wiredRef.current,
    });
    if (manager && emu.setNetplayManager && !wiredRef.current) {
      console.log("[Netplay:Page] ✅ Wiring manager into emulator + calling startNetplay()");
      emu.setNetplayManager(manager);
      wiredRef.current = true;
      netplay.startNetplay();
    }

    // Unwire when manager is cleared
    if (!manager && wiredRef.current) {
      console.log("[Netplay:Page] ❌ Manager cleared, unwiring");
      emu.setNetplayManager?.(null);
      wiredRef.current = false;
    }
  }, [netplay.manager, emu.setNetplayManager]);

  // ── Handlers ────────────────────────────────────────────────────

  const handleSelectChallenge = useCallback((challengeId: number) => {
    setSelectedChallengeId(challengeId);
  }, []);

  const handleAuthenticated = useCallback((userId: number, username: string) => {
    setCurrentUserId(userId);
    setCurrentUsername(username);
  }, []);

  const handleParticipate = useCallback((_arg?: number) => {
    netplay.participate();
  }, [netplay]);

  const handleStartMatchmaking = useCallback((opponentId?: number) => {
    // Guard: emulator must be running before matchmaking
    if (emu.status !== "running") {
      console.warn("[Netplay:Page] ⚠️ Cannot start matchmaking — emulator not running. Status:", emu.status);
    }
    netplay.startMatchmaking(opponentId);
  }, [netplay, emu.status]);

  // For the NetplayLobby "Start Now" button (anonymous matchmaking, no specific opponent)
  const handleLobbyMatchmaking = useCallback(() => {
    if (emu.status !== "running") {
      console.warn("[Netplay:Page] ⚠️ Cannot start lobby matchmaking — emulator not running.");
    }
    netplay.startMatchmaking(undefined);
  }, [netplay, emu.status]);

  const handleCloseParticipation = useCallback(() => {
    setShowParticipation(false);
    setSelectedChallengeId(null);
  }, []);

  // ── Netplay info overlay data ───────────────────────────────────
  const netplayInfo = {
    status: netplay.netplayStatus,
    latency: netplay.latency,
    rollbacks: netplay.rollbacks,
    mode: (emu.system === "nes" ? "rollback" : "input_delay") as "rollback" | "input_delay",
    opponentName: netplay.session?.opponentName ?? null,
  };
  const connectionStatus = {
    visible: netplay.netplayStatus === "playing" || netplay.netplayStatus === "connected",
    latency: netplay.latency,
    rollbacks: netplay.rollbacks,
    opponentName: netplay.session?.opponentName ?? null,
    connectionState: netplay.netplayStatus === "playing" ? "connected" : "connecting",
    status: netplay.netplayStatus,
  };

  return (
    <main className="relative min-h-screen">
      <GlowBackground />

      {/* Countdown Overlay */}
      <CountdownOverlay
        countdown={netplay.countdown}
        visible={netplay.netplayStatus === "countdown"}
      />

      {/* Challenge Notification Dialog (shown to P2 when challenged) */}
      {challengeNotifs.pendingChallenge && (
        <ChallengeNotificationDialog
          fromUsername={challengeNotifs.pendingChallenge.fromUsername}
          onAccept={() => handleAcceptChallenge(challengeNotifs.pendingChallenge!.sessionId)}
          onDecline={() => handleDeclineChallenge(challengeNotifs.pendingChallenge!.sessionId)}
          isAccepting={challengeNotifs.isAccepting}
          isDeclining={challengeNotifs.isDeclining}
          error={challengeNotifs.error}
        />
      )}

      {/* Disconnect Result Dialog (shown when match ends via disconnect) */}
      {netplay.disconnectResult && (
        <DisconnectResultDialog
          result={netplay.disconnectResult}
          onClose={() => {
            netplay.clearDisconnectResult();
            netplay.cleanup();
          }}
        />
      )}

      {/* Session Summary Overlay (CPU/cloud mode — shown after game session ends) */}
      {sessionSummary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div
            className="rounded-3xl border p-8 max-w-md w-full mx-4 text-center animate-in fade-in zoom-in-95"
            style={{
              backgroundColor: "rgba(13,27,46,0.95)",
              borderColor: "rgba(0,200,255,0.3)",
              boxShadow: "0 0 60px rgba(0,200,255,0.2)",
            }}
          >
            {/* Header */}
            <div className="mb-6">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{
                  backgroundColor: "rgba(0,200,255,0.1)",
                  border: "2px solid rgba(0,200,255,0.25)",
                }}
              >
                <Gamepad2 className="w-8 h-8" style={{ color: "#00c8ff" }} />
              </div>
              <h2 className="text-xl font-black text-white mb-1">Session terminée</h2>
              <p className="text-xs text-white/30">
                {sessionSummary.matches.length > 0
                  ? `${sessionSummary.matches.length} match${sessionSummary.matches.length > 1 ? "es" : ""} joué${sessionSummary.matches.length > 1 ? "s" : ""}`
                  : "Aucun match complété"}
              </p>
            </div>

            {/* Match Results */}
            {sessionSummary.matches.length > 0 && (
              <div
                className="rounded-xl border p-4 mb-6 text-left"
                style={{
                  backgroundColor: "rgba(0,0,0,0.3)",
                  borderColor: "rgba(255,255,255,0.08)",
                }}
              >
                <div className="space-y-2">
                  {sessionSummary.matches.map((m, i) => {
                    const isPlayerWin = m.winner === 1; // P1 is always the player in CPU mode
                    return (
                      <div
                        key={i}
                        className="flex items-center justify-between rounded-lg px-3 py-2 text-xs"
                        style={{ backgroundColor: "rgba(255,255,255,0.03)" }}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-white/40 font-bold">Match {m.matchNumber || i + 1}</span>
                          <span
                            className="rounded-full px-2 py-0.5 text-[9px] font-bold"
                            style={{
                              backgroundColor: isPlayerWin
                                ? "rgba(74,222,128,0.12)"
                                : "rgba(253,46,95,0.12)",
                              color: isPlayerWin ? "#4ade80" : "#fd2e5f",
                            }}
                          >
                            {isPlayerWin ? "VICTOIRE" : "DÉFAITE"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-white/40">
                            {m.p1Losses} - {m.p2Losses}
                          </span>
                          {(m.perfectKos || 0) > 0 && (
                            <span
                              className="rounded-full px-2 py-0.5 text-[9px] font-bold"
                              style={{
                                backgroundColor: "rgba(255,215,0,0.15)",
                                color: "#ffd700",
                              }}
                            >
                              ⭐ Perfect
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col gap-3">
              {sessionSummary.sessionId && (
                <a
                  href={`/stats/${sessionSummary.sessionId}`}
                  className="block w-full px-5 py-3 rounded-xl text-sm font-bold transition-all hover:scale-105"
                  style={{
                    backgroundColor: "rgba(0,200,255,0.15)",
                    border: "1px solid rgba(0,200,255,0.35)",
                    color: "#00c8ff",
                  }}
                >
                  📊 Voir les statistiques détaillées
                </a>
              )}
              <button
                onClick={() => setSessionSummary(null)}
                className="w-full px-5 py-3 rounded-xl text-sm font-bold transition-all hover:scale-105"
                style={{
                  backgroundColor: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "rgba(255,255,255,0.6)",
                }}
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Connection Status Bar — hidden in popup mode */}
      {!isPopup && <ConnectionStatus {...connectionStatus} />}

      {/* Header — hidden in popup mode */}
      {!isPopup && (
      <header
        className="relative z-10 border-b border-white/5 bg-[#070f1e]/80 backdrop-blur-sm"
      >
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
              {t.common.siteTitle}
            </div>
            <div
              className="uppercase tracking-[4px] mt-0.5"
              style={{ fontSize: "8px", color: "rgba(255,255,255,0.4)" }}
            >
              {t.common.siteSubtitle}
            </div>
          </a>

          <div className="flex items-center gap-4">
            {/* Auth status */}
            {authChecked && currentUserId && (
              <div className="flex items-center gap-2">
                <span
                  className="px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5"
                  style={{
                    backgroundColor: "rgba(74,222,128,0.1)",
                    border: "1px solid rgba(74,222,128,0.2)",
                    color: "#4ade80",
                  }}
                >
                  <User className="w-3 h-3" />
                  {currentUsername}
                </span>
              </div>
            )}

            <LanguageSwitcher />
            {authChecked && currentUserId ? (
              <button
                onClick={async () => {
                  try {
                    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
                  } catch { /* ignore */ }
                  // Prevent dev identity fallback on reload
                  try { sessionStorage.setItem("skyplay_logged_out", "1"); } catch { /* ignore */ }
                  window.location.reload();
                }}
                className="text-xs text-white/40 hover:text-white transition font-medium flex items-center gap-1"
              >
                <LogOut className="w-3 h-3" />
                Déconnexion
              </button>
            ) : (
              <a
                href="/login"
                className="text-xs text-white/40 hover:text-white transition font-medium"
              >
                Connexion
              </a>
            )}
            <a
              href="/"
              className="text-xs text-white/40 hover:text-white transition font-medium flex items-center gap-1"
            >
              <ArrowLeft className="w-3 h-3" />
              {t.common.back}
            </a>
            <a
              href="/faq"
              className="text-xs text-white/40 hover:text-white transition font-medium"
            >
              {t.common.faq}
            </a>
            <a
              href="/duel"
              className="text-xs text-white/40 hover:text-white transition font-medium flex items-center gap-1"
            >
              ⚔️ Duel
            </a>
            <a
              href={process.env.NODE_ENV === "development" ? "http://localhost:3000" : "https://sky-play-platform-gamma.vercel.app"}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1 rounded-full text-xs font-bold border transition"
              style={{
                color: "#00c8ff",
                borderColor: "rgba(0,200,255,0.3)",
                backgroundColor: "rgba(0,200,255,0.08)",
              }}
            >
              Plateforme ↗
            </a>
            <a
              href="/admin"
              className="text-xs text-white/40 hover:text-white transition font-medium"
            >
              {t.common.admin}
            </a>
            <span
              className="px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5"
              style={{
                backgroundColor: "rgba(0,200,255,0.1)",
                border: "1px solid rgba(0,200,255,0.3)",
                color: "#00c8ff",
              }}
            >
              <Gamepad2 className="w-3 h-3" />
              PLAY
            </span>
          </div>
        </div>
      </header>
      )}

      {/* Content — full-width in popup mode */}
      <section className={isPopup ? "relative z-10 w-full px-2 py-4" : "relative z-10 max-w-7xl mx-auto px-4 py-8 pb-20"}>
        {/* Page Title — hidden in popup mode */}
        {!isPopup && (
        <div className="text-center mb-8">
          <h1 className="text-3xl sm:text-4xl font-black text-white mb-3">
            {t.play.title}
          </h1>
          <p className="text-sm text-white/40 max-w-md mx-auto">
            {emu.currentRom
              ? `${t.play.nowPlaying}: ${emu.currentRom}`
              : t.play.noRomDescription}
          </p>
        </div>
        )}

        {/* Netplay Error */}
        {netplay.error && (
          <div
            className="rounded-xl px-4 py-3 text-sm font-bold text-center mb-4"
            style={{
              backgroundColor: "rgba(253,46,95,0.08)",
              border: "1px solid rgba(253,46,95,0.2)",
              color: "#fd2e5f",
            }}
          >
            {netplay.error}
          </div>
        )}

        {/* Participation Dialog */}
        {authChecked && participationChallenge && (
          <ParticipationDialog
            challenge={participationChallenge}
            isOpen={showParticipation}
            onClose={handleCloseParticipation}
            currentUserId={currentUserId}
            currentUsername={currentUsername}
            onAuthenticated={handleAuthenticated}
            isParticipating={netplay.participationStatus !== "none"}
            onParticipate={handleParticipate}
            onLeave={netplay.leave}
            participants={netplay.participants}
            onStartMatchmaking={handleStartMatchmaking}
            isSearching={netplay.isSearching}
            error={netplay.error}
            onClearError={() => {}} // error is cleared by next netplay action
          />
        )}

        {/* Async Challenges — hidden in popup mode */}
        {!isPopup && (
        <ChallengePanel
          currentSystem={system}
          onPlayChallenge={(s, rom) => {
            setSystem(s);
          }}
          autoDetectResult={autoDetectResult}
          onAutoDetectConsumed={() => setAutoDetectResult(null)}
          currentUserId={currentUserId}
          currentUsername={currentUsername}
          netplayParticipants={netplay.participants}
          netplayStatus={netplay.netplayStatus}
          isNetplaySearching={netplay.isSearching}
          onParticipate={handleParticipate}
          onStartMatchmaking={handleLobbyMatchmaking}
          onCancelMatchmaking={netplay.cancelMatchmaking}
          onSelectChallenge={handleSelectChallenge}
        />
        )}

        {/* Emulator */}
        <EmulatorCore
          emu={emu}
          system={system}
          onSystemChange={setSystem}
          onAutoDetectConfirm={(detected) => {
            setAutoDetectResult({
              result: detected.trigger.result,
              romName: detected.profile.romName,
            });
          }}
          netplayInfo={netplayInfo}
          isPopup={isPopup}
          onOpenPopup={handleOpenPopup}
        />
      </section>

      {/* Footer — hidden in popup mode */}
      {!isPopup && (
      <footer className="relative z-10 border-t border-white/5 py-6 px-4 text-center">
        <p className="text-xs text-white/20">
          {t.common.footer}
        </p>
      </footer>
      )}
    </main>
  );
}
