"use client";

import { useEffect, useRef, useCallback } from "react";
import { getButtonIndexToBit, SYSTEM_KEY_MAPS } from "../EmulatorAdapter";
import type { SystemType } from "../types";

/**
 * Keyboard input hook for emulator.
 *
 * Listens for keydown/keyup events, maps physical key position (e.code) to
 * emulator-specific button indices (via SYSTEM_KEY_MAPS), and calls the
 * provided buttonDown/buttonUp callbacks. Also tracks the current input
 * bitmask for the game loop to read synchronously.
 *
 * Uses e.code (physical position) as primary lookup so WASD/ZQSD work
 * identically on QWERTY and AZERTY layouts. Falls back to e.key for
 * layout-specific overrides.
 *
 * @param buttonDown - Callback when a button is pressed
 * @param buttonUp   - Callback when a button is released
 * @param system     - Target system (determines key→button mapping)
 * @param enabled    - Whether to capture input (false while loading/idle)
 */
export function useKeyboard(
  buttonDown: (player: 1 | 2, button: number) => void,
  buttonUp: (player: 1 | 2, button: number) => void,
  system: SystemType = "nes",
  enabled: boolean = true,
) {
  // Track currently held keys to compute input bitmask per player
  const heldKeysRef = useRef<Set<string>>(new Set());
  // Current input bitmask for Player 1 (for game loop)
  const p1BitmaskRef = useRef<number>(0);

  // Stable refs so the effect doesn't need to re-register
  const buttonDownRef = useRef(buttonDown);
  buttonDownRef.current = buttonDown;
  const buttonUpRef = useRef(buttonUp);
  buttonUpRef.current = buttonUp;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const buttonIndexToBit = getButtonIndexToBit(system);
  const keyMap = SYSTEM_KEY_MAPS[system];

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!enabledRef.current) return;
    // Use e.code (physical key position) first so WASD/ZQSD works on both
    // QWERTY and AZERTY. Fall back to e.key for layout-specific overrides
    // and special keys (ArrowUp, Enter, ShiftRight, etc.).
    const mapping = keyMap[e.code] ?? keyMap[e.key.toLowerCase()];
    if (!mapping) return;

    e.preventDefault();
    e.stopPropagation();

    const key = `${mapping.player}:${mapping.button}`;
    if (heldKeysRef.current.has(key)) return; // ignore repeat

    heldKeysRef.current.add(key);
    // 🔍 DEBUG: log all player inputs
    const playerLabel = mapping.player === 1 ? "P1" : "P2";
    console.log(`[KB] ${playerLabel} key DOWN: code="${e.code}" key="${e.key}" → btn=${mapping.button}`);
    buttonDownRef.current(mapping.player, mapping.button);

    // Update bitmask
    if (mapping.player === 1) {
      p1BitmaskRef.current |= buttonIndexToBit[mapping.button] ?? 0;
    }
  }, [keyMap, buttonIndexToBit]);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    if (!enabledRef.current) return;
    const mapping = keyMap[e.code] ?? keyMap[e.key.toLowerCase()];
    if (!mapping) return;

    e.preventDefault();
    e.stopPropagation();

    const key = `${mapping.player}:${mapping.button}`;
    heldKeysRef.current.delete(key);
    // 🔍 DEBUG: log all player inputs
    const playerLabel = mapping.player === 1 ? "P1" : "P2";
    console.log(`[KB] ${playerLabel} key UP: code="${e.code}" key="${e.key}" → btn=${mapping.button}`);
    buttonUpRef.current(mapping.player, mapping.button);

    // Update bitmask
    if (mapping.player === 1) {
      p1BitmaskRef.current &= ~(buttonIndexToBit[mapping.button] ?? 0);
    }
  }, [keyMap, buttonIndexToBit]);

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
