"use client";

import { TranslationProvider } from "@/lib/i18n/TranslationContext";
import type { ReactNode } from "react";

export default function Providers({ children }: { children: ReactNode }) {
  return <TranslationProvider>{children}</TranslationProvider>;
}
