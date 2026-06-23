"use client";

import { useCallback } from "react";
import type { SystemType } from "@/lib/emulator/types";
import { getButton } from "@/lib/emulator/EmulatorAdapter";
import {
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

interface TouchControlsProps {
  onButtonDown: (player: 1 | 2, button: number) => void;
  onButtonUp: (player: 1 | 2, button: number) => void;
  system: SystemType;
  visible: boolean;
}

/** Touch event handlers object returned by makeHandler. */
interface TouchHandlers {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
  onTouchCancel: (e: React.TouchEvent) => void;
}

/** Props passed to layout sub-components. */
interface TouchLayoutProps {
  handlers: (id: string) => TouchHandlers;
  system: SystemType;
}

/**
 * Touch overlay controls for mobile play.
 *
 * Renders per-system layouts using button indices from
 * SYSTEM_CONFIGS so the correct emulator input is sent.
 * Visible only on touch devices (hidden on desktop via CSS).
 */
export default function TouchControls({
  onButtonDown,
  onButtonUp,
  system,
  visible,
}: TouchControlsProps) {
  if (!visible) return null;

  const prevent = (e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const makeHandler = useCallback(
    (button: number): TouchHandlers => ({
      onTouchStart: (e: React.TouchEvent) => {
        prevent(e);
        onButtonDown(1, button);
      },
      onTouchEnd: (e: React.TouchEvent) => {
        prevent(e);
        onButtonUp(1, button);
      },
      onTouchCancel: (e: React.TouchEvent) => {
        prevent(e);
        onButtonUp(1, button);
      },
    }),
    [onButtonDown, onButtonUp],
  );

  // Memoize per-button handlers so sub-components don't re-render
  const handlers = useCallback(
    (id: string): TouchHandlers =>
      makeHandler(getButton(system, id)?.index ?? -1),
    [makeHandler, system],
  );

  return (
    <div
      className="absolute inset-0 pointer-events-none z-20 md:hidden"
      style={{ touchAction: "none" }}
    >
      <Dpad handlers={handlers} system={system} />
      <StartSelect handlers={handlers} system={system} />
      <FaceButtons handlers={handlers} system={system} />
    </div>
  );
}

/* ─── Shared Styles ─────────────────────────────────────────────── */

const btnBase: React.CSSProperties = {
  backgroundColor: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "rgba(255,255,255,0.5)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  userSelect: "none",
  touchAction: "none",
};

/* ─── D-Pad ─────────────────────────────────────────────────────── */

function Dpad({ handlers, system }: TouchLayoutProps) {
  return (
    <div
      className="absolute bottom-6 left-6 pointer-events-auto grid gap-0.5"
      style={{
        gridTemplateColumns: "48px 48px 48px",
        gridTemplateRows: "48px 48px 48px",
      }}
    >
      <button
        {...handlers("UP")}
        className="rounded-t-xl flex items-center justify-center active:opacity-60"
        style={{ ...btnBase, gridColumn: "2", gridRow: "1" }}
      >
        <ChevronUp className="w-5 h-5" />
      </button>
      <button
        {...handlers("LEFT")}
        className="rounded-l-xl flex items-center justify-center active:opacity-60"
        style={{ ...btnBase, gridColumn: "1", gridRow: "2" }}
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <div style={{ gridColumn: "2", gridRow: "2" }} />
      <button
        {...handlers("RIGHT")}
        className="rounded-r-xl flex items-center justify-center active:opacity-60"
        style={{ ...btnBase, gridColumn: "3", gridRow: "2" }}
      >
        <ChevronRight className="w-5 h-5" />
      </button>
      <button
        {...handlers("DOWN")}
        className="rounded-b-xl flex items-center justify-center active:opacity-60"
        style={{ ...btnBase, gridColumn: "2", gridRow: "3" }}
      >
        <ChevronDown className="w-5 h-5" />
      </button>
    </div>
  );
}

/* ─── Start / Select ────────────────────────────────────────────── */

function StartSelect({ handlers, system }: TouchLayoutProps) {
  return (
    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 pointer-events-auto flex gap-3">
      <button
        {...handlers("SELECT")}
        className="rounded-lg px-3 py-1.5 text-[10px] font-bold tracking-wider uppercase active:opacity-60"
        style={btnBase}
      >
        Select
      </button>
      <button
        {...handlers("START")}
        className="rounded-lg px-3 py-1.5 text-[10px] font-bold tracking-wider uppercase active:opacity-60"
        style={btnBase}
      >
        Start
      </button>
    </div>
  );
}

/* ─── Face Buttons — NES / GB / GBC ─────────────────────────────── */

function FaceButtons({ handlers, system }: TouchLayoutProps) {
  const isSnesLike = system === "snes" || system === "gba";

  if (isSnesLike) {
    return <SnesFaceButtons handlers={handlers} system={system} />;
  }

  const isGb = system === "gb" || system === "gbc";
  const bColor = isGb ? "rgba(138,43,226,0.4)" : "rgba(253,46,95,0.4)";
  const bTextColor = isGb ? "rgba(138,43,226,0.7)" : "rgba(253,46,95,0.7)";
  const aColor = isGb ? "rgba(220,20,60,0.4)" : "rgba(0,200,255,0.4)";
  const aTextColor = isGb ? "rgba(220,20,60,0.7)" : "rgba(0,200,255,0.7)";

  return (
    <div className="absolute bottom-8 right-6 pointer-events-auto flex items-center gap-2">
      <button
        {...handlers("B")}
        className="rounded-full w-14 h-14 flex items-center justify-center text-sm font-black active:opacity-60"
        style={{ ...btnBase, borderColor: bColor, color: bTextColor }}
      >
        B
      </button>
      <button
        {...handlers("A")}
        className="rounded-full w-14 h-14 flex items-center justify-center text-sm font-black active:opacity-60"
        style={{ ...btnBase, borderColor: aColor, color: aTextColor }}
      >
        A
      </button>
    </div>
  );
}

/* ─── Face Buttons — SNES / GBA ─────────────────────────────────── */

function SnesFaceButtons({ handlers, system }: TouchLayoutProps) {
  return (
    <div className="absolute right-4 bottom-4 pointer-events-auto flex flex-col items-end gap-2">
      {/* L / R shoulder buttons */}
      <div className="flex gap-2 mb-1">
        <button
          {...handlers("L")}
          className="rounded-lg px-4 py-1.5 text-[10px] font-black tracking-wider uppercase active:opacity-60"
          style={{
            ...btnBase,
            borderColor: "rgba(128,128,128,0.5)",
            color: "rgba(200,200,200,0.7)",
          }}
        >
          L
        </button>
        <button
          {...handlers("R")}
          className="rounded-lg px-4 py-1.5 text-[10px] font-black tracking-wider uppercase active:opacity-60"
          style={{
            ...btnBase,
            borderColor: "rgba(128,128,128,0.5)",
            color: "rgba(200,200,200,0.7)",
          }}
        >
          R
        </button>
      </div>

      {/* X/Y/A/B diamond (3×3 grid) */}
      <div
        className="grid gap-1"
        style={{
          gridTemplateColumns: "44px 44px 44px",
          gridTemplateRows: "44px 44px 44px",
        }}
      >
        {/* X — top center */}
        <button
          {...handlers("X")}
          className="rounded-full flex items-center justify-center text-xs font-black active:opacity-60"
          style={{
            ...btnBase,
            gridColumn: "2",
            gridRow: "1",
            borderColor: "rgba(0,180,255,0.4)",
            color: "rgba(0,180,255,0.7)",
          }}
        >
          X
        </button>
        {/* Y — middle left */}
        <button
          {...handlers("Y")}
          className="rounded-full flex items-center justify-center text-xs font-black active:opacity-60"
          style={{
            ...btnBase,
            gridColumn: "1",
            gridRow: "2",
            borderColor: "rgba(255,200,0,0.4)",
            color: "rgba(255,200,0,0.7)",
          }}
        >
          Y
        </button>
        {/* center spacer */}
        <div style={{ gridColumn: "2", gridRow: "2" }} />
        {/* A — middle right */}
        <button
          {...handlers("A")}
          className="rounded-full flex items-center justify-center text-xs font-black active:opacity-60"
          style={{
            ...btnBase,
            gridColumn: "3",
            gridRow: "2",
            borderColor: "rgba(0,200,255,0.4)",
            color: "rgba(0,200,255,0.7)",
          }}
        >
          A
        </button>
        {/* B — bottom center */}
        <button
          {...handlers("B")}
          className="rounded-full flex items-center justify-center text-xs font-black active:opacity-60"
          style={{
            ...btnBase,
            gridColumn: "2",
            gridRow: "3",
            borderColor: "rgba(253,46,95,0.4)",
            color: "rgba(253,46,95,0.7)",
          }}
        >
          B
        </button>
      </div>
    </div>
  );
}
