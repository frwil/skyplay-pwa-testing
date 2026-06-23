"use client";

import { useRef, useCallback } from "react";
import { getButtonIndexToBit, SYSTEM_GAMEPAD_MAPS } from "../EmulatorAdapter";
import type { SystemType } from "../types";

/**
 * Gamepad API polling hook for emulator.
 *
 * Polls `navigator.getGamepads()` each frame (called synchronously
 * by the game loop) and fires buttonDown/buttonUp based on diff
 * from the previous state. Supports standard gamepad layout with
 * per-system button mappings.
 *
 * @param buttonDown - Callback when a gamepad button is pressed
 * @param buttonUp   - Callback when a gamepad button is released
 * @param system     - Target system (determines gamepad→button mapping)
 * @param enabled    - Whether to poll (false while loading/idle)
 */
const GAMEPAD_AXIS_THRESHOLD = 0.5;

export function useGamepad(
  buttonDown: (player: 1 | 2, button: number) => void,
  buttonUp: (player: 1 | 2, button: number) => void,
  system: SystemType = "nes",
  enabled: boolean = true,
) {
  // Previous state for diff-based edge detection
  const prevButtonsRef = useRef<Map<number, Set<number>>>(new Map());
  // Current input bitmask per player
  const p1BitmaskRef = useRef<number>(0);

  // Stable refs to avoid re-creating the poll callback
  const buttonDownRef = useRef(buttonDown);
  buttonDownRef.current = buttonDown;
  const buttonUpRef = useRef(buttonUp);
  buttonUpRef.current = buttonUp;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const buttonIndexToBit = getButtonIndexToBit(system);
  const gpMap = SYSTEM_GAMEPAD_MAPS[system];

  /** Call once per animation frame from the game loop. */
  const poll = useCallback(() => {
    if (!enabledRef.current) return;

    const gamepads = navigator.getGamepads();

    for (let player = 0; player < Math.min(gamepads.length, 2); player++) {
      const gp = gamepads[player];
      if (!gp) {
        // Gamepad disconnected — release all held buttons
        const prevSet = prevButtonsRef.current.get(player);
        if (prevSet && prevSet.size > 0) {
          for (const btn of prevSet) {
            buttonUpRef.current((player + 1) as 1 | 2, btn);
          }
          prevButtonsRef.current.set(player, new Set());
        }
        if (player === 0) p1BitmaskRef.current = 0;
        continue;
      }

      const currentSet = new Set<number>();
      const prevSet = prevButtonsRef.current.get(player) ?? new Set();
      const playerNum = (player + 1) as 1 | 2;

      // D-pad via axes (0 = horizontal, 1 = vertical)
      const [upIdx, downIdx, leftIdx, rightIdx] = gpMap.dPadIndices;
      if (gp.axes.length >= 2) {
        if (gp.axes[0] < -GAMEPAD_AXIS_THRESHOLD) currentSet.add(leftIdx);
        if (gp.axes[0] > GAMEPAD_AXIS_THRESHOLD)  currentSet.add(rightIdx);
        if (gp.axes[1] < -GAMEPAD_AXIS_THRESHOLD) currentSet.add(upIdx);
        if (gp.axes[1] > GAMEPAD_AXIS_THRESHOLD)  currentSet.add(downIdx);
      }

      // Face/shoulder/menu buttons (via per-system mapping)
      for (const [gpBtn, emuBtn] of Object.entries(gpMap.faceButtons)) {
        const idx = Number(gpBtn);
        if (gp.buttons[idx]?.pressed) {
          currentSet.add(emuBtn);
        }
      }

      // Hardware D-pad buttons (12-15 on many controllers)
      const dpadBtnMap: Record<number, number> = {
        12: upIdx,
        13: downIdx,
        14: leftIdx,
        15: rightIdx,
      };
      for (const [gpBtn, emuBtn] of Object.entries(dpadBtnMap)) {
        const idx = Number(gpBtn);
        if (gp.buttons[idx]?.pressed) {
          currentSet.add(emuBtn);
        }
      }

      // Fire buttonDown for newly pressed buttons
      for (const btn of currentSet) {
        if (!prevSet.has(btn)) {
          buttonDownRef.current(playerNum, btn);
        }
      }

      // Fire buttonUp for released buttons
      for (const btn of prevSet) {
        if (!currentSet.has(btn)) {
          buttonUpRef.current(playerNum, btn);
        }
      }

      prevButtonsRef.current.set(player, currentSet);

      // Update bitmask for Player 1
      if (player === 0) {
        let mask = 0;
        for (const btn of currentSet) {
          mask |= buttonIndexToBit[btn] ?? 0;
        }
        p1BitmaskRef.current = mask;
      }
    }
  }, [buttonIndexToBit, gpMap]);

  /** Get the current Player 1 gamepad input bitmask. */
  const getP1Bitmask = useCallback((): number => {
    return p1BitmaskRef.current;
  }, []);

  return { poll, getP1Bitmask };
}
