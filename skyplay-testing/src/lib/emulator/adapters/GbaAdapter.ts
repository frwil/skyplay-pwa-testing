import { BaseNostalgistAdapter, type NostalgistCallbacks } from "./BaseNostalgistAdapter";
import type { SystemType } from "../types";

export class GbaEmulatorAdapter extends BaseNostalgistAdapter {
  readonly coreName = "mgba";

  constructor(callbacks: NostalgistCallbacks) {
    super("gba", callbacks);
  }
}
