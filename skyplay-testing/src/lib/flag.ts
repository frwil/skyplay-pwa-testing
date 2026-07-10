/**
 * Convert an ISO-3166 alpha-2 country code (e.g. "FR") to its emoji flag using Unicode
 * regional indicator symbols. Returns "" for missing/invalid codes. No external dependency.
 */
export function countryToFlag(code?: string | null): string {
  if (!code) return "";
  const c = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "";
  const base = 0x1f1e6; // regional indicator 'A'
  return String.fromCodePoint(base + (c.charCodeAt(0) - 65), base + (c.charCodeAt(1) - 65));
}
