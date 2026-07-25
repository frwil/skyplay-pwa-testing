// SFA2 (Street Fighter Alpha 2) SNES character ID → display name.
// Mirror of SFA2_CHARACTERS in apps/game-server/src/game-runner.ts — keep both in sync.
// IDs are the emulator RAM values (0x00–0x11). Authoritative mapping confirmed
// via RAM double-match differential (2026-07-25): Ryu=0x00, Ken=0x01, Chun-Li=0x04.
// Full mapping validated against SFA2 EU ROM character table.
export const SFA2_CHARACTERS: Record<number, string> = {
  0x00: "Ryu",
  0x01: "Ken",
  0x02: "Akuma",
  0x03: "Charlie",
  0x04: "Chun-Li",
  0x05: "Adon",
  0x06: "Sakura",
  0x07: "Guy",
  0x08: "Birdie",
  0x09: "Sodom",
  0x0A: "Rose",
  0x0B: "Dan",
  0x0C: "M. Bison",
  0x0D: "Sagat",
  0x0E: "Rolento",
  0x0F: "Dhalsim",
  0x10: "Zangief",
  0x11: "Gen",
};

/** Resolve an SFA2 character ID to its display name. Returns "?" for unknown IDs. */
export function sfa2CharName(id: number): string {
  return SFA2_CHARACTERS[id] ?? "?";
}

/** SFA2 character ID range: 0x00–0x11 (18 characters). */
export const SFA2_CHAR_ID_MIN = 0x00;
export const SFA2_CHAR_ID_MAX = 0x11;
