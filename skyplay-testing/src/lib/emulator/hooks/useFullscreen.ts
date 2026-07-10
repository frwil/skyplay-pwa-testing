"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Fullscreen helper. Tracks whether the document is currently in fullscreen and exposes
 * enter / exit / toggle. `enter` and `toggle` take the target element (e.g. the canvas
 * container). Exiting via the browser UI or the Escape key is reflected automatically
 * through the `fullscreenchange` listener, so `isFullscreen` always mirrors reality.
 */
export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const enter = useCallback(async (el: HTMLElement | null) => {
    try {
      if (!document.fullscreenElement && el) await el.requestFullscreen();
    } catch (err) {
      console.warn("[useFullscreen] enter failed:", err);
    }
  }, []);

  const exit = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch (err) {
      console.warn("[useFullscreen] exit failed:", err);
    }
  }, []);

  const toggle = useCallback(
    async (el: HTMLElement | null) => {
      if (document.fullscreenElement) await exit();
      else await enter(el);
    },
    [enter, exit],
  );

  return { isFullscreen, enter, exit, toggle };
}
