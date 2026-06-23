"use client";

import { useState } from "react";
import GlowBackground from "@/components/GlowBackground";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import EmulatorCore from "@/components/play/EmulatorCore";
import DesktopDownloadBanner from "@/components/play/DesktopDownloadBanner";
import ChallengePanel from "@/components/play/ChallengePanel";
import { useEmulator } from "@/lib/emulator/hooks/useEmulator";
import { useTranslation } from "@/lib/i18n/TranslationContext";
import { ArrowLeft, Gamepad2 } from "lucide-react";
import type { SystemType } from "@/lib/emulator/types";

export default function PlayPage() {
  const { t } = useTranslation();
  const [system, setSystem] = useState<SystemType>("nes");
  const emu = useEmulator(system);
  const [autoDetectResult, setAutoDetectResult] = useState<{
    result: string;
    romName: string;
  } | null>(null);

  return (
    <main className="relative min-h-screen">
      <GlowBackground />

      {/* Header */}
      <header
        className="relative z-10 border-b border-white/5 bg-[#070f1e]/80 backdrop-blur-sm"
      >
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
              href="/faq"
              className="text-xs text-white/40 hover:text-white transition font-medium"
            >
              {t.common.faq}
            </a>
            <a
              href="/admin"
              className="text-xs text-white/40 hover:text-white transition font-medium"
            >
              {t.common.admin}
            </a>
            <span
              className="px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5"
              style={{
                backgroundColor: "rgba(0,200,255,0.1)",
                border: "1px solid rgba(0,200,255,0.3)",
                color: "#00c8ff",
              }}
            >
              <Gamepad2 className="w-3 h-3" />
              PLAY
            </span>
          </div>
        </div>
      </header>

      {/* Content */}
      <section className="relative z-10 max-w-4xl mx-auto px-4 py-8 pb-20">
        {/* Page Title */}
        <div className="text-center mb-8">
          <h1 className="text-3xl sm:text-4xl font-black text-white mb-3">
            {t.play.title}
          </h1>
          <p className="text-sm text-white/40 max-w-md mx-auto">
            {emu.currentRom
              ? `${t.play.nowPlaying}: ${emu.currentRom}`
              : t.play.noRomDescription}
          </p>
        </div>

        {/* Desktop Download Banner */}
        <DesktopDownloadBanner />

        {/* Async Challenges */}
        <ChallengePanel
          currentSystem={system}
          onPlayChallenge={(s, rom) => {
            setSystem(s);
            // The user will select the ROM from the list
          }}
          autoDetectResult={autoDetectResult}
          onAutoDetectConsumed={() => setAutoDetectResult(null)}
        />

        {/* Emulator */}
        <EmulatorCore
          emu={emu}
          system={system}
          onSystemChange={setSystem}
          onAutoDetectConfirm={(detected) => {
            setAutoDetectResult({
              result: detected.trigger.result,
              romName: detected.profile.romName,
            });
          }}
        />
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
