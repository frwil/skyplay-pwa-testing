"use client";

import type { MatchStateData } from "@/lib/emulator/types";
import { charName } from "@/lib/emulator/kof98Characters";

/**
 * Live in-match HUD overlaid on the cloud video canvas (KOF98 / neogeo).
 * Shows each player's 3-character team with the currently-fighting character
 * highlighted, plus the gauge mode (ADVANCED / EXTRA). Auto-updates from the
 * server's ~500ms "match_state" messages. Renders nothing outside steady combat.
 */
export function KofMatchHUD({ state }: { state: MatchStateData | null }) {
  if (!state) return null;
  // Combat is signalled by the 0x40 bit of matchFlag. Live RAM shows the low
  // nibble varying through a round (0x40/0x43/0x44/0x48 all seen), so match on
  // the bit rather than exact values. Char-select and round transitions read
  // 0x00 (bit clear) → hidden. The team guard suppresses the brief boot flash
  // where RAM is uninitialised and the team arrays are empty.
  const inCombat = (state.matchFlag & 0x40) !== 0;
  if (!inCombat || state.p1Team.length === 0 || state.p2Team.length === 0) return null;

  return (
    <div className="absolute top-2 left-0 right-0 z-20 flex justify-between px-3 pointer-events-none select-none">
      <TeamPanel
        team={state.p1Team}
        activeName={state.p1Active >= 0 ? charName(state.p1Active) : null}
        mode={state.p1Mode}
        side="left"
      />
      <TeamPanel
        team={state.p2Team}
        activeName={state.p2Active >= 0 ? charName(state.p2Active) : null}
        mode={state.p2Mode}
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
  mode: "ADVANCED" | "EXTRA";
  side: "left" | "right";
}) {
  const modeColor = mode === "ADVANCED" ? "rgba(96,165,250,0.9)" : "rgba(251,191,36,0.9)";
  return (
    <div
      className={`flex flex-col gap-1 ${side === "right" ? "items-end" : "items-start"}`}
      style={{ fontFamily: "monospace" }}
    >
      {/* Gauge mode badge */}
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
      {/* Team members */}
      <div className={`flex flex-col gap-0.5 ${side === "right" ? "items-end" : "items-start"}`}>
        {team.map((name, i) => {
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
        })}
      </div>
    </div>
  );
}
