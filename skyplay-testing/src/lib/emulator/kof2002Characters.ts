// KOF2002 character ID → display name.
// Mirror of KOF2002_CHARACTERS in apps/game-server/src/game-runner.ts — keep both in sync.
// ⚠️ IDs are UNVERIFIED (KOF2002 ROM incompatible with current FBNeo).
// Based on NeoGeo memory encoding, likely same scheme as KOF98. Verify via RAM scan
// once a compatible ROM is available.
export const KOF2002_CHARACTERS: Record<number, string> = {
  // ── KOF2002 roster (42+ characters) ─────────────────────────────
  // IDs need verification — these are educated guesses based on KOF98 encoding.
  // The KOF2002 roster is different from KOF98:
  //   New: K', Maxima, Whip, Kula, K9999, Angel, May Lee, Vanessa, Seth, Ramon
  //   Removed: Chizuru, Mature, Vice, Shingo, Saisyu, Heavy D!, Lucky, Brian, Rugal
  0x00: "Kyo Kusanagi",
  0x01: "Benimaru Nikaido",
  0x02: "Goro Daimon",
  0x03: "Terry Bogard",
  0x04: "Andy Bogard",
  0x05: "Joe Higashi",
  0x06: "Ryo Sakazaki",
  0x07: "Robert Garcia",
  0x08: "Yuri Sakazaki",
  0x09: "Leona Heidern",
  0x0A: "Ralf Jones",
  0x0B: "Clark Still",
  0x0C: "Athena Asamiya",
  0x0D: "Sie Kensou",
  0x0E: "Chin Gentsai",
  0x0F: "Mai Shiranui",
  0x10: "King",
  0x11: "Kim Kaphwan",
  0x12: "Chang Koehan",
  0x13: "Choi Bounge",
  0x14: "Yashiro Nanakase",
  0x15: "Shermie",
  0x16: "Chris",
  0x17: "Ryuji Yamazaki",
  0x18: "Blue Mary",
  0x19: "Billy Kane",
  0x1A: "Iori Yagami",
  0x1B: "Heidern",
  0x1C: "Takuma Sakazaki",
  // ── KOF2002 newcomers (IDs guessed, verify!) ────────────────────
  0x1D: "K'",
  0x1E: "Maxima",
  0x1F: "Whip",
  0x20: "Kula Diamond",
  0x21: "K9999",
  0x22: "Angel",
  0x23: "May Lee",
  0x24: "Vanessa",
  0x25: "Seth",
  0x26: "Ramon",
  // ── Bosses ──────────────────────────────────────────────────────
  0x30: "Omega Rugal",
};

/** Resolve a KOF2002 character ID to its display name. Returns "?" for unknown IDs. */
export function kof2002CharName(id: number): string {
  return KOF2002_CHARACTERS[id] ?? "?";
}

/** KOF2002 character ID range. Use broad range until verified. */
export const KOF2002_CHAR_ID_MIN = 0x00;
export const KOF2002_CHAR_ID_MAX = 0x3F;
