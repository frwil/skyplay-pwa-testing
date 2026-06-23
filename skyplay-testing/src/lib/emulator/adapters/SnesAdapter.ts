import { BaseNostalgistAdapter, type NostalgistCallbacks } from "./BaseNostalgistAdapter";
import type { SystemType } from "../types";

export class SnesEmulatorAdapter extends BaseNostalgistAdapter {
  readonly coreName = "snes9x";

  constructor(callbacks: NostalgistCallbacks) {
    super("snes", callbacks);
  }
}
