import type { Locale, Dictionary } from "./types";
import fr from "./dictionaries/fr";
import en from "./dictionaries/en";

const dictionaries: Record<Locale, Dictionary> = { fr, en };

/**
 * Resolve locale from an Accept-Language header or fallback to "fr".
 * Use in server components / API routes that don't have access to the cookie.
 */
export function resolveLocale(acceptLanguage?: string | null): Locale {
  if (acceptLanguage) {
    const first = acceptLanguage.split(",")[0]?.trim().toLowerCase();
    if (first?.startsWith("en")) return "en";
  }
  return "fr";
}

/**
 * Parse locale from a cookie string (the raw `cookie` header).
 */
export function getLocaleFromCookie(cookieHeader?: string): Locale {
  if (!cookieHeader) return "fr";
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("skyplay-locale="));
  if (match) {
    const value = match.split("=")[1];
    if (value === "fr" || value === "en") return value;
  }
  return "fr";
}

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
