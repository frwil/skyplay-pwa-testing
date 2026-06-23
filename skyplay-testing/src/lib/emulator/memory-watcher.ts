import {
  type GameProfile,
  type MemoryTrigger,
  findProfile,
  getActiveTrigger,
  type SystemCategory,
} from "./game-profiles";

/**
 * Result emitted when a memory trigger fires.
 */
export interface DetectedResult {
  trigger: MemoryTrigger;
  profile: GameProfile;
  timestamp: number;
}

export interface MemoryWatcherOptions {
  /** Function that reads current system RAM as Uint8Array */
  readRam: () => Uint8Array | null;
  /** Current ROM name (for profile lookup) */
  romName: string;
  /** Which system */
  system: SystemCategory;
  /** Called when a trigger fires */
  onDetect: (result: DetectedResult) => void;
  /** Called on errors (non-fatal) */
  onError?: (error: string) => void;
}

export interface MemoryWatcher {
  /** Start watching */
  start: () => void;
  /** Stop watching */
  stop: () => void;
  /** Whether the watcher is currently active */
  readonly active: boolean;
  /** Current profile (if loaded) */
  readonly profile: GameProfile | null;
}

/**
 * Create a memory watcher for a given ROM.
 *
 * Polls system RAM at the profile's interval, comparing snapshots
 * against trigger conditions. When a trigger fires, `onDetect` is called.
 * The same trigger won't refire within a 5-second cooldown.
 */
export function createMemoryWatcher(opts: MemoryWatcherOptions): MemoryWatcher {
  const { readRam, romName, system, onDetect, onError } = opts;

  let profile: GameProfile | null = null;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let prevRam: Uint8Array | null = null;
  let warmupDone = false;
  let lastFireTime: Record<string, number> = {}; // trigger id → timestamp
  let isRunning = false;

  const COOLDOWN_MS = 5000; // Don't refire the same trigger within 5 seconds

  function tick() {
    if (!profile || !isRunning) return;

    try {
      const ram = readRam();
      if (!ram || ram.length === 0) return;

      // Respect warmup period
      if (!warmupDone) {
        const now = Date.now();
        const loadTime = profile!.warmupMs ?? 5000;
        if (now - (watchStartTime ?? now) < loadTime) {
          // Still warming up — just snapshot without checking
          prevRam = new Uint8Array(ram);
          return;
        }
        warmupDone = true;
      }

      // Check all triggers
      const trigger = getActiveTrigger(profile, ram, prevRam);
      if (trigger) {
        const now = Date.now();
        const lastFire = lastFireTime[trigger.id] ?? 0;

        if (now - lastFire >= COOLDOWN_MS) {
          lastFireTime[trigger.id] = now;
          onDetect({
            trigger,
            profile,
            timestamp: now,
          });
        }
      }

      // Save snapshot for next comparison
      prevRam = new Uint8Array(ram);
    } catch (err) {
      onError?.(`Memory watcher error: ${String(err)}`);
    }
  }

  let watchStartTime: number | null = null;

  function start() {
    // Find profile
    profile = findProfile(romName, system);
    if (!profile) return; // No profile for this ROM — watcher stays idle

    if (intervalId) return; // Already running

    watchStartTime = Date.now();
    isRunning = true;
    warmupDone = false;
    prevRam = null;
    lastFireTime = {};

    const interval = profile.pollIntervalMs ?? 500;
    intervalId = setInterval(tick, interval);
  }

  function stop() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    isRunning = false;
    prevRam = null;
    warmupDone = false;
    watchStartTime = null;
  }

  return {
    start,
    stop,
    get active() {
      return isRunning;
    },
    get profile() {
      return profile;
    },
  };
}
