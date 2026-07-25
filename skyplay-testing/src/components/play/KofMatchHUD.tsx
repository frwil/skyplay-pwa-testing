"use client";

import type { MatchStateData } from "@/lib/emulator/types";

/**
 * Live in-match HUD overlaid on the cloud video canvas (KOF98/SFA2).
 * Shows each player's character/team with the currently-fighting character
 * highlighted, plus the gauge/play mode. Auto-updates from the
 * server's ~500ms "match_state" messages. Renders nothing outside steady combat.
 *
 * Character names are resolved server-side — p1ActiveName/p2ActiveName
 * and p1Team/p2Team are already display-ready strings, no client-side
 * lookup needed.
 */
export function KofMatchHUD({ state }: { state: MatchStateData | null }) {
  if (!state) return null;
  // Combat is signalled by the 0x40 bit of matchFlag. Live RAM shows the low
  // nibble varying through a round (0x40/0x43/0x44/0x48 all seen), so match on
  // the bit rather than exact values. Char-select and round transitions read
  // 0x00 (bit clear) → hidden.
  // For SFA2 (no teams), show the HUD if either active name is known.
  const hasTeams = state.p1Team.length > 0 || state.p2Team.length > 0;
  const hasActiveChars = state.p1ActiveName || state.p2ActiveName;
  if (!hasTeams && !hasActiveChars) return null;

  const inCombat = (state.matchFlag & 0x40) !== 0;
  if (!inCombat) return null;

  // SFA2 mode label: play mode (Auto/Manual) instead of gauge mode
  const p1ModeLabel = state.p1PlayMode ?? state.p1Mode;
  const p2ModeLabel = state.p2PlayMode ?? state.p2Mode;

  return (
    <div className="absolute top-2 left-0 right-0 z-20 flex justify-between px-3 pointer-events-none select-none">
      <TeamPanel
        team={state.p1Team}
        activeName={state.p1ActiveName ?? null}
        mode={p1ModeLabel}
        side="left"
      />
      <TeamPanel
        team={state.p2Team}
        activeName={state.p2ActiveName ?? null}
        mode={p2ModeLabel}
        side="right"
      />
    </div>
  );
}

function TeamPanel({
  team,
  activeName,
  mode,
  side,
}: {
  team: string[];
  activeName: string | null;
  mode: string;
  side: "left" | "right";
}) {
  const isSfa2 = mode === "Auto" || mode === "Manual";
  const modeColor = isSfa2
    ? (mode === "Auto" ? "rgba(52,211,153,0.9)" : "rgba(148,163,184,0.9)")
    : (mode === "ADVANCED" ? "rgba(96,165,250,0.9)" : "rgba(251,191,36,0.9)");
  return (
    <div
      className={`flex flex-col gap-1 ${side === "right" ? "items-end" : "items-start"}`}
      style={{ fontFamily: "monospace" }}
    >
      {/* Mode badge */}
      <div
        className="rounded-full px-2.5 py-0.5 text-[10px] font-bold"
        style={{
          backgroundColor: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(4px)",
          color: modeColor,
          border: `1px solid ${modeColor.replace("0.9", "0.3")}`,
        }}
      >
        {mode}
      </div>
      {/* Team members or single active character (SFA2) */}
      <div className={`flex flex-col gap-0.5 ${side === "right" ? "items-end" : "items-start"}`}>
        {team.length > 0 ? (
          team.map((name, i) => {
            const isActive = activeName != null && name === activeName;
            return (
              <div
                key={`${name}-${i}`}
                className="rounded px-2 py-0.5 text-[10px] font-bold transition-colors"
                style={{
                  backgroundColor: isActive ? "rgba(253,46,95,0.85)" : "rgba(0,0,0,0.55)",
                  backdropFilter: "blur(4px)",
                  color: isActive ? "#fff" : "rgba(255,255,255,0.6)",
                  border: isActive
                    ? "1px solid rgba(253,46,95,0.6)"
                    : "1px solid rgba(255,255,255,0.08)",
                }}
              >
                {name}
              </div>
            );
          })
        ) : activeName ? (
          <div
            className="rounded px-2 py-0.5 text-[10px] font-bold"
            style={{
              backgroundColor: "rgba(253,46,95,0.85)",
              backdropFilter: "blur(4px)",
              color: "#fff",
              border: "1px solid rgba(253,46,95,0.6)",
            }}
          >
            {activeName}
          </div>
        ) : null}
      </div>
    </div>
  );
}
