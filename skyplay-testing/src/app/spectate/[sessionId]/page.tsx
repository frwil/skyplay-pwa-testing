"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { GiftOverlay } from "@/components/overlay/GiftOverlay";
import type { GiftNotifyData } from "@/components/overlay/GiftQueue";
import GiftPanel from "@/components/overlay/GiftPanel";
import DonorRanking from "@/components/overlay/DonorRanking";
import { Gift } from "lucide-react";

// Binary protocol constants (mirrors game-server/src/types.ts)
const FRAME_MAGIC = 0x01;
const AUDIO_MAGIC = 0x02;
const CODEC_CONFIG_MAGIC = 0x03;
const FRAME_HEADER_SIZE = 13;
const CODEC_CFG_HEADER_SIZE = 3;

interface SpectateState {
  status: "connecting" | "loading" | "running" | "error" | "ended";
  error?: string;
  spectatorCount: number;
  width: number;
  height: number;
  fps: number;
}

/** Extract NAL unit type from first byte after start code. */
function getNalUnitType(data: Uint8Array): number {
  // Look for Annex B start code
  if (data.length >= 4 && data[0] === 0x00 && data[1] === 0x00 && data[2] === 0x00 && data[3] === 0x01) {
    return data[4] & 0x1f;
  }
  if (data.length >= 3 && data[0] === 0x00 && data[1] === 0x00 && data[2] === 0x01) {
    return data[3] & 0x1f;
  }
  return data[0] & 0x1f;
}

export default function SpectatePage() {
  const params = useParams();
  const sessionId = params.sessionId as string;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const videoDecoderRef = useRef<VideoDecoder | null>(null);
  const videoDecoderReadyRef = useRef(false);
  const latestFrameRef = useRef<VideoFrame | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingChunksRef = useRef<{ chunk: EncodedVideoChunk; nalType: number; nalData: Uint8Array }[]>([]);
  const videoNeedsKeyframeRef = useRef(false);
  const streamWidthRef = useRef(320);
  const streamHeightRef = useRef(224);
  const lastFrameIdRef = useRef(0);
  const pendingConfigRef = useRef<{ codec: string; width: number; height: number; framerate: number } | null>(null);
  const lastDecoderInitRef = useRef<{ codec: string; width: number; height: number; framerate: number } | null>(null);

  const [state, setState] = useState<SpectateState>({
    status: "connecting",
    spectatorCount: 0,
    width: 320,
    height: 224,
    fps: 0,
  });

  const [gifts, setGifts] = useState<GiftNotifyData[]>([]);
  const [showGiftPanel, setShowGiftPanel] = useState(false);
  const [hostUserId, setHostUserId] = useState<string | null>(null);

  // ── Paint loop (rAF) ─────────────────────────────────────────
  const startPaintLoop = useCallback(() => {
    if (rafRef.current) return;
    const paint = () => {
      rafRef.current = requestAnimationFrame(paint);
      const frame = latestFrameRef.current;
      const canvas = canvasRef.current;
      if (!frame || !canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = frame.displayWidth;
      canvas.height = frame.displayHeight;
      ctx.drawImage(frame, 0, 0);
      latestFrameRef.current = null;
      frame.close();
    };
    rafRef.current = requestAnimationFrame(paint);
  }, []);

  const stopPaintLoop = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (latestFrameRef.current) {
      latestFrameRef.current.close();
      latestFrameRef.current = null;
    }
  }, []);

  // ── Video decoder setup ───────────────────────────────────────
  const createDecoder = useCallback((config: { codec: string; width: number; height: number; framerate: number }, idrChunk?: EncodedVideoChunk) => {
    if (typeof VideoDecoder === "undefined") {
      setState(s => ({ ...s, status: "error", error: "WebCodecs API non supportée par ce navigateur" }));
      return;
    }

    try {
      // Close previous decoder
      if (videoDecoderRef.current) {
        try { videoDecoderRef.current.close(); } catch { /* ok */ }
      }

      const decoder = new VideoDecoder({
        output: (frame: VideoFrame) => {
          if (latestFrameRef.current) {
            latestFrameRef.current.close();
          }
          latestFrameRef.current = frame;
        },
        error: (err: Error) => {
          console.error("[spectate] VideoDecoder error:", err);
          videoDecoderReadyRef.current = false;
          // Re-create decoder with saved config
          if (lastDecoderInitRef.current) {
            videoNeedsKeyframeRef.current = true;
            createDecoder(lastDecoderInitRef.current);
          }
        },
      });

      lastDecoderInitRef.current = config;
      streamWidthRef.current = config.width;
      streamHeightRef.current = config.height;

      const decoderConfig: VideoDecoderConfig = {
        codec: config.codec,
        codedWidth: config.width,
        codedHeight: config.height,
      };

      decoder.configure(decoderConfig);
      videoDecoderRef.current = decoder;
      videoNeedsKeyframeRef.current = false;

      // Feed buffered SPS+PPS then the IDR to prime the decoder
      if (idrChunk) {
        const spsChunks = pendingChunksRef.current.filter(c => c.nalType === 7);
        const ppsChunks = pendingChunksRef.current.filter(c => c.nalType === 8);
        for (const c of [...spsChunks, ...ppsChunks]) {
          try { decoder.decode(c.chunk); } catch { /* ok */ }
        }
        try { decoder.decode(idrChunk); } catch { /* ok */ }
        videoDecoderReadyRef.current = true;
        pendingChunksRef.current = [];
        startPaintLoop();
      }
    } catch (err) {
      console.error("[spectate] Failed to create VideoDecoder:", err);
      setState(s => ({ ...s, status: "error", error: "Échec du décodeur vidéo" }));
    }
  }, [startPaintLoop]);

  // ── WebSocket connection ──────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;

    let ws: WebSocket | null = null;
    let cancelled = false;

    async function connect() {
      try {
        // 1. Fetch spectator token + WS URL
        const res = await fetch(`/api/cloud-session/spectate?sessionId=${encodeURIComponent(sessionId)}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Unknown error" }));
          if (!cancelled) setState(s => ({ ...s, status: "error", error: err.error || "Session introuvable" }));
          return;
        }

        const { wsUrl, token, hostUserId: hostId } = await res.json() as { wsUrl: string; token: string; username: string; hostUserId?: string };
        if (cancelled) return;
        if (hostId) setHostUserId(hostId);

        // 2. Connect WebSocket
        ws = new WebSocket(wsUrl);
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;

        ws.onopen = () => {
          if (cancelled) return;
          // Send spectator_join
          ws!.send(JSON.stringify({
            type: "spectator_join",
            sessionId,
            token,
          }));
          setState(s => ({ ...s, status: "loading" }));
        };

        ws.onmessage = (event) => {
          if (cancelled) return;
          if (typeof event.data === "string") {
            try {
              const msg = JSON.parse(event.data);
              handleServerMessage(msg);
            } catch { /* ignore */ }
          } else if (event.data instanceof ArrayBuffer) {
            handleBinaryMessage(event.data);
          }
        };

        ws.onclose = (event) => {
          if (cancelled) return;
          console.log(`[spectate] WebSocket closed: ${event.code}`);
          wsRef.current = null;
          stopPaintLoop();
          if (videoDecoderRef.current) {
            try { videoDecoderRef.current.close(); } catch { /* ok */ }
            videoDecoderRef.current = null;
          }
          videoDecoderReadyRef.current = false;
          if (event.code === 1000) {
            setState(s => ({ ...s, status: "ended" }));
          } else {
            setState(s => ({ ...s, status: "error", error: `Connexion perdue (${event.code})` }));
          }
        };

        ws.onerror = () => {
          if (cancelled) return;
          setState(s => ({ ...s, status: "error", error: "Erreur de connexion au serveur de jeu" }));
        };
      } catch (err) {
        if (!cancelled) {
          setState(s => ({ ...s, status: "error", error: (err as Error).message }));
        }
      }
    }

    void connect();

    return () => {
      cancelled = true;
      stopPaintLoop();
      if (videoDecoderRef.current) {
        try { videoDecoderRef.current.close(); } catch { /* ok */ }
        videoDecoderRef.current = null;
      }
      videoDecoderReadyRef.current = false;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close(1000, "Page closed");
      }
    };
  }, [sessionId, stopPaintLoop, createDecoder]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Server message handlers ────────────────────────────────────
  function handleServerMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case "ready": {
        const w = (msg.width as number) || 320;
        const h = (msg.height as number) || 224;
        setState(s => ({ ...s, status: "running", width: w, height: h }));
        streamWidthRef.current = w;
        streamHeightRef.current = h;
        break;
      }
      case "spectator_count": {
        setState(s => ({ ...s, spectatorCount: (msg.count as number) || 0 }));
        break;
      }
      case "gift_notify": {
        const gift = msg as unknown as GiftNotifyData;
        setGifts(prev => [...prev, gift]);
        // Auto-remove after animation duration
        setTimeout(() => {
          setGifts(prev => prev.filter(g => g !== gift));
        }, 5000);
        break;
      }
      case "error": {
        setState(s => ({ ...s, status: "error", error: (msg.message as string) || "Erreur serveur" }));
        break;
      }
      case "session_closed": {
        setState(s => ({ ...s, status: "ended" }));
        break;
      }
      case "status": {
        setState(s => ({ ...s, fps: (msg.fps as number) || 0 }));
        break;
      }
      case "pong": {
        break; // keepalive
      }
    }
  }

  // ── Binary message handler (H.264 video frames) ────────────────
  function handleBinaryMessage(data: ArrayBuffer): void {
    const view = new DataView(data);
    if (data.byteLength < 1) return;

    const magic = view.getUint8(0);

    if (magic === FRAME_MAGIC) {
      if (data.byteLength < FRAME_HEADER_SIZE) return;

      const width = view.getUint16(1, true);
      const height = view.getUint16(3, true);
      const frameId = view.getUint32(5, true);
      const nalLength = view.getUint32(9, true);

      if (nalLength === 0 || FRAME_HEADER_SIZE + nalLength > data.byteLength) return;

      lastFrameIdRef.current = frameId;
      const nalData = new Uint8Array(data, FRAME_HEADER_SIZE, nalLength);
      const nalUnitType = getNalUnitType(nalData);

      const chunk = new EncodedVideoChunk({
        type: nalUnitType === 5 ? "key" : "delta",
        timestamp: frameId * 16667, // ~60fps in microseconds
        duration: 16667,
        data: nalData,
      });

      const decoder = videoDecoderRef.current;

      if (videoDecoderReadyRef.current && decoder) {
        if (videoNeedsKeyframeRef.current) {
          if (nalUnitType === 5) {
            // Feed buffered SPS/PPS before keyframe
            const spsPps = pendingChunksRef.current.filter(c => c.nalType === 7 || c.nalType === 8);
            for (const c of spsPps) {
              try { decoder.decode(c.chunk); } catch { /* ok */ }
            }
            try { decoder.decode(chunk); } catch { /* ok */ }
            videoNeedsKeyframeRef.current = false;
            pendingChunksRef.current = [];
          } else if (nalUnitType === 7 || nalUnitType === 8) {
            pendingChunksRef.current.push({ chunk, nalType: nalUnitType, nalData });
          }
          // Drop deltas before keyframe
        } else {
          if (decoder.decodeQueueSize < 16) {
            try { decoder.decode(chunk); } catch { /* ok */ }
          }
        }
      } else {
        // Buffer until decoder is ready
        pendingChunksRef.current.push({ chunk, nalType: nalUnitType, nalData });
        if (pendingChunksRef.current.length > 300) {
          pendingChunksRef.current.shift();
        }

        // Deferred decoder creation: wait for SPS+PPS+IDR
        if (pendingConfigRef.current && !decoder) {
          const hasSps = pendingChunksRef.current.some(c => c.nalType === 7);
          const hasPps = pendingChunksRef.current.some(c => c.nalType === 8);
          const idrEntry = pendingChunksRef.current.find(c => c.nalType === 5);
          if (hasSps && hasPps && idrEntry) {
            const cfg = pendingConfigRef.current;
            pendingConfigRef.current = null;
            createDecoder(cfg, idrEntry.chunk);
          }
        }
      }

      // Ensure canvas matches stream dimensions
      if (canvasRef.current && streamWidthRef.current > 0) {
        if (canvasRef.current.width !== streamWidthRef.current || canvasRef.current.height !== streamHeightRef.current) {
          canvasRef.current.width = streamWidthRef.current;
          canvasRef.current.height = streamHeightRef.current;
        }
      }

    } else if (magic === CODEC_CONFIG_MAGIC) {
      if (data.byteLength < CODEC_CFG_HEADER_SIZE) return;

      const payloadLen = view.getUint16(1, true);
      if (payloadLen === 0 || 3 + payloadLen > data.byteLength) return;

      const payload = new Uint8Array(data, 3, payloadLen);
      if (payload.length < 2) return;
      const videoDescLen = new DataView(payload.buffer, payload.byteOffset, 2).getUint16(0, true);
      if (2 + videoDescLen > payload.length) return;

      const videoDescJson = new TextDecoder().decode(payload.subarray(2, 2 + videoDescLen));

      try {
        const videoCfg = JSON.parse(videoDescJson) as { codec: string; width: number; height: number; framerate: number };
        streamWidthRef.current = videoCfg.width;
        streamHeightRef.current = videoCfg.height;
        setState(s => ({ ...s, width: videoCfg.width, height: videoCfg.height }));

        // Deferred decoder creation: check if we already have SPS+PPS+IDR buffered
        const hasSps = pendingChunksRef.current.some(c => c.nalType === 7);
        const hasPps = pendingChunksRef.current.some(c => c.nalType === 8);
        const idrEntry = pendingChunksRef.current.find(c => c.nalType === 5);

        if (hasSps && hasPps && idrEntry) {
          createDecoder(videoCfg, idrEntry.chunk);
        } else {
          pendingConfigRef.current = videoCfg;
        }
      } catch {
        // Ignore malformed codec config
      }
    }
    // Audio (0x02) is ignored for spectators — no audio needed
  }

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="relative w-full min-h-screen bg-black flex flex-col items-center justify-center">
      {/* Video Canvas */}
      <canvas
        ref={canvasRef}
        className="max-w-full max-h-[90vh] object-contain"
        style={{ imageRendering: "pixelated" }}
      />

      {/* Loading / Error overlay */}
      {state.status === "connecting" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-white">
          <div className="text-center">
            <div className="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full mx-auto mb-3" />
            <p className="text-lg">Connexion au match...</p>
          </div>
        </div>
      )}

      {state.status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-white">
          <div className="text-center">
            <div className="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full mx-auto mb-3" />
            <p className="text-lg">Chargement du flux vidéo...</p>
          </div>
        </div>
      )}

      {state.status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-white">
          <div className="text-center max-w-md p-6">
            <p className="text-red-400 text-lg mb-2">⚠️ Erreur</p>
            <p className="text-gray-300">{state.error || "Une erreur est survenue"}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-white/20 hover:bg-white/30 rounded text-sm"
            >
              Réessayer
            </button>
          </div>
        </div>
      )}

      {state.status === "ended" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-white">
          <div className="text-center">
            <p className="text-lg mb-2">Match terminé</p>
            <p className="text-gray-400 text-sm">La session a pris fin.</p>
          </div>
        </div>
      )}

      {/* Info bar (top) */}
      {state.status === "running" && (
        <div className="absolute top-2 left-2 right-2 flex items-center justify-between text-white text-xs px-3 py-1.5 bg-black/50 rounded backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
              LIVE
            </span>
            <span>{state.fps} fps</span>
          </div>
          <div className="flex items-center gap-3">
            {/* Gift button */}
            {hostUserId && (
              <button
                onClick={() => setShowGiftPanel(true)}
                className="flex items-center gap-1 hover:text-yellow-400 transition-colors"
                title="Envoyer un cadeau"
              >
                <Gift className="w-3.5 h-3.5" />
              </button>
            )}
            <div className="flex items-center gap-1.5">
              <span>👁️</span>
              <span>{state.spectatorCount}</span>
            </div>
          </div>
        </div>
      )}

      {/* Gift Overlays */}
      {gifts.map((gift, i) => (
        <GiftOverlay key={`${gift.gift?.id || "gift"}-${i}`} gift={gift} index={i} />
      ))}

      {/* Gift Panel Modal */}
      {showGiftPanel && hostUserId && (
        <GiftPanel
          open={showGiftPanel}
          onClose={() => setShowGiftPanel(false)}
          receiverId={hostUserId}
          sessionId={sessionId}
        />
      )}

      {/* Donor Ranking Sidebar */}
      {state.status === "running" && <DonorRanking />}
    </div>
  );
}
