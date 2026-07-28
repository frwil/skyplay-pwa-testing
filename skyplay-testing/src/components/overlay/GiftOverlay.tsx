"use client";

import { useEffect, useState } from "react";
import type { GiftNotifyData } from "./GiftQueue";

interface GiftOverlayProps {
  gift: GiftNotifyData;
  index: number;
}

/** Category → emoji mapping (matches seeded demo gifts). */
const CATEGORY_EMOJI: Record<string, string> = {
  FREE: "🎁",
  COMMON: "🎈",
  RARE: "🎁",
  EPIC: "💎",
  LEGENDARY: "👑",
};

/** Category → CSS accent color. */
const CATEGORY_COLORS: Record<string, string> = {
  FREE: "from-gray-400 to-gray-500",
  COMMON: "from-green-400 to-emerald-500",
  RARE: "from-blue-400 to-indigo-500",
  EPIC: "from-purple-400 to-pink-500",
  LEGENDARY: "from-yellow-400 to-orange-500",
};

export function GiftOverlay({ gift, index }: GiftOverlayProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger entrance animation on next frame
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const emoji = CATEGORY_EMOJI[gift.gift.category] || "🎁";
  const colorGradient = CATEGORY_COLORS[gift.gift.category] || "from-blue-400 to-indigo-500";
  const isMultiple = gift.quantity > 1;

  return (
    <div
      className={`absolute inset-0 flex items-center justify-center pointer-events-none z-50 transition-all duration-500 ${
        visible ? "opacity-100 scale-100" : "opacity-0 scale-50"
      }`}
      style={{ top: `${index * 20}px` }}
    >
      {/* Animated card */}
      <div className="flex flex-col items-center gap-2">
        {/* Animated ring behind the gift */}
        <div
          className={`absolute w-24 h-24 rounded-full bg-gradient-to-r ${colorGradient} opacity-30 animate-ping`}
          style={{ animationDuration: "2s" }}
        />

        {/* Gift icon */}
        <div className="relative flex flex-col items-center">
          {/* Main icon */}
          <span className="text-6xl animate-bounce drop-shadow-lg">
            {emoji}
          </span>

          {/* Quantity badge */}
          {isMultiple && (
            <span className="absolute -top-1 -right-4 bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full shadow-lg animate-pulse">
              ×{gift.quantity}
            </span>
          )}

          {/* Gift name */}
          <span
            className={`text-sm font-bold mt-1 bg-gradient-to-r ${colorGradient} bg-clip-text text-transparent`}
          >
            {gift.gift.name}
          </span>
        </div>

        {/* Sender info */}
        <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1">
          <span className="text-xs text-white/60">de</span>
          {gift.from.avatar ? (
            <img
              src={gift.from.avatar}
              alt={gift.from.username}
              className="w-5 h-5 rounded-full"
            />
          ) : null}
          <span className="text-sm font-semibold text-white">{gift.from.username}</span>
        </div>

        {/* Message (if any) */}
        {gift.message && (
          <p className="text-xs text-white/50 italic max-w-[200px] text-center">
            "{gift.message}"
          </p>
        )}

        {/* Diamond value */}
        <span className="text-xs text-white/40">
          +{gift.diamondAmount} 💎
        </span>
      </div>
    </div>
  );
}
