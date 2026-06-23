"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import GlowBackground from "@/components/GlowBackground";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import EmulatorCore from "@/components/play/EmulatorCore";
import ChallengePanel from "@/components/play/ChallengePanel";
import CountdownOverlay from "@/components/play/CountdownOverlay";
import ConnectionStatus from "@/components/play/ConnectionStatus";
import ParticipationDialog from "@/components/play/ParticipationDialog";
import type { ChallengeInfo } from "@/components/play/ParticipationDialog";
import { useEmulator } from "@/lib/emulator/hooks/useEmulator";
import { useNetplay } from "@/lib/emulator/netplay/hooks/useNetplay";
import type { NetplayEmulatorDeps } from "@/lib/emulator/netplay/NetplayManager";
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

  const netplay = useNetplay({ challengeId: selectedChallengeId });

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
            if (data.challenge) {
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
  }, [selectedChallengeId]);

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

  // ── Bind netplay deps to emulator when running NES ──────────────

  const depsBoundRef = useRef(false);

  useEffect(() => {
    if (
      emu.status === "running" &&
      emu.system === "nes" &&
      emu.stateBuffer &&
      emu.inputBuffer &&
      !depsBoundRef.current
    ) {
      const deps: NetplayEmulatorDeps = {
        getNes: emu.getNes,
        stateBuffer: emu.stateBuffer as NetplayEmulatorDeps["stateBuffer"],
        inputBuffer: emu.inputBuffer as NetplayEmulatorDeps["inputBuffer"],
        muteAudio: emu.muteAudio,
        unmuteAudio: emu.unmuteAudio,
        applyInputs: emu.applyInputs,
      };
      console.log("[Netplay:Page] bindEmulator called — emulator running, NES ready", {
        hasGetNes: typeof deps.getNes === "function",
        hasStateBuffer: !!deps.stateBuffer,
        hasInputBuffer: !!deps.inputBuffer,
        hasMuteAudio: typeof deps.muteAudio === "function",
        hasApplyInputs: typeof deps.applyInputs === "function",
      });
      netplay.bindEmulator(deps);
      depsBoundRef.current = true;
    }

    // Reset when emulator stops (so we re-bind on next ROM load)
    if (emu.status !== "running") {
      depsBoundRef.current = false;
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

  const handleStartMatchmaking = useCallback((_arg?: number) => {
    netplay.startMatchmaking();
  }, [netplay]);

  const handleCloseParticipation = useCallback(() => {
    setShowParticipation(false);
    setSelectedChallengeId(null);
  }, []);

  // ── Connection status state ──────────────────────────────────────
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

      {/* Connection Status Bar */}
      <ConnectionStatus {...connectionStatus} />

      {/* Header */}
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

      {/* Content */}
      <section className="relative z-10 max-w-4xl mx-auto px-4 py-8 pb-20">
        {/* Page Title */}
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

        {/* Async Challenges */}
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
          onStartMatchmaking={handleStartMatchmaking}
          onCancelMatchmaking={netplay.cancelMatchmaking}
          onSelectChallenge={handleSelectChallenge}
        />

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
        />
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 py-6 px-4 text-center">
        <p className="text-xs text-white/20">
          {t.common.footer}
        </p>
      </footer>
    </main>
  );
}
