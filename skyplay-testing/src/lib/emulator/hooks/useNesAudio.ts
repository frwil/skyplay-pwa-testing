"use client";

import { useRef, useCallback, useState } from "react";
import { SAMPLE_RATE, AUDIO_BUFFER_SIZE, RING_BUFFER_SIZE } from "../constants";

/**
 * Web Audio API hook for jsnes audio output.
 *
 * Manages an AudioContext with a ScriptProcessorNode and a
 * Float32Array ring buffer to decouple emulator sample
 * production (per-frame at ~48000Hz) from audio output consumption.
 *
 * Exposes mute/unmute for rollback readiness (audio is muted
 * during the fast-forward recalc phase).
 */
export function useNesAudio() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  // Ring buffer for stereo samples
  const ringRef = useRef<Float32Array>(new Float32Array(RING_BUFFER_SIZE));
  const writePosRef = useRef<number>(0);
  const readPosRef = useRef<number>(0);

  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolumeState] = useState(1.0);
  const volumeRef = useRef(1.0);

  /** Initialize AudioContext lazily (must be called from a user gesture). */
  const init = useCallback(() => {
    if (audioCtxRef.current) return;

    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "playback" });
    audioCtxRef.current = ctx;

    const gain = ctx.createGain();
    gain.gain.value = volumeRef.current;
    gain.connect(ctx.destination);
    gainNodeRef.current = gain;

    // ScriptProcessorNode for low-latency audio output
    const node = ctx.createScriptProcessor(AUDIO_BUFFER_SIZE, 0, 2);
    node.onaudioprocess = (e: AudioProcessingEvent) => {
      const outL = e.outputBuffer.getChannelData(0);
      const outR = e.outputBuffer.getChannelData(1);
      const ring = ringRef.current;
      let readIdx = readPosRef.current;
      let writeIdx = writePosRef.current;
      const mask = RING_BUFFER_SIZE - 1;

      for (let i = 0; i < outL.length; i++) {
        if (readIdx !== writeIdx) {
          outL[i] = ring[readIdx];
          readIdx = (readIdx + 1) & mask;
          if (readIdx !== writeIdx) {
            outR[i] = ring[readIdx];
            readIdx = (readIdx + 1) & mask;
          } else {
            outR[i] = outL[i]; // mono fallback
          }
        } else {
          outL[i] = 0;
          outR[i] = 0;
        }
      }
      readPosRef.current = readIdx;
    };
    node.connect(gain);
    scriptNodeRef.current = node;
  }, []);

  /** Enqueue a single audio sample (called by jsnes onAudioSample callback). */
  const enqueueSample = useCallback((left: number, right: number) => {
    const ring = ringRef.current;
    const mask = RING_BUFFER_SIZE - 1;
    let writeIdx = writePosRef.current;
    const readIdx = readPosRef.current;

    // Check if buffer is full (drop oldest samples if consumer can't keep up)
    const nextWrite = (writeIdx + 2) & mask;
    if (nextWrite === readIdx) {
      // Buffer full — advance read pointer to drop 2 samples
      readPosRef.current = (readIdx + 2) & mask;
    }

    ring[writeIdx] = left;
    writeIdx = (writeIdx + 1) & mask;
    ring[writeIdx] = right;
    writeIdx = (writeIdx + 1) & mask;
    writePosRef.current = writeIdx;
  }, []);

  /** Mute audio (used during rollback fast-forward). */
  const mute = useCallback(() => {
    setIsMuted(true);
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = 0;
    }
  }, []);

  /** Unmute audio (restore after rollback). */
  const unmute = useCallback(() => {
    setIsMuted(false);
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volumeRef.current;
    }
  }, []);

  /** Set volume (0 to 1). */
  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    volumeRef.current = clamped;
    setVolumeState(clamped);
    if (gainNodeRef.current && !isMuted) {
      gainNodeRef.current.gain.value = clamped;
    }
  }, [isMuted]);

  /** Resume suspended AudioContext (after browser autoplay policy). */
  const resume = useCallback(async () => {
    if (audioCtxRef.current?.state === "suspended") {
      await audioCtxRef.current.resume();
    }
  }, []);

  /** Clean up audio resources. */
  const destroy = useCallback(() => {
    if (scriptNodeRef.current) {
      scriptNodeRef.current.disconnect();
      scriptNodeRef.current = null;
    }
    if (gainNodeRef.current) {
      gainNodeRef.current.disconnect();
      gainNodeRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  return {
    init,
    enqueueSample,
    mute,
    unmute,
    setVolume,
    resume,
    destroy,
    volume,
    isMuted,
    audioContext: audioCtxRef,
  };
}
