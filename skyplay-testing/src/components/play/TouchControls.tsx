"use client";

import { useCallback } from "react";
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

interface TouchControlsProps {
  onButtonDown: (player: 1 | 2, button: number) => void;
  onButtonUp: (player: 1 | 2, button: number) => void;
  visible: boolean;
}

// jsnes button indices: 0=A, 1=B, 2=SELECT, 3=START, 4=UP, 5=DOWN, 6=LEFT, 7=RIGHT
const NES = {
  A: 0,
  B: 1,
  SELECT: 2,
  START: 3,
  UP: 4,
  DOWN: 5,
  LEFT: 6,
  RIGHT: 7,
} as const;

/**
 * Touch overlay controls for mobile play.
 * Visible only on touch devices (hidden on desktop via CSS).
 * D-pad on left, A/B buttons on right, Start/Select in middle.
 */
export default function TouchControls({
  onButtonDown,
  onButtonUp,
  visible,
}: TouchControlsProps) {
  if (!visible) return null;

  const prevent = (e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const touchButton = useCallback(
    (player: 1 | 2, button: number) => ({
      onTouchStart: (e: React.TouchEvent) => {
        prevent(e);
        onButtonDown(player, button);
      },
      onTouchEnd: (e: React.TouchEvent) => {
        prevent(e);
        onButtonUp(player, button);
      },
      onTouchCancel: (e: React.TouchEvent) => {
        prevent(e);
        onButtonUp(player, button);
      },
    }),
    [onButtonDown, onButtonUp],
  );

  const p1 = (btn: number) => touchButton(1, btn);

  const btnStyle: React.CSSProperties = {
    backgroundColor: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "rgba(255,255,255,0.5)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    userSelect: "none",
    touchAction: "none",
  };

  return (
    <div
      className="absolute inset-0 pointer-events-none z-20 md:hidden"
      style={{ touchAction: "none" }}
    >
      {/* ─── D-Pad (Bottom Left) ──────────────────────────────── */}
      <div
        className="absolute bottom-6 left-6 pointer-events-auto grid gap-0.5"
        style={{
          gridTemplateColumns: "48px 48px 48px",
          gridTemplateRows: "48px 48px 48px",
        }}
      >
        {/* UP */}
        <button
          {...p1(NES.UP)}
          className="rounded-t-xl flex items-center justify-center active:opacity-60"
          style={{ ...btnStyle, gridColumn: "2", gridRow: "1" }}
        >
          <ChevronUp className="w-5 h-5" />
        </button>
        {/* LEFT */}
        <button
          {...p1(NES.LEFT)}
          className="rounded-l-xl flex items-center justify-center active:opacity-60"
          style={{ ...btnStyle, gridColumn: "1", gridRow: "2" }}
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        {/* CENTER (empty) */}
        <div style={{ gridColumn: "2", gridRow: "2" }} />
        {/* RIGHT */}
        <button
          {...p1(NES.RIGHT)}
          className="rounded-r-xl flex items-center justify-center active:opacity-60"
          style={{ ...btnStyle, gridColumn: "3", gridRow: "2" }}
        >
          <ChevronRight className="w-5 h-5" />
        </button>
        {/* DOWN */}
        <button
          {...p1(NES.DOWN)}
          className="rounded-b-xl flex items-center justify-center active:opacity-60"
          style={{ ...btnStyle, gridColumn: "2", gridRow: "3" }}
        >
          <ChevronDown className="w-5 h-5" />
        </button>
      </div>

      {/* ─── Start / Select (Bottom Center) ───────────────────── */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 pointer-events-auto flex gap-3">
        <button
          {...p1(NES.SELECT)}
          className="rounded-lg px-3 py-1.5 text-[10px] font-bold tracking-wider uppercase active:opacity-60"
          style={btnStyle}
        >
          Select
        </button>
        <button
          {...p1(NES.START)}
          className="rounded-lg px-3 py-1.5 text-[10px] font-bold tracking-wider uppercase active:opacity-60"
          style={btnStyle}
        >
          Start
        </button>
      </div>

      {/* ─── A / B Buttons (Bottom Right) ──────────────────────── */}
      <div className="absolute bottom-8 right-6 pointer-events-auto flex items-center gap-2">
        {/* B */}
        <button
          {...p1(NES.B)}
          className="rounded-full w-14 h-14 flex items-center justify-center text-sm font-black active:opacity-60"
          style={{
            ...btnStyle,
            borderColor: "rgba(253,46,95,0.4)",
            color: "rgba(253,46,95,0.7)",
          }}
        >
          B
        </button>
        {/* A */}
        <button
          {...p1(NES.A)}
          className="rounded-full w-14 h-14 flex items-center justify-center text-sm font-black active:opacity-60"
          style={{
            ...btnStyle,
            borderColor: "rgba(0,200,255,0.4)",
            color: "rgba(0,200,255,0.7)",
          }}
        >
          A
        </button>
      </div>
    </div>
  );
}
