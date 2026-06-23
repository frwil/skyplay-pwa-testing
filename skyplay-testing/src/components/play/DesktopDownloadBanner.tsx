"use client";

import { useState, useEffect } from "react";
import { useTranslation } from "@/lib/i18n/TranslationContext";
import { Monitor, Download, X } from "lucide-react";

const STORAGE_KEY = "skyplay-desktop-banner-dismissed";

/**
 * Detects if the current browser is running on a desktop OS.
 * Shows a banner prompting users to download the native Tauri app
 * for Neo Geo and PlayStation 1 support.
 */
export default function DesktopDownloadBanner() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Check if user previously dismissed the banner
    try {
      if (localStorage.getItem(STORAGE_KEY) === "true") return;
    } catch {
      // localStorage not available
    }

    // Detect desktop (not mobile/tablet)
    const ua = navigator.userAgent.toLowerCase();
    const isMobile = /android|iphone|ipad|ipod|webos|blackberry|windows phone|mobile/i.test(ua);
    if (isMobile) return;

    // Only show on desktop browsers
    setVisible(true);
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // localStorage not available
    }
  };

  if (!visible) return null;

  return (
    <div
      className="relative rounded-2xl border p-5 mb-6 flex items-start gap-4 animate-in"
      style={{
        backgroundColor: "rgba(0,200,255,0.06)",
        borderColor: "rgba(0,200,255,0.2)",
        backgroundImage:
          "linear-gradient(135deg, rgba(0,200,255,0.08) 0%, rgba(155,93,229,0.08) 50%, rgba(241,91,181,0.08) 100%)",
      }}
    >
      {/* Icon */}
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
        style={{
          backgroundColor: "rgba(0,200,255,0.1)",
          border: "1px solid rgba(0,200,255,0.2)",
        }}
      >
        <Monitor className="w-5 h-5" style={{ color: "#00c8ff" }} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-bold text-white mb-1">
          {t.play.desktopBanner.title}
        </h3>
        <p className="text-xs mb-3" style={{ color: "rgba(255,255,255,0.5)" }}>
          {t.play.desktopBanner.description}
        </p>
        <a
          href="https://github.com/frwil/skyplay-pwa-testing/releases"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition"
          style={{
            backgroundColor: "rgba(0,200,255,0.15)",
            border: "1px solid rgba(0,200,255,0.3)",
            color: "#00c8ff",
          }}
        >
          <Download className="w-3.5 h-3.5" />
          {t.play.desktopBanner.download}
        </a>
      </div>

      {/* Dismiss button */}
      <button
        onClick={dismiss}
        className="p-1.5 rounded-lg transition shrink-0"
        style={{ color: "rgba(255,255,255,0.3)" }}
        aria-label={t.play.desktopBanner.dismiss}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
