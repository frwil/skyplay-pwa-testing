"use client";

import { useState, useEffect } from "react";
import { Clock, AlertTriangle } from "lucide-react";
import { useTranslation } from "@/lib/i18n/TranslationContext";

interface CampaignBannerProps {
  deadline: string | null;
  name?: string | null;
}

export default function CampaignBanner({ deadline, name }: CampaignBannerProps) {
  const { t } = useTranslation();
  const [remaining, setRemaining] = useState<{
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
  } | null>(null);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!deadline) {
      setRemaining(null);
      setExpired(false);
      return;
    }

    const deadlineMs = Date.parse(deadline);

    const tick = () => {
      const diff = deadlineMs - Date.now();
      if (diff <= 0) {
        setExpired(true);
        setRemaining(null);
        return;
      }
      setExpired(false);
      setRemaining({
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((diff / (1000 * 60)) % 60),
        seconds: Math.floor((diff / 1000) % 60),
      });
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  if (!deadline || !remaining) {
    if (expired) {
      return (
        <div
          className="relative z-10 px-4 py-3 text-center border-b"
          style={{
            backgroundColor: "rgba(253,46,95,0.1)",
            borderColor: "rgba(253,46,95,0.25)",
          }}
        >
          <div className="flex items-center justify-center gap-2 text-sm font-bold text-[#FD2E5F]">
            <AlertTriangle className="w-4 h-4" />
            {t.campaignBanner.expired}
          </div>
        </div>
      );
    }
    return null;
  }

  const parts = [
    { label: t.campaignBanner.days, value: remaining.days },
    { label: t.campaignBanner.hours, value: remaining.hours },
    { label: t.campaignBanner.minutes, value: remaining.minutes },
    { label: t.campaignBanner.seconds, value: remaining.seconds },
  ];

  return (
    <div
      className="relative z-10 px-4 py-2.5 text-center border-b flex items-center justify-center gap-3 flex-wrap"
      style={{
        backgroundColor: "rgba(0,200,255,0.05)",
        borderColor: "rgba(0,200,255,0.12)",
      }}
    >
      <Clock className="w-4 h-4 text-[#00c8ff]" />
      <span className="text-xs text-white/50 font-medium">
        {name || t.campaignBanner.campaign} — {t.campaignBanner.endsIn}
      </span>
      {parts.map((p, i) => (
        <span key={p.label} className="inline-flex items-baseline gap-1">
          <span className="font-black text-sm text-white">
            {String(p.value).padStart(2, "0")}
          </span>
          <span className="text-[10px] text-white/30 uppercase">{p.label}</span>
          {i < parts.length - 1 && (
            <span className="text-white/20 text-xs mx-0.5">:</span>
          )}
        </span>
      ))}
    </div>
  );
}
