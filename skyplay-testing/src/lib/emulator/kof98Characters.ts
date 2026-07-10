// KOF98 character ID → display name.
// Mirror of KOF98_CHARACTERS in apps/game-server/src/game-runner.ts — keep both in sync.
// IDs are the emulator RAM values (0x00–0x25). The game-server sends team rosters as
// names, but selection-order and stats payloads use raw IDs (resolved here on display).
export const KOF98_CHARACTERS: Record<number, string> = {
  0x00: "Kyo Kusanagi",     0x01: "Benimaru Nikaido",  0x02: "Goro Daimon",
  0x03: "Terry Bogard",     0x04: "Andy Bogard",       0x05: "Joe Higashi",
  0x06: "Ryo Sakazaki",     0x07: "Robert Garcia",     0x08: "Yuri Sakazaki",
  0x09: "Leona Heidern",    0x0a: "Ralf Jones",        0x0b: "Clark Still",
  0x0c: "Athena Asamiya",   0x0d: "Sie Kensou",        0x0e: "Chin Gentsai",
  0x0f: "Chizuru Kagura",   0x10: "Mai Shiranui",      0x11: "King",
  0x12: "Kim Kaphwan",      0x13: "Chang Koehan",      0x14: "Choi Bounge",
  0x15: "Yashiro Nanakase", 0x16: "Shermie",           0x17: "Chris",
  0x18: "Ryuji Yamazaki",   0x19: "Blue Mary",         0x1a: "Billy Kane",
  0x1b: "Iori Yagami",      0x1c: "Mature",            0x1d: "Vice",
  0x1e: "Heidern",          0x1f: "Takuma Sakazaki",   0x20: "Saisyu Kusanagi",
  0x21: "Heavy D!",         0x22: "Lucky Glauber",     0x23: "Brian Battler",
  0x24: "Rugal Bernstein",  0x25: "Shingo Yabuki",
};

/** Resolve a character ID to a display name, with a hex fallback for unknown IDs. */
export function charName(id: number): string {
  return KOF98_CHARACTERS[id] ?? `0x${id.toString(16).padStart(2, "0")}`;
}

/** Resolve an array of character IDs to names (skips out-of-range/sentinel values like -1). */
export function charNames(ids: number[] | null | undefined): string[] {
  if (!ids) return [];
  return ids.filter((id) => id >= 0x00 && id <= 0x25).map(charName);
}
