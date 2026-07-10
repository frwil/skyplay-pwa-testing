/**
 * Match recording + live RTMP streaming — Plan A.
 *
 * These are SEPARATE FFmpeg processes that grab the Xvfb display (:99) and the PulseAudio
 * monitor independently of the WebSocket streaming pipeline (startFfmpegVideo / startPcmAudio
 * in game-runner.ts). Decoupling means a recorder/streamer failure can never degrade the live
 * game feed. Both are fully env-gated and therefore INERT until the operator turns them on and
 * rebuilds the Docker image:
 *
 *   RECORDING_ENABLED=1          → record every PvP duel to an mp4, then upload to Vercel Blob
 *   STREAMING_ENABLED=1          → allow a per-session RTMP push when the client supplies a URL
 *   BLOB_READ_WRITE_TOKEN=...    → Vercel Blob token used for the (private) recording upload
 *   RECORDINGS_DIR=/recordings   → where mp4s are written before upload (default /recordings)
 *   STATS_API_URL / STATS_API_TOKEN → reused to POST recording metadata back to Next.js
 */

export function isRecordingEnabled(): boolean {
  return process.env.RECORDING_ENABLED === "1";
}

export function isStreamingEnabled(): boolean {
  return process.env.STREAMING_ENABLED === "1";
}

export function recordingDir(): string {
  return process.env.RECORDINGS_DIR || "/recordings";
}

/**
 * FFmpeg args for the file recorder: grab the display + game audio and mux to a fragmented
 * mp4. Fragmented (`+frag_keyframe+empty_moov`) means the file stays playable even if the
 * process is killed mid-write — no need for a clean moov atom at the end.
 */
export function recorderFfmpegArgs(display: string, w: number, h: number, outPath: string): string[] {
  return [
    "-y",
    "-f", "x11grab",
    "-framerate", "30",
    "-video_size", `${w}x${h}`,
    "-i", `${display}.0`,
    "-f", "pulse",
    "-i", "game_sink.monitor",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-b:v", "2500k",
    "-g", "60",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "48000",
    "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
    "-f", "mp4",
    outPath,
  ];
}

/**
 * FFmpeg args for the live RTMP push: grab the display + game audio and send FLV to the RTMP
 * ingest URL (which already embeds the stream key, e.g. rtmp://host/app/STREAM_KEY). Audio is
 * transcoded PCM→AAC and video is low-latency H.264 as most RTMP endpoints (YouTube/Twitch)
 * require.
 */
export function streamerFfmpegArgs(display: string, w: number, h: number, rtmpUrl: string): string[] {
  return [
    "-f", "x11grab",
    "-framerate", "30",
    "-video_size", `${w}x${h}`,
    "-i", `${display}.0`,
    "-f", "pulse",
    "-i", "game_sink.monitor",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-tune", "zerolatency",
    "-pix_fmt", "yuv420p",
    "-b:v", "2500k",
    "-maxrate", "2500k",
    "-bufsize", "5000k",
    "-g", "60",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "44100",
    "-f", "flv",
    rtmpUrl,
  ];
}

/**
 * Upload a finished recording to Vercel Blob (private) and register its metadata with Next.js.
 *
 * The `@vercel/blob` SDK is imported via a non-literal specifier so this file still type-checks
 * before the dependency is installed (it lands with the next Docker rebuild). At runtime, a
 * missing token or missing package is logged and skipped — never throws into the caller.
 */
export async function uploadRecording(opts: {
  filePath: string;
  sessionId: string;
  system: string;
  rom: string;
}): Promise<void> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.log("[recording] BLOB_READ_WRITE_TOKEN not set — skipping upload (recording kept on disk)");
    return;
  }

  const { readFile } = await import("fs/promises");
  let data: Buffer;
  try {
    data = await readFile(opts.filePath);
  } catch (err) {
    console.error(`[recording] Cannot read ${opts.filePath}:`, err);
    return;
  }
  if (data.length === 0) {
    console.warn(`[recording] ${opts.filePath} is empty — skipping upload`);
    return;
  }

  // Non-literal specifier: keeps tsc green before `@vercel/blob` is installed.
  const blobPkg = "@vercel/blob";
  let put: (path: string, body: Buffer, o: Record<string, unknown>) => Promise<{ url: string; pathname: string }>;
  try {
    const mod = (await import(blobPkg)) as {
      put: (path: string, body: Buffer, o: Record<string, unknown>) => Promise<{ url: string; pathname: string }>;
    };
    put = mod.put;
  } catch (err) {
    console.error("[recording] @vercel/blob not installed — skipping upload:", err);
    return;
  }

  let url = "";
  let pathname = "";
  try {
    const blob = await put(`duel-recordings/${opts.sessionId}.mp4`, data, {
      access: "private",
      contentType: "video/mp4",
      token,
      allowOverwrite: true,
    });
    url = blob.url;
    pathname = blob.pathname;
    console.log(`[recording] Uploaded ${opts.sessionId} (${(data.length / 1e6).toFixed(1)}MB) → ${url}`);
  } catch (err) {
    console.error("[recording] Blob upload failed:", err);
    return;
  }

  // Register metadata with Next.js (same shared-secret channel as stats).
  const apiUrl = process.env.STATS_API_URL || "http://localhost:3000";
  const apiToken = process.env.STATS_API_TOKEN || "dev";
  try {
    const res = await fetch(`${apiUrl}/api/duel/recording`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiToken}` },
      body: JSON.stringify({
        sessionId: opts.sessionId,
        url,
        pathname,
        size: data.length,
        system: opts.system,
        rom: opts.rom,
      }),
    });
    if (!res.ok) console.error(`[recording] Metadata POST failed: ${res.status} ${await res.text().catch(() => "")}`);
    else console.log(`[recording] Metadata registered for ${opts.sessionId}`);
  } catch (err) {
    console.error("[recording] Metadata POST error:", err);
  }
}
