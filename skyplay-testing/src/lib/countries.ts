/**
 * Curated list of ISO-3166 alpha-2 country codes for the profile nationality selector.
 * Display names are resolved at render time via Intl.DisplayNames(locale), so no country
 * name is hardcoded — the flag comes from `countryToFlag`.
 */
export const COUNTRY_CODES: string[] = [
  "FR", "BE", "CH", "CA", "US", "GB", "DE", "ES", "IT", "PT", "NL", "IE", "LU",
  "MA", "DZ", "TN", "SN", "CI", "CM", "CG", "CD", "GA", "ML", "BF", "BJ", "TG",
  "NE", "GN", "MG", "MU", "RE", "GP", "MQ", "GF", "HT",
  "BR", "AR", "MX", "CO", "CL", "PE", "VE",
  "JP", "KR", "CN", "TW", "HK", "TH", "VN", "PH", "ID", "MY", "SG", "IN", "PK",
  "AU", "NZ",
  "RU", "UA", "PL", "RO", "CZ", "SK", "HU", "GR", "TR", "SE", "NO", "DK", "FI",
  "AT", "HR", "RS", "BG", "LT", "LV", "EE",
  "EG", "SA", "AE", "QA", "IL", "LB", "JO", "IR", "IQ",
  "NG", "GH", "KE", "ZA", "ET", "TZ", "UG", "AO", "MZ",
];

/** Localized display name for a country code, e.g. "France" / "Allemagne". Falls back to the code. */
export function countryName(code: string, locale: string): string {
  try {
    const dn = new Intl.DisplayNames([locale], { type: "region" });
    return dn.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}
