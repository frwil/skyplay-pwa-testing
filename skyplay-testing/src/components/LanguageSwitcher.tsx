"use client";

import { useTranslation } from "@/lib/i18n/TranslationContext";
import type { Locale } from "@/lib/i18n/types";

const flags: Record<Locale, string> = {
  fr: "🇫🇷",
  en: "🇬🇧",
};

const nextLocale: Record<Locale, Locale> = {
  fr: "en",
  en: "fr",
};

export default function LanguageSwitcher() {
  const { locale, setLocale } = useTranslation();

  return (
    <button
      onClick={() => setLocale(nextLocale[locale])}
      className="text-sm px-2 py-1 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] transition"
      title={locale === "fr" ? "Switch to English" : "Passer en français"}
    >
      {flags[locale]}
    </button>
  );
}
