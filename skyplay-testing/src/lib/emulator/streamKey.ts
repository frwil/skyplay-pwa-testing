/**
 * Plan A — live stream key registry (MVP "paste key").
 *
 * A module-level holder for the RTMP ingest URL (with embedded stream key) that a duel host
 * pastes before starting a match. Kept out of React state / the emulator adapter lifecycle so
 * the paste-key UI stays fully decoupled from the working cloud pipeline: the UI writes here,
 * and CloudAdapter reads here when it builds the WS init message. Session-scoped (cleared on
 * reload). Entirely inert unless the host actually pastes a key AND the game-server has
 * STREAMING_ENABLED=1 after a Docker rebuild.
 */

let rtmpUrl: string | null = null;

/** Set (or clear with null/empty) the RTMP ingest URL for the next hosted session. */
export function setStreamKey(url: string | null): void {
  const trimmed = url?.trim() || "";
  rtmpUrl = trimmed.length > 0 ? trimmed : null;
}

/** Current RTMP ingest URL, or null when no live broadcast is configured. */
export function getStreamKey(): string | null {
  return rtmpUrl;
}
