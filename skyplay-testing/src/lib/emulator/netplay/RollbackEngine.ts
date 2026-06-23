import { STATE_BUFFER_SIZE } from "../constants";
import type { StateBuffer } from "../buffers/StateBuffer";
import type { InputBuffer } from "../buffers/InputBuffer";

/**
 * GGPO-style rollback engine for NES netplay.
 *
 * When a remote player's input arrives late (after we've already predicted
 * and rendered those frames), we:
 *
 * 1. Restore the savestate from N frames ago
 * 2. Correct the remote input in our InputBuffer
 * 3. Mute audio
 * 4. Replay (fast-forward) the corrected frames
 * 5. Unmute audio
 *
 * This keeps inputs responsive locally while maintaining synchronization.
 *
 * IMPORTANT: NES only. SNES/GB/GBA via Nostalgist.js do not support
 * toJSON()/fromJSON() required for rollback.
 */
export class RollbackEngine {
  /** Queue of late remote inputs waiting to be processed. */
  private remoteInputQueue: Array<{
    frame: number;
    p1?: number;
    p2?: number;
  }> = [];

  private totalRollbacks = 0;

  /** Number of rollbacks performed since session start. */
  get rollbackCount(): number {
    return this.totalRollbacks;
  }

  /**
   * Enqueue a remote input for processing.
   * Called when a NetplayInputMessage arrives via DataChannel.
   */
  queueRemoteInput(frame: number, p1?: number, p2?: number): void {
    this.remoteInputQueue.push({ frame, p1, p2 });
  }

  /**
   * Process all queued remote inputs that are for past frames.
   *
   * This should be called once per frame AFTER advancing the emulator,
   * so the current frame count reflects the latest rendered frame.
   *
   * @param currentFrame - The absolute frame number just rendered.
   * @param nes - The jsnes instance (must have fromJSON).
   * @param stateBuffer - Circular buffer of savestates.
   * @param inputBuffer - Circular buffer of input records.
   * @param muteAudio - Callback to mute audio during fast-forward.
   * @param unmuteAudio - Callback to unmute audio after replay.
   * @param applyInputs - Function to inject button transitions into jsnes.
   * @returns The number of frames rollbacked this call.
   */
  processRemoteInputs(
    currentFrame: number,
    nes: { fromJSON(state: object): void; frame(): void },
    stateBuffer: StateBuffer,
    inputBuffer: InputBuffer,
    muteAudio: () => void,
    unmuteAudio: () => void,
    applyInputs: (
      player: 1 | 2,
      bitmask: number,
      prevBitmask: number,
    ) => void,
  ): number {
    if (this.remoteInputQueue.length === 0) return 0;

    let totalReplayed = 0;

    // Sort by frame number ascending (oldest first)
    // We need to process the oldest late inputs first and replay forward
    this.remoteInputQueue.sort((a, b) => a.frame - b.frame);

    while (this.remoteInputQueue.length > 0) {
      const input = this.remoteInputQueue[0];
      const framesAgo = currentFrame - input.frame;

      // Input for the future or current frame — leave in queue for later
      if (framesAgo <= 0) {
        // If it's for the current frame, we can use it as prediction next frame
        break;
      }

      // Too late to rollback — discard
      if (framesAgo >= STATE_BUFFER_SIZE) {
        this.remoteInputQueue.shift();
        continue;
      }

      // Perform the rollback
      const replayed = this.rewindAndReplay(
        framesAgo,
        currentFrame,
        input.p1,
        input.p2,
        nes,
        stateBuffer,
        inputBuffer,
        muteAudio,
        unmuteAudio,
        applyInputs,
      );

      totalReplayed += replayed;
      this.remoteInputQueue.shift();
    }

    this.totalRollbacks += totalReplayed > 0 ? 1 : 0;
    return totalReplayed;
  }

  /**
   * Rewind to a past state, correct the input, and fast-forward back.
   *
   * @returns Number of frames replayed.
   */
  private rewindAndReplay(
    framesAgo: number,
    currentFrame: number,
    correctedP1: number | undefined,
    correctedP2: number | undefined,
    nes: { fromJSON(state: object): void; frame(): void },
    stateBuffer: StateBuffer,
    inputBuffer: InputBuffer,
    muteAudio: () => void,
    unmuteAudio: () => void,
    applyInputs: (
      player: 1 | 2,
      bitmask: number,
      prevBitmask: number,
    ) => void,
  ): number {
    // 1. Restore state from framesAgo frames ago
    const restoreState = stateBuffer.get(framesAgo);
    if (!restoreState) return 0; // Not enough history

    // 2. Update the input record at the rollback point
    inputBuffer.update(framesAgo, correctedP1, correctedP2);

    // 3. Mute audio for the fast-forward
    muteAudio();

    try {
      // Restore emulator state
      nes.fromJSON(restoreState);

      // 4. Replay frames from (currentFrame - framesAgo) to currentFrame
      // We need to replay 'framesAgo' frames total.
      // The first frame to replay has its inputs in inputBuffer.get(framesAgo - 1)
      // The last frame to replay has its inputs in inputBuffer.get(0)
      // Track previous bitmasks across the replay for edge detection
      // Pre-replay: get the input from ONE frame before the rollback point
      let prevP1 = 0;
      let prevP2 = 0;
      const preRollbackInput = inputBuffer.get(framesAgo);
      if (preRollbackInput) {
        prevP1 = preRollbackInput.p1;
        prevP2 = preRollbackInput.p2;
      }

      for (let i = 0; i < framesAgo; i++) {
        const framesBack = framesAgo - 1 - i;
        const inputRecord = inputBuffer.get(framesBack);
        if (!inputRecord) continue;

        // Apply inputs with edge detection
        applyInputs(1, inputRecord.p1, prevP1);
        applyInputs(2, inputRecord.p2, prevP2);

        prevP1 = inputRecord.p1;
        prevP2 = inputRecord.p2;

        // Advance the emulator one frame
        nes.frame();
      }
    } catch (err) {
      console.error("[RollbackEngine] Error during replay:", err);
    } finally {
      // 5. Unmute audio
      unmuteAudio();
    }

    return framesAgo;
  }

  /** Clear the input queue and reset counters. */
  reset(): void {
    this.remoteInputQueue = [];
    this.totalRollbacks = 0;
  }
}
