"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import GlowBackground from "@/components/GlowBackground";
import { useEmulator } from "@/lib/emulator/hooks/useEmulator";
import { useFullscreen } from "@/lib/emulator/hooks/useFullscreen";
import { useDuelLobby } from "@/lib/emulator/hooks/useDuelLobby";
import type { DuelSession } from "@/lib/emulator/hooks/useDuelLobby";
import type { SystemType } from "@/lib/emulator/types";
import { SYSTEM_CONFIGS } from "@/lib/emulator/EmulatorAdapter";
import { useDuelGames, type ResolvedDuelGame } from "@/lib/duel/useDuelGames";
import DuelLobby from "@/components/duel/DuelLobby";
import DuelNotification from "@/components/duel/DuelNotification";
import { KofMatchHUD } from "@/components/play/KofMatchHUD";
import DuelEndOverlay, { type RevengePhase, type BalanceMove } from "@/components/duel/DuelEndOverlay";
import DuelAbandonOverlay from "@/components/duel/DuelAbandonOverlay";
import DuelRulesOverlay from "@/components/duel/DuelRulesOverlay";
import DuelPauseOverlay from "@/components/duel/DuelPauseOverlay";
import DuelGameSelector from "@/components/duel/DuelGameSelector";
import DuelWizardStepper, { type WizardStep } from "@/components/duel/DuelWizardStepper";
import DuelModeSelector from "@/components/duel/DuelModeSelector";
import PlayerBadge from "@/components/PlayerBadge";
import { useTranslation } from "@/lib/i18n/TranslationContext";
import {
  Gamepad2, Swords, Copy, Users, Cloud, Zap, Loader2,
  Keyboard, User, Check, AlertCircle, ArrowLeft, Activity, LogOut,
  Maximize2, Minimize2, History, Pause,
} from "lucide-react";

export default function DuelPage() {
  const { t } = useTranslation();

  // ── Game selection (fetched from DB, falls back to games.ts) ────
  const { games: duelGames, getEntryFee, getModeEntryFee, getMode } = useDuelGames();
  const [selectedGameId, setSelectedGameId] = useState<string>("kof98");
  const game: ResolvedDuelGame = duelGames.find((g) => g.id === selectedGameId) ?? duelGames[0];
  // Default to the first (standard) mode of the selected game
  const [selectedModeId, setSelectedModeId] = useState<string>("kof98_standard");
  // ── Wizard step (game → mode → arena) ─────────────────────
  const [wizardStep, setWizardStep] = useState<WizardStep>("game");
  const handleSelectGame = useCallback((gameId: string) => {
    setSelectedGameId(gameId);
    const g = duelGames.find((g) => g.id === gameId);
    if (g?.modes?.[0]) setSelectedModeId(g.modes[0].id);
    setWizardStep("mode"); // auto-advance to mode selection
  }, [duelGames]);
  const currentMode = getMode(selectedModeId) ?? game?.modes?.[0] ?? null;
  const system: SystemType = (game?.system ?? "neogeo") as SystemType;
  const emu = useEmulator(system);
  const cfg = SYSTEM_CONFIGS[system];

  // Canvas container ref + fullscreen control (auto-fullscreen at match start; Escape exits).
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, enter: enterFullscreen, exit: exitFullscreen, toggle: toggleFullscreen } = useFullscreen();

  // ── Auth State ─────────────────────────────────────────────────
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [currentUsername, setCurrentUsername] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [isDevMode, setIsDevMode] = useState(false);

  const [mounted, setMounted] = useState(false);

  // Current user's profile (avatar + nationality) for the header badge.
  const [myAvatar, setMyAvatar] = useState<string | null>(null);
  const [myCountry, setMyCountry] = useState<string | null>(null);

  // Both duel participants' profiles (username/avatar/country), keyed by user id — for the overlay.
  const [duelProfiles, setDuelProfiles] = useState<Record<number, { username: string; avatar: string | null; country: string | null }>>({});

  // ── Duel SKY balance (header badge + button gating) ────────────
  const [skyBalance, setSkyBalance] = useState<number | null>(null);
  const [unlimitedSky, setUnlimitedSky] = useState(false);
  const entryFee = currentMode?.entryFee ?? getEntryFee(selectedGameId);
  const canChallenge = unlimitedSky || (skyBalance !== null && skyBalance >= entryFee);

  // Animated end-of-match balance panel data (you + opponent), filled from the /api/duel/result
  // settlement response. null until the POST resolves (overlay falls back to the static line).
  const [balanceAnim, setBalanceAnim] = useState<{ you: BalanceMove | null; opp: BalanceMove | null } | null>(null);

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
            setMyAvatar(data.user.avatar ?? null);
            setMyCountry(data.user.country ?? null);
            try { sessionStorage.removeItem("skyplay_logged_out"); } catch { /* ignore */ }
            return;
          }
        }
      } catch { /* not authenticated */ }

      // Auth failed — in local dev, generate a dev identity (unless just logged out)
      if (isLocalhost && !sessionStorage.getItem("skyplay_logged_out")) {
        setIsDevMode(true);
        const ident = getDevIdentity();
        setCurrentUserId(ident.userId);
        setCurrentUsername(ident.username);
      }
    };
    checkAuth().finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => { setMounted(true); }, []);

  // Resolve main platform URL after mount (avoids hydration mismatch)
  const mainPlatformUrl = mounted && typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:3000"
    : "https://sky-play-platform-gamma.vercel.app";

  // Fetch/refresh the caller's SKY balance (used for the header badge + gating challenge/rematch).
  const refreshBalance = useCallback(async () => {
    if (!currentUserId) return;
    try {
      const q = isDevMode
        ? `?devUserId=${currentUserId}&devUsername=${encodeURIComponent(currentUsername || "")}`
        : "";
      const res = await fetch(`/api/duel/balance${q}`, { credentials: "include" });
      if (!res.ok) return;
      const d = await res.json();
      setSkyBalance(d.unlimitedSky ? null : d.balance);
      setUnlimitedSky(!!d.unlimitedSky);
      // canChallenge is computed locally from skyBalance + per-game entryFee
    } catch { /* ignore */ }
  }, [currentUserId, isDevMode, currentUsername]);

  useEffect(() => { void refreshBalance(); }, [refreshBalance]);

  // ── Duel Lobby ─────────────────────────────────────────────────
  const lobby = useDuelLobby({
    userId: currentUserId,
    username: currentUsername,
    isDevMode,
    enabled: authChecked && !!currentUserId && emu.status === "idle",
    system: game.system,
    rom: game.rom,
  });

  // Auto-join lobby when authenticated and idle
  useEffect(() => {
    if (currentUserId && emu.status === "idle" && !lobby.inLobby) {
      lobby.joinLobby();
    }
  }, [currentUserId, emu.status]);

  // Re-join lobby when game selection changes
  useEffect(() => {
    if (lobby.inLobby && currentUserId && emu.status === "idle") {
      lobby.leaveLobby().then(() => lobby.joinLobby());
    }
  }, [selectedGameId]);

  // ── Game Connection ────────────────────────────────────────────
  const connectingRef = false;

  // When duelSession is set, connect to the game
  useEffect(() => {
    if (!lobby.duelSession || emu.status !== "idle") return;

    const session = lobby.duelSession;
    const isHost = session.player1Id === currentUserId;

    console.log("[Duel] Connecting to game —", isHost ? "P1 HOST" : "P2 GUEST", session);

    // Initialize multi-match tracking from the selected mode
    if (currentMode && currentMode.matchCount > 1) {
      setDuelFormat({ modeId: currentMode.id, matchCount: currentMode.matchCount, currentMatch: 0 });
    } else {
      setDuelFormat(null);
    }

    if (isHost && emu.connectDuelHost) {
      emu.connectDuelHost(session.wsUrl, session.sessionId, game.rom, session.roomCode);
    } else {
      emu.joinSession(session.roomCode);
    }
  }, [lobby.duelSession, emu.status, currentUserId]);

  // Fetch both participants' profiles (avatar/country/username) once a duel session exists — for
  // the end-of-match overlay badges (players have left the lobby by then).
  useEffect(() => {
    const session = lobby.duelSession;
    if (!session) return;
    const ids = [session.player1Id, session.player2Id].filter(Boolean);
    if (ids.length === 0) return;
    const q = isDevMode ? `&devUserId=${currentUserId}` : "";
    fetch(`/api/duel/profiles?ids=${ids.join(",")}${q}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.profiles) setDuelProfiles(d.profiles); })
      .catch(() => { /* non-fatal — overlay falls back to generic badges */ });
  }, [lobby.duelSession?.sessionId]);

  // ── Handle incoming challenge ──────────────────────────────────
  const [isAccepting, setIsAccepting] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);

  const handleAcceptChallenge = useCallback(async () => {
    if (!lobby.pendingChallenge) return;
    setIsAccepting(true);
    try {
      const session = await lobby.acceptChallenge(lobby.pendingChallenge.duelChallengeId);
      if (session) {
        // duelSession will be set, triggering the useEffect above
      }
    } finally {
      setIsAccepting(false);
    }
  }, [lobby.pendingChallenge, lobby.acceptChallenge]);

  const handleDeclineChallenge = useCallback(async () => {
    if (!lobby.pendingChallenge) return;
    setIsDeclining(true);
    try {
      await lobby.declineChallenge(lobby.pendingChallenge.duelChallengeId);
    } finally {
      setIsDeclining(false);
    }
  }, [lobby.pendingChallenge, lobby.declineChallenge]);

  // ── Rules overlay state & handlers ─────────────────────────────
  const [rulesAccepting, setRulesAccepting] = useState(false);
  const [rulesDeclining, setRulesDeclining] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  /** True when this player confirmed first and is waiting for the opponent.
   *  Prevents re-submission that would hit "not in rules_pending" error. */
  const [rulesWaitingOpponent, setRulesWaitingOpponent] = useState(false);
  // Challenge details fetched when rules overlay appears
  const [rulesChallenge, setRulesChallenge] = useState<{
    challengeId: number;
    opponentName: string;
    gameLabel: string;
    modeLabel: string;
    matchCount: number;
    entryFee: number;
  } | null>(null);

  // Fetch challenge details when rules_pending appears
  useEffect(() => {
    if (!lobby.rulesPendingChallenge) { setRulesChallenge(null); setRulesWaitingOpponent(false); return; }
    const challengeId = lobby.rulesPendingChallenge.duelChallengeId;
    const q = isDevMode ? `&devUserId=${currentUserId}` : "";
    fetch(`/api/duel/challenge?challengeId=${challengeId}${q}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.challenge) return;
        const c = data.challenge;
        // Determine opponent
        const isChallenger = c.challengerId === currentUserId;
        const oppId = isChallenger ? c.targetId : c.challengerId;
        const oppProfile = duelProfiles[oppId];
        const opponentName = oppProfile?.username ?? (isChallenger ? `Player-${c.targetId}` : `Player-${c.challengerId}`);
        setRulesChallenge({
          challengeId: c.id as number,
          opponentName,
          gameLabel: game.label,
          modeLabel: currentMode?.label?.split(" — ").pop() ?? "Standard",
          matchCount: (c.matchCount as number) ?? 1,
          entryFee: entryFee,
        });
      })
      .catch(() => { setRulesError("Impossible de charger les détails du défi"); });
  }, [lobby.rulesPendingChallenge?.duelChallengeId, currentUserId, game.label, currentMode?.label, entryFee, isDevMode, duelProfiles]);

  const handleRulesAccept = useCallback(async () => {
    if (!rulesChallenge || rulesAccepting || rulesWaitingOpponent) return;
    setRulesAccepting(true);
    setRulesError(null);
    try {
      let body: Record<string, unknown> = { challengeId: rulesChallenge.challengeId, accept: true };
      if (isDevMode) { body.devUserId = currentUserId; body.devUsername = currentUsername; }
      const res = await fetch("/api/duel/challenge/confirm-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Échec de la confirmation");
      }
      if (data.session) {
        // Both confirmed — session is ready. Set duelSession directly so the
        // game connects immediately (no polling delay). Also used by P2 (target)
        // who has no outgoing challenge and would otherwise never get the session.
        lobby.setDuelSession(data.session);
        lobby.clearRulesPending();
        setRulesChallenge(null);
      } else if (data.waiting) {
        // We confirmed first — keep the overlay but disable re-submission.
        // If we re-enable the button and the user clicks again after the opponent
        // confirmed, we'd hit "not in rules_pending" because the status is now "accepted".
        setRulesWaitingOpponent(true);
      }
    } catch (err) {
      setRulesError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setRulesAccepting(false);
    }
  }, [rulesChallenge, isDevMode, currentUserId, currentUsername, lobby]);

  const handleRulesDecline = useCallback(async () => {
    if (!rulesChallenge) return;
    setRulesDeclining(true);
    try {
      let body: Record<string, unknown> = { challengeId: rulesChallenge.challengeId, accept: false };
      if (isDevMode) { body.devUserId = currentUserId; body.devUsername = currentUsername; }
      await fetch("/api/duel/challenge/confirm-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      lobby.clearRulesPending();
      setRulesChallenge(null);
    } catch { /* best effort */ }
    finally {
      setRulesDeclining(false);
    }
  }, [rulesChallenge, isDevMode, currentUserId, currentUsername, lobby]);

  // ── Handle sending challenge ───────────────────────────────────
  const handleChallenge = useCallback(async (targetUserId: number) => {
    await lobby.sendChallenge(targetUserId, selectedModeId);
  }, [lobby.sendChallenge, selectedModeId]);

  // ── Exit game ──────────────────────────────────────────────────
  const handleExit = useCallback(() => {
    emu.exit();
    lobby.clearChallenge();
    // Re-join lobby then reload to fresh state
    lobby.joinLobby();
    setTimeout(() => window.location.reload(), 500);
  }, [emu.exit, lobby.clearChallenge, lobby.joinLobby]);

  // ── Post-game summary (shown after session ends) ──────────────
  const [postGame, setPostGame] = useState<{
    sessionId: string;
    matches: typeof emu.duelMatchHistory;
    p1Wins: number;
    p2Wins: number;
    perfectKos: number;
  } | null>(null);

  // ── Toast & auto-save ──────────────────────────────────────────
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // ── Multi-match tracking (XL/Fighter modes) ──────────────────────
  const [duelFormat, setDuelFormat] = useState<{ modeId: string; matchCount: number; currentMatch: number } | null>(null);

  // ── End-match blocking overlay + revenge (same-session) ────────
  const [revengePhase, setRevengePhase] = useState<RevengePhase | null>(null);
  const [countdown, setCountdown] = useState(30);

  // ── Opponent-abandon forfeit (client-side, no game-server change) ──
  // When the opponent leaves mid-match the server emits player_disconnected (emu.opponentAbandoned);
  // we declare a forfeit win, freeze behind a blocking overlay for 10s, then return to the Cage.
  const [abandonWin, setAbandonWin] = useState(false);
  const [abandonCountdown, setAbandonCountdown] = useState(10);
  const abandonFiredRef = useRef(false);

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
    const winnerLabel = result.winner === (session.player1Id === currentUserId ? 1 : 2) ? t.duel.you : t.duel.opponent;
    setToastMessage(t.duel.page.toastWinMatch(winnerLabel, p1Wins, p2Wins));
    const timer = setTimeout(() => setToastMessage(null), 4000);

    // Save result to DB. A draw (winner 0) sends winnerId/loserId = 0 so the server settles the
    // escrow chamber as a draw (platform keeps the pot) instead of mis-reading a fake winner.
    const decisive = result.winner === 1 || result.winner === 2;
    const oppId = session.player1Id === currentUserId ? session.player2Id : session.player1Id;
    // Clear any prior match's animated balances so the new overlay doesn't flash stale numbers.
    setBalanceAnim(null);
    fetch("/api/duel/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeId: session.challengeId,
        winnerId: decisive ? (result.winner === 1 ? session.player1Id : session.player2Id) : 0,
        loserId: decisive ? (result.loser === 1 ? session.player1Id : session.player2Id) : 0,
        p1Losses: result.p1Losses,
        p2Losses: result.p2Losses,
        perfectKoCount: result.perfectKos ?? 0,
        sessionId: session.sessionId,
        markCompleted: false,
        ...(isDevMode ? { devUserId: currentUserId, devUsername: currentUsername } : {}),
      }),
    })
      .then(async (r) => {
        void refreshBalance();
        if (!r.ok) return;
        const data = await r.json().catch(() => null);
        const bal = data?.settlement?.balances as
          | Record<string, { after: number | null; sessionDelta: number; unlimited: boolean }>
          | undefined;
        if (!bal) return;
        // Reconstruct each player's pre-match balance (before = after − net session delta) for the
        // animated before→after counter. Admins (unlimited/after null) get no animation (∞).
        const toMove = (b?: { after: number | null; sessionDelta: number; unlimited: boolean }): BalanceMove | null =>
          b
            ? {
                after: b.after,
                delta: b.sessionDelta,
                unlimited: !!b.unlimited,
                before: b.unlimited || b.after === null ? null : b.after - b.sessionDelta,
              }
            : null;
        setBalanceAnim({
          you: currentUserId != null ? toMove(bal[String(currentUserId)]) : null,
          opp: toMove(bal[String(oppId)]),
        });
      })
      .catch((e) => console.error("[Duel] Failed to save result:", e));

    return () => clearTimeout(timer);
  }, [emu.duelMatchHistory.length]);

  // Duel stake: charge both players ONLY when the fight actually starts (2 coins + START →
  // combat), for the initial match AND every rematch. We detect the real start client-side from
  // the server's ~500ms match_state: combat is the 0x40 bit of matchFlag (same heuristic as
  // KofMatchHUD), with a team-non-empty guard to skip the boot flash. Charging here (not at
  // accept) means a session that bugs before combat never debits anyone. The charge opens the
  // escrow chamber; it's idempotent per session id server-side, so both clients firing — and
  // stale match_state frames — are safe (dedup by session id below is just an optimisation).
  const chargedSessionsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const session = lobby.duelSession;
    const sid = emu.sessionId;
    const ms = emu.matchState;
    if (!session || !sid || !ms) return;
    const inCombat = (ms.matchFlag & 0x40) !== 0 && ms.p1Team.length > 0 && ms.p2Team.length > 0;
    if (!inCombat || chargedSessionsRef.current.has(sid)) return;
    chargedSessionsRef.current.add(sid);
    fetch("/api/duel/wager/charge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeId: session.challengeId,
        sessionId: sid,
        player1Id: session.player1Id,
        player2Id: session.player2Id,
        ...(isDevMode ? { devUserId: currentUserId, devUsername: currentUsername } : {}),
      }),
    })
      .then((r) => { if (!r.ok) console.error("[Duel] Match-start charge failed:", r.status); void refreshBalance(); })
      .catch((e) => console.error("[Duel] Match-start charge error:", e));
  }, [emu.matchState, emu.sessionId]);

  // ── End-match overlay lifecycle ────────────────────────────────
  // Show the blocking overlay when a match ends (PvP session), reset when a
  // same-session rematch starts (onRematchStarting / onAutoRematch clears duelMatchResult).
  // For multi-match modes (XL/Fighter), auto-rematch skips the overlay for non-final matches.
  useEffect(() => {
    if (emu.duelMatchResult && lobby.duelSession) {
      const completedMatches = (duelFormat?.currentMatch ?? 0) + 1;

      if (duelFormat && completedMatches < duelFormat.matchCount) {
        // Non-final match — auto-rematch, skip the stats overlay
        console.log(`[Duel] Auto-rematch: ${completedMatches}/${duelFormat.matchCount} done, queuing match ${completedMatches + 1}`);
        setDuelFormat(prev => prev ? { ...prev, currentMatch: completedMatches } : null);
        const nextMatch = completedMatches + 1;
        const total = duelFormat.matchCount;
        // Brief delay so the result POST starts before we signal the server
        const timer = setTimeout(() => {
          emu.requestAutoRematch(nextMatch, total);
        }, 600);
        return () => clearTimeout(timer);
      }

      // Final match (or standard 1-match / no duelFormat) — show the end overlay
      if (duelFormat) {
        setDuelFormat(prev => prev ? { ...prev, currentMatch: completedMatches } : null);
      }
      setRevengePhase("stats");
      // Draw match (winner 0) auto-returns to the Cage after a short countdown;
      // decisive matches keep the (test-frozen) 30 so players can read the stats.
      setCountdown(emu.duelMatchResult.winner === 0 ? 10 : 30);
    } else {
      setRevengePhase(null);
      setBalanceAnim(null);
    }
  }, [emu.duelMatchResult]);

  // Countdown while showing stats (no revenge in progress) → back to lobby at 0.
  // Décisif : 30 s pour lire les stats puis retour Cage. Nul (winner 0) : 10 s (voir setCountdown).
  // Le passage en "requesting"/"incoming" (revanche) stoppe le décompte via la garde
  // revengePhase !== "stats".
  useEffect(() => {
    if (revengePhase !== "stats") return;
    if (countdown <= 0) { handleExit(); return; }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [revengePhase, countdown]);

  // Winner: opponent (loser) requested a rematch → show accept/decline, stop countdown.
  // Functional update: only the winner is still in "stats" when the request arrives
  // (the loser has already moved to "requesting"), so this reliably targets the winner.
  useEffect(() => {
    if (!emu.rematchRequested) return;
    setRevengePhase((p) => (p === "stats" ? "incoming" : p));
  }, [emu.rematchRequested]);

  // Loser: winner declined → notify for 5s (declined countdown) then exit.
  useEffect(() => {
    if (emu.rematchDeclined && revengePhase) {
      setRevengePhase("declined");
      setCountdown(5);
    }
  }, [emu.rematchDeclined]);

  // Safety: if the loser's revenge request goes unanswered (winner left), exit.
  useEffect(() => {
    if (revengePhase !== "requesting") return;
    const t = setTimeout(() => handleExit(), 20000);
    return () => clearTimeout(t);
  }, [revengePhase]);

  // ── Revenge handlers ───────────────────────────────────────────
  const handleRequestRevenge = useCallback(() => {
    setRevengePhase("requesting");
    emu.requestRematch();
  }, [emu.requestRematch]);

  const handleAcceptRevenge = useCallback(() => {
    // Server unlocks input + broadcasts rematch_starting → onRematchStarting
    // clears duelMatchResult on both sides → overlay hides, players re-pick teams.
    emu.acceptRematch();
  }, [emu.acceptRematch]);

  const handleDeclineRevenge = useCallback(() => {
    emu.declineRematch();
    // Give the decline message time to flush before tearing down the socket.
    setTimeout(() => handleExit(), 400);
  }, [emu.declineRematch]);

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
    // Capture stats before cleanup
    const sid = emu.sessionId || session?.sessionId || "";
    const matches = [...emu.duelMatchHistory];
    const p1Wins = matches.filter((r) => r.winner === 1).length;
    const p2Wins = matches.filter((r) => r.winner === 2).length;
    const perfectKos = matches.reduce((sum, r) => sum + (r.perfectKos || 0), 0);
    emu.stopDuel();
    setPostGame({ sessionId: sid, matches, p1Wins, p2Wins, perfectKos });
  }, [lobby.duelSession, emu.stopDuel, emu.sessionId, emu.duelMatchHistory, isDevMode, currentUserId, currentUsername]);

  // ── Session closed by server → save + show post-game ──────────
  useEffect(() => {
    if (!emu.duelSessionClosed) return;
    console.log("[Duel] Session closed by server — saving result and showing post-game");

    const saveAndShow = async () => {
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

      // Show post-game summary with stats link
      const sid = emu.sessionId || session?.sessionId || "";
      const matches = [...emu.duelMatchHistory];
      const p1Wins = matches.filter((r) => r.winner === 1).length;
      const p2Wins = matches.filter((r) => r.winner === 2).length;
      const perfectKos = matches.reduce((sum, r) => sum + (r.perfectKos || 0), 0);
      setPostGame({ sessionId: sid, matches, p1Wins, p2Wins, perfectKos });
    };

    saveAndShow();
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

  // ── Pause keyboard shortcut (P key) ────────────────────────────
  useEffect(() => {
    if (!gameActive || !lobby.duelSession) return;
    const handleKey = (e: KeyboardEvent) => {
      // Ignore when typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        if (emu.status === "running") {
          emu.pause();
        } else if (emu.status === "paused" && emu.pauseState) {
          // Only the pausing player can resume
          const localSide: 1 | 2 = lobby.duelSession!.player1Id === currentUserId ? 1 : 2;
          if (emu.pauseState.pausedBy === localSide) {
            emu.resume();
          }
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [gameActive, lobby.duelSession, emu.status, emu.pauseState, currentUserId]);

  // Fullscreen lifecycle. Entering MUST ride a user gesture — browsers block
  // requestFullscreen() from a state-driven effect — so when a match goes live we
  // arm a one-shot: the player's first key/click enters fullscreen (that gesture is
  // allowed). Leaving the match / showing the end overlay exits (no gesture needed).
  // Escape exits natively (reflected by the hook); since the one-shot has already
  // fired, an Escape mid-match won't drag the player back in.
  useEffect(() => {
    if (!gameActive || revengePhase) {
      void exitFullscreen();
      return;
    }
    const enterOnGesture = () => {
      void enterFullscreen(canvasContainerRef.current);
      window.removeEventListener("keydown", enterOnGesture);
      window.removeEventListener("pointerdown", enterOnGesture);
    };
    window.addEventListener("keydown", enterOnGesture);
    window.addEventListener("pointerdown", enterOnGesture);
    return () => {
      window.removeEventListener("keydown", enterOnGesture);
      window.removeEventListener("pointerdown", enterOnGesture);
    };
  }, [gameActive, revengePhase, enterFullscreen, exitFullscreen]);

  // ── Opponent abandon → automatic forfeit win (client-side, no Docker rebuild) ──
  // emu.opponentAbandoned holds the leaver's side (server-sent, can't be forged). Only treat it
  // as a forfeit when a match is genuinely live and not already ending — rematch/teardown churn
  // also fires disconnects. Fire once per session (abandonFiredRef).
  useEffect(() => {
    if (emu.opponentAbandoned == null) return;
    const session = lobby.duelSession;
    if (
      !session ||
      !gameActive ||
      revengePhase ||               // match already resolved (stats / rematch negotiation)
      emu.duelSessionClosed ||      // server already tore the session down
      abandonFiredRef.current ||
      !currentUserId
    ) {
      return;
    }
    abandonFiredRef.current = true;
    setAbandonWin(true);
    setAbandonCountdown(10);

    // Declare the forfeit win: winner = me, loser = the opponent who left. Only my client remains,
    // so this single POST settles the escrow (75% payout to me) — idempotent per session. Use the
    // CURRENT adapter session id (a rematch opens a fresh chamber keyed by its new session id).
    const settleSessionId = emu.sessionId || session.sessionId;
    const winnerId = currentUserId;
    const loserId = session.player1Id === currentUserId ? session.player2Id : session.player1Id;
    const last = emu.duelMatchResult;
    fetch("/api/duel/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeId: session.challengeId,
        winnerId,
        loserId,
        p1Losses: last?.p1Losses ?? 0,
        p2Losses: last?.p2Losses ?? 0,
        perfectKoCount: last?.perfectKos ?? 0,
        sessionId: settleSessionId,
        reason: "abandon",
        markCompleted: true,
        ...(isDevMode ? { devUserId: currentUserId, devUsername: currentUsername } : {}),
      }),
    })
      .then(() => { void refreshBalance(); })
      .catch((e) => console.error("[Duel] Abandon settle failed:", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emu.opponentAbandoned, gameActive, revengePhase, emu.duelSessionClosed, currentUserId]);

  // Abandon countdown → freeze behind the blocking overlay for 10s then auto-return to the Cage.
  useEffect(() => {
    if (!abandonWin) return;
    if (abandonCountdown <= 0) { handleExit(); return; }
    const t = setTimeout(() => setAbandonCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [abandonWin, abandonCountdown]);

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
              <a href="/profile" className="flex items-center gap-2 hover:opacity-80 transition" title={t.profile.link}>
                <PlayerBadge
                  username={currentUsername || ""}
                  avatar={myAvatar}
                  country={myCountry}
                  size={28}
                  hideName
                  accent="#4ade80"
                />
                <span
                  className="px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5"
                  style={{
                    backgroundColor: "rgba(74,222,128,0.1)",
                    border: "1px solid rgba(74,222,128,0.2)",
                    color: "#4ade80",
                  }}
                >
                  {currentUsername}
                </span>
              </a>
            )}
          </div>

          <div className="flex items-center gap-4">
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
                {t.duel.page.logout}
              </button>
            ) : (
              <a href="/login" className="text-xs text-white/40 hover:text-white transition font-medium">
                {t.duel.page.login}
              </a>
            )}
            {authChecked && currentUserId && (
              <a href="/duel/history" className="text-xs text-white/40 hover:text-white transition font-medium flex items-center gap-1">
                <History className="w-3 h-3" />
                {t.duel.history.link}
              </a>
            )}
            {authChecked && currentUserId && (
              <a href="/profile" className="text-xs text-white/40 hover:text-white transition font-medium flex items-center gap-1">
                <User className="w-3 h-3" />
                {t.profile.link}
              </a>
            )}
            <a href="/play" className="text-xs text-white/40 hover:text-white transition font-medium flex items-center gap-1">
              <ArrowLeft className="w-3 h-3" />
              {t.duel.page.backToPlay}
            </a>
            <a href="/faq" className="text-xs text-white/40 hover:text-white transition font-medium">
              {t.common.faq}
            </a>
            <a
              href={mainPlatformUrl}
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
          </div>
        </div>
      </header>

      {/* ── Challenge Notification Modal ────────────────────────── */}
      {lobby.pendingChallenge && (
        <DuelNotification
          fromUsername={lobby.pendingChallenge.fromUsername}
          message={lobby.pendingChallenge.message}
          gameLabel={game.label}
          onAccept={handleAcceptChallenge}
          onDecline={handleDeclineChallenge}
          isAccepting={isAccepting}
          isDeclining={isDeclining}
          error={lobby.error}
        />
      )}

      {/* ── Rules Overlay (both players confirm rules before match) ── */}
      {rulesChallenge && (
        <DuelRulesOverlay
          gameLabel={rulesChallenge.gameLabel}
          modeLabel={rulesChallenge.modeLabel}
          matchCount={rulesChallenge.matchCount}
          entryFee={rulesChallenge.entryFee}
          opponentName={rulesChallenge.opponentName}
          modeRules={currentMode?.rules ?? null}
          onAccept={handleRulesAccept}
          onDecline={handleRulesDecline}
          isAccepting={rulesAccepting}
          isDeclining={rulesDeclining}
          isWaiting={rulesWaitingOpponent}
          error={rulesError}
        />
      )}

      {/* ── End-of-match blocking overlay (PvP) ─────────────────── */}
      {revengePhase && emu.duelMatchResult && lobby.duelSession && (() => {
        const localSide: 1 | 2 = lobby.duelSession.player1Id === currentUserId ? 1 : 2;
        // For multi-match: determine series winner from cumulative match history (best-of-N).
        // For standard 1-match: the last match winner IS the series winner.
        const p1SeriesWins = emu.duelMatchHistory.filter(r => r.winner === 1).length;
        const p2SeriesWins = emu.duelMatchHistory.filter(r => r.winner === 2).length;
        const majority = duelFormat ? Math.ceil(duelFormat.matchCount / 2) : 1;
        const seriesWinner = p1SeriesWins >= majority ? 1 : p2SeriesWins >= majority ? 2 : 0;
        const isWinner = duelFormat ? seriesWinner === localSide : emu.duelMatchResult.winner === localSide;
        const p1 = duelProfiles[lobby.duelSession.player1Id];
        const p2 = duelProfiles[lobby.duelSession.player2Id];
        const youProfile = localSide === 1 ? p1 : p2;
        const oppProfile = localSide === 1 ? p2 : p1;
        return (
          <DuelEndOverlay
            result={emu.duelMatchResult}
            matchHistory={emu.duelMatchHistory}
            localSide={localSide}
            isWinner={isWinner}
            sessionId={emu.sessionId || lobby.duelSession.sessionId || ""}
            phase={revengePhase}
            countdown={countdown}
            entryFee={entryFee}
            localBalance={skyBalance}
            unlimitedSky={unlimitedSky}
            canRematch={unlimitedSky || (skyBalance !== null && skyBalance >= entryFee)}
            settlement={balanceAnim}
            youProfile={youProfile}
            oppProfile={oppProfile}
            onRequestRevenge={handleRequestRevenge}
            onAcceptRevenge={handleAcceptRevenge}
            onDeclineRevenge={handleDeclineRevenge}
            onExit={handleExit}
          />
        );
      })()}

      {/* ── Opponent-abandon forfeit overlay (blocking freeze, 10s → Cage) ── */}
      {abandonWin && <DuelAbandonOverlay countdown={abandonCountdown} onExit={handleExit} />}

      <section className="relative z-10 max-w-5xl mx-auto px-4 py-8 pb-20">
        {/* Title */}
        <div className="text-center mb-8">
          <h1 className="text-3xl sm:text-4xl font-black text-white mb-2">
            {t.duel.page.arenaTitle(game.label)}
          </h1>
          <p className="text-sm text-white/40 max-w-lg mx-auto">
            {gameActive
              ? t.duel.fightPrompt
              : t.duel.intro}
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
                  {t.duel.page.challengeSentTo(lobby.outgoingChallenge.targetUsername)}
                </p>
                <p className="text-xs text-white/30">
                  {t.duel.page.waitingResponse}
                </p>
              </>
            )}
            {lobby.outgoingChallenge.status === "declined" && (
              <>
                <AlertCircle className="w-8 h-8 mx-auto mb-3" style={{ color: "#fd2e5f" }} />
                <p className="text-sm font-bold text-white mb-1">
                  {t.duel.page.challengeDeclinedTitle}
                </p>
                <p className="text-xs text-white/30 mb-3">
                  {t.duel.page.declinedYourChallenge(lobby.outgoingChallenge.targetUsername)}
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
                  {t.duel.backToLobby}
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
                  {t.duel.signInToJoin}
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
                  {t.duel.page.goToPlaySignIn}
                </a>
              </div>
            )}

            {/* Auth check loading */}
            {!authChecked && (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: "rgba(255,255,255,0.15)" }} />
              </div>
            )}

            {/* Authenticated — 3-step wizard: Game → Mode → Arena */}
            {authChecked && currentUserId && !gameActive && (
              <>
                {/* Step indicator */}
                <DuelWizardStepper
                  currentStep={wizardStep}
                  selectedGameLabel={wizardStep !== "game" ? game.label : undefined}
                  selectedModeLabel={wizardStep === "arena" ? (currentMode?.label ?? undefined) : undefined}
                  onStepClick={(step) => setWizardStep(step)}
                />

                {/* Step 1 — Game Selection */}
                {wizardStep === "game" && (
                  <div className="mb-5">
                    <DuelGameSelector
                      games={duelGames}
                      selectedGameId={selectedGameId}
                      onSelectGame={handleSelectGame}
                    />
                  </div>
                )}

                {/* Step 2 — Mode Selection */}
                {wizardStep === "mode" && (
                  <div className="mb-5">
                    <DuelModeSelector
                      modes={game.modes}
                      selectedModeId={selectedModeId}
                      onSelect={setSelectedModeId}
                      game={game}
                    />
                    <div className="flex justify-between mt-4">
                      <button
                        onClick={() => setWizardStep("game")}
                        className="rounded-xl px-5 py-2.5 text-sm font-bold transition-all hover:scale-105"
                        style={{
                          backgroundColor: "rgba(255,255,255,0.04)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          color: "rgba(255,255,255,0.5)",
                        }}
                      >
                        ← {t.duel.wizard?.back ?? "Retour"}
                      </button>
                      <button
                        onClick={() => setWizardStep("arena")}
                        disabled={!selectedModeId}
                        className="rounded-xl px-6 py-2.5 text-sm font-bold transition-all hover:scale-105 disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{
                          backgroundColor: selectedModeId ? "rgba(241,91,181,0.15)" : "rgba(255,255,255,0.03)",
                          border: selectedModeId ? "1px solid rgba(241,91,181,0.35)" : "1px solid rgba(255,255,255,0.08)",
                          color: selectedModeId ? "#f15bb5" : "rgba(255,255,255,0.3)",
                        }}
                      >
                        {(t.duel.wizard?.continue ?? "Continuer")} →
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 3 — Arena (Lobby) */}
                {wizardStep === "arena" && (
                  <div className="mb-5">
                    {/* Mode summary header */}
                    <div
                      className="rounded-2xl border p-4 mb-4 flex items-center justify-between"
                      style={{
                        backgroundColor: "rgba(13,27,46,0.6)",
                        borderColor: "rgba(255,255,255,0.08)",
                      }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-sm font-bold text-white truncate">
                          {game.label}
                        </span>
                        <span className="text-xs text-white/20">•</span>
                        <span className="text-xs font-medium" style={{ color: "#f15bb5" }}>
                          {currentMode ? (t.duel.mode?.[currentMode.modeKey as keyof typeof t.duel.mode] as string ?? currentMode.modeKey.toUpperCase()) : "Standard"}
                        </span>
                        <span className="text-xs text-white/20">•</span>
                        <span className="text-xs text-white/30">
                          {t.duel.mode?.matches?.(currentMode?.matchCount ?? 1) ?? "1 match"}
                        </span>
                        <span className="text-xs text-white/20">•</span>
                        <span className="text-xs font-bold text-white/50">
                          {t.duel.mode?.entryFee?.(entryFee) ?? `${entryFee} SKY`}
                        </span>
                      </div>
                      <button
                        onClick={() => setWizardStep("mode")}
                        className="rounded-lg px-3 py-1.5 text-xs font-bold transition-all flex-shrink-0"
                        style={{
                          backgroundColor: "rgba(255,255,255,0.04)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          color: "rgba(255,255,255,0.4)",
                        }}
                      >
                        ← {t.duel.wizard?.back ?? "Retour"}
                      </button>
                    </div>
                    <DuelLobby
                      players={lobby.players.filter((p) => p.system === game.system && p.rom === game.rom)}
                      inLobby={lobby.inLobby}
                      isSending={lobby.isSending}
                      onChallenge={handleChallenge}
                      onJoinLobby={lobby.joinLobby}
                      canChallenge={canChallenge}
                      entryFee={entryFee}
                      balance={skyBalance}
                      unlimitedSky={unlimitedSky}
                      gameLabel={game.label}
                    />
                  </div>
                )}
              </>
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
              {playerRole === "guest" ? t.duel.page.joiningGame : t.duel.page.startingDuel(game.label)}
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
            <p className="text-sm font-semibold text-red-400">{t.duel.page.failedToStart}</p>
            <p className="text-xs text-white/25">
              {t.duel.page.checkServer}
            </p>
            <button
              onClick={handleExit}
              className="px-4 py-2 rounded-lg text-xs font-bold text-white/50 hover:text-white transition"
              style={{
                backgroundColor: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              {t.duel.backToLobby}
            </button>
          </div>
        )}

        {/* ── Game Canvas ────────────────────────────────────────── */}
        <div
          ref={canvasContainerRef}
          className="relative rounded-3xl border overflow-hidden mx-auto"
          style={{
            backgroundColor: "rgba(13,27,46,0.85)",
            borderColor: gameActive ? "rgba(0,200,255,0.3)" : "rgba(255,255,255,0.06)",
            boxShadow: gameActive
              ? "0 0 60px rgba(0,200,255,0.2), inset 0 0 40px rgba(0,200,255,0.03)"
              : "0 0 20px rgba(0,0,0,0.3)",
            aspectRatio: isFullscreen ? undefined : `${cfg.width} / ${cfg.height}`,
            width: isFullscreen ? "100vw" : undefined,
            height: isFullscreen ? "100vh" : undefined,
            maxWidth: isFullscreen ? undefined : "960px",
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

          {/* Live in-match HUD: teams + active char + gauge mode */}
          {gameActive && <KofMatchHUD state={emu.matchState} />}

          {/* Paused overlay — rich countdown overlay (duel pause via server) */}
          {emu.pauseState && lobby.duelSession && (() => {
            const localSide: 1 | 2 = lobby.duelSession.player1Id === currentUserId ? 1 : 2;
            return (
              <DuelPauseOverlay
                pausedBy={emu.pauseState.pausedBy}
                localSide={localSide}
                countdown={emu.pauseState.countdown}
                onResume={() => emu.resume()}
              />
            );
          })()}
          {/* Fallback simple paused overlay when pauseState is not set (e.g. non-duel or legacy) */}
          {emu.status === "paused" && !emu.pauseState && (
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
                <p className="text-sm font-bold uppercase tracking-wider text-yellow-400">{t.duel.page.paused}</p>
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
                {t.duel.page.cloud}
              </InfoBadge>
              <InfoBadge
                color={playerRole === "host" ? "#00c8ff" : "#f15bb5"}
                bg="rgba(0,0,0,0.6)"
              >
                <User className="w-2.5 h-2.5" />
                {playerRole === "host" ? t.duel.page.hostYou : t.duel.page.guestYou}
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
                title={t.duel.page.copyRoomCode}
              >
                <Users className="w-3.5 h-3.5" />
                <span className="font-mono tracking-[4px]">{emu.roomCode}</span>
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5 opacity-60" />}
              </button>
            </div>
          )}

          {/* Fullscreen toggle + Pause button */}
          {gameActive && (
            <div className="absolute bottom-3 right-3 z-30 flex items-center gap-2">
              {/* Pause / Resume */}
              <button
                onClick={() => {
                  if (emu.status === "running") {
                    emu.pause();
                  } else if (emu.status === "paused" && emu.pauseState) {
                    const localSide: 1 | 2 = lobby.duelSession?.player1Id === currentUserId ? 1 : 2;
                    if (emu.pauseState.pausedBy === localSide) {
                      emu.resume();
                    }
                  }
                }}
                className="flex items-center justify-center rounded-full p-2 pointer-events-auto transition-all hover:scale-105"
                style={{
                  backgroundColor: emu.status === "paused" ? "rgba(255,215,0,0.2)" : "rgba(0,0,0,0.6)",
                  backdropFilter: "blur(8px)",
                  color: emu.status === "paused" ? "#ffd700" : "rgba(255,255,255,0.8)",
                  border: emu.status === "paused" ? "1px solid rgba(255,215,0,0.3)" : "1px solid rgba(255,255,255,0.12)",
                }}
                title={emu.status === "paused" ? t.duel.pause?.resume ?? "Resume" : t.duel.pause?.title ?? "Pause"}
              >
                <Pause className="w-4 h-4" />
              </button>
              {/* Fullscreen */}
              <button
                onClick={() => void toggleFullscreen(canvasContainerRef.current)}
                className="flex items-center justify-center rounded-full p-2 pointer-events-auto transition-all hover:scale-105"
                style={{
                  backgroundColor: "rgba(0,0,0,0.6)",
                  backdropFilter: "blur(8px)",
                  color: "rgba(255,255,255,0.8)",
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
                title={isFullscreen ? t.duel.page.exitFullscreen : t.duel.page.enterFullscreen}
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
            </div>
          )}
        </div>

        {/* ── Post-Game Summary ─────────────────────────────────── */}
        {postGame && (
          <div className="flex flex-col items-center py-12 gap-6">
            <div
              className="rounded-3xl border p-8 max-w-lg w-full text-center"
              style={{
                backgroundColor: "rgba(13,27,46,0.9)",
                borderColor: "rgba(241,91,181,0.3)",
                boxShadow: "0 0 40px rgba(241,91,181,0.15)",
              }}
            >
              {/* Header */}
              <div className="mb-6">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                  style={{
                    backgroundColor: "rgba(241,91,181,0.12)",
                    border: "2px solid rgba(241,91,181,0.3)",
                  }}
                >
                  <Swords className="w-8 h-8" style={{ color: "#f15bb5" }} />
                </div>
                <h2 className="text-xl font-black text-white mb-1">{t.duel.page.duelFinished}</h2>
                <p className="text-xs text-white/30">
                  {postGame.matches.length > 0
                    ? t.duel.page.matchesPlayed(postGame.matches.length)
                    : t.duel.page.noMatchCompleted}
                </p>
              </div>

              {/* Scoreboard */}
              {postGame.matches.length > 0 && (
                <div
                  className="rounded-xl border p-4 mb-6"
                  style={{
                    backgroundColor: "rgba(0,0,0,0.3)",
                    borderColor: "rgba(255,255,255,0.08)",
                  }}
                >
                  <div className="flex items-center justify-center gap-6 mb-3">
                    <div className="text-center">
                      <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">P1</p>
                      <p className="text-3xl font-black" style={{ color: "#00c8ff" }}>
                        {postGame.p1Wins}
                      </p>
                    </div>
                    <span className="text-2xl font-black text-white/20">-</span>
                    <div className="text-center">
                      <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">P2</p>
                      <p className="text-3xl font-black" style={{ color: "#f15bb5" }}>
                        {postGame.p2Wins}
                      </p>
                    </div>
                  </div>

                  {/* Match breakdown */}
                  <div className="space-y-1.5">
                    {postGame.matches.map((m, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between rounded-lg px-3 py-1.5 text-xs"
                        style={{ backgroundColor: "rgba(255,255,255,0.03)" }}
                      >
                        <span className="text-white/40 font-bold">{t.duel.page.matchN(m.matchNumber || i + 1)}</span>
                        <span className="text-white/60">
                          P1 {m.p1Losses} - {m.p2Losses} P2
                        </span>
                        <span className="font-bold" style={{ color: m.winner === 1 ? "#00c8ff" : "#f15bb5" }}>
                          {t.duel.page.pWins(m.winner)}
                        </span>
                        {(m.perfectKos || 0) > 0 && (
                          <span
                            className="rounded-full px-2 py-0.5 text-[9px] font-bold"
                            style={{
                              backgroundColor: "rgba(255,215,0,0.15)",
                              color: "#ffd700",
                            }}
                          >
                            {t.duel.page.perfectTimes(m.perfectKos || 0)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  {postGame.perfectKos > 0 && (
                    <div className="mt-3 text-[10px] font-bold" style={{ color: "#ffd700" }}>
                      {t.duel.page.totalPerfects(postGame.perfectKos)}
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-col gap-3">
                {postGame.sessionId && (
                  <a
                    href={`/stats/${postGame.sessionId}`}
                    className="block w-full px-5 py-3 rounded-xl text-sm font-bold transition-all hover:scale-105"
                    style={{
                      backgroundColor: "rgba(241,91,181,0.15)",
                      border: "1px solid rgba(241,91,181,0.35)",
                      color: "#f15bb5",
                    }}
                  >
                    {t.duel.page.viewStats}
                  </a>
                )}
                <button
                  onClick={handleExit}
                  className="w-full px-5 py-3 rounded-xl text-sm font-bold transition-all hover:scale-105"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "rgba(255,255,255,0.6)",
                  }}
                >
                  ↩ {t.duel.backToLobby}
                </button>
              </div>
            </div>
          </div>
        )}

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
                    {isP1 ? t.duel.you : "P1"}
                  </span>{" "}
                  <span style={{ color: "#4ade80" }}>{p1Wins}</span>
                </span>
                <span className="text-white/30 font-black">-</span>
                <span>
                  <span style={{ color: "#f15bb5" }}>{p2Wins}</span>{" "}
                  <span style={{ color: isP1 ? "#f15bb5" : "#4ade80" }}>
                    {isP1 ? "P2" : t.duel.you}
                  </span>
                </span>
                {lastMatch && (
                  <>
                    <span className="text-white/10">|</span>
                    <span className="text-white/35">
                      {t.duel.page.last}: {lastMatch.winner === 1 ? "P1" : "P2"}
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
                  {t.duel.page.stop}
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
              {t.duel.page.stopDuel}
            </button>
          </div>
        )}

        {/* ── Controls Reference (only the current player's controls, per selected game) ── */}
        {gameActive && playerRole && (
          <div className="mt-8 grid grid-cols-1 gap-6">
            {playerRole === "host" && (
              <ControlsCard
                title={t.duel.page.p1Controls}
                accent="#00c8ff"
                controls={game.p1Controls.map((c) => ({
                  label: resolveCtrlLabel(c.label, t.duel.page),
                  keys: c.keys,
                }))}
                note={t.duel.page.p1Note}
              />
            )}
            {playerRole === "guest" && (
              <ControlsCard
                title={t.duel.page.p2Controls}
                accent="#f15bb5"
                controls={game.p2Controls.map((c) => ({
                  label: resolveCtrlLabel(c.label, t.duel.page),
                  keys: c.keys,
                }))}
                note={t.duel.page.p2Note}
              />
            )}
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

/** Resolve a control label key from the game config to the translated string. */
function resolveCtrlLabel(
  key: string,
  page: Record<string, unknown>,
): string {
  const val = page[key];
  return typeof val === "string" ? val : key;
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
