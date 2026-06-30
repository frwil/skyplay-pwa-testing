"use client";

import { useState, useEffect, useCallback } from "react";
import GlowBackground from "@/components/GlowBackground";
import { useEmulator } from "@/lib/emulator/hooks/useEmulator";
import { useDuelLobby } from "@/lib/emulator/hooks/useDuelLobby";
import type { DuelSession } from "@/lib/emulator/hooks/useDuelLobby";
import type { SystemType } from "@/lib/emulator/types";
import { SYSTEM_CONFIGS } from "@/lib/emulator/EmulatorAdapter";
import DuelLobby from "@/components/duel/DuelLobby";
import DuelNotification from "@/components/duel/DuelNotification";
import {
  Gamepad2, Swords, Copy, Users, Cloud, Zap, Loader2,
  Keyboard, User, Check, AlertCircle, ArrowLeft, Activity,
} from "lucide-react";

export default function DuelPage() {
  const system: SystemType = "neogeo";
  const emu = useEmulator(system);
  const cfg = SYSTEM_CONFIGS[system];

  // ── Auth State ─────────────────────────────────────────────────
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [currentUsername, setCurrentUsername] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [isDevMode, setIsDevMode] = useState(false);

  useEffect(() => {
    // Detect local dev environment (no JWT available)
    const isLocalhost =
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

    const checkAuth = async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          if (data.user) {
            setCurrentUserId(data.user.id);
            setCurrentUsername(data.user.username || null);
            return;
          }
        }
      } catch { /* not authenticated */ }

      // Auth failed — in local dev, generate a dev identity
      if (isLocalhost) {
        setIsDevMode(true);
        const ident = getDevIdentity();
        setCurrentUserId(ident.userId);
        setCurrentUsername(ident.username);
      }
    };
    checkAuth().finally(() => setAuthChecked(true));
  }, []);

  // ── Duel Lobby ─────────────────────────────────────────────────
  const lobby = useDuelLobby({
    userId: currentUserId,
    username: currentUsername,
    isDevMode,
    enabled: authChecked && !!currentUserId && emu.status === "idle",
  });

  // Auto-join lobby when authenticated and idle
  useEffect(() => {
    if (currentUserId && emu.status === "idle" && !lobby.inLobby) {
      lobby.joinLobby();
    }
  }, [currentUserId, emu.status]);

  // ── Game Connection ────────────────────────────────────────────
  const connectingRef = false;

  // When duelSession is set, connect to the game
  useEffect(() => {
    if (!lobby.duelSession || emu.status !== "idle") return;

    const session = lobby.duelSession;
    const isHost = session.player1Id === currentUserId;

    console.log("[Duel] Connecting to game —", isHost ? "P1 HOST" : "P2 GUEST", session);

    if (isHost && emu.connectDuelHost) {
      emu.connectDuelHost(session.wsUrl, session.sessionId, "kof98.zip", session.roomCode);
    } else {
      emu.joinSession(session.roomCode);
    }
  }, [lobby.duelSession, emu.status, currentUserId]);

  // ── Handle incoming challenge ──────────────────────────────────
  const handleAcceptChallenge = useCallback(async () => {
    if (!lobby.pendingChallenge) return;
    const session = await lobby.acceptChallenge(lobby.pendingChallenge.duelChallengeId);
    if (session) {
      // duelSession will be set, triggering the useEffect above
    }
  }, [lobby.pendingChallenge, lobby.acceptChallenge]);

  const handleDeclineChallenge = useCallback(async () => {
    if (!lobby.pendingChallenge) return;
    await lobby.declineChallenge(lobby.pendingChallenge.duelChallengeId);
  }, [lobby.pendingChallenge, lobby.declineChallenge]);

  // ── Handle sending challenge ───────────────────────────────────
  const handleChallenge = useCallback(async (targetUserId: number) => {
    await lobby.sendChallenge(targetUserId);
  }, [lobby.sendChallenge]);

  // ── Exit game ──────────────────────────────────────────────────
  const handleExit = useCallback(() => {
    emu.exit();
    lobby.clearChallenge();
    // Re-join lobby then reload to fresh state
    lobby.joinLobby();
    setTimeout(() => window.location.reload(), 500);
  }, [emu.exit, lobby.clearChallenge, lobby.joinLobby]);

  // ── Toast & auto-save ──────────────────────────────────────────
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Auto-save on each match end + show toast
  useEffect(() => {
    if (!emu.duelMatchResult || emu.duelMatchHistory.length === 0) return;
    const result = emu.duelMatchResult;
    const session = lobby.duelSession;
    if (!session) return;

    // Count wins for scoreboard
    const p1Wins = emu.duelMatchHistory.filter((r) => r.winner === 1).length;
    const p2Wins = emu.duelMatchHistory.filter((r) => r.winner === 2).length;

    // Show toast
    const winnerLabel = result.winner === (session.player1Id === currentUserId ? 1 : 2) ? "Vous" : "Adversaire";
    setToastMessage(`🏆 ${winnerLabel} gagne ce match ! Score: ${p1Wins} - ${p2Wins}`);
    const timer = setTimeout(() => setToastMessage(null), 4000);

    // Save result to DB
    fetch("/api/duel/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeId: session.challengeId,
        winnerId: result.winner === 1 ? session.player1Id : session.player2Id,
        loserId: result.loser === 1 ? session.player1Id : session.player2Id,
        p1Losses: result.p1Losses,
        p2Losses: result.p2Losses,
        sessionId: session.sessionId,
        markCompleted: false,
        ...(isDevMode ? { devUserId: currentUserId, devUsername: currentUsername } : {}),
      }),
    }).catch((e) => console.error("[Duel] Failed to save result:", e));

    return () => clearTimeout(timer);
  }, [emu.duelMatchHistory.length]);

  // ── Stop duel ────────────────────────────────────────────────────
  const handleStopDuel = useCallback(async () => {
    const session = lobby.duelSession;
    if (session) {
      // Mark challenge as completed
      try {
        await fetch("/api/duel/result", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            challengeId: session.challengeId,
            winnerId: 0, // Not a real result, just marking completed
            loserId: 0,
            p1Losses: 0,
            p2Losses: 0,
            sessionId: session.sessionId,
            markCompleted: true,
            ...(isDevMode ? { devUserId: currentUserId, devUsername: currentUsername } : {}),
          }),
        });
      } catch (e) {
        console.error("[Duel] Failed to mark challenge completed:", e);
      }
    }
    emu.stopDuel();
    handleExit();
  }, [lobby.duelSession, emu.stopDuel, handleExit, isDevMode, currentUserId, currentUsername]);

  // ── Session closed by server → save + reload ──────────────────
  useEffect(() => {
    if (!emu.duelSessionClosed) return;
    console.log("[Duel] Session closed by server — saving result and reloading");

    const saveAndReload = async () => {
      // Save result if match ended (overlay was shown) and we have session info
      const result = emu.duelMatchResult;
      const session = lobby.duelSession;
      if (result && session) {
        try {
          await fetch("/api/duel/result", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              challengeId: session.challengeId,
              winnerId: result.winner === 1 ? session.player1Id : session.player2Id,
              loserId: result.loser === 1 ? session.player1Id : session.player2Id,
              p1Losses: result.p1Losses,
              p2Losses: result.p2Losses,
              sessionId: session.sessionId,
              ...(isDevMode ? { devUserId: currentUserId, devUsername: currentUsername } : {}),
            }),
          });
          console.log("[Duel] Result saved on session close");
        } catch (e) {
          console.error("[Duel] Failed to save result on session close:", e);
        }
      }

      lobby.clearChallenge();
      lobby.joinLobby();
      setTimeout(() => window.location.reload(), 500);
    };

    saveAndReload();
  }, [emu.duelSessionClosed]);

  // ── Cleanup on unmount ─────────────────────────────────────────
  useEffect(() => {
    return () => {
      lobby.leaveLobby();
    };
  }, []);

  // ── Cleanup on tab close (beforeunload) ───────────────────────
  useEffect(() => {
    const handleBeforeUnload = () => {
      const devId = isDevMode ? currentUserId : 0;
      const devName = currentUsername || "";
      const body: Record<string, unknown> = { action: "leave" };
      if (devId) {
        body.devUserId = devId;
        body.devUsername = devName;
      }
      fetch("/api/duel/lobby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
        credentials: "include",
      });
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDevMode, currentUserId, currentUsername]);

  // ── Derived state ──────────────────────────────────────────────
  const gameActive = emu.status === "running" || emu.status === "paused";
  const isLoading = emu.status === "loading";
  const playerRole =
    emu.status === "running" && lobby.duelSession
      ? lobby.duelSession.player1Id === currentUserId
        ? "host"
        : "guest"
      : null;

  const [copied, setCopied] = useState(false);
  const handleCopyCode = useCallback(async () => {
    if (!emu.roomCode) return;
    try {
      await navigator.clipboard.writeText(emu.roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard denied */ }
  }, [emu.roomCode]);

  return (
    <main className="relative min-h-screen">
      <GlowBackground />

      {/* Header */}
      <header className="relative z-10 border-b border-white/5 bg-[#070f1e]/80 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <a href="/" className="block">
              <div
                className="font-black text-xl uppercase tracking-[3px]"
                style={{
                  background: "linear-gradient(135deg, #f15bb5 0%, #9b5de5 50%, #00d2ff 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                SKY PLAY
              </div>
            </a>
            <div
              className="px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5"
              style={{
                backgroundColor: "rgba(241,91,181,0.12)",
                border: "1px solid rgba(241,91,181,0.25)",
                color: "#f15bb5",
              }}
            >
              <Swords className="w-3 h-3" />
              DUEL
            </div>
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
          </div>

          <div className="flex items-center gap-4">
            <a href="/login" className="text-xs text-white/40 hover:text-white transition font-medium">
              Connexion
            </a>
            <a href="/play" className="text-xs text-white/40 hover:text-white transition font-medium flex items-center gap-1">
              <ArrowLeft className="w-3 h-3" />
              Back to Play
            </a>
          </div>
        </div>
      </header>

      {/* ── Challenge Notification Modal ────────────────────────── */}
      {lobby.pendingChallenge && (
        <DuelNotification
          fromUsername={lobby.pendingChallenge.fromUsername}
          message={lobby.pendingChallenge.message}
          onAccept={handleAcceptChallenge}
          onDecline={handleDeclineChallenge}
          isAccepting={lobby.isResponding}
          isDeclining={lobby.isResponding}
          error={lobby.error}
        />
      )}

      <section className="relative z-10 max-w-5xl mx-auto px-4 py-8 pb-20">
        {/* Title */}
        <div className="text-center mb-8">
          <h1 className="text-3xl sm:text-4xl font-black text-white mb-2">
            ⚔️ KOF &apos;98 Duel Arena
          </h1>
          <p className="text-sm text-white/40 max-w-lg mx-auto">
            {gameActive
              ? "Fight! Use the controls below to play."
              : "Join the lobby, find an opponent, and challenge them to a duel."}
          </p>
        </div>

        {/* ── Lobby Error ───────────────────────────────────────── */}
        {lobby.error && (
          <div
            className="rounded-xl px-4 py-3 text-sm font-bold text-center mb-4"
            style={{
              backgroundColor: "rgba(253,46,95,0.08)",
              border: "1px solid rgba(253,46,95,0.2)",
              color: "#fd2e5f",
            }}
          >
            {lobby.error}
          </div>
        )}

        {/* ── Outgoing Challenge Status ─────────────────────────── */}
        {lobby.outgoingChallenge && !gameActive && (
          <div
            className="rounded-2xl border p-5 mb-6 text-center"
            style={{
              backgroundColor: "rgba(241,91,181,0.06)",
              borderColor: "rgba(241,91,181,0.2)",
            }}
          >
            {lobby.outgoingChallenge.status === "pending" && (
              <>
                <Loader2
                  className="w-8 h-8 mx-auto mb-3 animate-spin"
                  style={{ color: "#f15bb5" }}
                />
                <p className="text-sm font-bold text-white mb-1">
                  Challenge sent to {lobby.outgoingChallenge.targetUsername}!
                </p>
                <p className="text-xs text-white/30">
                  Waiting for response...
                </p>
              </>
            )}
            {lobby.outgoingChallenge.status === "declined" && (
              <>
                <AlertCircle className="w-8 h-8 mx-auto mb-3" style={{ color: "#fd2e5f" }} />
                <p className="text-sm font-bold text-white mb-1">
                  Challenge declined
                </p>
                <p className="text-xs text-white/30 mb-3">
                  {lobby.outgoingChallenge.targetUsername} declined your challenge.
                </p>
                <button
                  onClick={lobby.clearChallenge}
                  className="px-4 py-2 rounded-lg text-xs font-bold"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "rgba(255,255,255,0.5)",
                  }}
                >
                  Back to Lobby
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Lobby View (pre-game) ──────────────────────────────── */}
        {!gameActive && !isLoading && !lobby.outgoingChallenge && (
          <div className="mb-6">
            {/* Auth required */}
            {authChecked && !currentUserId && !isDevMode && (
              <div
                className="rounded-2xl border p-8 text-center"
                style={{
                  backgroundColor: "rgba(13,27,46,0.7)",
                  borderColor: "rgba(255,255,255,0.08)",
                }}
              >
                <User className="w-10 h-10 mx-auto mb-3" style={{ color: "rgba(255,255,255,0.2)" }} />
                <p className="text-sm text-white/40 mb-4">
                  Sign in to join the duel lobby
                </p>
                <a
                  href="/play"
                  className="px-5 py-2.5 rounded-xl text-sm font-bold inline-block"
                  style={{
                    backgroundColor: "rgba(0,200,255,0.15)",
                    border: "1px solid rgba(0,200,255,0.3)",
                    color: "#00c8ff",
                  }}
                >
                  Go to Play (sign in)
                </a>
              </div>
            )}

            {/* Auth check loading */}
            {!authChecked && (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: "rgba(255,255,255,0.15)" }} />
              </div>
            )}

            {/* Authenticated — show lobby */}
            {authChecked && currentUserId && (
              <DuelLobby
                players={lobby.players}
                inLobby={lobby.inLobby}
                isSending={lobby.isSending}
                onChallenge={handleChallenge}
                onJoinLobby={lobby.joinLobby}
              />
            )}
          </div>
        )}

        {/* ── Loading State ──────────────────────────────────────── */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div
              className="w-16 h-16 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: "rgba(0,200,255,0.3)", borderTopColor: "transparent" }}
            />
            <p className="text-sm font-medium text-cyan-300/70">
              {playerRole === "guest" ? "Joining game..." : "Starting KOF '98 duel..."}
            </p>
          </div>
        )}

        {/* ── Error State ────────────────────────────────────────── */}
        {emu.status === "error" && (
          <div className="flex flex-col items-center py-12 gap-4">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{
                backgroundColor: "rgba(253,46,95,0.1)",
                border: "1px solid rgba(253,46,95,0.3)",
              }}
            >
              <span style={{ color: "#fd2e5f", fontSize: "24px" }}>!</span>
            </div>
            <p className="text-sm font-semibold text-red-400">Failed to start game</p>
            <p className="text-xs text-white/25">
              Check that the game server is running.
            </p>
            <button
              onClick={handleExit}
              className="px-4 py-2 rounded-lg text-xs font-bold text-white/50 hover:text-white transition"
              style={{
                backgroundColor: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              Back to Lobby
            </button>
          </div>
        )}

        {/* ── Game Canvas ────────────────────────────────────────── */}
        <div
          className="relative rounded-3xl border overflow-hidden mx-auto"
          style={{
            backgroundColor: "rgba(13,27,46,0.85)",
            borderColor: gameActive ? "rgba(0,200,255,0.3)" : "rgba(255,255,255,0.06)",
            boxShadow: gameActive
              ? "0 0 60px rgba(0,200,255,0.2), inset 0 0 40px rgba(0,200,255,0.03)"
              : "0 0 20px rgba(0,0,0,0.3)",
            aspectRatio: `${cfg.width} / ${cfg.height}`,
            maxWidth: "960px",
            display: gameActive || isLoading || emu.status === "error" ? "block" : "none",
          }}
        >
          <canvas
            ref={emu.canvasRef}
            className="absolute inset-0 w-full h-full block"
            style={{ imageRendering: "pixelated" }}
          />

          {/* Scanline overlay */}
          {gameActive && (
            <div
              className="absolute inset-0 pointer-events-none z-10"
              style={{
                background: `repeating-linear-gradient(0deg, transparent, transparent 2px,
                  rgba(0,0,0,0.06) 2px, rgba(0,0,0,0.06) 4px)`,
              }}
            />
          )}

          {/* Paused overlay */}
          {emu.status === "paused" && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 backdrop-blur-[2px]">
              <div className="flex flex-col items-center gap-3">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center"
                  style={{
                    backgroundColor: "rgba(255,215,0,0.15)",
                    border: "2px solid rgba(255,215,0,0.4)",
                  }}
                >
                  <span style={{ color: "#ffd700", fontSize: "28px" }}>⏸</span>
                </div>
                <p className="text-sm font-bold uppercase tracking-wider text-yellow-400">Paused</p>
              </div>
            </div>
          )}

          {/* Loading overlay on canvas */}
          {isLoading && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30">
              <Loader2 className="w-10 h-10 animate-spin" style={{ color: "rgba(0,200,255,0.5)" }} />
            </div>
          )}

          {/* Info Badges */}
          {gameActive && (
            <div className="absolute top-3 left-3 z-30 flex flex-col gap-1.5 pointer-events-none">
              <InfoBadge color="#4ade80" bg="rgba(0,0,0,0.6)">
                <Activity className="w-2.5 h-2.5" />
                {emu.fps} FPS
              </InfoBadge>
              <InfoBadge color="rgba(139,92,246,0.8)" bg="rgba(139,92,246,0.12)">
                <Cloud className="w-2.5 h-2.5" />
                Cloud
              </InfoBadge>
              <InfoBadge
                color={playerRole === "host" ? "#00c8ff" : "#f15bb5"}
                bg="rgba(0,0,0,0.6)"
              >
                <User className="w-2.5 h-2.5" />
                {playerRole === "host" ? "P1 — You (Host)" : "P2 — You (Guest)"}
              </InfoBadge>
            </div>
          )}

          {/* Room Code Badge (P1) */}
          {gameActive && emu.roomCode && playerRole === "host" && (
            <div className="absolute top-3 right-3 z-30">
              <button
                onClick={handleCopyCode}
                className="flex items-center gap-2 rounded-full pl-3 pr-2.5 py-1.5 text-sm font-bold pointer-events-auto transition-all hover:scale-105"
                style={{
                  backgroundColor: "rgba(34,197,94,0.12)",
                  backdropFilter: "blur(8px)",
                  color: "rgba(34,197,94,0.9)",
                  border: "1px solid rgba(34,197,94,0.25)",
                }}
                title="Click to copy room code"
              >
                <Users className="w-3.5 h-3.5" />
                <span className="font-mono tracking-[4px]">{emu.roomCode}</span>
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5 opacity-60" />}
              </button>
            </div>
          )}
        </div>

        {/* ── Toast Notification ─────────────────────────────────── */}
        {toastMessage && (
          <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
            <div
              className="rounded-xl px-5 py-3 text-sm font-bold animate-in fade-in zoom-in-95"
              style={{
                backgroundColor: "rgba(13,27,46,0.95)",
                border: "1px solid rgba(241,91,181,0.4)",
                boxShadow: "0 0 30px rgba(241,91,181,0.3)",
                color: "white",
              }}
            >
              {toastMessage}
            </div>
          </div>
        )}

        {/* ── Scoreboard (overlaid on canvas) ────────────────────── */}
        {gameActive && emu.duelMatchHistory.length > 0 && (() => {
          const p1Wins = emu.duelMatchHistory.filter((r) => r.winner === 1).length;
          const p2Wins = emu.duelMatchHistory.filter((r) => r.winner === 2).length;
          const lastMatch = emu.duelMatchHistory[emu.duelMatchHistory.length - 1];
          const isP1 = lobby.duelSession?.player1Id === currentUserId;

          return (
            <div className="absolute top-12 left-1/2 -translate-x-1/2 z-25">
              <div
                className="rounded-xl px-4 py-2 flex items-center gap-3 text-xs font-bold whitespace-nowrap"
                style={{
                  backgroundColor: "rgba(0,0,0,0.75)",
                  backdropFilter: "blur(8px)",
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
              >
                <span>
                  🏆{" "}
                  <span style={{ color: isP1 ? "#4ade80" : "#f15bb5" }}>
                    {isP1 ? "Vous" : "P1"}
                  </span>{" "}
                  <span style={{ color: "#4ade80" }}>{p1Wins}</span>
                </span>
                <span className="text-white/30 font-black">-</span>
                <span>
                  <span style={{ color: "#f15bb5" }}>{p2Wins}</span>{" "}
                  <span style={{ color: isP1 ? "#f15bb5" : "#4ade80" }}>
                    {isP1 ? "P2" : "Vous"}
                  </span>
                </span>
                {lastMatch && (
                  <>
                    <span className="text-white/10">|</span>
                    <span className="text-white/35">
                      Dernier: {lastMatch.winner === 1 ? "P1" : "P2"}
                      {" ("}{lastMatch.p1Losses}-{lastMatch.p2Losses}{")"}
                    </span>
                  </>
                )}
                <button
                  onClick={handleStopDuel}
                  className="pointer-events-auto ml-1 px-3 py-1 rounded-lg text-[10px] font-bold transition-all hover:scale-105"
                  style={{
                    backgroundColor: "rgba(253,46,95,0.2)",
                    border: "1px solid rgba(253,46,95,0.4)",
                    color: "#fd2e5f",
                  }}
                >
                  Stop
                </button>
              </div>
            </div>
          );
        })()}

        {/* ── Stop Button ────────────────────────────────────────── */}
        {gameActive && (
          <div className="flex justify-center mt-4">
            <button
              onClick={handleStopDuel}
              className="px-5 py-2 rounded-xl text-xs font-bold transition-all hover:scale-105"
              style={{
                backgroundColor: "rgba(253,46,95,0.15)",
                border: "1px solid rgba(253,46,95,0.35)",
                color: "#fd2e5f",
              }}
            >
              ⏹ Stop Duel
            </button>
          </div>
        )}

        {/* ── Controls Reference ─────────────────────────────────── */}
        {gameActive && (
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
            <ControlsCard
              title="Player 1 Controls"
              accent="#00c8ff"
              controls={[
                { label: "Move", keys: "W A S D" },
                { label: "A (Punch)", keys: "Z" },
                { label: "B (Kick)", keys: "X" },
                { label: "C (Strong Punch)", keys: "C" },
                { label: "D (Strong Kick)", keys: "V" },
                { label: "Coin", keys: "Space" },
                { label: "Start", keys: "Enter" },
              ]}
              note="QWERTY: WASD + Z/X/C/V. AZERTY: ZQSD + W/X/C/V (same physical keys)."
            />
            <ControlsCard
              title="Player 2 Controls"
              accent="#f15bb5"
              controls={[
                { label: "Move", keys: "W A S D" },
                { label: "A (Punch)", keys: "Z" },
                { label: "B (Kick)", keys: "X" },
                { label: "C (Strong Punch)", keys: "C" },
                { label: "D (Strong Kick)", keys: "V" },
                { label: "Coin", keys: "Space" },
                { label: "Start", keys: "Enter" },
              ]}
              note="Guest uses the SAME physical keys. CloudAdapter routes inputs to correct player."
            />
          </div>
        )}
      </section>
    </main>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function InfoBadge({ children, color, bg }: { children: React.ReactNode; color: string; bg: string }) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold"
      style={{ backgroundColor: bg, backdropFilter: "blur(4px)", color, border: "1px solid rgba(255,255,255,0.08)" }}
    >
      {children}
    </div>
  );
}

function ControlsCard({
  title, accent, controls, note,
}: {
  title: string; accent: string; controls: { label: string; keys: string }[]; note: string;
}) {
  return (
    <div
      className="rounded-2xl border p-5"
      style={{ backgroundColor: "rgba(13,27,46,0.6)", borderColor: "rgba(255,255,255,0.06)" }}
    >
      <h3 className="text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-2" style={{ color: accent }}>
        <Gamepad2 className="w-3.5 h-3.5" />
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        {controls.map((c) => (
          <div key={c.label} className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-white/35">{c.label}</span>
            <span
              className="rounded-md px-2 py-0.5 text-[10px] font-mono font-bold"
              style={{ backgroundColor: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: accent }}
            >
              {c.keys}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[10px] text-white/20 italic">{note}</p>
    </div>
  );
}

// ── Dev Identity (local development without JWT) ──────────────────────

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/** Generate a stable dev user identity from URL ?name= or localStorage. */
function getDevIdentity(): { userId: number; username: string } {
  if (typeof window === "undefined") {
    return { userId: 1, username: "dev" };
  }

  // 1. URL param ?name=Player1 → consistent hash
  const params = new URLSearchParams(window.location.search);
  const nameParam = params.get("name");
  if (nameParam) {
    const userId = hashCode(nameParam);
    const username = nameParam;
    try {
      localStorage.setItem("skyplay_dev_userId", String(userId));
      localStorage.setItem("skyplay_dev_username", username);
    } catch { /* storage blocked */ }
    return { userId, username };
  }

  // 2. Restore from localStorage
  try {
    const storedId = localStorage.getItem("skyplay_dev_userId");
    const storedName = localStorage.getItem("skyplay_dev_username");
    if (storedId && storedName) {
      return { userId: parseInt(storedId, 10), username: storedName };
    }
  } catch { /* storage blocked */ }

  // 3. Generate a fresh random identity
  const randomId = Math.floor(Math.random() * 90000) + 10000;
  const randomName = `Duelist-${randomId}`;
  try {
    localStorage.setItem("skyplay_dev_userId", String(randomId));
    localStorage.setItem("skyplay_dev_username", randomName);
  } catch { /* storage blocked */ }
  return { userId: randomId, username: randomName };
}
