"use client";

import { useEffect, useRef, useState } from "react";

interface AnimatedNumberProps {
  /** Start value of the animation. */
  from: number;
  /** End value of the animation. */
  to: number;
  /** Animation duration in ms (default 900). */
  durationMs?: number;
  className?: string;
  /** Optional formatter for the displayed (rounded) value; defaults to locale integer. */
  format?: (n: number) => string;
}

/** Ease-out cubic — fast start, gentle landing. */
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Counts from `from` to `to` over `durationMs` using requestAnimationFrame + ease-out cubic.
 * No external dependency. Renders a rounded, `tabular-nums`-friendly integer by default.
 * Re-animates whenever `from`/`to` change (e.g. a new match settles).
 */
export default function AnimatedNumber({
  from,
  to,
  durationMs = 900,
  className,
  format,
}: AnimatedNumberProps) {
  const [value, setValue] = useState(from);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // Instant when there is nothing to animate.
    if (from === to) {
      setValue(to);
      return;
    }
    let start: number | null = null;
    const tick = (now: number) => {
      if (start === null) start = now;
      const t = Math.min(1, (now - start) / durationMs);
      setValue(from + (to - from) * easeOutCubic(t));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setValue(to);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [from, to, durationMs]);

  const rounded = Math.round(value);
  return <span className={className}>{format ? format(rounded) : rounded.toLocaleString()}</span>;
}
