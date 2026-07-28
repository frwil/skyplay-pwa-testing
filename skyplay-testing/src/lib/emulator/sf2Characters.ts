// SF2 (Street Fighter II) SNES character ID → display name.
// Mirror of SF2_CHARACTERS in apps/game-server/src/game-runner.ts — keep both in sync.
// ⚠️ IDs are UNVERIFIED for the "Street Fighter 5 (Hack).smc" ROM.
// Based on standard SF2 Turbo SNES PAR data. Verify via RAM scan.
export const SF2_CHARACTERS: Record<number, string> = {
  0x00: "Ryu",
  0x01: "Ken",
  0x02: "E. Honda",
  0x03: "Chun-Li",
  0x04: "Blanka",
  0x05: "Zangief",
  0x06: "Guile",
  0x07: "Dhalsim",
  0x08: "Balrog",
  0x09: "Vega",
  0x0A: "Sagat",
  0x0B: "M. Bison",
  0x0C: "Fei Long",
  0x0D: "Cammy",
  0x0E: "T. Hawk",
  0x0F: "Dee Jay",
  0x10: "Akuma",
};

/** Resolve a SF2 character ID to its display name. Returns "?" for unknown IDs. */
export function sf2CharName(id: number): string {
  return SF2_CHARACTERS[id] ?? "?";
}

/** SF2 character ID range. */
export const SF2_CHAR_ID_MIN = 0x00;
export const SF2_CHAR_ID_MAX = 0x1F;
