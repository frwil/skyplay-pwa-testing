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

interface TouchHandlers {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
  onTouchCancel: (e: React.TouchEvent) => void;
}

interface TouchLayoutProps {
  handlers: (id: string) => TouchHandlers;
  system: SystemType;
}

/**
 * Touch overlay controls for mobile play.
 *
 * Renders per-system layouts. Uses smaller tap targets and
 * responsive spacing so buttons don't overlap on any screen size.
 * Hidden on non-touch devices via `md:hidden`.
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

  const handlers = useCallback(
    (id: string): TouchHandlers =>
      makeHandler(getButton(system, id)?.index ?? -1),
    [makeHandler, system],
  );

  const isSnesLike = system === "snes" || system === "gba";

  return (
    <div
      className="absolute inset-0 pointer-events-none z-20 md:hidden"
      style={{ touchAction: "none" }}
    >
      {/* ── D-Pad (bottom-left) ─────────────────────────────── */}
      <Dpad handlers={handlers} />

      {/* ── Start / Select (bottom-center) ──────────────────── */}
      <StartSelect handlers={handlers} />

      {/* ── Face Buttons (bottom-right) ─────────────────────── */}
      {isSnesLike ? (
        <SnesFaceButtons handlers={handlers} />
      ) : (
        <NesFaceButtons handlers={handlers} system={system} />
      )}
    </div>
  );
}

/* ─── Shared Styles ─────────────────────────────────────────────── */

const btnBase: React.CSSProperties = {
  backgroundColor: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.15)",
  color: "rgba(255,255,255,0.6)",
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
  userSelect: "none",
  touchAction: "none",
  WebkitTapHighlightColor: "transparent",
};

/* ─── D-Pad (3×3 grid, 40px cells) ──────────────────────────────── */

function Dpad({ handlers }: Omit<TouchLayoutProps, "system">) {
  return (
    <div
      className="absolute left-2 bottom-2 pointer-events-auto grid gap-[2px]"
      style={{
        gridTemplateColumns: "38px 38px 38px",
        gridTemplateRows: "38px 38px 38px",
      }}
    >
      <button
        {...handlers("UP")}
        className="rounded-t-lg flex items-center justify-center active:opacity-50"
        style={{ ...btnBase, gridColumn: "2", gridRow: "1" }}
        aria-label="Up"
      >
        <ChevronUp className="w-4 h-4" />
      </button>
      <button
        {...handlers("LEFT")}
        className="rounded-l-lg flex items-center justify-center active:opacity-50"
        style={{ ...btnBase, gridColumn: "1", gridRow: "2" }}
        aria-label="Left"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <div style={{ gridColumn: "2", gridRow: "2" }} />
      <button
        {...handlers("RIGHT")}
        className="rounded-r-lg flex items-center justify-center active:opacity-50"
        style={{ ...btnBase, gridColumn: "3", gridRow: "2" }}
        aria-label="Right"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
      <button
        {...handlers("DOWN")}
        className="rounded-b-lg flex items-center justify-center active:opacity-50"
        style={{ ...btnBase, gridColumn: "2", gridRow: "3" }}
        aria-label="Down"
      >
        <ChevronDown className="w-4 h-4" />
      </button>
    </div>
  );
}

/* ─── Start / Select ────────────────────────────────────────────── */

function StartSelect({ handlers }: Omit<TouchLayoutProps, "system">) {
  return (
    <div className="absolute left-1/2 -translate-x-1/2 bottom-2 pointer-events-auto flex gap-2">
      <button
        {...handlers("SELECT")}
        className="rounded-md px-2.5 py-1 text-[9px] font-bold tracking-wider uppercase active:opacity-50"
        style={btnBase}
      >
        Sel
      </button>
      <button
        {...handlers("START")}
        className="rounded-md px-2.5 py-1 text-[9px] font-bold tracking-wider uppercase active:opacity-50"
        style={btnBase}
      >
        Start
      </button>
    </div>
  );
}

/* ─── NES / GB / GBC Face Buttons ────────────────────────────────── */

function NesFaceButtons({ handlers, system }: TouchLayoutProps) {
  const isGb = system === "gb" || system === "gbc";
  const bBorder = isGb ? "rgba(138,43,226,0.5)" : "rgba(253,46,95,0.5)";
  const bColor = isGb ? "rgba(138,43,226,0.8)" : "rgba(253,46,95,0.8)";
  const aBorder = isGb ? "rgba(220,20,60,0.5)" : "rgba(0,200,255,0.5)";
  const aColor = isGb ? "rgba(220,20,60,0.8)" : "rgba(0,200,255,0.8)";

  return (
    <div className="absolute right-2 bottom-2 pointer-events-auto flex items-center gap-1.5">
      <button
        {...handlers("B")}
        className="rounded-full w-11 h-11 flex items-center justify-center text-xs font-black active:opacity-50"
        style={{ ...btnBase, borderColor: bBorder, color: bColor }}
      >
        B
      </button>
      <button
        {...handlers("A")}
        className="rounded-full w-11 h-11 flex items-center justify-center text-xs font-black active:opacity-50"
        style={{ ...btnBase, borderColor: aBorder, color: aColor }}
      >
        A
      </button>
    </div>
  );
}

/* ─── SNES / GBA Face Buttons ───────────────────────────────────── */

function SnesFaceButtons({ handlers }: Omit<TouchLayoutProps, "system">) {
  return (
    <div className="absolute right-1 bottom-1 pointer-events-auto flex flex-col items-end gap-1.5">
      {/* L / R shoulder buttons */}
      <div className="flex gap-1.5">
        <button
          {...handlers("L")}
          className="rounded-md px-3 py-1 text-[9px] font-black tracking-wider uppercase active:opacity-50"
          style={{
            ...btnBase,
            borderColor: "rgba(160,160,160,0.5)",
            color: "rgba(220,220,220,0.8)",
          }}
        >
          L
        </button>
        <button
          {...handlers("R")}
          className="rounded-md px-3 py-1 text-[9px] font-black tracking-wider uppercase active:opacity-50"
          style={{
            ...btnBase,
            borderColor: "rgba(160,160,160,0.5)",
            color: "rgba(220,220,220,0.8)",
          }}
        >
          R
        </button>
      </div>

      {/* X/Y/A/B diamond */}
      <div
        className="grid gap-[2px]"
        style={{
          gridTemplateColumns: "36px 36px 36px",
          gridTemplateRows: "36px 36px 36px",
        }}
      >
        <button
          {...handlers("X")}
          className="rounded-full flex items-center justify-center text-[10px] font-black active:opacity-50"
          style={{
            ...btnBase,
            gridColumn: "2", gridRow: "1",
            borderColor: "rgba(0,180,255,0.5)", color: "rgba(0,180,255,0.8)",
          }}
        >
          X
        </button>
        <button
          {...handlers("Y")}
          className="rounded-full flex items-center justify-center text-[10px] font-black active:opacity-50"
          style={{
            ...btnBase,
            gridColumn: "1", gridRow: "2",
            borderColor: "rgba(255,200,0,0.5)", color: "rgba(255,200,0,0.8)",
          }}
        >
          Y
        </button>
        <div style={{ gridColumn: "2", gridRow: "2" }} />
        <button
          {...handlers("A")}
          className="rounded-full flex items-center justify-center text-[10px] font-black active:opacity-50"
          style={{
            ...btnBase,
            gridColumn: "3", gridRow: "2",
            borderColor: "rgba(0,200,255,0.5)", color: "rgba(0,200,255,0.8)",
          }}
        >
          A
        </button>
        <button
          {...handlers("B")}
          className="rounded-full flex items-center justify-center text-[10px] font-black active:opacity-50"
          style={{
            ...btnBase,
            gridColumn: "2", gridRow: "3",
            borderColor: "rgba(253,46,95,0.5)", color: "rgba(253,46,95,0.8)",
          }}
        >
          B
        </button>
      </div>
    </div>
  );
}
