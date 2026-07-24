"use client";

import type { DuelMatchResult } from "@/lib/emulator/types";

export interface DuelScoreHUDProps {
  /** Completed matches in the current session (match-level wins). */
  matchHistory: DuelMatchResult[];
  /** Total matches in the series (1 = standard, 3 = XL, 5 = Fighter). */
  totalMatches: number;
  /** Player display names. */
  player1Name: string;
  player2Name: string;
  /** Accent colors per side. */
  p1Color?: string;
  p2Color?: string;
  /** Character names selected by each player (from char select phase). */
  p1CharName?: string | null;
  p2CharName?: string | null;
}

/**
 * Duel score HUD — overlaid above the game canvas (inside the container, visible
 * in fullscreen). Shows player names with the match win count (e.g. "J1  1 – 0  J2").
 *
 * Positioned at the top of the canvas container (z-15, between scanlines at z-10 and
 * the team/character HUD at z-20). Hidden when no matches have been completed.
 */
export default function DuelScoreHUD({
  matchHistory,
  totalMatches,
  player1Name,
  player2Name,
  p1Color = "#00c8ff",
  p2Color = "#f15bb5",
  p1CharName,
  p2CharName,
}: DuelScoreHUDProps) {
  const p1Wins = matchHistory.filter((r) => r.winner === 1).length;
  const p2Wins = matchHistory.filter((r) => r.winner === 2).length;

  // Show the HUD when a match result exists, OR when character names are known
  if (matchHistory.length === 0 && !p1CharName && !p2CharName) return null;

  return (
    <div
      className="absolute top-0 left-0 right-0 z-25 flex justify-center pointer-events-none select-none px-2 pt-1.5"
      style={{ fontFamily: "monospace" }}
    >
      <div
        className="flex items-center gap-3 rounded-xl px-4 py-1.5 text-sm font-bold whitespace-nowrap"
        style={{
          backgroundColor: "rgba(0,0,0,0.7)",
          backdropFilter: "blur(10px)",
          border: "1px solid rgba(255,255,255,0.1)",
          color: "#fff",
        }}
      >
        {/* P1 Name + Character */}
        <span className="truncate max-w-[100px] text-right" style={{ color: p1Color }}>
          <div className="leading-tight">{player1Name}</div>
          {p1CharName && (
            <div className="text-[10px] opacity-60 leading-tight">{p1CharName}</div>
          )}
        </span>

        {/* Score */}
        <span className="flex items-center gap-1.5">
          <span className="text-lg" style={{ color: p1Color }}>{p1Wins}</span>
          <span className="text-white/25 font-black">–</span>
          <span className="text-lg" style={{ color: p2Color }}>{p2Wins}</span>
          {totalMatches > 1 && (
            <span className="text-white/15 text-[10px]">/ {totalMatches}</span>
          )}
        </span>

        {/* P2 Name + Character */}
        <span className="truncate max-w-[100px] text-left" style={{ color: p2Color }}>
          <div className="leading-tight">{player2Name}</div>
          {p2CharName && (
            <div className="text-[10px] opacity-60 leading-tight">{p2CharName}</div>
          )}
        </span>
      </div>
    </div>
  );
}
