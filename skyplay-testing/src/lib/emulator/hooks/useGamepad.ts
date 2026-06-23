"use client";

import { useRef, useCallback } from "react";
import { BUTTON_INDEX_TO_BIT } from "../constants";

/**
 * Gamepad API polling hook for NES emulator.
 *
 * Polls `navigator.getGamepads()` each frame (called synchronously
 * by the game loop) and fires buttonDown/buttonUp based on diff
 * from the previous state. Supports standard gamepad layout.
 *
 * Standard Gamepad mapping for NES:
 * - D-pad: axes 0 (left-right) and 1 (up-down)
 * - A button: button index 0 (Cross/A on PlayStation, A on Xbox)
 * - B button: button index 1 (Circle/B, B on Xbox)
 * - SELECT: button index 8 (Share/Select, Back)
 * - START: button index 9 (Options/Start, Start)
 */
const GAMEPAD_AXIS_THRESHOLD = 0.5;

export function useGamepad(
  buttonDown: (player: 1 | 2, button: number) => void,
  buttonUp: (player: 1 | 2, button: number) => void,
  enabled: boolean = true,
) {
  // Previous state for diff-based edge detection
  const prevButtonsRef = useRef<Map<number, Set<number>>>(new Map());
  // Current input bitmask per player
  const p1BitmaskRef = useRef<number>(0);

  /** Call once per animation frame from the game loop. */
  const poll = useCallback(() => {
    if (!enabled) return;

    const gamepads = navigator.getGamepads();

    for (let player = 0; player < Math.min(gamepads.length, 2); player++) {
      const gp = gamepads[player];
      if (!gp) {
        // Gamepad disconnected
        const prevSet = prevButtonsRef.current.get(player);
        if (prevSet && prevSet.size > 0) {
          for (const btn of prevSet) {
            buttonUp((player + 1) as 1 | 2, btn);
          }
          prevButtonsRef.current.set(player, new Set());
        }
        if (player === 0) p1BitmaskRef.current = 0;
        continue;
      }

      const currentSet = new Set<number>();
      const prevSet = prevButtonsRef.current.get(player) ?? new Set();
      const playerNum = (player + 1) as 1 | 2;

      // jsnes button indices: A=0, B=1, SELECT=2, START=3, UP=4, DOWN=5, LEFT=6, RIGHT=7
      // D-pad via axes
      if (gp.axes.length >= 2) {
        if (gp.axes[0] < -GAMEPAD_AXIS_THRESHOLD) currentSet.add(6); // LEFT
        if (gp.axes[0] > GAMEPAD_AXIS_THRESHOLD)  currentSet.add(7); // RIGHT
        if (gp.axes[1] < -GAMEPAD_AXIS_THRESHOLD) currentSet.add(4); // UP
        if (gp.axes[1] > GAMEPAD_AXIS_THRESHOLD)  currentSet.add(5); // DOWN
      }

      // Face buttons (standard mapping)
      if (gp.buttons[0]?.pressed) currentSet.add(0); // A (Cross / A)
      if (gp.buttons[1]?.pressed) currentSet.add(1); // B (Circle / B)
      if (gp.buttons[8]?.pressed) currentSet.add(2); // SELECT (Share / Back)
      if (gp.buttons[9]?.pressed) currentSet.add(3); // START (Options / Start)

      // D-pad buttons (some gamepads report D-pad as buttons 12-15)
      if (gp.buttons[12]?.pressed) currentSet.add(4); // UP
      if (gp.buttons[13]?.pressed) currentSet.add(5); // DOWN
      if (gp.buttons[14]?.pressed) currentSet.add(6); // LEFT
      if (gp.buttons[15]?.pressed) currentSet.add(7); // RIGHT

      // Fire buttonDown for newly pressed buttons
      for (const btn of currentSet) {
        if (!prevSet.has(btn)) {
          buttonDown(playerNum, btn);
        }
      }

      // Fire buttonUp for released buttons
      for (const btn of prevSet) {
        if (!currentSet.has(btn)) {
          buttonUp(playerNum, btn);
        }
      }

      prevButtonsRef.current.set(player, currentSet);

      // Update bitmask for Player 1
      if (player === 0) {
        let mask = 0;
        for (const btn of currentSet) {
          mask |= BUTTON_INDEX_TO_BIT[btn] ?? 0;
        }
        p1BitmaskRef.current = mask;
      }
    }
  }, [buttonDown, buttonUp, enabled]);

  /** Get the current Player 1 gamepad input bitmask. */
  const getP1Bitmask = useCallback((): number => {
    return p1BitmaskRef.current;
  }, []);

  return { poll, getP1Bitmask };
}
