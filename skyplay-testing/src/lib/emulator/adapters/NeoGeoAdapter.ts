import { BaseNostalgistAdapter, type NostalgistCallbacks } from "./BaseNostalgistAdapter";
import type { SystemType } from "../types";

export class NeoGeoEmulatorAdapter extends BaseNostalgistAdapter {
  readonly coreName = "fbneo";

  constructor(callbacks: NostalgistCallbacks) {
    super("neogeo", callbacks);
  }
}
