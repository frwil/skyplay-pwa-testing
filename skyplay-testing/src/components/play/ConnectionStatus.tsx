"use client";

import { Wifi, WifiOff, Activity, User, RotateCcw } from "lucide-react";

interface ConnectionStatusProps {
  /** Whether the connection is active (show the bar) */
  visible: boolean;
  /** Current latency in ms */
  latency: number;
  /** Total number of rollbacks */
  rollbacks: number;
  /** Opponent's username */
  opponentName: string | null;
  /** Connection state from RTCPeerConnection */
  connectionState: string;
  /** Netplay status */
  status: string;
}

/**
 * Thin status bar displayed during a netplay match.
 *
 * Shows:
 * - Ping indicator (green/yellow/red)
 * - Rollback count
 * - Opponent name
 * - Connection state
 */
export default function ConnectionStatus({
  visible,
  latency,
  rollbacks,
  opponentName,
  connectionState,
  status,
}: ConnectionStatusProps) {
  if (!visible || status !== "playing") return null;

  // Latency color
  const latencyColor =
    latency < 50 ? "#4ade80"   // green: excellent
    : latency < 100 ? "#facc15" // yellow: playable
    : "#fd2e5f";                // red: laggy

  const connectionIcon =
    connectionState === "connected" ? (
      <Wifi className="w-3 h-3" style={{ color: latencyColor }} />
    ) : (
      <WifiOff className="w-3 h-3" style={{ color: "#fd2e5f" }} />
    );

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-4 px-4 py-1.5 text-[10px]"
      style={{
        backgroundColor: "rgba(13,27,46,0.95)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(8px)",
      }}
    >
      {/* Opponent */}
      {opponentName && (
        <div className="flex items-center gap-1.5" style={{ color: "rgba(255,255,255,0.6)" }}>
          <User className="w-3 h-3" />
          <span className="font-medium" style={{ color: "rgba(255,255,255,0.8)" }}>{opponentName}</span>
        </div>
      )}

      <div className="w-px h-3" style={{ backgroundColor: "rgba(255,255,255,0.08)" }} />

      {/* Latency */}
      <div className="flex items-center gap-1.5">
        {connectionIcon}
        <span className="font-bold tabular-nums" style={{ color: latencyColor }}>
          {latency > 0 ? `${latency}ms` : "--"}
        </span>
      </div>

      <div className="w-px h-3" style={{ backgroundColor: "rgba(255,255,255,0.08)" }} />

      {/* Rollbacks */}
      <div className="flex items-center gap-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>
        <RotateCcw className="w-3 h-3" />
        <span className="font-bold tabular-nums" style={{ color: rollbacks > 0 ? "#facc15" : "rgba(255,255,255,0.4)" }}>
          {rollbacks}
        </span>
      </div>

      <div className="w-px h-3" style={{ backgroundColor: "rgba(255,255,255,0.08)" }} />

      {/* Status */}
      <div className="flex items-center gap-1.5">
        <Activity className="w-3 h-3" style={{ color: "rgba(255,255,255,0.4)" }} />
        <span style={{ color: "rgba(255,255,255,0.35)" }}>
          {connectionState === "connected" ? "Connected" : connectionState}
        </span>
      </div>
    </div>
  );
}
