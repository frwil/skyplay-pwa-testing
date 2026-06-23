"use client";

import { useEffect, useRef, useCallback } from "react";
import { KEY_MAP, BUTTON_INDEX_TO_BIT } from "../constants";

/**
 * Keyboard input hook for NES emulator.
 *
 * Listens for keydown/keyup events, maps physical keys to
 * NES buttons, and calls the provided buttonDown/buttonUp
 * callbacks. Also tracks the current input bitmask for the
 * game loop to read synchronously.
 */
export function useKeyboard(
  buttonDown: (player: 1 | 2, button: number) => void,
  buttonUp: (player: 1 | 2, button: number) => void,
  enabled: boolean = true,
) {
  // Track currently held keys to compute input bitmask per player
  const heldKeysRef = useRef<Set<string>>(new Set());
  // Current input bitmask for Player 1 (for game loop)
  const p1BitmaskRef = useRef<number>(0);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;
      const mapping = KEY_MAP[e.code];
      if (!mapping) return;

      e.preventDefault();
      e.stopPropagation();

      const key = `${mapping.player}:${mapping.button}`;
      if (heldKeysRef.current.has(key)) return; // ignore repeat

      heldKeysRef.current.add(key);
      buttonDown(mapping.player, mapping.button);

      // Update bitmask
      if (mapping.player === 1) {
        p1BitmaskRef.current |= BUTTON_INDEX_TO_BIT[mapping.button] ?? 0;
      }
    },
    [buttonDown, enabled],
  );

  const handleKeyUp = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;
      const mapping = KEY_MAP[e.code];
      if (!mapping) return;

      e.preventDefault();
      e.stopPropagation();

      const key = `${mapping.player}:${mapping.button}`;
      heldKeysRef.current.delete(key);
      buttonUp(mapping.player, mapping.button);

      // Update bitmask
      if (mapping.player === 1) {
        p1BitmaskRef.current &= ~(BUTTON_INDEX_TO_BIT[mapping.button] ?? 0);
      }
    },
    [buttonUp, enabled],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      // Release all held keys
      heldKeysRef.current.clear();
      p1BitmaskRef.current = 0;
    };
  }, [handleKeyDown, handleKeyUp]);

  /** Get the current Player 1 input bitmask (for synchronous game loop read). */
  const getP1Bitmask = useCallback((): number => {
    return p1BitmaskRef.current;
  }, []);

  return { getP1Bitmask };
}
