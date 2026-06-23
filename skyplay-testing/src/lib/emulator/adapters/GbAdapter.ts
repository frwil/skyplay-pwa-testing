import { BaseNostalgistAdapter, type NostalgistCallbacks } from "./BaseNostalgistAdapter";
import type { SystemType } from "../types";

/**
 * GB/GBC adapter using Nostalgist.js with the gambatte core.
 * systemType is set at construction to allow both "gb" and "gbc".
 */
export class GbEmulatorAdapter extends BaseNostalgistAdapter {
  readonly coreName = "gambatte";

  constructor(systemType: "gb" | "gbc", callbacks: NostalgistCallbacks) {
    super(systemType, callbacks);
  }
}
