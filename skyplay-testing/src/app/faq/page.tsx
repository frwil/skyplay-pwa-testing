"use client";

import { useState } from "react";
import GlowBackground from "@/components/GlowBackground";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { ChevronDown, ArrowLeft } from "lucide-react";
import { useTranslation } from "@/lib/i18n/TranslationContext";

export default function FaqPage() {
  const { t } = useTranslation();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggleEntry = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <main className="relative min-h-screen">
      <GlowBackground />

      {/* Header */}
      <header className="relative z-10 border-b border-white/5 bg-[#070f1e]/80 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <a href="/" className="block">
            <div
              className="font-black text-xl uppercase tracking-[3px]"
              style={{
                background:
                  "linear-gradient(135deg, #00d2ff 0%, #9b5de5 50%, #f15bb5 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              {t.common.siteTitle}
            </div>
            <div
              className="uppercase tracking-[4px] mt-0.5"
              style={{ fontSize: "8px", color: "rgba(255,255,255,0.4)" }}
            >
              {t.common.siteSubtitle}
            </div>
          </a>

          <div className="flex items-center gap-4">
            <LanguageSwitcher />
            <a
              href="/"
              className="text-xs text-white/40 hover:text-white transition font-medium flex items-center gap-1"
            >
              <ArrowLeft className="w-3 h-3" />
              {t.common.back}
            </a>
            <a
              href="/admin"
              className="text-xs text-white/40 hover:text-white transition font-medium"
            >
              {t.common.admin}
            </a>
          </div>
        </div>
      </header>

      {/* Content */}
      <section className="relative z-10 max-w-2xl mx-auto px-4 py-12 pb-20">
        <div className="text-center mb-10">
          <h1 className="text-3xl sm:text-4xl font-black text-white mb-3">
            {t.faq.title}
          </h1>
          <p className="text-sm text-white/40 max-w-md mx-auto">
            {t.faq.subtitle}
          </p>
        </div>

        <div className="space-y-3">
          {t.faq.entries.map((entry, index) => (
            <div
              key={index}
              className="rounded-2xl border overflow-hidden transition-all duration-200"
              style={{
                backgroundColor: "rgba(13,27,46,0.8)",
                borderColor: "rgba(255,255,255,0.08)",
              }}
            >
              <button
                onClick={() => toggleEntry(index)}
                className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left group"
              >
                <span className="text-sm font-bold text-white/80 group-hover:text-white transition pr-2">
                  {entry.question}
                </span>
                <ChevronDown
                  className="w-4 h-4 text-white/30 shrink-0 transition-transform duration-200"
                  style={{
                    transform:
                      openIndex === index ? "rotate(180deg)" : "rotate(0deg)",
                  }}
                />
              </button>

              {openIndex === index && (
                <div className="px-5 pb-4 pt-0">
                  <div
                    className="rounded-xl p-4 text-sm leading-relaxed"
                    style={{
                      backgroundColor: "rgba(0,200,255,0.05)",
                      borderColor: "rgba(0,200,255,0.1)",
                      border: "1px solid rgba(0,200,255,0.1)",
                      color: "rgba(255,255,255,0.6)",
                    }}
                  >
                    {entry.answer}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 py-6 px-4 text-center">
        <p className="text-xs text-white/20">
          {t.common.footer}
        </p>
      </footer>
    </main>
  );
}
