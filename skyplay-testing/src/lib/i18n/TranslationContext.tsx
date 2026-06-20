"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { Locale, Dictionary } from "./types";
import fr from "./dictionaries/fr";
import en from "./dictionaries/en";

const dictionaries: Record<Locale, Dictionary> = { fr, en };

const COOKIE_NAME = "skyplay-locale";

function getInitialLocale(): Locale {
  if (typeof document === "undefined") return "fr";
  const stored = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${COOKIE_NAME}=`))
    ?.split("=")[1];
  if (stored === "fr" || stored === "en") return stored;
  // Fallback to browser language
  const nav = navigator.language.toLowerCase();
  if (nav.startsWith("en")) return "en";
  return "fr";
}

interface TranslationContextValue {
  locale: Locale;
  t: Dictionary;
  setLocale: (locale: Locale) => void;
}

const TranslationContext = createContext<TranslationContextValue | null>(null);

export function TranslationProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    // Persist in cookie (1 year)
    document.cookie = `${COOKIE_NAME}=${next};path=/;max-age=31536000;SameSite=Lax`;
  }, []);

  const t = dictionaries[locale];

  return (
    <TranslationContext.Provider value={{ locale, t, setLocale }}>
      {children}
    </TranslationContext.Provider>
  );
}

export function useTranslation(): TranslationContextValue {
  const ctx = useContext(TranslationContext);
  if (!ctx) {
    throw new Error("useTranslation must be used within a TranslationProvider");
  }
  return ctx;
}
