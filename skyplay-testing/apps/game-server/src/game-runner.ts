import { spawn, spawnSync, type ChildProcess } from "child_process";
import { createSocket, type Socket } from "dgram";
import { EventEmitter } from "events";
import { writeFileSync, unlinkSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SYSTEM_CORES, SYSTEM_RESOLUTIONS, UPSCALE, XDOTOOL_KEY_MAP, XDOTOOL_KEY_MAP_P2, getButtonToRetroarch, buildRetroarchKeyConfig } from "./config.js";
import { isRecordingEnabled, isStreamingEnabled, recordingDir, recorderFfmpegArgs, streamerFfmpegArgs, uploadRecording } from "./recording.js";
import type { RamConfig } from "./game-config.js";

// Verbose per-frame / per-input RAM-detection tracing. OFF by default: those logs fire
// dozens of times per second during a live round and each console.log to the Docker
// json-file driver is a synchronous stdout write that competes with the frame pump.
// Re-enable with DEBUG_RAM=1 when working on RAM/roster/input detection.
const DEBUG_RAM = process.env.DEBUG_RAM === "1";

export interface GameRunnerEvents {
  onFrame: (jpegData: Buffer, width: number, height: number) => void;
  onAudio: (opusData: Buffer) => void;
  onExit: (code: number | null) => void;
  onError: (err: Error) => void;
  /** H.264 codec config — sent once before the first video frame. */
  onCodecConfig: (videoDesc: Uint8Array, audioDesc: Uint8Array) => void;
}

/** RetroArch network command port (NCI). */
const RA_CMD_PORT = 55355;

/** Known memory addresses for health bars in RetroArch core memory (offsets from work RAM base).
 *  For NeoGeo/FBNeo: full health is typically 0x67 (103 decimal). */
const HEALTH_MEMORY_MAP: Record<string, { p1: number; p2: number; size: number; maxHealth: number; timer: number; timerAlt: number; p1Char: number; p2Char: number; p1Mode: number; p2Mode: number; altChars?: number[]; teamSlots?: number[]; /** Discovered via RAM scan: team roster base at 0xA84E (P1) and 0xA85E (P2) */ p1TeamBase?: number; p2TeamBase?: number; /** Byte offsets from team base to each of the 3 slots (irregular, with separator gaps) */ p1TeamOffsets?: number[]; p2TeamOffsets?: number[]; /** Active character slot index (0-2) */ p1ActiveIdx?: number; p2ActiveIdx?: number; /** Currently-fighting character ID address (0x8256 P1 / 0x8456 P2), discovered via multi-snapshot diff */ p1Active?: number; p2Active?: number; /** Match state flag at 0xA840 (0x40 = in-match, 0x00 = char select) */ matchFlag?: number; /** Per-player "characters lost" counters (0xA859 P1 / 0xA868 P2), 0→3, draw-inclusive — the authoritative match-end signal (health heuristics give the wrong time-over winner and misread the 31% draw-replay) */ p1Lost?: number; p2Lost?: number; /** Pick-order (fight order) buffer in the player struct — [1st, 2nd, 3rd] absolute addresses. P1 0x15CB/0x15CA/0x15CD, P2 mirror +0x200 0x17CB/0x17CA/0x17CD (sep 0x00 at +0xCC). Discovered + validated via controlled diff on 3 distinct orders (2026-07-10). This is the REAL selection order (≠ set-order 0xA84E). Reliable in stable combat; read once + freeze. */ p1PickOrder?: number[]; p2PickOrder?: number[] }> = {
  "kof98.zip":   {
    p1: 0x8238, p2: 0x8438, size: 1, maxHealth: 0x67,
    timer: 0xA83A, timerAlt: 0x85D2,
    p1Char: 0x823F, p2Char: 0x843F,
    p1Mode: 0x821E, p2Mode: 0x841E,
    // Gauge mode ADVANCED/EXTRA — discovered via multi-snapshot diff (2026-07-09). Chosen at char
    // select, immutable for the whole match. 1 = ADVANCED, 0 = EXTRA. Confirmed stable in combat
    // across 5 matches + 29 in-combat samples (not facing direction / not a dynamic gauge value).
    // Mirror struct: P2 = P1 + 0x200. (The old 0x81F0/0x83F0 was WRONG — it read 0xCF-ish, always "ADV".)
    // Discovered via multi-snapshot RAM diff (2026-07-09):
    // Team members are NOT stored in 3 consecutive bytes — each player's 3 picks sit at
    // irregular offsets from the base, with a 0x00 separator byte in the middle.
    //   P1 slots: 0xA84E, 0xA84F, 0xA851  (base+0, +1, +3; separator at 0xA850)
    //   P2 slots: 0xA85E, 0xA860, 0xA861  (base+0, +2, +3; separator at 0xA85F)
    // Confirmed across 6 captures with varied teams (CPU + PvP), stable within a match.
    // Values are KOF98 character IDs 0x00-0x25. RAM order != selection order (set-only).
    p1TeamBase: 0xA84E, p2TeamBase: 0xA85E,
    p1TeamOffsets: [0, 1, 3], p2TeamOffsets: [0, 2, 3],
    // Active (currently-fighting) character ID — discovered via multi-snapshot diff (2026-07-09).
    // Confirmed on 6 distinct characters: P2 0x8456 held Chang→Chizuru→Mai as the 1st pick fought;
    // P1 0x8256 cycled Kyo→Ralf→Choi as each character was KO'd. Mirror structs (P2 = P1 + 0x200),
    // value duplicated at +0x56/+0x58. Reliable only in steady combat (matchFlag 0x40/0x48).
    // The sequence of distinct active IDs over a match = that player's SELECTION ORDER
    // (there is no static order array in RAM; the roster at 0xA84E is fixed internal order, not pick order).
    p1Active: 0x8256, p2Active: 0x8456,
    matchFlag: 0xA840,  // 0x40 when match is active, 0x00 during char select
    // Per-player "characters lost" counters (0→3), discovered via watch-counter multi-round
    // capture (2026-07-10) and validated against a full match (P1 wins R1+R3, P2 R2, DRAW R4 →
    // p2Lost hit 3 → P1 wins). A DRAW increments BOTH at the same poll. These are the
    // authoritative round-result + match-end signal, replacing the unreliable health heuristics.
    p1Lost: 0xA859, p2Lost: 0xA868,
    // Pick order (fight order) buffers — [1st, 2nd, 3rd] absolute addresses. P2 = P1 + 0x200.
    // Layout in RAM is [2nd, 1st, sep(00), 3rd]; we list them here already in fight order.
    // Validated via controlled full-RAM diff on 3 distinct P2 orders (Yuri>Kyo>Beni,
    // Beni>Yuri>Kyo, Kyo>Yuri>Beni) + P1 mirror at -0x200 (2026-07-10). Values are char IDs.
    p1PickOrder: [0x15CB, 0x15CA, 0x15CD], p2PickOrder: [0x17CB, 0x17CA, 0x17CD],
  },
  "kof2002.zip": { p1: 0x8238, p2: 0x8438, size: 1, maxHealth: 0x67, timer: 0xA83A, timerAlt: 0x85D2, p1Char: 0x823F, p2Char: 0x843F, p1Mode: 0x81F0, p2Mode: 0x83F0 },
};

// ── Per-game pixel-based health + timer detection config ────────────
// Every ROM gets its OWN config entry. Adding a new game = adding one entry here.
// The detection engine (state machine, column scan, template matching) stays the same.
//
// Lookup: matched by ROM basename (stripped of path + extension), same as HEALTH_MEMORY_MAP.

/** Full pixel-detection configuration for a single game ROM. */
interface PixelGameConfig {
  // ── Health bar stripe (ffmpeg capture region) ──
  /** Y offset of the health bar stripe from the top of Xvfb. */
  stripeY: number;
  /** Height of the captured stripe in pixels. */
  stripeH: number;
  // ── Health bar X regions (within the stripe, at display width) ──
  p1StartX: number;
  p1EndX: number;
  p2StartX: number;
  p2EndX: number;
  // ── Round / match rules ──
  /** Number of rounds needed to win the match (2 = best-of-3, 3 = best-of-5). */
  winsNeeded: number;
  // ── Timer digit recognition (absent → no pixel timer for this ROM) ──
  timer?: {
    /** 10 digit templates, each 12 rows × 8 bits (MSB=left). */
    digits: number[][];
    /** Left digit X position in the health bar stripe. */
    leftDigitX: number;
    /** Right digit X position in the health bar stripe. */
    rightDigitX: number;
    /** Width of each digit in pixels. */
    digitW: number;
    /** Height of each digit in pixels. */
    digitH: number;
    /** Minimum bright pixel ratio to consider the region readable. */
    minBrightRatio: number;
  };
}

const PIXEL_GAME_CONFIGS: Record<string, PixelGameConfig> = {
  // ── Street Fighter Alpha 2 (SNES) ──────────────────────────────────
  "Street Fighter Alpha 2 (Europe).sfc": {
    stripeY: 110, stripeH: 24,
    p1StartX: 70, p1EndX: 310,
    p2StartX: 450, p2EndX: 768,
    winsNeeded: 2,
    timer: {
      // Arcade-style bold white digits on dark background, ~22×24px each at 3x upscale.
      // Timer sits between P1 health (ends 310) and P2 health (starts 450).
      digits: [
        [0b00111100,0b01100110,0b01100110,0b01100110,0b01100110,0b01100110,0b01100110,0b01100110,0b01100110,0b01100110,0b01100110,0b00111100], // 0
        [0b00011000,0b00111000,0b00011000,0b00011000,0b00011000,0b00011000,0b00011000,0b00011000,0b00011000,0b00011000,0b00011000,0b01111110], // 1
        [0b00111100,0b01100110,0b00000110,0b00000110,0b00000110,0b00001100,0b00011000,0b00110000,0b01100000,0b01100000,0b01111110,0b01111110], // 2
        [0b00111100,0b01100110,0b00000110,0b00000110,0b00001100,0b00111100,0b00000110,0b00000110,0b00000110,0b00000110,0b01100110,0b00111100], // 3
        [0b00001100,0b00011100,0b00111100,0b01101100,0b11001100,0b11001100,0b11111110,0b11111110,0b00001100,0b00001100,0b00001100,0b00001100], // 4
        [0b01111110,0b01100000,0b01100000,0b01100000,0b01111100,0b00000110,0b00000110,0b00000110,0b00000110,0b00000110,0b01100110,0b00111100], // 5
        [0b00011100,0b00110000,0b01100000,0b01100000,0b01111100,0b01100110,0b01100110,0b01100110,0b01100110,0b01100110,0b01100110,0b00111100], // 6
        [0b01111110,0b01111110,0b00000110,0b00000110,0b00001100,0b00011000,0b00011000,0b00110000,0b00110000,0b01100000,0b01100000,0b01100000], // 7
        [0b00111100,0b01100110,0b01100110,0b01100110,0b00111100,0b01100110,0b01100110,0b01100110,0b01100110,0b01100110,0b01100110,0b00111100], // 8
        [0b00111100,0b01100110,0b01100110,0b01100110,0b01100110,0b01100110,0b00111110,0b00000110,0b00000110,0b00000110,0b00001100,0b01111000], // 9
      ],
      leftDigitX: 338, rightDigitX: 362, digitW: 22, digitH: 24, minBrightRatio: 0.15,
    },
  },
};

/** Template dimensions (all digit templates are 8×12 bitmaps). */
const DIGIT_TEMPLATE_W = 8;
const DIGIT_TEMPLATE_H = 12;

/** Look up the pixel config for a ROM. Returns null if the game uses RAM-based detection. */
function getPixelConfig(rom: string): PixelGameConfig | null {
  const romKey = rom.split("/").pop()?.replace(/\.(zip|sfc|smc|nes|gb|gbc|gba)$/i, "") ?? rom;
  const entry = Object.entries(PIXEL_GAME_CONFIGS).find(([k]) =>
    k.replace(/\.(zip|sfc|smc|nes|gb|gbc|gba)$/i, "") === romKey
  );
  return entry?.[1] ?? null;
}

/** KOF '98 character ID → name mapping. */
const KOF98_CHARACTERS: Record<number, string> = {
  0x00: "Kyo Kusanagi",     0x01: "Benimaru Nikaido",  0x02: "Goro Daimon",
  0x03: "Terry Bogard",     0x04: "Andy Bogard",       0x05: "Joe Higashi",
  0x06: "Ryo Sakazaki",     0x07: "Robert Garcia",     0x08: "Yuri Sakazaki",
  0x09: "Leona Heidern",    0x0A: "Ralf Jones",        0x0B: "Clark Still",
  0x0C: "Athena Asamiya",   0x0D: "Sie Kensou",        0x0E: "Chin Gentsai",
  0x0F: "Chizuru Kagura",   0x10: "Mai Shiranui",      0x11: "King",
  0x12: "Kim Kaphwan",      0x13: "Chang Koehan",      0x14: "Choi Bounge",
  0x15: "Yashiro Nanakase", 0x16: "Shermie",           0x17: "Chris",
  0x18: "Ryuji Yamazaki",   0x19: "Blue Mary",         0x1A: "Billy Kane",
  0x1B: "Iori Yagami",      0x1C: "Mature",            0x1D: "Vice",
  0x1E: "Heidern",          0x1F: "Takuma Sakazaki",   0x20: "Saisyu Kusanagi",
  0x21: "Heavy D!",         0x22: "Lucky Glauber",     0x23: "Brian Battler",
  0x24: "Rugal Bernstein",  0x25: "Shingo Yabuki",
};

/**
 * Manages RetroArch + FFmpeg lifecycle inside the Docker container.
 *
 * Spawns:
 * 1. Xvfb — virtual framebuffer for headless rendering
 * 2. PulseAudio — virtual audio device (null sink)
 * 3. RetroArch — runs the libretro core with the ROM
 * 4. FFmpeg (video) — captures Xvfb, encodes H.264, pipes to stdout
 * 5. FFmpeg (audio) — captures PulseAudio monitor, encodes Opus, pipes to stdout
 *
 * Video uses H.264 baseline profile (WebCodecs-compatible).
 * Audio uses Opus 32kbps mono.
 */
/** Pixel-based health detection state machine.
 *  Replaces implicit boolean-flag state with explicit phases so every
 *  transition requires multi-frame evidence — no single-frame false positives. */
enum GamePhase {
  WARMUP       = "WARMUP",        // collecting calibration frames, no KO detection
  PLAYING      = "PLAYING",       // active KO detection
  KO_PENDING   = "KO_PENDING",    // potential KO — confirming over N frames
  KO_CONFIRMED = "KO_CONFIRMED",  // KO confirmed, waiting for new round
  NEW_ROUND    = "NEW_ROUND",     // health bars back, transitioning to next round
  MATCH_END    = "MATCH_END",     // match is over
}

export class GameRunner extends EventEmitter {
  private xvfb: ChildProcess | null = null;
  private retroarch: ChildProcess | null = null;
  private ffmpegVideo: ChildProcess | null = null;
  private parec: ChildProcess | null = null;
  /** Plan A: separate recorder/streamer FFmpeg processes (decoupled from the WS pipeline). */
  private recorder: ChildProcess | null = null;
  private streamer: ChildProcess | null = null;
  /** Local mp4 path being written by the recorder (null when recording is off). */
  private recordingPath: string | null = null;
  /** One-shot guard so the recorder's exit uploads exactly once. */
  private recordingUploaded = false;
  /** Per-session RTMP ingest URL (with embedded stream key), from the client init. Null = no stream. */
  private rtmpUrl: string | null;
  private system: string;
  private rom: string;
  private sessionId: string;
  private mode: "cpu" | "pvp";
  private displayNum: number;
  private running = false;
  /** Set to true by stop() — used to abort late start() completion after async setup. */
  private stopRequested = false;
  private frameId = 0;
  private videoBuffer = Buffer.alloc(0);
  private codecConfigSent = false;
  private retroarchWindowId: string | null = null;
  private configPath: string | null = null;

  // ── Round win/loss detection via screenshot pixel analysis (health bars) ──
  private healthFfmpeg: ChildProcess | null = null;
  private healthPollTimer: ReturnType<typeof setInterval> | null = null; // debug log timer (10s)
  private healthReadTimer: ReturnType<typeof setInterval> | null = null; // health polling timer (250ms)
  private healthPollEnabled = false;
  private healthFrameBuf = Buffer.alloc(0);
  private healthPollErrorCount = 0;
  private previousP1Health = -1;
  private previousP2Health = -1;
  private koDetected = false;
  private p1Losses = 0;
  private p2Losses = 0;
  private matchEnded = false;
  private healthStableFrames = 0; // total frames collected during warmup
  private healthStableFramesHealthy = 0; // how many were healthy
  private healthDetectionArmed = false; // KO detection enabled after warmup
  private lastKoTimestamp = 0; // prevent double-triggers within cooldown window
  private koCooldownFrames = 0; // countdown after KO before re-arming detection
  /** Width of the upscaled display (set when game starts). */
  private displayW = 0;
  private displayH = 0;
  /** Per-match round tracking for stats. */
  private matchNumber = 0;
  private roundNumber = 0;
  private matchPerfectKos = 0;
  /** Track minimum health of each player during the current round (for accurate perfect KO detection). */
  private roundP1MinHealth = 100;
  private roundP2MinHealth = 100;
  /** Latches when the round timer counts down to 0 (TIME OVER). A perfect KO and a per-character win
   *  badge are credited ONLY on a KO round (timer > 0). A TIME OVER — including KOF98 "DRAW GAME",
   *  where the game flashes "PERFECT" for an untouched player even without a KO — never counts. */
  private roundTimerHitZero = false;
  /** processLossCounters-local previous 16-bit timer, to detect the >0 → 0 (TIME OVER) transition. */
  private lcPrevTimer16 = -1;
  /** Calibrated "full health" pixel counts — set during warmup, used to normalize readings to 0-100%. */
  private p1MaxPixels = 0;
  private p2MaxPixels = 0;
  /** After auto-continue, use a shorter warmup since we already validated the readings. */
  private fastWarmup = false;
  // ── State-machine pixel detection (per-ROM config) ──
  /** Pixel-game config for the current ROM (null = RAM-based detection). */
  private pixelConfig: PixelGameConfig | null = null;
  private gamePhase: GamePhase = GamePhase.WARMUP;
  /** Rolling health history ring buffers (smoothed via median). */
  private healthHistoryP1: number[] = [];
  private healthHistoryP2: number[] = [];
  private readonly HEALTH_HISTORY_SIZE = 5;
  /** Calibrated full-bar width in columns (set once during WARMUP). */
  private p1FullBarWidth = 0;
  private p2FullBarWidth = 0;
  // ── Timer digit recognition (template matching) ──
  /** Last recognized timer value (-1 = unknown). */
  private lastTimerValue = -1;
  /** How many frames the timer has been at the same value. */
  private timerStableFrames = 0;
  /** Emit timer value only after this many stable frames. */
  private readonly TIMER_STABLE_REQUIRED = 3;

  /** Grace period after entering PLAYING — ignore KOs during screen transitions. */
  private playingFrameCount = 0;
  private readonly PLAYING_GRACE_FRAMES = 16; // ~4s at 4 reads/sec — skips FIGHT! overlay
  /** KO confirmation: how many consecutive frames the loser stayed ≤ KO_THRESHOLD. */
  private koConfirmFrames = 0;
  private readonly KO_CONFIRM_REQUIRED = 4;  // ~2s at 2 fps
  /** New-round confirmation: how many consecutive frames both bars stayed > 80%. */
  private newRoundConfirmFrames = 0;
  private readonly NEW_ROUND_CONFIRM_REQUIRED = 5;  // ~2.5s at 2 fps
  /** Time-over confirmation: how many consecutive frames the OCR timer stayed at 0
   *  while both players are alive. Prevents false positives from OCR flicker. */
  private timeOverConfirmFrames = 0;
  private readonly TIME_OVER_CONFIRM_REQUIRED = 3;  // ~1.5s at 2 fps
  /** UDP socket for reading health directly from RetroArch core memory via READ_CORE_RAM. */
  private healthUdp: Socket | null = null;
  /** Pending GET_STATUS resolvers, settled by the healthUdp message handler when RetroArch
   *  replies "GET_STATUS <PLAYING|PAUSED|CONTENTLESS> ...". We reuse the proven health socket
   *  (which reliably gets replies under load) instead of an ephemeral socket that drops them. */
  private pendingStatusResolvers: Array<(s: "PLAYING" | "PAUSED" | "CONTENTLESS" | null) => void> = [];
  /** Memory-map entry for the current game (null = fall back to pixel analysis). */
  private healthMemMap: typeof HEALTH_MEMORY_MAP[string] | null = null;
  /** Latest health values read from core memory (raw, before normalization). */
  private memHealthP1 = -1;
  private memHealthP2 = -1;
  private memTimer = -1;
  private memTimerAlt = -1;
  private memTimer16 = -1; // 16-bit LE timer (A83A-A83B)
  private prevTimer16 = -1; // previous frame's 16-bit timer (for round-reset detection)
  private memP1Char = -1;
  private memP2Char = -1;
  private memP1Mode = -1;
  private memP2Mode = -1;
  /** Discovered team slots (3 per player): P1 @0xA84E/A84F/A851, P2 @0xA85E/A860/A861. */
  private p1TeamSlots: number[] = [];
  private p2TeamSlots: number[] = [];
  /** Locked team (frozen once during char select, matchFlag==0). Never polluted by combat noise. */
  private p1LockedTeam: number[] | null = null;
  private p2LockedTeam: number[] | null = null;
  /** Once true, the locked teams are frozen and no longer refreshed (set at combat start). */
  private teamFrozen: boolean = false;
  /** Match state flag at 0xA840: 0x40 = in-match, 0x00 = char select. */
  private memMatchFlag = -1;
  /** Currently-fighting character ID (0x8256 P1 / 0x8456 P2). Valid only in steady combat. */
  private memP1Active = -1;
  private memP2Active = -1;
  /** Authoritative per-player "characters lost" counters (0xA859 P1 / 0xA868 P2), 0→3, draw-inclusive.
   *  -1 = not yet read. These drive round results + match end for kof98 (see processLossCounters). */
  private memP1Lost = -1;
  private memP2Lost = -1;
  /** Last ACCEPTED loss-counter values (the confirmed baseline we diff against). -1 = not baselined. */
  private prevP1Lost = -1;
  private prevP2Lost = -1;
  /** Previous poll's raw loss reads, for a 1-poll confirmation that rejects torn chunk reads. */
  private lastRawP1Lost = -1;
  private lastRawP2Lost = -1;
  /** Selection order: distinct active chars appended in the order they enter the fight (pick 1,2,3). */
  private p1SelectOrder: number[] = [];
  private p2SelectOrder: number[] = [];
  /** Once true, p1/p2SelectOrder came from the authoritative RAM pick-order buffer (0x15CB.. / 0x17CB..);
   *  the round-by-round active-char tracker is then disabled and won't pollute it. Reset per match. */
  private pickOrderCaptured = false;
  private pickOrderInFlight = false;
  /** Consecutive polls where matchFlag read 0x00. A real new-match char-select
   *  sustains 0x00 for several seconds; a mid-match round-transition blip lasts
   *  only 1-2 polls. Used to debounce the new-match reset so a transition blip
   *  doesn't wipe the locked team + selection order mid-match. */
  private matchFlagZeroStreak = 0;
  /** Throttle for the live "matchState" event (ms epoch of last emit). */
  private lastMatchStateEmit = 0;
  /** Unique ID for this runner instance (for debugging duplicate-reader issues). */
  private static nextRunnerId = 1;
  private runnerId: number;
  /** Set to true after auto-start/continue completes — suppress KO detection during demo mode. */
  private gameStarted = false;
  /** One-shot flag: roster scan runs on first ARMED. */
  private rosterScanned = false;
  /** Team roster read from memory slots (direct address read, updated each poll). */
  private memP1TeamSlots: number[] = [];
  private memP2TeamSlots: number[] = [];
  private memP1TeamActiveIdx = -1;
  private memP2TeamActiveIdx = -1;
  private teamLogged = false;
  /** Accumulated unique character IDs seen for each player during the current match. */
  private p1SeenChars = new Set<number>();
  private p2SeenChars = new Set<number>();
  /** Rounds won per character (charId → win count), for the end-match overlay.
   *  Credited to the winner's active character on each one-sided round win (not draws). */
  private p1CharWins = new Map<number, number>();
  private p2CharWins = new Map<number, number>();
  /** True while RetroArch is paused (F12 toggle). Freezes the game on match end so the
   *  attract/demo never starts; cleared on rematch. Tracked to keep pause/resume idempotent. */
  private paused = false;
  /** True once the game has left the real match into post-combat char-select/attract WITHOUT
   *  a clean matchEnd (e.g. a missed draw). Stops the health detector from scoring the KOF98
   *  attract DEMO (CPU vs CPU) as phantom rounds/matches. Cleared by beginRematch(). */
  private detectionFrozen = false;

  /** Build character info for event payloads using the locked team (frozen at char select). */
  private charInfo() {
    const p1Name = KOF98_CHARACTERS[this.memP1Char] || "?";
    const p2Name = KOF98_CHARACTERS[this.memP2Char] || "?";
    // Prefer the locked team; fall back to current raw slots if we never captured char select.
    const p1Src = this.p1LockedTeam ?? this.p1TeamSlots;
    const p2Src = this.p2LockedTeam ?? this.p2TeamSlots;
    const p1Team = p1Src.filter(c => c >= 0 && c <= 0x25).map(c => KOF98_CHARACTERS[c] || "?");
    const p2Team = p2Src.filter(c => c >= 0 && c <= 0x25).map(c => KOF98_CHARACTERS[c] || "?");
    return { p1Char: p1Name, p2Char: p2Name, p1Team, p2Team };
  }
  /**
   * Match metadata for post-match stats persistence: team rosters + selection order as
   * compact character-ID arrays (names resolved on display), plus gauge mode per player.
   * Spread into the "matchEnd" event so ws-handler can accumulate it for /api/stats/save.
   */
  private matchMeta() {
    const ids = (locked: number[] | null, slots: number[]) =>
      (locked ?? slots).filter(c => c >= 0x00 && c <= 0x25);
    const wins = (m: Map<number, number>): Record<number, number> => {
      const o: Record<number, number> = {};
      for (const [id, n] of m) o[id] = n;
      return o;
    };
    return {
      p1TeamIds: ids(this.p1LockedTeam, this.p1TeamSlots),
      p2TeamIds: ids(this.p2LockedTeam, this.p2TeamSlots),
      p1SelectOrder: this.p1SelectOrder.slice(),
      p2SelectOrder: this.p2SelectOrder.slice(),
      p1Mode: this.memP1Mode === 1 ? "ADVANCED" : "EXTRA",
      p2Mode: this.memP2Mode === 1 ? "ADVANCED" : "EXTRA",
      p1CharWins: wins(this.p1CharWins),
      p2CharWins: wins(this.p2CharWins),
    };
  }
  /** Credit a round win to the winner's currently-active character (for the overlay's
   *  per-character win tally). No-op for draws (winner 0) or invalid/unknown active IDs. */
  private creditRoundWin(winner: number): void {
    const active = winner === 1 ? this.memP1Active : winner === 2 ? this.memP2Active : -1;
    if (active < 0x00 || active > 0x25) return;
    const m = winner === 1 ? this.p1CharWins : this.p2CharWins;
    m.set(active, (m.get(active) ?? 0) + 1);
  }
  /** Unique ID for the UDP reader within this runner (incremented on each startMemoryHealthReader call). */
  private readerInstance = 0;
  /** Tag used in log messages to identify which reader produced the output (e.g. "R1.1"). */
  private readerTag = "R?.?";

  constructor(
    system: string,
    rom: string,
    sessionId: string,
    mode: "cpu" | "pvp" = "cpu",
    rtmpUrl?: string | null,
    /** RAM config from the DB (or fallback). If null, the hardcoded HEALTH_MEMORY_MAP is used. */
    ramConfig?: RamConfig | null,
  ) {
    super();
    this.system = system;
    this.rom = rom;
    this.sessionId = sessionId;
    this.mode = mode;
    this.rtmpUrl = rtmpUrl ?? null;
    this.runnerId = GameRunner.nextRunnerId++;
    this.displayNum = 99;

    // Pre-set the memory map from the provided config (or fall back to hardcoded lookup).
    if (ramConfig) {
      this.healthMemMap = ramConfig;
    }
    // Look up the per-ROM pixel detection config (only used when no RAM map available).
    this.pixelConfig = getPixelConfig(this.rom);
    if (this.pixelConfig) {
      console.log(`[game-runner] 🎯 Pixel config loaded for ${this.rom}: P1 x=${this.pixelConfig.p1StartX}-${this.pixelConfig.p1EndX} P2 x=${this.pixelConfig.p2StartX}-${this.pixelConfig.p2EndX} wins=${this.pixelConfig.winsNeeded} stripe y=${this.pixelConfig.stripeY} h=${this.pixelConfig.stripeH}${this.pixelConfig.timer ? " ⏱️timer" : ""}`);
    }
  }

  get display(): string {
    return `:${this.displayNum}`;
  }

  get isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<{ width: number; height: number }> {
    const resolution = SYSTEM_RESOLUTIONS[this.system];
    if (!resolution) throw new Error(`Unknown system: ${this.system}`);
    const core = SYSTEM_CORES[this.system];
    if (!core) throw new Error(`No core for system: ${this.system}`);

    const displayW = resolution.w * UPSCALE;
    const displayH = resolution.h * UPSCALE;
    const coresDir = process.env.RETROARCH_CORES_DIR || "/usr/lib/libretro";
    const romsDir = process.env.ROMS_DIR || "/roms";

    console.log(`[game-runner] R${this.runnerId} Starting ${this.system} — ${displayW}x${displayH}`);

    // 0. Start D-Bus (needed by PulseAudio and RetroArch)
    await this.startDbus();

    // 1. Start PulseAudio
    await this.startPulseAudio();

    // 2. Start Xvfb
    await this.startXvfb(displayW, displayH);

    // 3. Start RetroArch (with audio enabled)
    await this.startRetroArch(`${coresDir}/${core}`, `${romsDir}/${this.rom}`, displayW, displayH);

    // 4. Start FFmpeg video capture (H.264)
    this.startFfmpegVideo(displayW, displayH);

    // 5. Start FFmpeg audio capture (Opus) — delayed to ensure RetroArch is actively playing
    setTimeout(() => this.startPcmAudio(), 3000);

    // Send codec config via next tick (FFmpeg needs time to start)
    setTimeout(() => {
      if (!this.codecConfigSent && this.running) {
        this.sendCodecConfig();
      }
    }, 1500);

    // Guard: stop() may have been called during async setup (e.g. player disconnected
    // while waiting for RetroArch to start). If so, don't create the health reader.
    if (this.stopRequested) {
      console.log(`[game-runner] R${this.runnerId} Start aborted — runner was stopped during setup`);
      return { width: resolution.w, height: resolution.h };
    }

    this.running = true;
    console.log(`[game-runner] All processes started for session ${this.sessionId}`);

    // Plan A (env-gated, inert until enabled): record duels + optionally push a live RTMP stream.
    // Both are independent x11grab/pulse consumers — a failure here never affects the WS feed.
    this.startRecorder(displayW, displayH);
    this.startStreamer(displayW, displayH);

    // Start health bar watcher — prefer direct memory reading, fall back to pixel capture.
    // If a RamConfig was passed to the constructor (from DB), it's already set. Otherwise
    // look up the hardcoded HEALTH_MEMORY_MAP by ROM basename.
    if (!this.healthMemMap) {
      const romKey = this.rom.split("/").pop()?.replace(/\.zip$/i, "") ?? this.rom;
      const memMapEntry = Object.entries(HEALTH_MEMORY_MAP).find(([k]) =>
        k.replace(/\.zip$/i, "") === romKey
      );
      this.healthMemMap = memMapEntry?.[1] ?? null;
    }
    if (this.healthMemMap) {
      this.startMemoryHealthReader();
    } else {
      console.log(`[game-runner] 🧠 No memory map for ${this.rom}, using pixel analysis`);
      this.startHealthBarCapture();
    }

    return { width: resolution.w, height: resolution.h };
  }

  // ─────────────────────────────────────────────────────────────────
  //  Health bar watcher (screenshot-based round detection)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Start an ffmpeg process that captures a thin horizontal stripe at the
   * top of the screen (where KOF '98 health bars are) at 2 fps.
   * Raw RGB24 pixels are parsed to detect health bar presence/absence.
   */
  private startHealthBarCapture(): void {
    this.displayW = (SYSTEM_RESOLUTIONS[this.system]?.w ?? 320) * UPSCALE;
    this.displayH = (SYSTEM_RESOLUTIONS[this.system]?.h ?? 224) * UPSCALE;

    // Capture a stripe where health bars are (from per-ROM config or system fallback).
    const stripeY = this.pixelConfig?.stripeY ?? (this.system === "snes" ? 110 : Math.floor(this.displayH * 0.04));
    const stripeH = this.pixelConfig?.stripeH ?? (this.system === "snes" ? 24 : 10);

    try {
      this.healthFfmpeg = spawn("ffmpeg", [
        "-f", "x11grab",
        "-framerate", "2",
        "-video_size", `${this.displayW}x${stripeH}`,
        "-i", `${this.display}.0+0,${stripeY}`,
        "-f", "rawvideo",
        "-pix_fmt", "rgb24",
        "-loglevel", "quiet",
        "pipe:1",
      ], {
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, DISPLAY: this.display },
      });

      this.healthFfmpeg.stdout?.on("data", (chunk: Buffer) => {
        this.healthFrameBuf = Buffer.concat([this.healthFrameBuf, chunk]);
        const frameSize = this.displayW * stripeH * 3; // RGB = 3 bytes/pixel
        while (this.healthFrameBuf.length >= frameSize) {
          const frame = this.healthFrameBuf.subarray(0, frameSize);
          this.healthFrameBuf = this.healthFrameBuf.subarray(frameSize);
          this.analyzeHealthFrame(frame, this.displayW, stripeH);
        }
        // Safety: prevent unbounded buffer growth
        if (this.healthFrameBuf.length > frameSize * 3) {
          this.healthFrameBuf = Buffer.alloc(0);
        }
      });

      this.healthFfmpeg.on("error", (err) => {
        if (this.healthPollErrorCount < 3) {
          console.warn("[game-runner] 🧠 Health bar ffmpeg error:", err.message);
        }
        this.healthPollErrorCount++;
      });

      console.log(`[game-runner] 🧠 Health bar capture started: ${this.displayW}x${stripeH} at y=${stripeY}`);
    } catch (err) {
      console.warn("[game-runner] 🧠 Failed to start health bar capture:", err);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  //  UDP-based health reader (direct RetroArch core memory access)
  // ─────────────────────────────────────────────────────────────────

  /** Start polling RetroArch core memory via UDP for exact health values.
   *  Reads both players in a single READ_CORE_RAM command (P1=0x8238, P2=0x8438, 512 bytes apart).
   *  RetroArch Network Commands UDP protocol — far more reliable than pixel analysis. */
  private startMemoryHealthReader(): void {
    // Guard 1: if the runner was stopped (e.g. during async setup), don't start.
    if (this.stopRequested) {
      console.log(`[game-runner] R${this.runnerId} 🧠 UDP health reader skipped — runner was stopped`);
      return;
    }
    // Guard 2: prevent duplicate UDP readers (can happen if called again before cleanup,
    // or if RetroArch crashes and a new runner inherits a leaked socket on the same port).
    if (this.healthUdp) {
      console.log(`[game-runner] R${this.runnerId} 🧠 UDP health reader already active — skipping duplicate start`);
      return;
    }

    this.readerInstance++;
    this.readerTag = `R${this.runnerId}.${this.readerInstance}`;
    const map = this.healthMemMap!;
    const maxHealth = map.maxHealth;
    // Read a single chunk covering the lowest to highest address (health, chars, timer).
    const allAddrs = [map.p1, map.p2, map.timer, map.timerAlt, map.p1Char, map.p2Char, map.p1Mode, map.p2Mode];
    if (map.altChars) allAddrs.push(...map.altChars);
    if (map.teamSlots) allAddrs.push(...map.teamSlots);
    if (map.p1Active != null) allAddrs.push(map.p1Active);
    if (map.p2Active != null) allAddrs.push(map.p2Active);
    // Add discovered team roster addresses (cover up to the highest slot offset)
    if (map.p1TeamBase != null) { const offs = map.p1TeamOffsets ?? [0, 2]; allAddrs.push(map.p1TeamBase + Math.min(...offs)); allAddrs.push(map.p1TeamBase + Math.max(...offs)); }
    if (map.p2TeamBase != null) { const offs = map.p2TeamOffsets ?? [0, 2]; allAddrs.push(map.p2TeamBase + Math.min(...offs)); allAddrs.push(map.p2TeamBase + Math.max(...offs)); }
    if (map.matchFlag != null) allAddrs.push(map.matchFlag);
    if (map.p1Lost != null) allAddrs.push(map.p1Lost);
    if (map.p2Lost != null) allAddrs.push(map.p2Lost);
    const minAddr = Math.min(...allAddrs);
    const maxAddr = Math.max(...allAddrs);
    const chunkSize = maxAddr + 2 - minAddr; // +2: timer is 16-bit (needs A83A + A83B)
    const p1Offset = (map.p1 - minAddr) * 2;
    const p2Offset = (map.p2 - minAddr) * 2;
    const timerOffset = (map.timer - minAddr) * 2;
    const timerAltOffset = (map.timerAlt - minAddr) * 2;
    const p1CharOffset = (map.p1Char - minAddr) * 2;
    const p2CharOffset = (map.p2Char - minAddr) * 2;
    const p1ModeOffset = (map.p1Mode - minAddr) * 2;
    const p2ModeOffset = (map.p2Mode - minAddr) * 2;
    const p1TeamOff = map.p1TeamBase != null ? (map.p1TeamBase - minAddr) * 2 : -1;
    const p2TeamOff = map.p2TeamBase != null ? (map.p2TeamBase - minAddr) * 2 : -1;
    const p1SlotOffs = map.p1TeamOffsets ?? [0, 1, 2];
    const p2SlotOffs = map.p2TeamOffsets ?? [0, 1, 2];
    const matchFlagOff = map.matchFlag != null ? (map.matchFlag - minAddr) * 2 : -1;
    const p1ActiveOff = map.p1Active != null ? (map.p1Active - minAddr) * 2 : -1;
    const p2ActiveOff = map.p2Active != null ? (map.p2Active - minAddr) * 2 : -1;
    const p1LostOff = map.p1Lost != null ? (map.p1Lost - minAddr) * 2 : -1;
    const p2LostOff = map.p2Lost != null ? (map.p2Lost - minAddr) * 2 : -1;
    let responseBuf = "";
    let successCount = 0;
    let timeoutCount = 0;

    this.healthUdp = createSocket("udp4");

    this.healthUdp.on("message", (msg: Buffer) => {
      responseBuf += msg.toString();
      const lines = responseBuf.split("\n");
      responseBuf = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.trim().split(/\s+/);

        // GET_STATUS reply: "GET_STATUS <PLAYING|PAUSED|CONTENTLESS> <core>,<game>,...".
        // Handle before the length guard (CONTENTLESS replies are only 2 tokens) and settle
        // any pending pause-state queries. Reusing this proven socket avoids the ephemeral-
        // socket packet drops that made GET_STATUS unreliable under event-loop load.
        if (parts[0] === "GET_STATUS") {
          const st = parts[1];
          const val = (st === "PLAYING" || st === "PAUSED" || st === "CONTENTLESS") ? st : null;
          const resolvers = this.pendingStatusResolvers;
          this.pendingStatusResolvers = [];
          for (const r of resolvers) r(val);
          continue;
        }

        if (parts.length < 3) continue;

        const command = parts[0];
        if (command !== "READ_CORE_RAM" && command !== "READ_CORE_MEMORY") continue;

        const rspAddr = parseInt(parts[1], 16);
        const hexBytes = parts.slice(2).join("");
        if (hexBytes === "-1") continue; // read failed

        if (rspAddr !== minAddr && rspAddr !== map.timer) {
          // Unexpected address — might be a timeout retry response
          continue;
        }

        // Handle the separate fast timer-only response (2 bytes at map.timer)
        if (rspAddr === map.timer) {
          if (hexBytes.length >= 4) {
            const tLo = parseInt(hexBytes.substring(0, 2), 16);
            const tHi = parseInt(hexBytes.substring(2, 4), 16);
            this.memTimer16 = tLo | (tHi << 8);
            this.memTimer = tLo;
            this.prevTimer16 = this.memTimer16;
            timerPollCount++;
            if (DEBUG_RAM && (timerPollCount <= 3 || timerPollCount % 30 === 0)) {
              console.log(`[game-runner] ${this.readerTag} ⏱️ timer-only poll #${timerPollCount}: A83A=${this.memTimer} 16bit=${this.memTimer16}`);
            }
          }
          continue;
        }

        // Parse health, character, mode, and timer values from the chunk response
        const p1Hex = hexBytes.substring(p1Offset, p1Offset + 2);
        const p2Hex = hexBytes.substring(p2Offset, p2Offset + 2);
        const timerHex = hexBytes.substring(timerOffset, timerOffset + 2);
        const timerHexHi = hexBytes.substring(timerOffset + 2, timerOffset + 4); // high byte at A83B
        const timerAltHex = hexBytes.substring(timerAltOffset, timerAltOffset + 2);
        const p1CharHex = hexBytes.substring(p1CharOffset, p1CharOffset + 2);
        const p2CharHex = hexBytes.substring(p2CharOffset, p2CharOffset + 2);
        const p1ModeHex = hexBytes.substring(p1ModeOffset, p1ModeOffset + 2);
        const p2ModeHex = hexBytes.substring(p2ModeOffset, p2ModeOffset + 2);

        if (p1Hex.length === 2 && p2Hex.length === 2) {
          const p1Raw = parseInt(p1Hex, 16);
          const p2Raw = parseInt(p2Hex, 16);
          this.memHealthP1 = Math.min(100, Math.round((p1Raw / maxHealth) * 100));
          this.memHealthP2 = Math.min(100, Math.round((p2Raw / maxHealth) * 100));
          this.memTimer = parseInt(timerHex, 16);
          this.memTimer16 = parseInt(timerHex, 16) | (parseInt(timerHexHi, 16) << 8); // 16-bit LE: A83A | A83B<<8
          this.memTimerAlt = parseInt(timerAltHex, 16);
          this.memP1Char = parseInt(p1CharHex, 16);
          this.memP2Char = parseInt(p2CharHex, 16);
          this.memP1Mode = parseInt(p1ModeHex, 16);
          this.memP2Mode = parseInt(p2ModeHex, 16);
          // Match state flag (0x00 = char select, 0x40+ = in combat / round transition)
          if (matchFlagOff >= 0) {
            this.memMatchFlag = parseInt(hexBytes.substring(matchFlagOff, matchFlagOff + 2), 16);
          }
          // Debounce: track how long matchFlag has been sustained at 0x00. A real
          // new-match char-select holds 0x00 for seconds; a mid-match round
          // transition only blips through 0x00 for 1-2 polls.
          this.matchFlagZeroStreak = this.memMatchFlag === 0x00 ? this.matchFlagZeroStreak + 1 : 0;
          // Active (currently-fighting) character ID at 0x8256 (P1) / 0x8456 (P2).
          if (p1ActiveOff >= 0) this.memP1Active = parseInt(hexBytes.substring(p1ActiveOff, p1ActiveOff + 2), 16);
          if (p2ActiveOff >= 0) this.memP2Active = parseInt(hexBytes.substring(p2ActiveOff, p2ActiveOff + 2), 16);
          // Authoritative per-player "characters lost" counters (0xA859 P1 / 0xA868 P2).
          if (p1LostOff >= 0) this.memP1Lost = parseInt(hexBytes.substring(p1LostOff, p1LostOff + 2), 16);
          if (p2LostOff >= 0) this.memP2Lost = parseInt(hexBytes.substring(p2LostOff, p2LostOff + 2), 16);
          // Selection order: prefer the authoritative RAM pick-order buffer (captured once below).
          // Until that succeeds, fall back to appending each newly-seen active char in the order it
          // enters the fight (first = 1st pick). Disabled once the RAM order is captured so it can't
          // pollute the real order with a noisy active-char read.
          const steadyCombat = this.memMatchFlag === 0x40 || this.memMatchFlag === 0x48;
          if (steadyCombat && !this.pickOrderCaptured) {
            const track = (active: number, order: number[], locked: number[] | null) => {
              if (active < 0x00 || active > 0x25) return;
              if (locked && !locked.includes(active)) return; // ignore noise not in the team
              if (!order.includes(active)) order.push(active);
            };
            track(this.memP1Active, this.p1SelectOrder, this.p1LockedTeam);
            track(this.memP2Active, this.p2SelectOrder, this.p2LockedTeam);
          }
          // Parse discovered team slots. Members sit at irregular byte offsets from the base
          // (with a 0x00 separator between them), so read each slot by its configured offset.
          const parseSlots = (baseOff: number, slotOffs: number[]): number[] | null => {
            if (baseOff < 0) return null;
            const slots = slotOffs.map(so => parseInt(hexBytes.substring(baseOff + so * 2, baseOff + so * 2 + 2), 16));
            return slots.some(v => Number.isNaN(v)) ? null : slots;
          };
          const p1Slots = parseSlots(p1TeamOff, p1SlotOffs);
          const p2Slots = parseSlots(p2TeamOff, p2SlotOffs);
          if (p1Slots) this.p1TeamSlots = p1Slots;
          if (p2Slots) this.p2TeamSlots = p2Slots;
          // Lock each team ONCE from a stable char-select read (matchFlag==0, all 3 slots valid).
          // The 0xA847/0xA85E region is only reliable in char select; it gets repurposed at round
          // transitions/KOs, so we freeze the roster here and ignore later reads (kills false positives
          // like the phantom "Terry Bogard" the old seen-set accumulator picked up).
          const validTeam = (t: number[] | null): t is number[] =>
            t != null && t.every(id => id >= 0x00 && id <= 0x25);
          // NOTE: re-arming match scoring for a same-session rematch is now EXPLICIT
          // (GameRunner.beginRematch(), called by ws-handler on rematch_accept). The old
          // auto "new match char-select detected" reset used to fire here on the post-match
          // attract/DEMO screen (matchFlag==0x00 with random CPU teams) and made the detector
          // score the demo as a real match (phantom roundResult/matchEnd). The game is now
          // paused on match end, so no demo runs and no implicit reset is needed.
          //
          // STOPGAP anti-demo: if the game reaches a SUSTAINED char-select (matchFlag 0x00)
          // while a match was in progress (teamFrozen) but was NOT cleanly ended (matchEnded
          // still false — e.g. a draw the health detector missed), the real match is over and
          // the game is about to run its attract DEMO. Freeze the detector and pause so the
          // demo can't be scored as phantom rounds. A real rematch clears this via beginRematch().
          const ATTRACT_ZERO_STREAK = 8; // ~2s at 250ms polls; mid-match round blips last 1-2 polls
          // Only treat a SUSTAINED char-select as post-match ATTRACT when the match had
          // actually progressed to the brink of ending. A match ends at 3 losses, so a MISSED
          // clean end (exactly the case this stopgap covers) still leaves the loser at ≥2 recorded
          // losses. Firing at a low score — e.g. a round-1 time-over DRAW at full health that
          // briefly drops matchFlag to 0x00 — is a false positive that PAUSED and froze a live
          // game (user: "après un draw le jeu se fige même au 1er round"). Require near-match-end.
          const nearMatchEnd = Math.max(this.p1Losses, this.p2Losses) >= 2;
          // The loss-counter path (kof98) detects match end AUTHORITATIVELY (processLossCounters
          // sets matchEnded at 3 losses) and ws-handler pauses the emulator on matchEnd, so this
          // stopgap is redundant there. Worse: a KOF98 DRAW triggers a round REPLAY whose loading
          // holds matchFlag 0x00 for many polls at a mid-match score >= 2, which this stopgap
          // mis-read as post-match attract → it froze a LIVE match after a draw (no matchEnd, no
          // overlay — user: "R3 fini, l'overlay s'affiche pas"). Disable it when loss counters run.
          const usesLossCounters = this.healthMemMap?.p1Lost != null;
          if (!usesLossCounters && !this.detectionFrozen && this.teamFrozen && !this.matchEnded && nearMatchEnd &&
              this.memMatchFlag === 0x00 && this.matchFlagZeroStreak >= ATTRACT_ZERO_STREAK) {
            this.detectionFrozen = true;
            this.pause();
            console.log(`[game-runner] ${this.readerTag} 🛑 Post-match attract detected (no clean matchEnd) — froze detector + paused to block demo scoring. Score was P1=${this.p1Losses} P2=${this.p2Losses}`);
          }
          // The roster is reliable in char select (0x00) AND steady combat (0x40). The 0xA85E P2
          // region only settles to the real picks once combat starts, so keep refreshing through
          // steady combat (last-valid-wins), then freeze at the first round transition/KO
          // (matchFlag becomes 0x42/0x04/etc.) when the region is repurposed and goes noisy —
          // that freeze kills the false positives the old seen-set accumulator picked up.
          if (!this.teamFrozen) {
            const steady = this.memMatchFlag === 0x00 || this.memMatchFlag === 0x40;
            if (steady) {
              if (validTeam(p1Slots)) this.p1LockedTeam = p1Slots.slice();
              if (validTeam(p2Slots)) this.p2LockedTeam = p2Slots.slice();
            } else if (this.memMatchFlag !== 0 && (this.p1LockedTeam || this.p2LockedTeam)) {
              this.teamFrozen = true;
              const fmt = (t: number[] | null) => t ? t.map(id => KOF98_CHARACTERS[id] || `0x${id.toString(16)}`).join(" | ") : "?";
              console.log(`[game-runner] ${this.readerTag} 🔒 Teams frozen at round transition (flag=0x${this.memMatchFlag.toString(16)}): P1=[${fmt(this.p1LockedTeam)}] P2=[${fmt(this.p2LockedTeam)}]`);
            }
          }
          // Capture the REAL selection order once, from the RAM pick-order buffer (reliable in
          // steady combat 0x40). Fire-and-forget with an in-flight guard so it retries each poll
          // until it lands a clean read, then latches (pickOrderCaptured) and stops.
          if (!this.pickOrderCaptured && !this.pickOrderInFlight && this.memMatchFlag === 0x40 &&
              validTeam(this.p1LockedTeam) && validTeam(this.p2LockedTeam)) {
            this.pickOrderInFlight = true;
            void this.capturePickOrders().finally(() => { this.pickOrderInFlight = false; });
          }
          successCount++;
          timeoutCount = 0;
          // Trigger team roster scan during character select phase:
          // timer 16-bit in 45-85 range, health showing garbage (>80%), indicating "How to Play" or char select
          if (!this.rosterScanned && this.memTimer16 >= 45 && this.memTimer16 <= 85 && this.memHealthP1 >= 80) {
            this.rosterScanned = true;
            console.log(`[game-runner] ${this.readerTag} 🔬 Char select detected (timer16=${this.memTimer16}, health=${this.memHealthP1}%) — starting roster scan`);
            this.scanTeamRoster();
          }
          this.processHealthFrame();

          // ── Live match-state event (throttled ~500ms) ──
          // Push the current teams, active chars, gauge mode and health to the browser so the
          // in-match HUD updates live. Data is already fresh here (values updated above +
          // processHealthFrame). ws-handler forwards this as a "match_state" WebSocket message.
          if (Date.now() - this.lastMatchStateEmit >= 500) {
            this.lastMatchStateEmit = Date.now();
            const ci = this.charInfo();
            this.emit("matchState", {
              p1Team: ci.p1Team,
              p2Team: ci.p2Team,
              p1Active: this.memP1Active,
              p2Active: this.memP2Active,
              p1Mode: this.memP1Mode === 1 ? "ADVANCED" : "EXTRA",
              p2Mode: this.memP2Mode === 1 ? "ADVANCED" : "EXTRA",
              p1Health: this.memHealthP1,
              p2Health: this.memHealthP2,
              matchFlag: this.memMatchFlag,
              gameStarted: this.gameStarted,
            });
          }

          // Verbose logging for first 100 reads (25s) to capture ephemeral team data during char select
          if (DEBUG_RAM && (successCount <= 100 || successCount % 30 === 0)) {
            const p1Name = KOF98_CHARACTERS[this.memP1Char] || "?";
            const p2Name = KOF98_CHARACTERS[this.memP2Char] || "?";
            const p1Mode = this.memP1Mode === 1 ? "ADVANCED" : "EXTRA";
            const p2Mode = this.memP2Mode === 1 ? "ADVANCED" : "EXTRA";
            const p1LockStr = this.p1LockedTeam ? this.p1LockedTeam.map(c => KOF98_CHARACTERS[c] || `0x${c.toString(16)}`).join(",") : "unlocked";
            const p2LockStr = this.p2LockedTeam ? this.p2LockedTeam.map(c => KOF98_CHARACTERS[c] || `0x${c.toString(16)}`).join(",") : "unlocked";
            // Show discovered team slots from roster area
            const p1SlotStr = this.p1TeamSlots.length === 3 ? this.p1TeamSlots.map(id => KOF98_CHARACTERS[id] || `0x${id.toString(16)}`).join("|") : "?";
            const p2SlotStr = this.p2TeamSlots.length === 3 ? this.p2TeamSlots.map(id => KOF98_CHARACTERS[id] || `0x${id.toString(16)}`).join("|") : "?";
            // Log alternative character addresses for debugging
            let altStr = "";
            if (map.altChars) {
              const altOffsets = map.altChars.map(a => (a - minAddr) * 2);
              const altVals = altOffsets.map(off => {
                const h = hexBytes.substring(off, off + 2);
                if (h.length !== 2) return "??";
                const id = parseInt(h, 16);
                return `0x${id.toString(16).padStart(2,"0")}=${KOF98_CHARACTERS[id] || "?"}`;
              });
              altStr = ` | alt: 8223=${altVals[0]} 8227=${altVals[1]} 8423=${altVals[2]} 8427=${altVals[3]}`;
            }
            // Team slot values — read from memory if teamSlots configured
            let teamStr = "";
            if (map.teamSlots) {
              const tOffsets = map.teamSlots.map(a => (a - minAddr) * 2);
              const tVals = tOffsets.map(off => {
                const h = hexBytes.substring(off, off + 2);
                if (h.length !== 2) return "??";
                return `0x${parseInt(h, 16).toString(16).padStart(2,"0")}`;
              });
              teamStr = ` | team: 81E3=${tVals[3]} 81E4=${tVals[4]} 81E5=${tVals[5]} 81E6=${tVals[6]} 81ED=${tVals[7]} | 83E3=${tVals[11]} 83E4=${tVals[12]} 83E5=${tVals[13]} 83E6=${tVals[14]} 83ED=${tVals[15]}`;
            }
            // Hex dump of P1 team roster + char area and P2 area — always show first 100 + every 30th
            let hexDump = "";
            if (successCount <= 100 || successCount % 30 === 0) {
              // P1 team roster area: start from minAddr (0x81E0) to capture 0x81E3 slot
              const p1TeamStart = minAddr, p1TeamEnd = 0x8200;
              const p1TeamOff = (p1TeamStart - minAddr) * 2;
              const p1TeamEndOff = (p1TeamEnd - minAddr) * 2;
              if (p1TeamOff >= 0 && p1TeamEndOff <= hexBytes.length) {
                let p1TeamStr = "";
                for (let off = p1TeamOff; off < p1TeamEndOff; off += 2) {
                  p1TeamStr += hexBytes.substring(off, off + 2) + " ";
                }
                hexDump += ` | P1 ${p1TeamStart.toString(16)}-8200: ${p1TeamStr.trim()}`;
              }
              // P2 team roster area 0x83E0-0x8400
              const p2TeamStart = 0x83E0, p2TeamEnd = 0x8400;
              const p2TeamOff = (p2TeamStart - minAddr) * 2;
              const p2TeamEndOff = (p2TeamEnd - minAddr) * 2;
              if (p2TeamOff >= 0 && p2TeamEndOff <= hexBytes.length) {
                let p2TeamStr = "";
                for (let off = p2TeamOff; off < p2TeamEndOff; off += 2) {
                  p2TeamStr += hexBytes.substring(off, off + 2) + " ";
                }
                hexDump += ` | P2 83E0-8400: ${p2TeamStr.trim()}`;
              }
            }
            const nmC = (id: number) => KOF98_CHARACTERS[id] || `0x${id.toString(16)}`;
            const p1ActiveStr = this.memP1Active >= 0 ? nmC(this.memP1Active) : "?";
            const p2ActiveStr = this.memP2Active >= 0 ? nmC(this.memP2Active) : "?";
            const p1OrderStr = this.p1SelectOrder.length ? this.p1SelectOrder.map(nmC).join(">") : "?";
            const p2OrderStr = this.p2SelectOrder.length ? this.p2SelectOrder.map(nmC).join(">") : "?";
            console.log(`[game-runner] ${this.readerTag} 🧠 UDP read #${successCount}: P1=${this.memHealthP1}% ${p1Name}(${p1Mode}) P2=${this.memHealthP2}% ${p2Name}(${p2Mode}) ⏱️A83A=${this.memTimer}(16b=${this.memTimer16}) 85D2=${this.memTimerAlt} matchFlag=${this.memMatchFlag.toString(16)} | active: P1=${p1ActiveStr} P2=${p2ActiveStr} | order: P1=${p1OrderStr} P2=${p2OrderStr} | slots: P1=[${p1SlotStr}] P2=[${p2SlotStr}] | locked: P1=[${p1LockStr}] P2=[${p2LockStr}]${altStr}${teamStr}${hexDump}`);
          }
        }
      }
    });

    this.healthUdp.on("error", (err) => {
      if (this.healthPollErrorCount < 3) {
        console.warn("[game-runner] 🧠 UDP health read error:", err.message);
      }
      this.healthPollErrorCount++;
    });

    // Poll: single read covering the full range (minAddr to maxAddr+size)
    const poll = () => {
      if (!this.running || !this.healthUdp) return;
      const cmd = Buffer.from(`READ_CORE_RAM ${minAddr.toString(16)} ${chunkSize}\n`);
      this.healthUdp!.send(cmd, RA_CMD_PORT, "127.0.0.1");
    };

    // Quick timer-only poll: read just 2 bytes at the timer address for reliability.
    // The large chunk read (9KB) can catch mid-frame values during the 10ms transfer.
    let timerPollCount = 0;
    const timerPoll = () => {
      if (!this.running || !this.healthUdp) return;
      const cmd = Buffer.from(`READ_CORE_RAM ${map.timer.toString(16)} 2\n`);
      this.healthUdp!.send(cmd, RA_CMD_PORT, "127.0.0.1");
    };

    // Timeout watchdog: if no response in 2s, just keep polling
    const watchdog = () => {
      if (!this.running) return;
      timeoutCount++;
      if (timeoutCount <= 3 || timeoutCount % 15 === 0) {
        console.log(`[game-runner] 🧠 UDP timeout #${timeoutCount} (no response from RetroArch in 2s)`);
      }
    };

    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    this.healthUdp.on("message", () => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      watchdogTimer = setTimeout(watchdog, 2000);
    });

    // Poll every 250ms (4 reads/sec — single command is faster)
    this.healthReadTimer = setInterval(() => {
      if (this.running && this.healthUdp) { poll(); timerPoll(); }
    }, 250);

    poll();
    timerPoll();
    watchdogTimer = setTimeout(watchdog, 2000);

    console.log(`[game-runner] ${this.readerTag} 🧠 UDP health reader: ${this.rom} P1=0x${map.p1.toString(16)} P2=0x${map.p2.toString(16)} max=0x${maxHealth.toString(16)} (single-shot READ_CORE_RAM ${chunkSize} bytes)`);
  }

  /** One-time scan of team roster memory. Called when combat first starts (KO detection armed).
   *  Searches for consecutive 3-byte sequences matching known character IDs across a wide range. */
  private scanTeamRoster(): void {
    if (!this.running || !this.healthUdp) return;

    // Full scan of entire accessible RAM: 0x0000-0xFFFF in 256-byte chunks
    const SCAN_REGIONS = [
      { start: 0x0000, end: 0x8000 }, // lower RAM
      { start: 0x8000, end: 0xAC00 }, // upper RAM (health/chars/timer area)
    ];
    const CHUNK = 256;

    const rosterUdp = createSocket("udp4");
    const rosterData: Map<number, Buffer> = new Map();
    let receivedChunks = 0;
    let sentChunks = 0;
    let responseBuf = ""; // accumulator for split UDP packets

    const processResults = () => {
      rosterUdp.close();

      // Search each chunk independently for 3+ consecutive valid char IDs
      const allChars = new Set([0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x08,0x09,0x0A,0x0B,0x0C,0x0D,0x0E,0x0F,0x10,0x11,0x12,0x13,0x14,0x15,0x16,0x17,0x18,0x19,0x1A,0x1B,0x1C,0x1D,0x1E,0x1F,0x20,0x21,0x22,0x23,0x24,0x25]);

      // Find all positions with 3+ consecutive valid char IDs (excluding all-Kyo = likely empty)
      const triplets: { addr: number; ids: number[]; names: string[] }[] = [];
      for (const [baseAddr, buf] of rosterData) {
        for (let i = 0; i < buf.length - 2; i++) {
          const a = buf[i], b = buf[i+1], c = buf[i+2];
          if (allChars.has(a) && allChars.has(b) && allChars.has(c) &&
              !(a === 0x00 && b === 0x00 && c === 0x00)) {
            triplets.push({
              addr: baseAddr + i,
              ids: [a, b, c],
              names: [KOF98_CHARACTERS[a]||"?", KOF98_CHARACTERS[b]||"?", KOF98_CHARACTERS[c]||"?"],
            });
          }
        }
      }

      if (triplets.length > 0) {
        const sorted = [...rosterData.keys()].sort((a,b) => a-b);
        const minA = sorted[0] ?? 0;
        const maxA = (sorted[sorted.length-1] ?? 0) + CHUNK;
        console.log(`[game-runner] ${this.readerTag} 🔬 Team roster scan: ${triplets.length} potential triples across 0x${minA.toString(16)}-0x${maxA.toString(16)}`);
        // Show unique ones, deduped by content
        const seen = new Set<string>();
        for (const t of triplets) {
          const key = t.ids.join(",");
          if (!seen.has(key)) {
            seen.add(key);
            console.log(`[game-runner] ${this.readerTag} 🔬   0x${t.addr.toString(16).padStart(4,"0")}: ${t.ids.map(id=>"0x"+id.toString(16).padStart(2,"0")).join(" ")} = [${t.names.join(", ")}]`);
          }
        }
      } else {
        console.log(`[game-runner] ${this.readerTag} 🔬 Team roster scan: no valid triples found (${rosterData.size} chunks received)`);
      }

      // Dump first chunk for manual analysis
      const firstAddr = [...rosterData.keys()].sort((a,b) => a-b)[0];
      if (firstAddr !== undefined) {
        const dump = rosterData.get(firstAddr)!;
        const dumpLines: string[] = [];
        for (let i = 0; i < dump.length; i += 32) {
          const offset = i;
          const hex = [...dump.slice(i, Math.min(i+32, dump.length))].map(b => b.toString(16).padStart(2, "0")).join(" ");
          dumpLines.push(`  ${(firstAddr + offset).toString(16).padStart(4, "0")}: ${hex}`);
        }
        console.log(`[game-runner] ${this.readerTag} 🔬 Raw dump at 0x${firstAddr.toString(16)}:\n${dumpLines.join("\n")}`);
      }
    };

    // Timeout: if we don't get all responses in 5s, process what we have
    const scanTimeout = setTimeout(() => {
      console.log(`[game-runner] ${this.readerTag} 🔬 Roster scan timeout: ${receivedChunks}/${sentChunks} chunks received — processing partial results`);
      processResults();
    }, 5000);

    rosterUdp.on("message", (msg: Buffer) => {
      responseBuf += msg.toString();
      const lines = responseBuf.split("\n");
      responseBuf = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length < 3) continue;
        if (parts[0] !== "READ_CORE_RAM") continue;
        const rspAddr = parseInt(parts[1], 16);
        const hexBytes = parts.slice(2).join("");
        if (hexBytes === "-1") continue;
        try {
          rosterData.set(rspAddr, Buffer.from(hexBytes, "hex"));
          receivedChunks++;
        } catch { /* skip malformed hex */ }
      }

      if (receivedChunks >= sentChunks) {
        clearTimeout(scanTimeout);
        processResults();
      }
    });

    rosterUdp.on("error", (err: any) => {
      console.warn(`[game-runner] ${this.readerTag} 🔬 Roster scan UDP error:`, err.message);
      clearTimeout(scanTimeout);
      rosterUdp.close();
    });

    // Send all chunk requests
    for (const region of SCAN_REGIONS) {
      for (let addr = region.start; addr < region.end; addr += CHUNK) {
        const size = Math.min(CHUNK, region.end - addr);
        const cmd = Buffer.from(`READ_CORE_RAM ${addr.toString(16)} ${size}\n`);
        rosterUdp.send(cmd, RA_CMD_PORT, "127.0.0.1");
        sentChunks++;
      }
    }
    console.log(`[game-runner] ${this.readerTag} 🔬 Roster scan: requesting ${sentChunks} chunks across ${SCAN_REGIONS.length} regions...`);
  }

  /** Diagnostic RAM scanner — runs once at game start to discover memory addresses.
   *  Reads work RAM region in chunks, comparing values across time to find:
   *  - Timer (decrementing byte each second)
   *  - Character IDs (stable 0-38 values)
   *  - Mode flags (stable 0/1 values)
   */
  runMemoryDiagnostic(): void {
    if (!this.healthMemMap) {
      console.log("[game-runner] 🔬 Memory diagnostic skipped — no memory map");
      return;
    }

    const SCAN_START = 0xA800;
    const SCAN_END = 0xA900;
    const CHUNK_SIZE = 256; // read 256 bytes at a time
    const READ_INTERVAL_MS = 1000; // 1s between reads
    const NUM_SNAPSHOTS = 4; // take 4 snapshots over 4 seconds

    console.log(`[game-runner] 🔬 Memory diagnostic starting: 0x${SCAN_START.toString(16)}-0x${SCAN_END.toString(16)} (${SCAN_END - SCAN_START} bytes, ${NUM_SNAPSHOTS} snapshots at ${READ_INTERVAL_MS}ms)`);

    const snapshots: Map<number, Buffer>[] = [];

    const udp = createSocket("udp4");
    let readCount = 0;
    const allData: Map<number, Buffer> = new Map(); // address → buffer of bytes

    udp.on("message", (msg: Buffer) => {
      const response = msg.toString();
      const lines = response.split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length < 3) continue;
        if (parts[0] !== "READ_CORE_RAM" && parts[0] !== "READ_CORE_MEMORY") continue;

        const rspAddr = parseInt(parts[1], 16);
        const hexBytes = parts.slice(2).join("");
        if (hexBytes === "-1") continue;

        // Store the chunk
        const buf = Buffer.from(hexBytes, "hex");
        allData.set(rspAddr, buf);
        readCount++;

        if (readCount >= (SCAN_END - SCAN_START) / CHUNK_SIZE) {
          // Got all chunks for this snapshot
          const snapshot = new Map(allData);
          snapshots.push(snapshot);
          allData.clear();
          readCount = 0;

          if (snapshots.length >= NUM_SNAPSHOTS) {
            // All snapshots collected — analyze
            udp.close();
            this.analyzeDiagnosticData(snapshots, SCAN_START, SCAN_END);
          } else {
            // Schedule next snapshot
            setTimeout(() => this.requestDiagnosticChunks(udp, SCAN_START, SCAN_END, CHUNK_SIZE), READ_INTERVAL_MS);
          }
        }
      }
    });

    udp.on("error", (err) => {
      console.warn("[game-runner] 🔬 Diagnostic UDP error:", err.message);
      udp.close();
    });

    // Kick off first snapshot
    this.requestDiagnosticChunks(udp, SCAN_START, SCAN_END, CHUNK_SIZE);
  }

  private requestDiagnosticChunks(udp: Socket, start: number, end: number, chunkSize: number): void {
    for (let addr = start; addr < end; addr += chunkSize) {
      const size = Math.min(chunkSize, end - addr);
      const cmd = Buffer.from(`READ_CORE_RAM ${addr.toString(16)} ${size}\n`);
      udp.send(cmd, RA_CMD_PORT, "127.0.0.1");
    }
  }

  private analyzeDiagnosticData(snapshots: Map<number, Buffer>[], scanStart: number, scanEnd: number): void {
    console.log(`[game-runner] 🔬 === MEMORY DIAGNOSTIC RESULTS ===`);
    console.log(`[game-runner] 🔬 Scan range: 0x${scanStart.toString(16)}-0x${scanEnd.toString(16)}`);

    const timerCandidates: { addr: number; values: number[] }[] = [];
    const charIdCandidates: { addr: number; values: number[] }[] = [];
    const modeFlagCandidates: { addr: number; values: number[] }[] = [];
    const volatileAddrs: Set<number> = new Set();

    // For each byte address in the scanned range
    for (let addr = scanStart; addr < scanEnd; addr++) {
      const values: number[] = [];
      for (const snap of snapshots) {
        // Find which chunk contains this address
        const chunkStart = addr - (addr % 256); // we used 256-byte chunks
        const chunk = snap.get(chunkStart);
        if (chunk) {
          const offset = addr - chunkStart;
          if (offset < chunk.length) {
            values.push(chunk[offset] ?? 0);
          }
        }
      }

      if (values.length < 2) continue;
      const allSame = values.every(v => v === values[0]);
      const isDecrementing = values.length >= 3 &&
        values[0] > values[1] &&
        values[1] >= values[2] &&
        (values[0] - values[1]) <= 2; // tick by 1-2 per second

      // Timer: counts down 1-2 per second, starts between 30-99
      if (isDecrementing && values[0] >= 30 && values[0] <= 99) {
        timerCandidates.push({ addr, values });
      }

      // Character IDs (KOF '98): stable values 0-38
      if (allSame && values[0] >= 1 && values[0] <= 38) {
        charIdCandidates.push({ addr, values });
      }

      // Mode flags: stable 0 or 1
      if (allSame && (values[0] === 0 || values[0] === 1)) {
        modeFlagCandidates.push({ addr, values });
      }

      // Track volatile addresses (anything that changes)
      if (!allSame) {
        volatileAddrs.add(addr);
      }
    }

    // ── Report ──
    console.log(`[game-runner] 🔬 ⏱️  TIMER candidates (${timerCandidates.length}):`);
    for (const c of timerCandidates.slice(0, 10)) {
      console.log(`[game-runner] 🔬   0x${c.addr.toString(16).padStart(4, '0')}: ${c.values.join(" → ")} (decrementing)`);
    }

    // Group character ID candidates by proximity (chars are usually stored in arrays)
    const charClusters = this.findClusters(charIdCandidates, 8);
    console.log(`[game-runner] 🔬 👤 CHARACTER ID clusters (${charClusters.length} groups):`);
    for (const cluster of charClusters.slice(0, 10)) {
      const addrs = cluster.map(c => `0x${c.addr.toString(16).padStart(4, '0')}=${c.values[0]}`).join(", ");
      console.log(`[game-runner] 🔬   Cluster at 0x${cluster[0].addr.toString(16).padStart(4, '0')}: ${addrs}`);
    }

    // Mode flags near known addresses (0x8200-0x8400 range)
    const modeNearHealth = modeFlagCandidates.filter(c => c.addr >= 0x8200 && c.addr <= 0x8400);
    console.log(`[game-runner] 🔬 ⚙️  MODE flag candidates near health region (${modeNearHealth.length}):`);
    for (const c of modeNearHealth.slice(0, 10)) {
      const modeName = c.values[0] === 0 ? "ADVANCED?" : "EXTRA?";
      console.log(`[game-runner] 🔬   0x${c.addr.toString(16).padStart(4, '0')}: ${c.values[0]} (${modeName})`);
    }

    // Top volatile addresses (most likely game state)
    const volatileSorted = Array.from(volatileAddrs).sort((a, b) => a - b);
    console.log(`[game-runner] 🔬 📊 Volatile addresses (${volatileAddrs.size} total, showing first 20):`);
    for (const addr of volatileSorted.slice(0, 20)) {
      const vals = snapshots.map(s => {
        const cs = addr - (addr % 256);
        const chunk = s.get(cs);
        if (!chunk) return "??";
        const off = addr - cs;
        return off < chunk.length ? String(chunk[off] ?? 0) : "??";
      });
      console.log(`[game-runner] 🔬   0x${addr.toString(16).padStart(4, '0')}: ${vals.join(" → ")}`);
    }

    console.log(`[game-runner] 🔬 === END DIAGNOSTIC ===`);
  }

  /** Group nearby addresses (within `gap` bytes) into clusters. */
  private findClusters(candidates: { addr: number; values: number[] }[], gap: number): { addr: number; values: number[] }[][] {
    const sorted = [...candidates].sort((a, b) => a.addr - b.addr);
    const clusters: { addr: number; values: number[] }[][] = [];
    let current: { addr: number; values: number[] }[] = [];

    for (const c of sorted) {
      if (current.length === 0 || c.addr - current[current.length - 1].addr <= gap) {
        current.push(c);
      } else {
        if (current.length >= 2) clusters.push(current);
        current = [c];
      }
    }
    if (current.length >= 2) clusters.push(current);
    return clusters;
  }

  /** Feed exact (memory-read) health values into the round/KO detection logic.
   *  Simpler than pixel analysis — values are noise-free. */
  /**
   * Authoritative round-result + match-end detection from the RAM "characters lost" counters
   * (0xA859 P1 / 0xA868 P2, 0→3, draw-inclusive). Discovered + validated 2026-07-10. Replaces the
   * health heuristics for kof98: immune to the wrong time-over winner (health reads the wrong
   * character) and the KOF98 31% draw-replay (same characters keep fighting — not an elimination).
   *
   * Each poll: read both counters; a 1-poll confirmation rejects torn chunk reads; a drop means a
   * new match reset the counters (re-baseline); a rise means a round ended — emit the round result
   * (both rise = DRAW, only p2Lost rise = P1 won, only p1Lost rise = P2 won) and, at 3 losses, the
   * match end (loser = whoever reached 3; both 3 = draw match).
   */
  private processLossCounters(): void {
    const p1Lost = this.memP1Lost;
    const p2Lost = this.memP2Lost;
    // Reject invalid/garbage reads (demo/attract shows 0xff; torn reads out of 0..3).
    if (p1Lost < 0 || p2Lost < 0 || p1Lost > 3 || p2Lost > 3) return;

    // Perfect-KO flag: sample the winner's min health, but ONLY during STABLE combat
    // (matchFlag 0x40/0x48). At the KO/time-over/transition the health address reads the wrong
    // character (garbage), which used to pollute roundMinHealth and made "perfect" unreliable
    // (a real RAM perfect counter doesn't exist — 0xA867/0x2584 were eliminated by cross-match
    // diff, 2026-07-10). Gating out the parasite reads leaves the winner (who took no damage)
    // at ~100% across the whole round → perfect = winner's min-health >= threshold.
    const PERFECT_HEALTH_THRESHOLD = 95;
    if (this.memMatchFlag === 0x40 || this.memMatchFlag === 0x48) {
      const h1 = this.memHealthP1, h2 = this.memHealthP2;
      if (h1 >= 0 && h1 <= 100) this.roundP1MinHealth = Math.min(this.roundP1MinHealth, h1);
      if (h2 >= 0 && h2 <= 100) this.roundP2MinHealth = Math.min(this.roundP2MinHealth, h2);
    }

    // TIME OVER discriminator: the round timer counting from >0 down to exactly 0 means the round
    // ended on the clock, not by a KO. KOF98 resets the timer to full between rounds without passing
    // through 0, so a KO round never trips this. Latches for the whole round (same pattern as the
    // pixel path's time-over check). Only a KO round credits a perfect + a per-character win badge.
    if ((this.memMatchFlag & 0xf0) === 0x40 && this.lcPrevTimer16 > 0 && this.memTimer16 === 0) {
      this.roundTimerHitZero = true;
    }
    if (this.memTimer16 >= 0) this.lcPrevTimer16 = this.memTimer16;

    // 1-poll confirmation: require the value to persist across two consecutive polls before acting,
    // so a single torn/mid-frame chunk read can't fabricate a round.
    const confirmed = p1Lost === this.lastRawP1Lost && p2Lost === this.lastRawP2Lost;
    this.lastRawP1Lost = p1Lost;
    this.lastRawP2Lost = p2Lost;
    if (!confirmed) return;

    // Baseline on first confirmed read.
    if (this.prevP1Lost < 0) {
      this.prevP1Lost = p1Lost; this.prevP2Lost = p2Lost;
      this.p1Losses = p1Lost; this.p2Losses = p2Lost;
      return;
    }
    // New match / reset: counters dropped (char-select zeroes them). Re-baseline, don't score.
    if (p1Lost < this.prevP1Lost || p2Lost < this.prevP2Lost) {
      this.prevP1Lost = p1Lost; this.prevP2Lost = p2Lost;
      this.p1Losses = p1Lost; this.p2Losses = p2Lost;
      return;
    }

    const d1 = p1Lost - this.prevP1Lost; // new P1 characters lost
    const d2 = p2Lost - this.prevP2Lost; // new P2 characters lost
    if (d1 === 0 && d2 === 0) return;     // no round ended

    // A round ended — the RAM counter is authoritative.
    this.prevP1Lost = p1Lost; this.prevP2Lost = p2Lost;
    this.p1Losses = p1Lost; this.p2Losses = p2Lost;
    this.roundNumber++;

    if (d1 > 0 && d2 > 0) {
      // Both lost a character this round → DRAW (double-KO or true time-over tie).
      console.log(`[game-runner] ${this.readerTag} 🧮 DRAW round ${this.roundNumber} (RAM). lost P1=${p1Lost} P2=${p2Lost}`);
      this.emit("roundResult", { loser: 0, winner: 0, p1Losses: p1Lost, p2Losses: p2Lost, koType: "draw", ...this.charInfo() });
    } else if (d2 > 0) {
      // P2 lost a character. A clean KO round (timer > 0) → P1 wins + perfect if untouched. A TIME OVER
      // (incl. DRAW GAME, where KOF98 can still asymmetrically eliminate one side's character) is
      // inconclusive: no per-character win badge, no perfect. The match score already advanced via the
      // authoritative counters, so we only suppress the cosmetic credit.
      if (this.roundTimerHitZero) {
        console.log(`[game-runner] ${this.readerTag} 🧮 Round ${this.roundNumber} TIME OVER (RAM, DRAW GAME) — no win credit, no perfect. lost P1=${p1Lost} P2=${p2Lost}`);
        this.emit("roundResult", { loser: 0, winner: 0, p1Losses: p1Lost, p2Losses: p2Lost, koType: "draw", ...this.charInfo() });
      } else {
        const perfect = this.roundP1MinHealth >= PERFECT_HEALTH_THRESHOLD;
        if (perfect) this.matchPerfectKos++;
        this.creditRoundWin(1);
        console.log(`[game-runner] ${this.readerTag} 🧮 P1 wins round ${this.roundNumber} (RAM, KO${perfect ? ", perfect" : ""}). lost P1=${p1Lost} P2=${p2Lost}`);
        this.emit("roundResult", { loser: 2, winner: 1, p1Losses: p1Lost, p2Losses: p2Lost, koType: perfect ? "perfect" : "normal", ...this.charInfo() });
      }
    } else {
      // P1 lost a character. KO round → P2 wins + perfect if untouched; TIME OVER → inconclusive (see above).
      if (this.roundTimerHitZero) {
        console.log(`[game-runner] ${this.readerTag} 🧮 Round ${this.roundNumber} TIME OVER (RAM, DRAW GAME) — no win credit, no perfect. lost P1=${p1Lost} P2=${p2Lost}`);
        this.emit("roundResult", { loser: 0, winner: 0, p1Losses: p1Lost, p2Losses: p2Lost, koType: "draw", ...this.charInfo() });
      } else {
        const perfect = this.roundP2MinHealth >= PERFECT_HEALTH_THRESHOLD;
        if (perfect) this.matchPerfectKos++;
        this.creditRoundWin(2);
        console.log(`[game-runner] ${this.readerTag} 🧮 P2 wins round ${this.roundNumber} (RAM, KO${perfect ? ", perfect" : ""}). lost P1=${p1Lost} P2=${p2Lost}`);
        this.emit("roundResult", { loser: 1, winner: 2, p1Losses: p1Lost, p2Losses: p2Lost, koType: perfect ? "perfect" : "normal", ...this.charInfo() });
      }
    }
    this.roundP1MinHealth = 100;
    this.roundP2MinHealth = 100;
    this.roundTimerHitZero = false;

    // Match end: a player lost all 3 characters. Winner = the other side; both 3 = draw match.
    if (!this.matchEnded && (p1Lost >= 3 || p2Lost >= 3)) {
      this.matchEnded = true;
      this.matchNumber++;
      const winner = (p1Lost >= 3 && p2Lost >= 3) ? 0 : (p1Lost >= 3 ? 2 : 1);
      const loser = winner === 0 ? 0 : (winner === 1 ? 2 : 1);
      const totalRounds = this.roundNumber;
      const perfectKos = this.matchPerfectKos;
      console.log(`[game-runner] ${this.readerTag} 🧮 MATCH #${this.matchNumber} OVER (RAM)! Winner: P${winner} lost P1=${p1Lost} P2=${p2Lost} rounds=${totalRounds} perfectKOs=${perfectKos}`);
      this.emit("matchEnd", { winner, loser, p1Losses: p1Lost, p2Losses: p2Lost, matchNumber: this.matchNumber, totalRounds, perfectKos, ...this.charInfo(), ...this.matchMeta() });
    }
  }

  private processHealthFrame(): void {
    if (!this.running || this.matchEnded || this.detectionFrozen) return;
    this.healthPollErrorCount = 0;

    // Skip KO detection during demo/attract mode (before coins + START)
    if (!this.gameStarted) return;

    // ── Authoritative RAM path (kof98) ─────────────────────────────
    // The per-player "characters lost" counters (0xA859/0xA868) are read directly and drive
    // round results + match end. They are immune to the health heuristics' two failure modes:
    // the wrong time-over winner (health often reads the wrong character) and the KOF98 "31%"
    // draw-replay (same characters keep fighting — not an elimination). When present, use them
    // and skip ALL the health-based detection below (kept only as a fallback for other ROMs).
    if (this.healthMemMap?.p1Lost != null) {
      this.processLossCounters();
      return;
    }

    const p1Health = this.memHealthP1;
    const p2Health = this.memHealthP2;

    if (p1Health < 0 || p2Health < 0) return;

    const HEALTHYTHRESHOLD = 20;
    const KOTHRESHOLD = 10;
    // For KO detection: health must drop from above this to ≤ KOTHRESHOLD.
    // Must be > KOTHRESHOLD to catch KOs where previous read was already low (e.g. 14% → 0%).
    const KO_PREV_THRESHOLD = KOTHRESHOLD + 2; // 12 — just above the KO floor
    const KO_COOLDOWN_FRAMES = 6; // ~3s at 2 reads/sec
    const PERFECT_HEALTH_THRESHOLD = 95;

    const bothHealthy = p1Health >= HEALTHYTHRESHOLD && p2Health >= HEALTHYTHRESHOLD;

    // ── Warmup (simpler than pixel analysis — values are exact) ──
    const warmupFrames = this.fastWarmup ? 4 : 8; // ~1s vs ~2s at 4 reads/sec
    const WARMUP_MIN_HEALTHY_RATIO = 0.75;

    if (!this.healthDetectionArmed) {
      this.healthStableFrames++;
      if (bothHealthy) this.healthStableFramesHealthy++;

      if (this.healthStableFrames >= warmupFrames) {
        const ratio = this.healthStableFramesHealthy / this.healthStableFrames;
        if (ratio >= WARMUP_MIN_HEALTHY_RATIO) {
          this.healthDetectionArmed = true;
          this.previousP1Health = p1Health;
          this.previousP2Health = p2Health;
          this.fastWarmup = false;
          console.log(`[game-runner] ${this.readerTag} 🧠 KO detection ARMED (memory) — ${this.healthStableFramesHealthy}/${this.healthStableFrames} healthy: P1=${p1Health}% P2=${p2Health}%`);
          if (!this.rosterScanned) { this.rosterScanned = true; this.scanTeamRoster(); }
          return;
        } else {
          const keep = Math.floor(warmupFrames * 0.5);
          this.healthStableFrames = keep;
          this.healthStableFramesHealthy = Math.floor(this.healthStableFramesHealthy * (keep / (warmupFrames + 1)));
        }
      }
      return;
    }

    // ── KO Detection ────────────────────────────────────────────
    // Track minimum health (for perfect KO detection)
    const inGameplay = p1Health >= HEALTHYTHRESHOLD || p2Health >= HEALTHYTHRESHOLD;
    if (!this.koDetected && inGameplay) {
      if (p1Health > 0) this.roundP1MinHealth = Math.min(this.roundP1MinHealth, p1Health);
      if (p2Health > 0) this.roundP2MinHealth = Math.min(this.roundP2MinHealth, p2Health);
    }

    if (this.koCooldownFrames > 0) {
      this.koCooldownFrames--;
    }

    if (!this.koDetected && this.koCooldownFrames === 0 && this.memTimer16 > 0) {
      // A round-ending KO. A DOUBLE-KO (draw) reads as one player ≤ KOTHRESHOLD while the
      // OTHER either also sits ≤ KOTHRESHOLD (both polled at ~0) or has already jumped back to
      // ≥95% — its character reset, i.e. it died too and advanced. At 250ms polls a true
      // double-KO is easily misread as a one-sided (often "perfect") KO, so detect it here.
      const RESET = 95;
      const p1Down = p1Health <= KOTHRESHOLD;
      const p2Down = p2Health <= KOTHRESHOLD;
      const p1Reset = this.previousP1Health < RESET && p1Health >= RESET;
      const p2Reset = this.previousP2Health < RESET && p2Health >= RESET;
      const p1Ko = this.previousP1Health > KO_PREV_THRESHOLD && p1Down;
      const p2Ko = this.previousP2Health > KO_PREV_THRESHOLD && p2Down;
      const draw = (p1Ko && (p2Down || p2Reset)) || (p2Ko && (p1Down || p1Reset));

      if (draw) {
        this.koDetected = true;
        this.p1Losses++;
        this.p2Losses++;
        this.roundNumber++;
        this.koCooldownFrames = KO_COOLDOWN_FRAMES;
        console.log(`[game-runner] ${this.readerTag} 🧠 DRAW! Double-KO round ${this.roundNumber}. P1=${p1Health}% P2=${p2Health}% prevP1=${this.previousP1Health}% prevP2=${this.previousP2Health}% Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
        this.emit("roundResult", { loser: 0, winner: 0, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType: "draw", ...this.charInfo() });
      } else if (p1Ko) {
        this.koDetected = true;
        this.p1Losses++;
        this.roundNumber++;
        this.koCooldownFrames = KO_COOLDOWN_FRAMES;
        const koType = (this.roundP2MinHealth >= PERFECT_HEALTH_THRESHOLD) ? "perfect" : "normal";
        if (koType === "perfect") this.matchPerfectKos++;
        this.creditRoundWin(2);
        console.log(`[game-runner] ${this.readerTag} 🧠 P1 KO'd! P2 wins round ${this.roundNumber} (${koType}). P1=${p1Health}% P2=${p2Health}% minP2=${this.roundP2MinHealth}% Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
        this.emit("roundResult", { loser: 1, winner: 2, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType, ...this.charInfo() });
      } else if (p2Ko) {
        this.koDetected = true;
        this.p2Losses++;
        this.roundNumber++;
        this.koCooldownFrames = KO_COOLDOWN_FRAMES;
        const koType = (this.roundP1MinHealth >= PERFECT_HEALTH_THRESHOLD) ? "perfect" : "normal";
        if (koType === "perfect") this.matchPerfectKos++;
        this.creditRoundWin(1);
        console.log(`[game-runner] ${this.readerTag} 🧠 P2 KO'd! P1 wins round ${this.roundNumber} (${koType}). P1=${p1Health}% P2=${p2Health}% minP1=${this.roundP1MinHealth}% Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
        this.emit("roundResult", { loser: 2, winner: 1, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType, ...this.charInfo() });
      }
    }

    // ── Time-over / Draw detection ───────────────────────────────
    //
    // Three detection patterns, checked in order:
    //
    // A) Health-based winner: both health jump from gameplay to ~100%.
    //    Winner = player with higher health before the reset.
    //
    // B) Health-based draw: both health drop from gameplay to 25-35%
    //    (KOF draw restart health ≈ 31% = 0x20/0x67).
    //
    // C) Timer-reset fallback: the 16-bit round timer just jumped from
    //    near-zero to >20000, signalling a new round, but neither pattern A
    //    nor B caught it (health transition happened between poll ticks).
    //    Uses saved pre-reset health to determine winner/draw.
    //
    // Guard: skip during KO cooldown and when a KO was just detected.
    if (!this.koDetected && this.koCooldownFrames === 0 && this.memTimer16 > 0) {
      const wasInGameplay = this.previousP1Health > HEALTHYTHRESHOLD || this.previousP2Health > HEALTHYTHRESHOLD;

      if (wasInGameplay) {
        // ── Pattern C: timer-reset fallback (most reliable) ──
        // When the 16-bit timer jumps from near-expiry (<1000) to full (>20000),
        // a round just ended. This catches cases where the health transition
        // (to 100% or 31%) was faster than our 250ms poll interval.
        const TIMER_RESET_LO = 1000;  // timer was almost expired
        const TIMER_RESET_HI = 20000; // timer just reset to full
        if (this.prevTimer16 >= 0 && this.prevTimer16 < TIMER_RESET_LO &&
            this.memTimer16 > TIMER_RESET_HI) {
          // Timer reset detected — round ended without a KO
          if (this.previousP1Health > this.previousP2Health) {
            this.koDetected = true;
            this.p2Losses++;
            this.roundNumber++;
            this.koCooldownFrames = KO_COOLDOWN_FRAMES;
            console.log(`[game-runner] ${this.readerTag} 🧠 TIME OVER! P1 wins round ${this.roundNumber} (timer reset). prevP1=${this.previousP1Health}% prevP2=${this.previousP2Health}% Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
            this.creditRoundWin(1);
            this.emit("roundResult", { loser: 2, winner: 1, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType: "timeout", ...this.charInfo() });
          } else if (this.previousP2Health > this.previousP1Health) {
            this.koDetected = true;
            this.p1Losses++;
            this.roundNumber++;
            this.koCooldownFrames = KO_COOLDOWN_FRAMES;
            console.log(`[game-runner] ${this.readerTag} 🧠 TIME OVER! P2 wins round ${this.roundNumber} (timer reset). prevP1=${this.previousP1Health}% prevP2=${this.previousP2Health}% Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
            this.creditRoundWin(2);
            this.emit("roundResult", { loser: 1, winner: 2, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType: "timeout", ...this.charInfo() });
          } else {
            // Equal pre-reset health. A real time-over draw has both players at
            // equal *partial* health; equal *full* health (~100%) is a round/
            // match-transition artifact (health already reset to full during
            // char-select) — NOT a double KO. Ignore it, else it falsely adds a
            // loss to BOTH players and can end the match early.
            if (this.previousP1Health < 95 && this.previousP2Health < 95) {
              this.koDetected = true;
              this.p1Losses++;
              this.p2Losses++;
              this.roundNumber++;
              this.koCooldownFrames = KO_COOLDOWN_FRAMES;
              console.log(`[game-runner] ${this.readerTag} 🧠 DRAW! Timer reset with equal health. prevP1=${this.previousP1Health}% prevP2=${this.previousP2Health}% Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
              this.emit("roundResult", { loser: 0, winner: 0, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType: "draw", ...this.charInfo() });
            } else {
              console.log(`[game-runner] ${this.readerTag} ⏭️ Ignored timer-reset draw at full health (transition artifact). prevP1=${this.previousP1Health}% prevP2=${this.previousP2Health}%`);
            }
          }
        }

        // If Pattern C didn't fire, try the health-based patterns
        if (!this.koDetected) {
          const notAlreadyFull = !(this.previousP1Health >= 95 && this.previousP2Health >= 95);

          // Pattern A: health jumps to 100% (time-over with a winner)
          if (notAlreadyFull && p1Health >= 95 && p2Health >= 95) {
            if (this.previousP1Health > this.previousP2Health) {
              this.koDetected = true;
              this.p2Losses++;
              this.roundNumber++;
              this.koCooldownFrames = KO_COOLDOWN_FRAMES;
              console.log(`[game-runner] ${this.readerTag} 🧠 TIME OVER! P1 wins round ${this.roundNumber} (timeout). prevP1=${this.previousP1Health}% prevP2=${this.previousP2Health}% → both 100% Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
              this.creditRoundWin(1);
              this.emit("roundResult", { loser: 2, winner: 1, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType: "timeout", ...this.charInfo() });
            } else if (this.previousP2Health > this.previousP1Health) {
              this.koDetected = true;
              this.p1Losses++;
              this.roundNumber++;
              this.koCooldownFrames = KO_COOLDOWN_FRAMES;
              console.log(`[game-runner] ${this.readerTag} 🧠 TIME OVER! P2 wins round ${this.roundNumber} (timeout). prevP1=${this.previousP1Health}% prevP2=${this.previousP2Health}% → both 100% Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
              this.creditRoundWin(2);
              this.emit("roundResult", { loser: 1, winner: 2, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType: "timeout", ...this.charInfo() });
            }
          }

          // Pattern B: draw — both health drop to KOF draw restart health (~31%)
          const DRAW_HI = 36;
          const DRAW_LO = 25;
          if (this.previousP1Health > DRAW_HI && this.previousP2Health > DRAW_HI &&
              p1Health >= DRAW_LO && p1Health <= DRAW_HI &&
              p2Health >= DRAW_LO && p2Health <= DRAW_HI) {
            this.koDetected = true;
            this.p1Losses++;
            this.p2Losses++;
            this.roundNumber++;
            this.koCooldownFrames = KO_COOLDOWN_FRAMES;
            console.log(`[game-runner] ${this.readerTag} 🧠 DRAW! Both at 31%. prevP1=${this.previousP1Health}% prevP2=${this.previousP2Health}% Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
            this.emit("roundResult", { loser: 0, winner: 0, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType: "draw", ...this.charInfo() });
          }

          // Pattern B2: 31% round ended — both in draw range drop to 0% (continue screen)
          // The 31% tiebreaker round ended without a winner and without timer reset.
          if (!this.koDetected &&
              this.previousP1Health >= DRAW_LO && this.previousP1Health <= DRAW_HI &&
              this.previousP2Health >= DRAW_LO && this.previousP2Health <= DRAW_HI &&
              p1Health <= KOTHRESHOLD && p2Health <= KOTHRESHOLD) {
            this.koDetected = true;
            this.p1Losses++;
            this.p2Losses++;
            this.roundNumber++;
            this.koCooldownFrames = KO_COOLDOWN_FRAMES;
            console.log(`[game-runner] ${this.readerTag} 🧠 DRAW! 31% round ended (health→0). prevP1=${this.previousP1Health}% prevP2=${this.previousP2Health}% Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
            this.emit("roundResult", { loser: 0, winner: 0, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType: "draw", ...this.charInfo() });
          }
        }
      }
    }

    // ── Pattern B3: 31% round timer expired ─────────────────
    // When both health are already in draw range (25-36%) and the
    // timer just hit 0, the round ended in a draw (both characters
    // eliminated). This is NOT guarded by memTimer16>0 — we're looking
    // for the timer hitting exactly 0.
    // A draw eliminates BOTH characters but does NOT end the match on
    // its own: the match-end check below ends it only once a player has
    // lost all 3 characters (winner=0 when both reach 3). Ending here
    // unconditionally froze the game on a round-1 draw.
    const DRAW_HI = 36;
    const DRAW_LO = 25;
    if (!this.koDetected && this.koCooldownFrames === 0 && !this.matchEnded &&
        p1Health >= DRAW_LO && p1Health <= DRAW_HI &&
        p2Health >= DRAW_LO && p2Health <= DRAW_HI &&
        this.prevTimer16 > 0 && this.memTimer16 === 0) {
      this.koDetected = true;
      this.p1Losses++;
      this.p2Losses++;
      this.roundNumber++;
      this.koCooldownFrames = KO_COOLDOWN_FRAMES;
      console.log(`[game-runner] ${this.readerTag} 🧠 DRAW! 31% timer expired. prevTimer=${this.prevTimer16} prevP1=${this.previousP1Health}% prevP2=${this.previousP2Health}% Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
      this.emit("roundResult", { loser: 0, winner: 0, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType: "draw", ...this.charInfo() });
    }

    // ── Detect new round ────────────────────────────────────────
    if (this.koDetected && bothHealthy) {
      this.koDetected = false;
      this.roundP1MinHealth = 100;
      this.roundP2MinHealth = 100;
      console.log(`[game-runner] ${this.readerTag} 🧠 New round: P1=${p1Health}% P2=${p2Health}%`);
    }

    // ── Check match end ─────────────────────────────────────────
    // Wins needed: per-ROM config, system default, or 3 as ultimate fallback.
    const winsNeeded = this.pixelConfig?.winsNeeded ?? (this.system === "snes" ? 2 : 3);
    if (!this.matchEnded && (this.p1Losses >= winsNeeded || this.p2Losses >= winsNeeded)) {
      this.matchEnded = true;
      this.matchNumber++;
      let winner: number;
      if (this.p1Losses >= winsNeeded && this.p2Losses >= winsNeeded) {
        winner = 0; // draw — both reached winsNeeded simultaneously
      } else {
        winner = this.p1Losses >= winsNeeded ? 2 : 1;
      }
      const loser = winner === 0 ? 0 : (winner === 1 ? 2 : 1);
      const totalRounds = this.roundNumber;
      const perfectKos = this.matchPerfectKos;
      console.log(`[game-runner] ${this.readerTag} 🧠 MATCH #${this.matchNumber} OVER! Winner: P${winner} Score: P1=${this.p1Losses} P2=${this.p2Losses} rounds=${totalRounds} perfectKOs=${perfectKos}`);
      this.emit("matchEnd", { winner, loser, p1Losses: this.p1Losses, p2Losses: this.p2Losses, matchNumber: this.matchNumber, totalRounds, perfectKos, ...this.charInfo(), ...this.matchMeta() });

      // Match is over. No auto-continue: the game stays on the game-over screen and the
      // client shows the end-match overlay. Input is locked server-side (ws-handler) so no
      // player can keep playing. A rematch starts a fresh session with a new GameRunner.
    }

    // Update previous values
    this.previousP1Health = p1Health;
    this.previousP2Health = p2Health;
  }

  // ── Rolling average helper (median of last N readings) ────────
  /** Median of the health history ring buffer — robust to outlier frames
   *  (hit flashes, visual effects) that would otherwise cause false KOs. */
  private getSmoothedHealth(history: number[]): number {
    if (history.length === 0) return 0;
    const sorted = [...history].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  /** Analyze a raw RGB24 frame of the health bar stripe.
   *
   *  Refactored (2026-07-13) with four robustness improvements:
   *  1. Color-saturation detection instead of raw brightness (R+G+B > 240)
   *  2. Column-scan bar-length measurement instead of pixel counting
   *  3. Formal GamePhase state machine — every transition needs multi-frame evidence
   *  4. Median-of-5 rolling average to filter hit flashes */
  private analyzeHealthFrame(frame: Buffer, width: number, height: number): void {
    if (!this.running || this.matchEnded) return;
    if (this.healthPollErrorCount >= 10) return;
    this.healthPollErrorCount = 0;

    // ── Define P1/P2 health bar regions (from per-ROM config, or system fallback) ──
    let p1StartX: number, p1EndX: number, p2StartX: number, p2EndX: number;
    if (this.pixelConfig) {
      p1StartX = this.pixelConfig.p1StartX; p1EndX = this.pixelConfig.p1EndX;
      p2StartX = this.pixelConfig.p2StartX; p2EndX = this.pixelConfig.p2EndX;
    } else if (this.system === "snes") {
      p1StartX = 70;  p1EndX = 310;
      p2StartX = 450; p2EndX = 768;
    } else {
      p1StartX = 0;                   p1EndX = Math.floor(width / 2);
      p2StartX = Math.floor(width / 2); p2EndX = width;
    }

    // ── Measure bar extent (column scan) then normalize ──────────
    const p1BarEnd = this.measureBarEndX(frame, width, p1StartX, 0, p1EndX - p1StartX, height);
    const p2BarEnd = this.measureBarEndX(frame, width, p2StartX, 0, p2EndX - p2StartX, height);

    const regionW1 = p1EndX - p1StartX;
    const regionW2 = p2EndX - p2StartX;
    // Use calibrated full-bar width if available, else fall back to region width.
    // During WARMUP, fullBarWidth is 0 so we use region width as a rough approximation.
    const p1FullW = this.p1FullBarWidth > 0 ? this.p1FullBarWidth : regionW1;
    const p2FullW = this.p2FullBarWidth > 0 ? this.p2FullBarWidth : regionW2;

    const rawP1 = Math.min(100, Math.round(((p1BarEnd - p1StartX) / Math.max(1, p1FullW)) * 100));
    const rawP2 = Math.min(100, Math.round(((p2BarEnd - p2StartX) / Math.max(1, p2FullW)) * 100));

    // ── Rolling average ──────────────────────────────────────────
    this.healthHistoryP1.push(rawP1);
    this.healthHistoryP2.push(rawP2);
    if (this.healthHistoryP1.length > this.HEALTH_HISTORY_SIZE) this.healthHistoryP1.shift();
    if (this.healthHistoryP2.length > this.HEALTH_HISTORY_SIZE) this.healthHistoryP2.shift();

    const p1Health = Math.round(this.getSmoothedHealth(this.healthHistoryP1));
    const p2Health = Math.round(this.getSmoothedHealth(this.healthHistoryP2));

    // ── Track round min health (for perfect KO detection) ─────────
    if (this.gamePhase === GamePhase.PLAYING) {
      if (p1Health > 0) this.roundP1MinHealth = Math.min(this.roundP1MinHealth, p1Health);
      if (p2Health > 0) this.roundP2MinHealth = Math.min(this.roundP2MinHealth, p2Health);
    }

    // ── Timer digit recognition (only if this ROM has timer templates) ──
    if (this.pixelConfig?.timer && this.gamePhase !== GamePhase.WARMUP) {
      const timerValue = this.readTimerFromFrame(frame, width, height);
      this.processTimerValue(timerValue);
    }

    // ── State machine ────────────────────────────────────────────
    const KO_THRESHOLD = 2;       // health ≤ this = KO'd
    const KO_RECOVERY = 5;        // health > this after KO_PENDING = false alarm
    const NEW_ROUND_HEALTH = 80;  // both bars ≥ this = new round
    const WARMUP_HEALTHY = 65;    // health ≥ this = "healthy" for warmup counting
    const WARMUP_FRAMES = this.fastWarmup ? 8 : 24;
    const WARMUP_MIN_RATIO = 0.65;
    const PERFECT_HEALTH = 95;

    switch (this.gamePhase) {

      case GamePhase.WARMUP: {
        // Calibrate full-bar width: track the max measured bar extent.
        // We do this during warmup when both players should be at full health.
        const p1Extent = p1BarEnd - p1StartX;
        const p2Extent = p2BarEnd - p2StartX;
        if (p1Extent > this.p1FullBarWidth) this.p1FullBarWidth = p1Extent;
        if (p2Extent > this.p2FullBarWidth) this.p2FullBarWidth = p2Extent;

        // Count healthy frames for the warmup window
        this.healthStableFrames++;
        if (rawP1 >= WARMUP_HEALTHY && rawP2 >= WARMUP_HEALTHY) {
          this.healthStableFramesHealthy++;
        }

        if (this.healthStableFrames >= WARMUP_FRAMES) {
          const ratio = this.healthStableFramesHealthy / this.healthStableFrames;
          if (ratio >= WARMUP_MIN_RATIO) {
            this.gamePhase = GamePhase.PLAYING;
            this.playingFrameCount = 0; // reset grace period
            this.healthDetectionArmed = true;
            this.fastWarmup = false;
            console.log(`[game-runner] ${this.readerTag} 🎮 Phase: WARMUP → PLAYING (${this.healthStableFramesHealthy}/${this.healthStableFrames} healthy, ${(ratio * 100).toFixed(0)}%, fullBarW P1=${this.p1FullBarWidth} P2=${this.p2FullBarWidth})`);
            if (!this.rosterScanned) { this.rosterScanned = true; this.scanTeamRoster(); }
          } else {
            // Slide the window: keep oldest 50%
            const keep = Math.floor(WARMUP_FRAMES * 0.5);
            this.healthStableFrames = keep;
            this.healthStableFramesHealthy = Math.floor(this.healthStableFramesHealthy * (keep / (WARMUP_FRAMES + 1)));
            console.log(`[game-runner] ${this.readerTag} 🎮 Warmup: ${(ratio * 100).toFixed(0)}% < ${(WARMUP_MIN_RATIO * 100).toFixed(0)}% — sliding window`);
          }
        } else if (this.healthStableFrames > 0 && this.healthStableFrames % 8 === 0) {
          console.log(`[game-runner] ${this.readerTag} 🎮 Warmup: ${this.healthStableFrames}/${WARMUP_FRAMES} (${this.healthStableFramesHealthy} healthy, barW P1=${this.p1FullBarWidth} P2=${this.p2FullBarWidth})`);
        }
        break;
      }

      case GamePhase.PLAYING: {
        this.playingFrameCount++;

        // ── Grace period: ignore all KO/time-over signals for the first N frames ──
        // The "FIGHT!" overlay + round-start screen transition can cause both
        // health bars to momentarily read as 0%. A real KO can't happen before
        // any damage has been dealt — skip this window entirely.
        if (this.playingFrameCount <= this.PLAYING_GRACE_FRAMES) break;

        const p1Down = p1Health <= KO_THRESHOLD;
        const p2Down = p2Health <= KO_THRESHOLD;

        // ── Simultaneous double-drop guard ──
        // Both players hitting 0% at the exact same time is a screen transition
        // (e.g. "ROUND 2" banner, super-freeze flash), never a real double KO.
        // In actual play, only ONE player's bar empties at a time.
        if (p1Down && p2Down) break;

        // ── Time-over detection (timer expired with both players alive) ──
        // When the OCR timer reads a stable 0 and neither player is KO'd,
        // the round ended by time-out. Compare remaining health: higher wins,
        // equal = draw. Multi-frame confirmation prevents OCR flicker false-
        // positives (the timer digit can briefly read 0 during screen flash).
        if (!p1Down && !p2Down && this.lastTimerValue === 0) {
          this.timeOverConfirmFrames++;
          if (this.timeOverConfirmFrames >= this.TIME_OVER_CONFIRM_REQUIRED) {
            // TIME OVER confirmed — determine winner by remaining health
            if (p1Health > p2Health) {
              this.p2Losses++;
              this.roundNumber++;
              console.log(`[game-runner] ${this.readerTag} ⏱️ TIME OVER! P1 wins (health P1=${p1Health}% > P2=${p2Health}%). Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
              this.emit("roundResult", { loser: 2, winner: 1, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType: "timeout", ...this.charInfo() });
            } else if (p2Health > p1Health) {
              this.p1Losses++;
              this.roundNumber++;
              console.log(`[game-runner] ${this.readerTag} ⏱️ TIME OVER! P2 wins (health P2=${p2Health}% > P1=${p1Health}%). Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
              this.emit("roundResult", { loser: 1, winner: 2, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType: "timeout", ...this.charInfo() });
            } else {
              // Equal remaining health → DRAW
              this.p1Losses++;
              this.p2Losses++;
              this.roundNumber++;
              console.log(`[game-runner] ${this.readerTag} ⏱️ TIME OVER DRAW! Equal health (P1=${p1Health}% P2=${p2Health}%). Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
              this.emit("roundResult", { loser: 0, winner: 0, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType: "draw", ...this.charInfo() });
            }
            this.gamePhase = GamePhase.KO_CONFIRMED;
            this.koDetected = true;
            this.newRoundConfirmFrames = 0;
            break;
          }
        } else {
          this.timeOverConfirmFrames = 0;
        }

        if (p1Down || p2Down) {
          this.gamePhase = GamePhase.KO_PENDING;
          this.koConfirmFrames = 1;
          console.log(`[game-runner] ${this.readerTag} 🎮 Phase: PLAYING → KO_PENDING (P1=${p1Health}% P2=${p2Health}%)`);
        }
        break;
      }

      case GamePhase.KO_PENDING: {
        const p1Down = p1Health <= KO_THRESHOLD;
        const p2Down = p2Health <= KO_THRESHOLD;

        if (p1Down || p2Down) {
          this.koConfirmFrames++;
          if (this.koConfirmFrames >= this.KO_CONFIRM_REQUIRED) {
            // KO confirmed — determine winner
            const p1Lost = p1Down && !p2Down;  // P1 KO'd alone
            const p2Lost = p2Down && !p1Down;  // P2 KO'd alone
            const draw = p1Down && p2Down;      // both KO'd
            const p1WinsRound = p2Lost || (draw && this.previousP1Health > this.previousP2Health);
            const p2WinsRound = p1Lost || (draw && this.previousP2Health > this.previousP1Health);

            this.gamePhase = GamePhase.KO_CONFIRMED;
            this.koDetected = true;
            this.newRoundConfirmFrames = 0;

            if (draw && !p1WinsRound && !p2WinsRound) {
              // True draw — both eliminated simultaneously with equal health
              this.p1Losses++;
              this.p2Losses++;
              this.roundNumber++;
              console.log(`[game-runner] ${this.readerTag} 🎮 KO_CONFIRMED: DRAW! P1=${p1Health}% P2=${p2Health}% Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
              this.emit("roundResult", { loser: 0, winner: 0, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType: "draw", ...this.charInfo() });
            } else if (p1WinsRound) {
              this.p2Losses++;
              this.roundNumber++;
              const koType = (this.roundP1MinHealth >= PERFECT_HEALTH) ? "perfect" : "normal";
              if (koType === "perfect") this.matchPerfectKos++;
              this.creditRoundWin(1);
              console.log(`[game-runner] ${this.readerTag} 🎮 KO_CONFIRMED: P2 KO'd! P1 wins (${koType}). P1=${p1Health}% P2=${p2Health}% minP1=${this.roundP1MinHealth}% Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
              this.emit("roundResult", { loser: 2, winner: 1, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType, ...this.charInfo() });
            } else if (p2WinsRound) {
              this.p1Losses++;
              this.roundNumber++;
              const koType = (this.roundP2MinHealth >= PERFECT_HEALTH) ? "perfect" : "normal";
              if (koType === "perfect") this.matchPerfectKos++;
              this.creditRoundWin(2);
              console.log(`[game-runner] ${this.readerTag} 🎮 KO_CONFIRMED: P1 KO'd! P2 wins (${koType}). P1=${p1Health}% P2=${p2Health}% minP2=${this.roundP2MinHealth}% Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
              this.emit("roundResult", { loser: 1, winner: 2, p1Losses: this.p1Losses, p2Losses: this.p2Losses, koType, ...this.charInfo() });
            }
          } else {
            console.log(`[game-runner] ${this.readerTag} 🎮 KO_PENDING: ${this.koConfirmFrames}/${this.KO_CONFIRM_REQUIRED} (P1=${p1Health}% P2=${p2Health}%)`);
          }
        } else {
          // Both recovered — false alarm (hit flash, visual effect)
          console.log(`[game-runner] ${this.readerTag} 🎮 Phase: KO_PENDING → PLAYING (false alarm — P1=${p1Health}% P2=${p2Health}%)`);
          this.gamePhase = GamePhase.PLAYING;
          this.koConfirmFrames = 0;
        }
        break;
      }

      case GamePhase.KO_CONFIRMED: {
        // Wait for both health bars to come back (new round)
        const winsNeeded = this.pixelConfig?.winsNeeded ?? (this.system === "snes" ? 2 : 3);
        if (this.p1Losses >= winsNeeded || this.p2Losses >= winsNeeded) {
          this.gamePhase = GamePhase.MATCH_END;
          this.matchEnded = true;
          this.matchNumber++;
          const winner = this.p1Losses >= winsNeeded ? 2 : 1;
          const loser = winner === 1 ? 2 : 1;
          console.log(`[game-runner] ${this.readerTag} 🎮 Phase: KO_CONFIRMED → MATCH_END. Winner: P${winner} Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
          this.emit("matchEnd", { winner, loser, p1Losses: this.p1Losses, p2Losses: this.p2Losses, matchNumber: this.matchNumber, totalRounds: this.roundNumber, perfectKos: this.matchPerfectKos, ...this.charInfo(), ...this.matchMeta() });
          break;
        }

        if (p1Health >= NEW_ROUND_HEALTH && p2Health >= NEW_ROUND_HEALTH) {
          this.newRoundConfirmFrames++;
          if (this.newRoundConfirmFrames >= this.NEW_ROUND_CONFIRM_REQUIRED) {
            this.gamePhase = GamePhase.PLAYING;
            this.playingFrameCount = 0; // reset grace period for new round
            this.koDetected = false;
            this.koConfirmFrames = 0;
            this.newRoundConfirmFrames = 0;
            this.roundP1MinHealth = 100;
            this.roundP2MinHealth = 100;
            console.log(`[game-runner] ${this.readerTag} 🎮 Phase: KO_CONFIRMED → PLAYING (new round). P1=${p1Health}% P2=${p2Health}% Score: P1=${this.p1Losses} P2=${this.p2Losses}`);
          }
        } else {
          this.newRoundConfirmFrames = 0; // reset if bars drop again
        }
        break;
      }

      case GamePhase.MATCH_END:
        // Nothing to do — matchEnd already emitted
        break;
    }

    // Update previous values for the next frame
    this.previousP1Health = p1Health;
    this.previousP2Health = p2Health;
  }

    /** Check if a pixel belongs to a health bar by saturation, not raw brightness.
   *  Health bars are colored (yellow/green/red) — they have significant
   *  channel variance. Gray/white UI text, timer digits, and dark background
   *  all have low saturation. This is robust to shaders, gamma, and bloom. */
  private isHealthPixel(r: number, g: number, b: number): boolean {
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    return (maxC - minC) > 30   // has color saturation (not gray/white UI)
        && maxC > 80;           // not too dark
  }

  /**
   * Measure the health bar extent by scanning columns left-to-right.
   * Returns the X position of the rightmost column that still has enough
   * health-colored pixels.
   *
   * This directly answers "how long is the bar?" — no pixel counting,
   * no dynamic calibration, no brightness threshold fragility.
   */
  private measureBarEndX(
    frame: Buffer, frameWidth: number,
    startX: number, startY: number, regionW: number, regionH: number,
  ): number {
    const MIN_COL_PIXELS = Math.ceil(regionH * 0.33); // ~8 out of 24 for SNES
    let lastFilledX = startX; // default to bar-start if nothing found

    for (let x = startX; x < startX + regionW; x++) {
      let colCount = 0;
      for (let y = startY; y < startY + regionH; y++) {
        const idx = (y * frameWidth + x) * 3;
        const r = frame[idx] ?? 0;
        const g = frame[idx + 1] ?? 0;
        const b = frame[idx + 2] ?? 0;
        if (this.isHealthPixel(r, g, b)) colCount++;
      }
      if (colCount >= MIN_COL_PIXELS) {
        lastFilledX = x;
      }
    }
    return lastFilledX;
  }

  /** Recognize a single timer digit from a cropped region of the frame.
   *  Downsamples the region to DIGIT_TEMPLATE_W×DIGIT_TEMPLATE_H,
   *  binarizes via threshold, then compares against each template via
   *  Hamming distance (XOR popcount). Returns the best-match digit 0-9.
   *  @param templates — 10×12 digit bitmaps from the per-ROM config. */
  private recognizeDigit(
    frame: Buffer, frameWidth: number,
    x: number, y: number, w: number, h: number,
    templates: number[][],
  ): number {
    // Step 1: determine brightness threshold (median of the region)
    const samples: number[] = [];
    for (let row = 0; row < h; row += 4) {
      for (let col = 0; col < w; col += 4) {
        const idx = ((y + row) * frameWidth + (x + col)) * 3;
        const r = frame[idx] ?? 0, g = frame[idx + 1] ?? 0, b = frame[idx + 2] ?? 0;
        samples.push((r + g + b) / 3);
      }
    }
    samples.sort((a, b) => a - b);
    const threshold = samples[Math.floor(samples.length * 0.6)] + 20; // upper 40% are "lit"

    // Step 2: downsample to template size
    const cellW = w / DIGIT_TEMPLATE_W;
    const cellH = h / DIGIT_TEMPLATE_H;
    const bits: number[] = [];
    for (let tr = 0; tr < DIGIT_TEMPLATE_H; tr++) {
      let rowBits = 0;
      for (let tc = 0; tc < DIGIT_TEMPLATE_W; tc++) {
        // Average brightness of this cell
        let sum = 0, count = 0;
        const sx = Math.round(x + tc * cellW);
        const sy = Math.round(y + tr * cellH);
        const ex = Math.round(x + (tc + 1) * cellW);
        const ey = Math.round(y + (tr + 1) * cellH);
        for (let py = sy; py < ey && py < y + h; py++) {
          for (let px = sx; px < ex && px < x + w; px++) {
            const idx = (py * frameWidth + px) * 3;
            sum += (frame[idx] ?? 0) + (frame[idx + 1] ?? 0) + (frame[idx + 2] ?? 0);
            count += 3;
          }
        }
        const avg = count > 0 ? sum / count : 0;
        if (avg > threshold) rowBits |= (1 << (7 - tc));
      }
      bits.push(rowBits);
    }

    // Step 3: Hamming distance against each template
    let bestDigit = 0;
    let bestDist = Infinity;
    for (let d = 0; d < 10; d++) {
      const tmpl = templates[d];
      if (!tmpl) continue;
      let dist = 0;
      for (let r = 0; r < DIGIT_TEMPLATE_H; r++) {
        const xor = (bits[r] ?? 0) ^ (tmpl[r] ?? 0);
        // popcount
        let v = xor;
        while (v) { dist++; v &= v - 1; }
      }
      if (dist < bestDist) { bestDist = dist; bestDigit = d; }
    }
    return bestDigit;
  }

  /**
   * Extract and recognize the two timer digits from the health bar stripe.
   * Uses the per-ROM PixelGameConfig.timer for coordinates and templates.
   * Returns the timer value (0-99) or -1 if unrecognizable.
   */
  private readTimerFromFrame(frame: Buffer, width: number, height: number): number {
    const t = this.pixelConfig?.timer;
    if (!t) return -1;

    const DIGIT_W = t.digitW;
    const DIGIT_H = t.digitH;
    const leftX = t.leftDigitX;
    const rightX = t.rightDigitX;
    const y = Math.max(0, Math.floor((height - DIGIT_H) / 2)); // center vertically in stripe
    const minRatio = t.minBrightRatio;

    // Basic guard: check if the region has enough bright pixels
    const checkBright = (cx: number): boolean => {
      let bright = 0, total = 0;
      for (let row = 0; row < DIGIT_H && (y + row) < height; row++) {
        for (let col = 0; col < DIGIT_W && (cx + col) < width; col++) {
          const idx = ((y + row) * width + (cx + col)) * 3;
          const r = frame[idx] ?? 0, g = frame[idx + 1] ?? 0, b = frame[idx + 2] ?? 0;
          if ((r + g + b) / 3 > 80) bright++;
          total++;
        }
      }
      return total > 0 && bright / total > minRatio;
    };

    if (!checkBright(leftX) || !checkBright(rightX)) return -1;

    const left = this.recognizeDigit(frame, width, leftX, y, DIGIT_W, DIGIT_H, t.digits);
    const right = this.recognizeDigit(frame, width, rightX, y, DIGIT_W, DIGIT_H, t.digits);
    return left * 10 + right;
  }

  // ── Timer temporal validation ──────────────────────────────────
  /** Process a new timer reading. Only emits on stable, valid transitions. */
  private processTimerValue(rawValue: number): void {
    if (rawValue < 0 || rawValue > 99) {
      this.timerStableFrames = 0;
      return;
    }

    if (rawValue === this.lastTimerValue) {
      this.timerStableFrames++;
      return; // already reported
    }

    // New value — validate temporal constraints
    // Timer only decreases by 1 (or resets to 99 for new round)
    const isValidDecrease = rawValue === this.lastTimerValue - 1 && this.lastTimerValue >= 0;
    const isNewRoundReset = rawValue === 99 && this.lastTimerValue >= 0;

    if (isValidDecrease || isNewRoundReset || this.lastTimerValue < 0) {
      this.timerStableFrames++;
      if (this.timerStableFrames >= this.TIMER_STABLE_REQUIRED) {
        const prevTimer = this.lastTimerValue;
        this.lastTimerValue = rawValue;
        this.timerStableFrames = 0;
        if (rawValue === 99 && prevTimer !== 99) {
          console.log(`[game-runner] ${this.readerTag} ⏱️ Timer: ${rawValue} (new round reset, was ${prevTimer})`);
        }
        // Emit timer value for round time tracking
        // (can be used later for time-over detection)
      }
    } else {
      // Invalid transition — ignore (blinking, visual artifact)
      this.timerStableFrames = 0;
    }
  }

  /** Reset health bar warmup counters. Call when combat actually starts so the warmup
   *  only sees combat frames (not title/menu/char-select garbage). */
  resetHealthWarmup(): void {
    this.healthDetectionArmed = false;
    this.healthStableFrames = 0;
    this.healthStableFramesHealthy = 0;
    this.healthPollErrorCount = 0;
    // Reset pixel baseline: the previous calibration happened during char select /
    // menu screens whose stripe has different (usually brighter) content than the
    // real health bars. Recalibrating on actual combat frames gives correct ~100%
    // readings for full health, instead of the ~66% we saw before this fix.
    this.p1MaxPixels = 0;
    this.p2MaxPixels = 0;
    // Reset state-machine pixel detection (SFA2 / SNES)
    this.gamePhase = GamePhase.WARMUP;
    this.playingFrameCount = 0;
    this.p1FullBarWidth = 0;
    this.p2FullBarWidth = 0;
    this.healthHistoryP1 = [];
    this.healthHistoryP2 = [];
    this.koConfirmFrames = 0;
    this.newRoundConfirmFrames = 0;
    this.timeOverConfirmFrames = 0;
    // Fast warmup: shorter window since we already validated the stripe is readable.
    this.fastWarmup = true;
    // Reset timer tracking
    this.lastTimerValue = -1;
    this.timerStableFrames = 0;
    console.log("[game-runner] 🧠 Health warmup reset (combat starting, pixel baseline cleared)");
  }

  /** Start the debug health log timer. Actual detection runs continuously via TCP health reader.
   *  Does NOT interfere with the health reader's polling interval. */
  startMemoryWatcher(): void {
    if (this.matchEnded) return;
    // Clear any existing debug log timer (does NOT touch healthReadTimer)
    if (this.healthPollTimer) {
      clearInterval(this.healthPollTimer);
      this.healthPollTimer = null;
    }
    this.healthPollEnabled = true;
    this.gameStarted = true;
    console.log("[game-runner] 🧠 Health debug log activated");

    // Periodic debug log (every 10s) — reads latest values from the memory health reader
    this.healthPollTimer = setInterval(() => {
      if (!this.running || this.matchEnded) return;
      if (this.previousP1Health >= 0) {
        const p1Name = KOF98_CHARACTERS[this.memP1Char] || "?";
        const p2Name = KOF98_CHARACTERS[this.memP2Char] || "?";
        const pixelTimer = this.lastTimerValue >= 0 ? ` ⏱️pix=${this.lastTimerValue}` : "";
        console.log(`[game-runner] 🧠 Health: P1=${this.previousP1Health}% ${p1Name} P2=${this.previousP2Health}% ${p2Name} ⏱️A83A=${this.memTimer}(16b=${this.memTimer16}) 85D2=${this.memTimerAlt}${pixelTimer} ko=${this.koDetected} losses: P1=${this.p1Losses} P2=${this.p2Losses}`);
      }
    }, 10000);
  }

  /** Stop the health watcher. */
  stopHealthWatcher(): void {
    this.healthPollEnabled = false;
    if (this.healthPollTimer) {
      clearInterval(this.healthPollTimer);
      this.healthPollTimer = null;
    }
    if (this.healthReadTimer) {
      clearInterval(this.healthReadTimer);
      this.healthReadTimer = null;
    }
    console.log("[game-runner] 🧠 Round detection stopped");
  }

  // (keep stopMemoryWatcher for backwards compat)
  stopMemoryWatcher(): void {
    this.stopHealthWatcher();
  }

  /** Send H.264 + Opus codec configuration to the client. */
  private sendCodecConfig(): void {
    this.codecConfigSent = true;
    const resolution = SYSTEM_RESOLUTIONS[this.system];
    const w = resolution.w * UPSCALE;
    const h = resolution.h * UPSCALE;

    // H.264 AVC decoder description: AVCC record
    // For baseline profile, we provide a minimal AVCC with SPS/PPS extracted from FFmpeg.
    // We'll use default values that FFmpeg + libx264 produce.
    // The actual SPS/PPS will be extracted from the first IDR frame by the browser.
    const videoDesc = Buffer.from(JSON.stringify({
      codec: "avc1.42001E", // H.264 baseline, level 3.0
      width: w,
      height: h,
      framerate: 60,
      bitrate: 2000000,
    }), "utf-8");

    const audioDesc = Buffer.from(JSON.stringify({
      codec: "pcm_s16le",
      sampleRate: 48000,
      channels: 1,
    }), "utf-8");

    console.log(`[game-runner] Sending codec config: ${w}x${h} H.264 + PCM 48kHz mono`);
    this.emit("codecConfig", videoDesc, audioDesc);
    this.emit("audio", Buffer.alloc(0)); // kick audio pipeline
  }

  /** Start D-Bus daemon if not already running. */
  private async startDbus(): Promise<void> {
    return new Promise((resolve) => {
      const proc = spawn("dbus-daemon", ["--system", "--fork"], { stdio: "ignore" });
      proc.on("close", () => setTimeout(resolve, 300));
      proc.on("error", () => resolve());
      setTimeout(resolve, 1500);
    });
  }

  /** Start PulseAudio with a null sink for headless audio. */
  private async startPulseAudio(): Promise<void> {
    return new Promise((resolve) => {
      // Kill any existing pulseaudio
      spawn("pulseaudio", ["--kill"], { stdio: "ignore" }).on("close", () => {
        // Start pulseaudio daemon
        const pa = spawn("pulseaudio", [
          "--start",
          "--exit-idle-time=-1",
          "--disallow-module-loading=0",
          "--disallow-exit=1",
          "--log-target=stderr",
        ], { stdio: "ignore" });

        pa.on("close", (code) => {
          console.log(`[game-runner] PulseAudio started (code ${code})`);
          // Create null sink for game audio
          setTimeout(() => {
            spawn("pactl", [
              "load-module", "module-null-sink",
              "sink_name=game_sink",
              "sink_properties=device.description=GameAudio",
              "format=float32le",
              "rate=48000",
              "channels=2",
            ], { stdio: "ignore" }).on("close", () => {
              // Set as default sink
              spawn("pactl", ["set-default-sink", "game_sink"], { stdio: "ignore" })
                .on("close", () => {
                  console.log("[game-runner] PulseAudio null sink ready");
                  resolve();
                });
            });
          }, 500);
        });

        pa.on("error", () => {
          console.warn("[game-runner] PulseAudio failed to start — audio disabled");
          resolve();
        });

        setTimeout(resolve, 3000);
      });
    });
  }

  private async startXvfb(w: number, h: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const useXdummy = process.env.USE_XDUMMY === "1";

      if (useXdummy) {
        this.xvfb = spawn("Xorg", [
          this.display,
          "-config", "/etc/X11/xorg-dummy.conf",
          "-noreset",
          "+extension", "GLX",
          "+extension", "RANDR",
          "+extension", "RENDER",
        ], { stdio: ["ignore", "ignore", "pipe"] });
      } else {
        this.xvfb = spawn("Xvfb", [
          this.display,
          "-screen", "0", `${w}x${h}x24`,
          "-nolisten", "tcp",
          "+extension", "GLX",
        ], { stdio: ["ignore", "ignore", "pipe"] });
      }

      this.xvfb.on("error", reject);
      setTimeout(() => resolve(), 500);
    });
  }

  private async startRetroArch(
    corePath: string,
    romPath: string,
    w: number,
    h: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const retroarchBin = process.env.RETROARCH_BIN || "retroarch";

      // Write config to a temp file instead of stdin.
      // stdin piping with --appendconfig is unreliable — RetroArch may
      // read stdin before the config is fully written. A temp file is
      // guaranteed to be available when RetroArch processes --appendconfig.
      const config = this.buildRetroarchConfig(w, h);
      this.configPath = join(tmpdir(), `retroarch-${this.sessionId}.cfg`);
      writeFileSync(this.configPath, config, "utf-8");
      console.log(`[game-runner] Config written to ${this.configPath} (${config.length} bytes)`);

      const args = [
        "-L", corePath,
        romPath,
        "--set-shader", "",
        "-v",
        "--appendconfig", this.configPath!,
      ];

      this.retroarch = spawn(retroarchBin, args, {
        env: {
          ...process.env,
          DISPLAY: this.display,
          SDL_VIDEODRIVER: "x11",
          SDL_AUDIODRIVER: "pulseaudio",
          SDL_RENDER_DRIVER: "software",
          LIBGL_ALWAYS_SOFTWARE: "1",
          PULSE_SINK: "game_sink",
        },
        stdio: ["ignore", "ignore", "pipe"],
      });

      this.retroarch.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
        if (text.includes("ERROR") || text.includes("error")) {
          console.error(`[retroarch] ${text.trim()}`);
        }
      });

      this.retroarch.on("error", reject);
      this.retroarch.on("exit", (code) => {
        console.log(`[retroarch] Exited with code ${code}`);
        this.running = false;
        this.emit("exit", code);
      });

      setTimeout(() => {
        // Find RetroArch window for focused xdotool input
        this.findRetroarchWindow();
        resolve();
      }, 2000);
    });
  }

  /** Find the RetroArch X11 window ID for targeted xdotool input.
   *  Retries with backoff — RetroArch window may take several seconds to appear. */
  private findRetroarchWindow(attempt = 0): void {
    const MAX_ATTEMPTS = 20;
    const proc = spawn("xdotool", ["search", "--onlyvisible", "--class", "retroarch"], {
      env: { ...process.env, DISPLAY: this.display },
      stdio: "pipe",
    });
    let output = "";
    proc.stdout?.on("data", (d: Buffer) => { output += d.toString(); });
    proc.on("close", (code) => {
      const wid = output.trim().split("\n")[0]?.trim();
      if (wid && /^\d+$/.test(wid)) {
        this.retroarchWindowId = wid;
        console.log(`[game-runner] 🪟 RetroArch window ID: ${wid} (attempt ${attempt + 1})`);
        // Use windowfocus (no WM available, windowactivate won't work)
        spawn("xdotool", ["windowfocus", "--sync", wid], {
          env: { ...process.env, DISPLAY: this.display },
          stdio: "ignore",
        });
      } else if (attempt < MAX_ATTEMPTS) {
        // Retry with backoff: 1s, 1.5s, 2s, 2.5s, ...
        const delay = 1000 + attempt * 500;
        setTimeout(() => this.findRetroarchWindow(attempt + 1), delay);
      } else {
        console.warn(`[game-runner] ⚠️ Could not find RetroArch window after ${MAX_ATTEMPTS} attempts`);
      }
    });
  }

  /** FFmpeg video: captures Xvfb, encodes H.264 baseline, outputs to stdout. */
  private startFfmpegVideo(w: number, h: number): void {
    this.ffmpegVideo = spawn("ffmpeg", [
      "-f", "x11grab",
      "-framerate", "60",
      "-video_size", `${w}x${h}`,
      "-i", `${this.display}.0`,
      // H.264 baseline — WebCodecs compatible
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-tune", "zerolatency",
      "-profile:v", "baseline",
      "-level", "3.0",
      "-pix_fmt", "yuv420p",
      "-b:v", "2M",
      "-maxrate", "3M",
      "-bufsize", "1M",
      "-g", "120",         // keyframe every 2s at 60fps
      "-keyint_min", "60",
      "-sc_threshold", "0",
      "-refs", "1",
      "-x264-params", "sliced-threads=0:sync-lookahead=0:rc-lookahead=0",
      // Output Annex B format (raw NAL units)
      "-f", "h264",
      "-avioflags", "direct",
      "-flush_packets", "1",
      "pipe:1",
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, DISPLAY: this.display },
    });

    this.ffmpegVideo.stdout?.on("data", (chunk: Buffer) => {
      this.handleVideoChunk(chunk);
    });

    this.ffmpegVideo.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      if (text.includes("Error") || text.includes("error")) {
        console.error(`[ffmpeg:video] ${text.trim()}`);
      }
    });

    this.ffmpegVideo.on("error", (err) => {
      console.error(`[ffmpeg:video] Process error:`, err);
      this.emit("error", err);
    });

    this.ffmpegVideo.on("exit", (code) => {
      console.log(`[ffmpeg:video] Exited with code ${code}`);
    });
  }

  /** PCM audio: captures PulseAudio monitor via parec, sends raw s16le PCM directly.
   *  No FFmpeg, no Opus, no Ogg — just raw PCM for maximum simplicity. */
  private startPcmAudio(): void {
    const SAMPLE_RATE = 48000;
    const CHANNELS = 1;
    const CHUNK_MS = 20;
    const SAMPLES_PER_CHUNK = Math.floor(SAMPLE_RATE * CHUNK_MS / 1000); // 960 samples
    const BYTES_PER_CHUNK = SAMPLES_PER_CHUNK * CHANNELS * 2; // s16le = 2 bytes/sample

    this.pcmChunkSize = BYTES_PER_CHUNK; // 1920 bytes

    // parec captures raw PCM from PulseAudio monitor, format: s16le mono
    this.parec = spawn("parec", [
      "--device=game_sink.monitor",
      "--format=s16le",
      `--rate=${SAMPLE_RATE}`,
      `--channels=${CHANNELS}`,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.parec.stderr?.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) console.log(`[parec:stderr] ${text}`);
    });

    this.parec.on("error", (err) => {
      console.error(`[parec] Process error:`, err.message);
    });

    this.parec.on("exit", (code) => {
      console.log(`[parec] Exited with code ${code}`);
    });

    this.parec.stdout?.on("data", (chunk: Buffer) => {
      this.handlePcmChunk(chunk);
    });

    console.log(`[game-runner] PCM audio: ${SAMPLE_RATE}Hz s16le mono, ${CHUNK_MS}ms chunks`);
  }

  /**
   * Plan A recorder: capture the display + game audio to a fragmented mp4 on disk. PvP only,
   * env-gated (RECORDING_ENABLED=1). On graceful stop (a "q" written to stdin) FFmpeg finalizes
   * the file and its `exit` handler uploads it to Vercel Blob. Never throws into start().
   */
  private startRecorder(w: number, h: number): void {
    if (!isRecordingEnabled() || this.mode !== "pvp") return;
    try {
      const dir = recordingDir();
      mkdirSync(dir, { recursive: true });
      this.recordingPath = join(dir, `${this.sessionId}.mp4`);
      this.recorder = spawn("ffmpeg", recorderFfmpegArgs(this.display, w, h, this.recordingPath), {
        stdio: ["pipe", "ignore", "pipe"],
        env: { ...process.env, DISPLAY: this.display },
      });
      this.recorder.stderr?.on("data", (d: Buffer) => {
        const text = d.toString();
        if (text.includes("Error") || text.includes("error")) console.error(`[recorder] ${text.trim()}`);
      });
      this.recorder.on("error", (err) => console.error("[recorder] Process error:", err.message));
      this.recorder.on("exit", (code) => {
        console.log(`[recorder] Exited with code ${code}`);
        const path = this.recordingPath;
        if (path && !this.recordingUploaded) {
          this.recordingUploaded = true;
          void uploadRecording({ filePath: path, sessionId: this.sessionId, system: this.system, rom: this.rom })
            .catch((e) => console.error("[recorder] upload failed:", e));
        }
      });
      console.log(`[game-runner] 🎥 Recording to ${this.recordingPath}`);
    } catch (err) {
      console.warn("[game-runner] 🎥 Failed to start recorder:", err);
      this.recorder = null;
    }
  }

  /**
   * Plan A streamer: push the display + game audio as FLV to an RTMP ingest URL. Requires
   * STREAMING_ENABLED=1 AND a per-session rtmpUrl from the client init (absent by default,
   * so this stays inert). The URL is expected to embed the stream key.
   */
  private startStreamer(w: number, h: number): void {
    if (!isStreamingEnabled() || !this.rtmpUrl) return;
    try {
      this.streamer = spawn("ffmpeg", streamerFfmpegArgs(this.display, w, h, this.rtmpUrl), {
        stdio: ["ignore", "ignore", "pipe"],
        env: { ...process.env, DISPLAY: this.display },
      });
      this.streamer.stderr?.on("data", (d: Buffer) => {
        const text = d.toString();
        if (text.includes("Error") || text.includes("error") || text.includes("Failed")) {
          console.error(`[streamer] ${text.trim()}`);
        }
      });
      this.streamer.on("error", (err) => console.error("[streamer] Process error:", err.message));
      this.streamer.on("exit", (code) => console.log(`[streamer] Exited with code ${code}`));
      console.log(`[game-runner] 📡 Streaming live to RTMP target`);
    } catch (err) {
      console.warn("[game-runner] 📡 Failed to start streamer:", err);
      this.streamer = null;
    }
  }

  private pcmChunkSize = 1920;
  private pcmBuffer = Buffer.alloc(0);

  private handlePcmChunk(chunk: Buffer): void {
    this.pcmBuffer = Buffer.concat([this.pcmBuffer, chunk]);

    // Emit complete 20ms chunks
    while (this.pcmBuffer.length >= this.pcmChunkSize) {
      const pcmChunk = this.pcmBuffer.subarray(0, this.pcmChunkSize);
      this.emit("audio", Buffer.from(pcmChunk)); // copy before shifting
      this.pcmBuffer = this.pcmBuffer.subarray(this.pcmChunkSize);
    }

    // Safety: prevent unbounded buffer growth
    if (this.pcmBuffer.length > this.pcmChunkSize * 10) {
      console.warn("[game-runner] PCM buffer overflow — resetting");
      this.pcmBuffer = Buffer.alloc(0);
    }
  }

  /**
   * Parse H.264 Annex B stream into NAL units.
   * Each NAL unit starts with 0x00 0x00 0x00 0x01 or 0x00 0x00 0x01.
   * We emit complete NAL units (including start code) as video frames.
   */
  private handleVideoChunk(chunk: Buffer): void {
    this.videoBuffer = Buffer.concat([this.videoBuffer, chunk]);

    const resolution = SYSTEM_RESOLUTIONS[this.system];
    if (!resolution) return;

    // Search for NAL start codes in the buffer
    let pos = 0;
    while (pos < this.videoBuffer.length - 3) {
      // Find next start code
      let scLen = 0;
      if (this.videoBuffer[pos] === 0x00 && this.videoBuffer[pos + 1] === 0x00) {
        if (this.videoBuffer[pos + 2] === 0x01) {
          scLen = 3;
        } else if (this.videoBuffer[pos + 2] === 0x00 && pos + 3 < this.videoBuffer.length && this.videoBuffer[pos + 3] === 0x01) {
          scLen = 4;
        }
      }

      if (scLen > 0) {
        // Found a start code at `pos`
        // Find the NEXT start code to delimit this NAL unit
        let nextPos = pos + scLen;
        let nextScLen = 0;
        while (nextPos < this.videoBuffer.length - 3) {
          if (this.videoBuffer[nextPos] === 0x00 && this.videoBuffer[nextPos + 1] === 0x00) {
            if (this.videoBuffer[nextPos + 2] === 0x01) {
              nextScLen = 3;
              break;
            } else if (this.videoBuffer[nextPos + 2] === 0x00 && nextPos + 3 < this.videoBuffer.length && this.videoBuffer[nextPos + 3] === 0x01) {
              nextScLen = 4;
              break;
            }
          }
          nextPos++;
        }

        if (nextScLen > 0 && nextPos > pos + scLen) {
          // Complete NAL unit from pos to nextPos
          const nalUnit = this.videoBuffer.subarray(pos, nextPos);
          this.frameId++;
          this.emit("frame", nalUnit, resolution.w, resolution.h);
          pos = nextPos; // Continue from next start code
        } else if (nextScLen === 0) {
          // No next start code found — wait for more data
          break;
        } else {
          pos += scLen;
        }
      } else {
        pos++;
      }
    }

    // Trim processed data
    if (pos > 0 && pos < this.videoBuffer.length) {
      // Keep unprocessed tail
      this.videoBuffer = this.videoBuffer.subarray(pos);
    } else if (pos >= this.videoBuffer.length) {
      this.videoBuffer = Buffer.alloc(0);
    }

    // Safety: prevent unbounded buffer growth
    if (this.videoBuffer.length > 10 * 1024 * 1024) {
      console.warn("[game-runner] Video buffer exceeded 10MB — resetting");
      this.videoBuffer = Buffer.alloc(0);
    }
  }

  private audioRawLogged = false;
  /** Inject a keyboard input into RetroArch via xdotool.
   *  Uses --window to target RetroArch directly (no WM focus needed). */
  injectInput(player: number, button: number, pressed: boolean): void {
    if (!this.running) return;

    const buttonToRetroarch = getButtonToRetroarch(this.system);
    const retroarchName = buttonToRetroarch[button];
    if (!retroarchName) return;

    const keyMap = player === 1 ? XDOTOOL_KEY_MAP : XDOTOOL_KEY_MAP_P2;
    const xdoKey = keyMap[retroarchName];
    if (!xdoKey) return;

    // If we don't have the window ID yet, try to find it now (lazy init)
    if (!this.retroarchWindowId) {
      this.findRetroarchWindow();
      // Still try to inject — keys with --window will be more reliable once we have the ID
    }

    const action = pressed ? "keydown" : "keyup";
    // Use --window to target RetroArch directly when we have the ID.
    // Without a window manager, global key events go nowhere useful.
    const args = this.retroarchWindowId
      ? [action, "--window", this.retroarchWindowId, xdoKey]
      : [action, xdoKey];

    if (DEBUG_RAM) {
      if (!this.retroarchWindowId) {
        console.log(`[game-runner] 🕹️  xdotool ${action} ${xdoKey} (P${player} btn=${button}) [NO WINDOW — may be lost]`);
      } else {
        console.log(`[game-runner] 🕹️  xdotool --window ${this.retroarchWindowId} ${action} ${xdoKey} (P${player} btn=${button})`);
      }
    }

    const proc = spawn("xdotool", args, {
      env: { ...process.env, DISPLAY: this.display },
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("error", (err) => {
      console.error(`[game-runner] ❌ xdotool error (P${player} btn=${button} key=${xdoKey}):`, err.message);
    });

    proc.on("close", (code) => {
      if (code !== 0 || stderr) {
        console.warn(`[game-runner] ⚠️  xdotool exit=${code} stderr="${stderr.trim()}" (P${player} btn=${button} key=${xdoKey})`);
        // The cached RetroArch window ID can go stale (window recreated after
        // auto-continue/restart). BadWindow means our --window target is dead:
        // drop it and rediscover so subsequent inputs land in the live window.
        if (this.retroarchWindowId && /BadWindow|invalid Window/i.test(stderr)) {
          console.warn(`[game-runner] 🪟 Stale window ID ${this.retroarchWindowId} — rediscovering RetroArch window`);
          this.retroarchWindowId = "";
          this.findRetroarchWindow();
        }
      }
    });
  }

  /** Focus the RetroArch window (call once before a key sequence, not per-input).
   *  Uses windowfocus since there's no window manager for windowactivate.
   *  Synchronous: xdotool --sync ensures the focus completes before we continue,
   *  which is critical for SNES menu navigation where timing matters. */
  ensureFocus(): void {
    if (!this.retroarchWindowId) return;
    spawnSync("xdotool", ["windowfocus", "--sync", this.retroarchWindowId], {
      env: { ...process.env, DISPLAY: this.display },
      stdio: "ignore",
      timeout: 2000,
    });
  }

  /** Query RetroArch's *real* pause state over the UDP command interface. Sends GET_STATUS
   *  on the *health* socket (the one that reliably gets replies under event-loop load) and
   *  waits for the handler to settle. Resolves null if no reply within the window. */
  private raGetStatus(): Promise<"PLAYING" | "PAUSED" | "CONTENTLESS" | null> {
    return new Promise((resolve) => {
      if (!this.healthUdp) return resolve(null);
      let settled = false;
      const done = (v: "PLAYING" | "PAUSED" | "CONTENTLESS" | null) => {
        if (settled) return;
        settled = true;
        const i = this.pendingStatusResolvers.indexOf(done);
        if (i >= 0) this.pendingStatusResolvers.splice(i, 1);
        resolve(v);
      };
      this.pendingStatusResolvers.push(done);
      try {
        this.healthUdp.send(Buffer.from("GET_STATUS\n"), RA_CMD_PORT, "127.0.0.1");
      } catch { done(null); }
      setTimeout(() => done(null), 900);
    });
  }

  /** Fire-and-forget PAUSE_TOGGLE on the health socket (sending needs no reply, so it's
   *  reliable; only the GET_STATUS read can be lost). */
  private raPauseToggle(): void {
    try {
      this.healthUdp?.send(Buffer.from("PAUSE_TOGGLE\n"), RA_CMD_PORT, "127.0.0.1");
    } catch { /* ok */ }
  }

  /** One-shot RAM byte read over a dedicated short-lived UDP socket (kept separate from
   *  healthUdp so its READ_CORE_RAM reply isn't parsed against the health map). Resolves the
   *  byte value, or null if no reply within the window. Used to verify a coin registered
   *  (0xF2C0 = Neo Geo coin counter, steps on every coin) during the rematch continue. */
  private readRamByte(addr: number): Promise<number | null> {
    return new Promise((resolve) => {
      const sock = createSocket("udp4");
      let done = false;
      const finish = (v: number | null) => { if (done) return; done = true; try { sock.close(); } catch { /* ok */ } resolve(v); };
      sock.on("message", (m) => {
        const p = m.toString().trim().split(/\s+/);
        if (p[0] !== "READ_CORE_RAM") return;
        const h = p.slice(2).join("");
        if (h === "-1" || h.length < 2) return finish(null);
        finish(parseInt(h.substring(0, 2), 16));
      });
      sock.on("error", () => finish(null));
      try { sock.send(Buffer.from(`READ_CORE_RAM ${addr.toString(16)} 1\n`), RA_CMD_PORT, "127.0.0.1"); }
      catch { finish(null); }
      setTimeout(() => finish(null), 500);
    });
  }

  /** Read `count` consecutive RAM bytes starting at `addr` (one UDP round-trip). Returns an
   *  array of byte values, or null on failure/short reply. Used for the pick-order buffers,
   *  which sit far below the main health chunk and are only read a few times per match. */
  private readRamRange(addr: number, count: number): Promise<number[] | null> {
    return new Promise((resolve) => {
      const sock = createSocket("udp4");
      let done = false;
      const finish = (v: number[] | null) => { if (done) return; done = true; try { sock.close(); } catch { /* ok */ } resolve(v); };
      sock.on("message", (m) => {
        const p = m.toString().trim().split(/\s+/);
        if (p[0] !== "READ_CORE_RAM") return;
        const h = p.slice(2).join("");
        if (h === "-1" || h.length < count * 2) return finish(null);
        const out: number[] = [];
        for (let i = 0; i < count; i++) out.push(parseInt(h.substring(i * 2, i * 2 + 2), 16));
        finish(out);
      });
      sock.on("error", () => finish(null));
      try { sock.send(Buffer.from(`READ_CORE_RAM ${addr.toString(16)} ${count}\n`), RA_CMD_PORT, "127.0.0.1"); }
      catch { finish(null); }
      setTimeout(() => finish(null), 500);
    });
  }

  /** Read the authoritative pick-order (fight order) from the player-struct buffers and set
   *  p1/p2SelectOrder. Addresses (fight order 1st/2nd/3rd) come from the health map:
   *  P1 0x15CB/0x15CA/0x15CD, P2 mirror +0x200 0x17CB/0x17CA/0x17CD. Values are KOF98 char IDs.
   *  Requires all 3 picks valid (0x00-0x25) and distinct for BOTH players before latching, so a
   *  torn/early read never freezes a wrong order. Falls back silently (the round-by-round tracker
   *  keeps filling the order until this lands). Validated via controlled diff, 3 orders (2026-07-10). */
  private async capturePickOrders(): Promise<void> {
    const map = this.healthMemMap;
    if (!map?.p1PickOrder || !map?.p2PickOrder) return;
    const decode = async (addrs: number[]): Promise<number[] | null> => {
      const base = Math.min(...addrs);
      const span = Math.max(...addrs) - base + 1;
      const raw = await this.readRamRange(base, span);
      if (!raw) return null;
      const order = addrs.map(a => raw[a - base]);
      if (order.some(v => v == null || v < 0x00 || v > 0x25)) return null;
      if (new Set(order).size !== order.length) return null; // 3 distinct picks
      return order;
    };
    const [p1, p2] = await Promise.all([decode(map.p1PickOrder), decode(map.p2PickOrder)]);
    if (p1 && p2 && !this.pickOrderCaptured) {
      this.p1SelectOrder = p1;
      this.p2SelectOrder = p2;
      this.pickOrderCaptured = true;
      const nm = (id: number) => KOF98_CHARACTERS[id] || `0x${id.toString(16)}`;
      console.log(`[game-runner] ${this.readerTag} 🎯 Pick order (RAM): P1=[${p1.map(nm).join(" > ")}] P2=[${p2.map(nm).join(" > ")}]`);
    }
  }

  /** Drive RetroArch to the desired pause state and *verify convergence*: read the real
   *  state (GET_STATUS), toggle only if it differs, re-read, repeat until it matches or we
   *  run out of attempts. This tolerates lost GET_STATUS reads (just retries) and can never
   *  desync (unlike a blind F12 toggle + mirrored boolean, which left a running game that
   *  resume() then froze). PAUSE_TOGGLE sends are fire-and-forget so they don't get lost. */
  private async applyPauseState(wantPaused: boolean): Promise<void> {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let attempt = 0; attempt < 6; attempt++) {
      const st = await this.raGetStatus();
      if (st === null) { await sleep(120); continue; } // lost read — retry
      if (st === "CONTENTLESS") return;                 // nothing loaded
      const isPaused = st === "PAUSED";
      if (isPaused === wantPaused) return;              // reached desired state ✓
      this.raPauseToggle();
      await sleep(250);                                 // let RetroArch apply the toggle
    }
    console.warn(`[game-runner] ${this.readerTag} ⚠️ pause: could not confirm ${wantPaused ? "PAUSED" : "PLAYING"} after retries`);
  }

  pause(): void {
    this.paused = true;
    void this.applyPauseState(true);
  }

  /** Resume, returning the convergence promise so the rematch flow can await it before
   *  injecting the loser's coin/START (otherwise inputs land on a still-paused frame). */
  resume(): Promise<void> {
    this.paused = false;
    return this.applyPauseState(false);
  }

  /**
   * Explicitly re-arm scoring for a same-session rematch. Called by ws-handler on
   * rematch_accept. Resumes the (paused) emulator, then wipes per-match scoring and
   * team state so the next match is detected & recorded from scratch. matchNumber and
   * gameStarted are intentionally preserved (matchNumber increments per match for stats;
   * gameStarted gates demo/attract, still true). KO detection is re-warmed (fast) so it
   * settles on the rematch's first combat instead of firing on the char-select screen.
   */
  async beginRematch(): Promise<void> {
    // Reset scoring/teams FIRST (the emulator is still paused from match end), then
    // resume LAST — so the game never advances a frame with stale match state.
    this.detectionFrozen = false;
    // Scoring
    this.matchEnded = false;
    this.p1Losses = 0;
    this.p2Losses = 0;
    this.roundNumber = 0;
    this.matchPerfectKos = 0;
    this.koDetected = false;
    this.koCooldownFrames = 0;
    this.roundP1MinHealth = 100;
    this.roundP2MinHealth = 100;
    this.roundTimerHitZero = false;
    this.lcPrevTimer16 = -1;
    // RAM loss-counter tracking: force a fresh re-baseline. The counters zero out at the next
    // char-select, and prevP1Lost/prevP2Lost < 0 makes processLossCounters re-baseline silently
    // (no phantom round from the 3→0 reset).
    this.memP1Lost = -1;
    this.memP2Lost = -1;
    this.prevP1Lost = -1;
    this.prevP2Lost = -1;
    this.lastRawP1Lost = -1;
    this.lastRawP2Lost = -1;
    // Teams / selection order / per-char wins
    this.teamFrozen = false;
    this.p1LockedTeam = null;
    this.p2LockedTeam = null;
    this.p1SelectOrder = [];
    this.p2SelectOrder = [];
    this.pickOrderCaptured = false;
    this.pickOrderInFlight = false;
    this.p1SeenChars.clear();
    this.p2SeenChars.clear();
    this.p1CharWins.clear();
    this.p2CharWins.clear();
    this.matchFlagZeroStreak = 0;
    // Re-warm KO detection (fast) so char-select garbage health doesn't trigger a false KO
    this.healthDetectionArmed = false;
    this.healthStableFrames = 0;
    this.healthStableFramesHealthy = 0;
    this.fastWarmup = true;
    // Reset state-machine pixel detection
    this.gamePhase = GamePhase.WARMUP;
    this.playingFrameCount = 0;
    this.p1FullBarWidth = 0;
    this.p2FullBarWidth = 0;
    this.healthHistoryP1 = [];
    this.healthHistoryP2 = [];
    this.koConfirmFrames = 0;
    this.newRoundConfirmFrames = 0;
    // Resume LAST, once all scoring/team state is clean and re-armed. Await convergence so
    // callers (ws-handler) know the game is actually running before injecting coin/START.
    await this.resume();
    console.log(`[game-runner] ${this.readerTag} 🔁 beginRematch — scoring/teams re-armed + resumed (match #${this.matchNumber + 1} next)`);
  }

  /**
   * Bring the losing side back into the match from the arcade CONTINUE screen.
   *
   * After a match the loser's whole team is defeated and KOF98 shows a CONTINUE
   * countdown on their side; if no coin+START lands during that window the winner
   * drifts into a 1P-vs-CPU arcade run (which the detector then mis-scores as a phantom
   * match). Crucially, resume() first replays the win animation for a few seconds before
   * CONTINUE appears — so the old single coin/START at t≈0 landed on the animation and was
   * wasted. Here we bank a credit, then press the loser's START repeatedly across the whole
   * continue window, stopping as soon as the game settles back at char-select (matchFlag
   * 0x00) where an extra START would wrongly confirm a character.
   *
   * `loser` is 1 or 2 (the loser can be either player). Fire-and-forget from the rematch
   * handler (do not await) so clients aren't blocked for the length of the window.
   */
  async continueLoser(loser: number): Promise<void> {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const loserLost = () => (loser === 1 ? this.memP1Lost : this.memP2Lost);
    // Victory/CONTINUE screen flag: 0xc6 when P2 lost, 0xca when P1 lost. While either is set
    // we're still on the continue prompt; once it changes we've moved to char-select (loser
    // rejoined) or the winner's 1P-vs-CPU ladder. Either way, STOP pressing START — at
    // char-select it would confirm a default Kyo character (the "Kyo partout" bug).
    const onContinue = () => this.memMatchFlag === 0xc6 || this.memMatchFlag === 0xca;
    this.ensureFocus();
    // Wait for the CONTINUE screen — it appears a few seconds after resume, once the win
    // animation ends (inputs during the animation are wasted).
    let waited = 0;
    while (waited < 8000 && !onContinue()) { await sleep(250); waited += 250; }
    if (!onContinue()) {
      console.log(`[game-runner] ${this.readerTag} ⚠️ continue assist: CONTINUE screen never appeared (flag=0x${(this.memMatchFlag < 0 ? 0 : this.memMatchFlag).toString(16)}) — aborting`);
      return;
    }
    // On the continue screen: insert the loser's coin (btn 4 = SELECT = Neo Geo coin) on the
    // LOSER's slot only, and VERIFY it registered by watching the coin counter at 0xF2C0 (steps
    // on every coin; stable otherwise). Retry only if it didn't move — so exactly one credit
    // goes in, never a pile. Then only START loops (no more coins). The flag (0xc6/0xca) and the
    // loser's counter (3) stay put across BOTH the continue prompt AND the post-continue
    // char-select, only updating when the new match starts — so re-inserting a coin each nudge
    // (the old approach) just piled up visible credits until launch.
    //  • Coin the loser only — coining the winner hands them the credit to advance 1P-vs-CPU
    //    when the loser's continue is slow, which the detector then mis-scores (phantom match).
    let coinIn = false;
    for (let c = 0; c < 3 && !coinIn; c++) {
      const before = await this.readRamByte(0xF2C0);
      this.injectInput(loser, 4, true); await sleep(120); this.injectInput(loser, 4, false);
      await sleep(350);
      const after = await this.readRamByte(0xF2C0);
      if (before == null || after == null) { coinIn = true; break; } // can't verify → assume in
      if (after !== before) {
        coinIn = true;
        console.log(`[game-runner] ${this.readerTag} 🪙 continue assist: coin registered (0xF2C0 ${before}→${after})`);
      } else {
        console.log(`[game-runner] ${this.readerTag} 🪙 continue assist: coin NOT registered (0xF2C0=${before}), retry ${c + 1}/3`);
      }
    }
    // Credit is in — from here only START loops (no more coins), until the new match begins
    // (loser's loss counter resets) or we leave the continue screen.
    for (let i = 0; i < 5; i++) {
      if (loserLost() === 0 || !onContinue()) break; // new match started / left continue
      this.injectInput(loser, 5, true); await sleep(140); this.injectInput(loser, 5, false); // START only
      console.log(`[game-runner] ${this.readerTag} 🎮 continue assist: START P${loser} nudge ${i + 1} (flag=0x${(this.memMatchFlag < 0 ? 0 : this.memMatchFlag).toString(16)}, loserLost=${loserLost()})`);
      for (let j = 0; j < 8; j++) { await sleep(250); if (loserLost() === 0 || !onContinue()) break; }
    }
    // The flag (0xc6/0xca) and the loser's counter only update when the NEW match loads — which
    // is a few seconds after our nudge window ends. So don't judge success from the window; keep
    // polling (non-blocking; this method is already fire-and-forget) to log the REAL outcome.
    let rejoined = loserLost() === 0 || !onContinue();
    for (let w = 0; w < 40 && !rejoined; w++) { // ~12s
      await sleep(300);
      rejoined = loserLost() === 0 || !onContinue();
    }
    if (rejoined) {
      console.log(`[game-runner] ${this.readerTag} ✅ continue assist: loser P${loser} rejoined — match starting`);
    } else {
      // NOT a failure signal: the CONTINUE flag (0xc6/0xca) and the loss counter only clear when
      // the NEW fight actually loads — they persist unchanged all through the post-continue
      // char-select. So after ~12s with no change, the loser has almost certainly LEFT the
      // CONTINUE prompt and is simply still picking their team (which can take a while). We just
      // can't observe the fight-load moment yet. Report it as informational, not "stuck on CONTINUE".
      console.log(`[game-runner] ${this.readerTag} ℹ️ continue assist: new fight not yet loaded after ~12s (flag=0x${(this.memMatchFlag < 0 ? 0 : this.memMatchFlag).toString(16)}, loserLost=${loserLost()}) — credit is in; loser is most likely still choosing their team at char-select.`);
    }
  }

  stop(): void {
    console.log(`[game-runner] Stopping all processes for session ${this.sessionId}`);
    this.running = false;
    this.stopRequested = true;

    // Stop health watcher
    this.stopHealthWatcher();

    // Stop health bar ffmpeg (if pixel analysis was active)
    if (this.healthFfmpeg) {
      this.healthFfmpeg.kill("SIGTERM");
      this.healthFfmpeg = null;
    }

    // Close UDP health socket (if memory reading was active)
    if (this.healthUdp) {
      this.healthUdp.close();
      this.healthUdp = null;
    }

    this.parec?.kill("SIGTERM");
    this.ffmpegVideo?.kill("SIGTERM");
    // Plan A: finalize the recording gracefully — "q" on FFmpeg's stdin flushes the mp4
    // moov/fragments before it exits, and the recorder's exit handler then uploads it.
    if (this.recorder) {
      try { this.recorder.stdin?.write("q"); } catch { /* fall through to SIGTERM below */ }
      this.recorder.kill("SIGTERM");
    }
    this.streamer?.kill("SIGTERM");
    this.retroarch?.kill("SIGTERM");
    this.xvfb?.kill("SIGTERM");

    // Clean up temp config file
    if (this.configPath) {
      try { unlinkSync(this.configPath); } catch { /* ok */ }
    }

    setTimeout(() => {
      this.parec?.kill("SIGKILL");
      this.ffmpegVideo?.kill("SIGKILL");
      this.recorder?.kill("SIGKILL");
      this.streamer?.kill("SIGKILL");
      this.retroarch?.kill("SIGKILL");
      this.xvfb?.kill("SIGKILL");
      spawn("pulseaudio", ["--kill"], { stdio: "ignore" });
    }, 2000);
  }

  private buildRetroarchConfig(w: number, h: number): string {
    const lines: string[] = [
      `video_driver = "gl"`,
      // In headless Xvfb, true fullscreen (DRM/KMS) is unavailable — it falls back to a
      // window whose position may drift away from (0,0), which moves the game content
      // below the health-bar stripe at y=0. Rely on windowed_fullscreen + explicit
      // window position instead.
      `video_fullscreen = "false"`,
      `video_windowed_fullscreen = "true"`,
      `video_window_x = "0"`,
      `video_window_y = "0"`,
      `video_window_width = "${w}"`,
      `video_window_height = "${h}"`,
      `video_fullscreen_x = "${w}"`,
      `video_fullscreen_y = "${h}"`,
      `video_crop_overscan = "false"`,
      `video_force_aspect = "false"`,
      `video_aspect_ratio_auto = "false"`,
      `custom_viewport_width = "${w / UPSCALE}"`,
      `custom_viewport_height = "${h / UPSCALE}"`,
      `aspect_ratio_index = "0"`,
      `video_scale_integer = "false"`,
      `video_smooth = "false"`,
      `video_threaded = "true"`,
      `video_max_swapchain_images = "2"`,
      `video_frame_delay = "0"`,
      `video_hard_sync = "false"`,
      `video_vsync = "false"`,
      // Audio — enabled via PulseAudio
      `audio_enable = "true"`,
      `audio_driver = "pulse"`,
      `audio_rate = "48000"`,
      `audio_out_rate = "48000"`,
      `audio_sync = "true"`,
      `audio_max_timing_skew = "0.06"`,
      `audio_latency = "64"`,
      // Input
      `input_driver = "sdl2"`,
      `input_joypad_driver = "null"`,
      `input_player2_joypad_index = "1"`,
      // Performance
      `fastforward_ratio = "1.0"`,
      `rewind_enable = "false"`,
      // Menu
      `menu_driver = "null"`,
      `savestate_auto_load = "false"`,
      `savestate_auto_save = "false"`,
      `auto_remaps_enable = "false"`,
      `config_save_on_exit = "false"`,
      `content_show_override = "false"`,
      // Network commands — allows reading core memory via UDP
      `network_cmd_enable = true`,
      `network_cmd_port = ${RA_CMD_PORT}`,
      // Disable ALL default RetroArch hotkeys — several collide with P2's keyboard keys
      // (default input_reset="h" = P2 Right, input_pause_toggle="p" = P2 R2,
      //  input_frame_advance="k" = P2 B), which caused accidental resets/freezes.
      // Pause is rebound to a dedicated key (f12) that no player uses; pause()/resume() send it.
      `input_pause_toggle = "f12"`,
      `input_reset = "nul"`,
      `input_frame_advance = "nul"`,
      `input_rewind = "nul"`,
      `input_hold_fast_forward = "nul"`,
      `input_toggle_fast_forward = "nul"`,
      `input_hold_slowmotion = "nul"`,
      `input_slowmotion = "nul"`,
      `input_menu_toggle = "nul"`,
      `input_exit_emulator = "nul"`,
      `input_save_state = "nul"`,
      `input_load_state = "nul"`,
      `input_state_slot_increase = "nul"`,
      `input_state_slot_decrease = "nul"`,
      `input_screenshot = "nul"`,
      `input_audio_mute = "nul"`,
      `input_toggle_fullscreen = "nul"`,
      `input_shader_next = "nul"`,
      `input_shader_prev = "nul"`,
      `input_cheat_index_plus = "nul"`,
      `input_cheat_index_minus = "nul"`,
      `input_cheat_toggle = "nul"`,
      `input_netplay_flip_players = "nul"`,
      `input_volume_up = "nul"`,
      `input_volume_down = "nul"`,
      `input_disk_eject_toggle = "nul"`,
      `input_disk_next = "nul"`,
      `input_disk_prev = "nul"`,
      `input_grab_mouse_toggle = "nul"`,
      `input_game_focus_toggle = "nul"`,
      `input_movie_record_toggle = "nul"`,
      `input_fps_toggle = "nul"`,
    ];

    // Keyboard mappings for both players
    const keyConfig = buildRetroarchKeyConfig();
    // 🔍 DEBUG: Log P2 bindings
    const p2Bindings = Object.entries(keyConfig).filter(([k]) => k.startsWith("input_player2_"));
    console.log(`[game-runner] 🎮 P2 RetroArch bindings:`, Object.fromEntries(p2Bindings));
    for (const [key, value] of Object.entries(keyConfig)) {
      lines.push(`${key} = "${value}"`);
    }

    return lines.join("\n") + "\n";
  }
}
