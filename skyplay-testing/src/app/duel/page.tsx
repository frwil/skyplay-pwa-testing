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

  // ── Save result + return to lobby ───────────────────────────────
  const handleSaveAndExit = useCallback(async () => {
    const result = emu.duelMatchResult;
    const session = lobby.duelSession;
    if (!result || !session) return;

    // Save to DB
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
    } catch (e) {
      console.error("[Duel] Failed to save result:", e);
    }

    handleExit();
  }, [emu.duelMatchResult, lobby.duelSession, handleExit, isDevMode, currentUserId, currentUsername]);

  // ── Rematch ─────────────────────────────────────────────────────
  const [rematchLoading, setRematchLoading] = useState(false);

  const handleRematch = useCallback(async () => {
    const result = emu.duelMatchResult;
    const session = lobby.duelSession;
    if (!result || !session) return;

    setRematchLoading(true);
    // Save to DB first
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
    } catch (e) {
      console.error("[Duel] Failed to save result:", e);
    }

    // Request rematch via WebSocket → opponent gets rematch_requested
    emu.requestRematch();
  }, [emu.duelMatchResult, lobby.duelSession, emu.requestRematch, isDevMode, currentUserId, currentUsername]);

  // ── P2: Accept rematch ──────────────────────────────────────────
  const handleAcceptRematch = useCallback(async () => {
    const result = emu.duelMatchResult;
    const session = lobby.duelSession;
    if (!result || !session) return;

    setRematchLoading(true);
    // Save result to DB
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
    } catch (e) {
      console.error("[Duel] Failed to save result:", e);
    }

    // Call rematch API → creates new challenge + session
    try {
      const res = await fetch("/api/duel/rematch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: session.challengeId,
          winnerId: result.winner === 1 ? session.player1Id : session.player2Id,
          loserId: result.loser === 1 ? session.player1Id : session.player2Id,
          p1Losses: result.p1Losses,
          p2Losses: result.p2Losses,
          player1Id: session.player1Id,
          player2Id: session.player2Id,
          sessionId: session.sessionId,
          ...(isDevMode ? { devUserId: currentUserId, devUsername: currentUsername } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Rematch failed");

      // Send new session info to P1 via WebSocket
      const { sessionId: newSessionId, wsUrl: newWsUrl, roomCode: newRoomCode } = data.session;
      emu.acceptRematch(newSessionId, newWsUrl, newRoomCode);
    } catch (e) {
      console.error("[Duel] Rematch API failed:", e);
      setRematchLoading(false);
    }
  }, [emu.duelMatchResult, lobby.duelSession, emu.acceptRematch, isDevMode, currentUserId, currentUsername]);

  // ── P2: Decline rematch ─────────────────────────────────────────
  const handleDeclineRematch = useCallback(() => {
    emu.declineRematch();
    handleExit();
  }, [emu.declineRematch, handleExit]);

  // ── P1: Handle rematch declined by opponent ────────────────────
  useEffect(() => {
    if (!emu.rematchDeclined) return;
    handleExit();
  }, [emu.rematchDeclined, handleExit]);

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

        {/* ── Match Result Overlay ─────────────────────────────── */}
        {gameActive && emu.duelMatchResult && !emu.rematchRequested && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div
              className="rounded-3xl border p-8 text-center max-w-md mx-4 animate-in zoom-in-95"
              style={{
                backgroundColor: "rgba(13,27,46,0.95)",
                borderColor: emu.duelMatchResult.winner ===
                  (lobby.duelSession?.player1Id === currentUserId ? 1 : 2)
                  ? "rgba(74,222,128,0.4)"
                  : "rgba(253,46,95,0.4)",
                boxShadow: emu.duelMatchResult.winner ===
                  (lobby.duelSession?.player1Id === currentUserId ? 1 : 2)
                  ? "0 0 60px rgba(74,222,128,0.3)"
                  : "0 0 60px rgba(253,46,95,0.3)",
              }}
            >
              {/* Trophy / Skull icon */}
              <div className="text-6xl mb-4">
                {emu.duelMatchResult.winner ===
                  (lobby.duelSession?.player1Id === currentUserId ? 1 : 2)
                  ? "🏆"
                  : "💀"}
              </div>

              <h2 className="text-2xl font-black text-white mb-2">
                {emu.duelMatchResult.winner ===
                  (lobby.duelSession?.player1Id === currentUserId ? 1 : 2)
                  ? "Victoire !"
                  : "Défaite..."}
              </h2>

              <p className="text-sm text-white/40 mb-6">
                {emu.duelMatchResult.winner ===
                  (lobby.duelSession?.player1Id === currentUserId ? 1 : 2)
                  ? "Vous avez gagné le duel !"
                  : "Vous avez perdu le duel."}
              </p>

              {/* Score */}
              <div className="flex items-center justify-center gap-4 mb-6">
                <div className="text-center">
                  <div className="text-xs text-white/30 mb-1">P1</div>
                  <div
                    className="text-3xl font-black"
                    style={{
                      color: emu.duelMatchResult.winner === 1 ? "#4ade80" : "#fd2e5f",
                    }}
                  >
                    {emu.duelMatchResult.p1Losses >= 2 ? "💀" : "👑"}
                  </div>
                </div>
                <div className="text-2xl font-black text-white/20">vs</div>
                <div className="text-center">
                  <div className="text-xs text-white/30 mb-1">P2</div>
                  <div
                    className="text-3xl font-black"
                    style={{
                      color: emu.duelMatchResult.winner === 2 ? "#4ade80" : "#fd2e5f",
                    }}
                  >
                    {emu.duelMatchResult.p2Losses >= 2 ? "💀" : "👑"}
                  </div>
                </div>
              </div>

              <p className="text-xs text-white/20 mb-6">
                Score final : P1 {emu.duelMatchResult.p1Losses} - P2 {emu.duelMatchResult.p2Losses}
              </p>

              <div className="flex flex-col gap-3">
                <button
                  onClick={handleRematch}
                  disabled={rematchLoading}
                  className="px-6 py-3 rounded-xl text-sm font-bold transition-all hover:scale-105 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: "rgba(241,91,181,0.15)",
                    border: "1px solid rgba(241,91,181,0.35)",
                    color: "#f15bb5",
                  }}
                >
                  ⚔️ Prendre sa revanche
                </button>
                <button
                  onClick={handleSaveAndExit}
                  disabled={rematchLoading}
                  className="px-6 py-3 rounded-xl text-sm font-bold transition-all hover:scale-105 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    color: "white",
                  }}
                >
                  Retour au Lobby
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Rematch Requested Overlay (P2 sees accept/decline) ── */}
        {emu.rematchRequested && emu.duelMatchResult && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div
              className="rounded-3xl border p-8 text-center max-w-md mx-4"
              style={{
                backgroundColor: "rgba(13,27,46,0.95)",
                borderColor: "rgba(241,91,181,0.4)",
                boxShadow: "0 0 60px rgba(241,91,181,0.3)",
              }}
            >
              <div className="text-5xl mb-4">⚔️</div>
              <h2 className="text-xl font-black text-white mb-2">Revanche demandée !</h2>
              <p className="text-sm text-white/40 mb-6">
                Votre adversaire veut prendre sa revanche.
              </p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={handleAcceptRematch}
                  disabled={rematchLoading}
                  className="px-6 py-3 rounded-xl text-sm font-bold transition-all hover:scale-105 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: "rgba(74,222,128,0.15)",
                    border: "1px solid rgba(74,222,128,0.35)",
                    color: "#4ade80",
                  }}
                >
                  {rematchLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Création de la session...
                    </span>
                  ) : (
                    "✅ Accepter"
                  )}
                </button>
                <button
                  onClick={handleDeclineRematch}
                  disabled={rematchLoading}
                  className="px-6 py-3 rounded-xl text-sm font-bold transition-all hover:scale-105 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: "rgba(253,46,95,0.1)",
                    border: "1px solid rgba(253,46,95,0.25)",
                    color: "rgba(253,46,95,0.8)",
                  }}
                >
                  ❌ Refuser
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Waiting for Rematch Response (P1 sees this) ── */}
        {rematchLoading && !emu.rematchRequested && emu.duelMatchResult && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm pointer-events-none">
            <div
              className="rounded-3xl border p-8 text-center max-w-md mx-4"
              style={{
                backgroundColor: "rgba(13,27,46,0.95)",
                borderColor: "rgba(241,91,181,0.3)",
              }}
            >
              <Loader2 className="w-10 h-10 mx-auto mb-4 animate-spin" style={{ color: "#f15bb5" }} />
              <h2 className="text-lg font-black text-white mb-2">En attente...</h2>
              <p className="text-sm text-white/40">
                En attente de la réponse de l&apos;adversaire...
              </p>
            </div>
          </div>
        )}

        {/* ── Exit Button ────────────────────────────────────────── */}
        {gameActive && (
          <div className="flex justify-center mt-4">
            <button
              onClick={handleExit}
              className="px-5 py-2 rounded-xl text-xs font-bold transition-colors"
              style={{
                backgroundColor: "rgba(253,46,95,0.08)",
                border: "1px solid rgba(253,46,95,0.2)",
                color: "rgba(253,46,95,0.7)",
              }}
            >
              Leave Game
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
                { label: "Move", keys: "↑ ↓ ← →" },
                { label: "A (Punch)", keys: "X" },
                { label: "B (Kick)", keys: "Z" },
                { label: "C (Strong Punch)", keys: "C" },
                { label: "D (Strong Kick)", keys: "V" },
                { label: "Coin", keys: "Space" },
                { label: "Start", keys: "Enter" },
              ]}
              note="Host uses these keys on their machine."
            />
            <ControlsCard
              title="Player 2 Controls"
              accent="#f15bb5"
              controls={[
                { label: "Move", keys: "↑ ↓ ← →" },
                { label: "A (Punch)", keys: "X" },
                { label: "B (Kick)", keys: "Z" },
                { label: "C (Strong Punch)", keys: "C" },
                { label: "D (Strong Kick)", keys: "V" },
                { label: "Coin", keys: "Space" },
                { label: "Start", keys: "Enter" },
              ]}
              note="Guest uses the SAME keys on their machine. CloudAdapter routes inputs to correct player."
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
