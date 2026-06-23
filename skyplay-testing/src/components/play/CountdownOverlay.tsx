"use client";

import { useEffect, useState } from "react";

interface CountdownOverlayProps {
  /** Current countdown value (3, 2, 1, 0 = GO!) */
  countdown: number;
  /** Whether the overlay is visible */
  visible: boolean;
  /** Called when countdown finishes (after "GO!" animation) */
  onComplete?: () => void;
}

/**
 * Full-screen countdown overlay displayed before a netplay match starts.
 * Shows "3... 2... 1... GO!" with animations.
 */
export default function CountdownOverlay({
  countdown,
  visible,
  onComplete,
}: CountdownOverlayProps) {
  const [showGo, setShowGo] = useState(false);
  const [phase, setPhase] = useState<"countdown" | "go" | "done">("countdown");

  useEffect(() => {
    if (!visible) {
      setPhase("countdown");
      setShowGo(false);
      return;
    }

    if (countdown <= 0 && phase === "countdown") {
      // Transition to GO!
      setPhase("go");
      setShowGo(true);

      // Hide after 800ms
      const timer = setTimeout(() => {
        setPhase("done");
        onComplete?.();
      }, 800);

      return () => clearTimeout(timer);
    }
  }, [countdown, visible, phase, onComplete]);

  if (!visible || phase === "done") return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)" }}
    >
      {phase === "countdown" && countdown > 0 && (
        <div className="text-center select-none">
          <span
            className="inline-block text-[8rem] font-black leading-none animate-pulse"
            style={{ color: "#00c8ff", textShadow: "0 0 40px rgba(0,200,255,0.5)" }}
          >
            {countdown}
          </span>
          <p className="text-sm font-bold uppercase tracking-[0.3em] mt-2" style={{ color: "rgba(255,255,255,0.4)" }}>
            Prépare-toi
          </p>
        </div>
      )}

      {phase === "go" && (
        <div className="text-center select-none">
          <span
            className="inline-block text-[6rem] font-black leading-none animate-bounce"
            style={{ color: "#4ade80", textShadow: "0 0 40px rgba(74,222,128,0.5)" }}
          >
            GO!
          </span>
          <p className="text-sm font-bold uppercase tracking-[0.3em] mt-2" style={{ color: "rgba(255,255,255,0.6)" }}>
            FIGHT!
          </p>
        </div>
      )}
    </div>
  );
}
