import { STATE_BUFFER_SIZE } from "../constants";
import type { StateBufferInterface } from "../types";

/**
 * Circular buffer for emulator save-state snapshots.
 *
 * Stores up to `size` deep-cloned states from `nes.toJSON()`.
 * Supports rollback: when a late remote input arrives,
 * we can retrieve the state from N frames ago and fast-forward.
 *
 * Uses JSON round-trip for deep cloning to avoid shared references.
 * For production with large states, consider `structuredClone`.
 */
export class StateBuffer implements StateBufferInterface {
  private buffer: (object | null)[];
  private head: number = 0; // Next write position
  private count: number = 0; // Number of valid entries
  private readonly size: number;

  constructor(size: number = STATE_BUFFER_SIZE) {
    this.size = size;
    this.buffer = new Array(size).fill(null);
  }

  /** Push a deep-cloned snapshot into the buffer. */
  push(state: object): void {
    // Deep clone via JSON round-trip to avoid mutation during fast-forward
    const clone = JSON.parse(JSON.stringify(state));
    this.buffer[this.head] = clone;
    this.head = (this.head + 1) % this.size;
    if (this.count < this.size) {
      this.count++;
    }
  }

  /**
   * Retrieve the state from `framesAgo` frames in the past.
   * 0 = most recent state pushed, 1 = one frame ago, etc.
   */
  get(framesAgo: number): object | null {
    if (framesAgo < 0 || framesAgo >= this.count) return null;
    const index = (this.head - 1 - framesAgo + this.size) % this.size;
    return this.buffer[index];
  }

  /** The most recently pushed state. */
  get current(): object | null {
    return this.get(0);
  }

  /** Number of valid entries currently stored. */
  get length(): number {
    return this.count;
  }

  /** Clear all stored states. */
  clear(): void {
    this.buffer.fill(null);
    this.head = 0;
    this.count = 0;
  }
}
