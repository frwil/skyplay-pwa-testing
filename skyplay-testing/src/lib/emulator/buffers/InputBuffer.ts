import { INPUT_BUFFER_SIZE } from "../constants";
import type { InputBufferInterface, InputFrame } from "../types";

/**
 * Circular buffer for per-frame input records.
 *
 * Stores up to `size` InputFrame entries { frame, p1, p2 }.
 * Supports rollback via the `update()` method:
 * when a late remote input arrives, the corresponding
 * historical frame entry is corrected without affecting others.
 */
export class InputBuffer implements InputBufferInterface {
  private buffer: (InputFrame | null)[];
  private head: number = 0; // Next write position
  private count: number = 0; // Number of valid entries
  private readonly size: number;

  constructor(size: number = INPUT_BUFFER_SIZE) {
    this.size = size;
    this.buffer = new Array(size).fill(null);
  }

  /** Push a new input frame record. */
  push(frame: number, p1: number, p2: number): void {
    this.buffer[this.head] = { frame, p1, p2 };
    this.head = (this.head + 1) % this.size;
    if (this.count < this.size) {
      this.count++;
    }
  }

  /**
   * Retrieve input record from `framesAgo` frames in the past.
   * 0 = most recent, 1 = one frame ago, etc.
   */
  get(framesAgo: number): InputFrame | null {
    if (framesAgo < 0 || framesAgo >= this.count) return null;
    const index = (this.head - 1 - framesAgo + this.size) % this.size;
    return this.buffer[index];
  }

  /**
   * Update inputs for a historical frame.
   * Used during rollback when a remote peer's late input arrives.
   * Only updates the provided fields (p1/p2), leaves the other unchanged.
   */
  update(framesAgo: number, p1?: number, p2?: number): void {
    if (framesAgo < 0 || framesAgo >= this.count) return;
    const index = (this.head - 1 - framesAgo + this.size) % this.size;
    const entry = this.buffer[index];
    if (entry) {
      if (p1 !== undefined) entry.p1 = p1;
      if (p2 !== undefined) entry.p2 = p2;
    }
  }

  /** Number of valid entries currently stored. */
  get length(): number {
    return this.count;
  }

  /** Clear all stored input frames. */
  clear(): void {
    this.buffer.fill(null);
    this.head = 0;
    this.count = 0;
  }
}
