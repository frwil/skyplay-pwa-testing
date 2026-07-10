"use client";

import { countryToFlag } from "@/lib/flag";

interface PlayerBadgeProps {
  username: string;
  /** Avatar as a base64 data URL, or null for the initial fallback. */
  avatar?: string | null;
  /** ISO-3166 alpha-2 country code, or null for no flag. */
  country?: string | null;
  /** Avatar diameter in px (default 32). */
  size?: number;
  /** Hide the username text (avatar + flag only). */
  hideName?: boolean;
  className?: string;
  /** Accent color for the fallback initial ring. */
  accent?: string;
}

/**
 * Reusable player identity chip: round avatar (or initial fallback) + nationality flag + name.
 * Used everywhere a player appears (lobby, duel header, end overlay, history, admin tables).
 */
export default function PlayerBadge({
  username,
  avatar,
  country,
  size = 32,
  hideName = false,
  className,
  accent = "#f15bb5",
}: PlayerBadgeProps) {
  const flag = countryToFlag(country);
  const initial = (username || "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <div className={`flex items-center gap-2 min-w-0 ${className ?? ""}`}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatar}
            alt={username}
            className="rounded-full object-cover w-full h-full"
            style={{ border: `1px solid ${accent}55` }}
          />
        ) : (
          <div
            className="flex items-center justify-center rounded-full w-full h-full font-bold text-white"
            style={{
              backgroundColor: `${accent}1f`,
              border: `1px solid ${accent}44`,
              fontSize: size * 0.42,
            }}
          >
            {initial}
          </div>
        )}
        {flag && (
          <span
            className="absolute -bottom-1 -right-1 leading-none"
            style={{ fontSize: Math.max(11, size * 0.42) }}
            title={country ?? undefined}
          >
            {flag}
          </span>
        )}
      </div>
      {!hideName && <span className="text-sm font-bold text-white truncate">{username}</span>}
    </div>
  );
}
