"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import GlowBackground from "@/components/GlowBackground";
import PlayerBadge from "@/components/PlayerBadge";
import { useTranslation } from "@/lib/i18n/TranslationContext";
import { COUNTRY_CODES, countryName } from "@/lib/countries";
import { countryToFlag } from "@/lib/flag";
import { ArrowLeft, Loader2, Upload, Trash2, Save } from "lucide-react";

/** Compress an image file to a small square-ish JPEG data URL (max ~256px, quality 0.8). */
async function compressImage(file: File, max = 256): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error("read failed"));
    fr.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("decode failed"));
    i.src = dataUrl;
  });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas context");
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.8);
}

export default function ProfilePage() {
  const { t, locale } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(true);
  const [username, setUsername] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [country, setCountry] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/profile", { credentials: "include" });
        if (res.status === 401) { setAuthed(false); return; }
        const d = await res.json();
        if (d.profile) {
          setUsername(d.profile.username || "");
          setAvatar(d.profile.avatar || null);
          setCountry(d.profile.country || "");
        }
      } catch { /* ignore */ } finally { setLoading(false); }
    };
    void load();
  }, []);

  const onPickFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setErr(null); setMsg(null);
    if (!file.type.startsWith("image/")) { setErr(t.profile.invalidImage); return; }
    try {
      const compressed = await compressImage(file);
      if (compressed.length > 300_000) { setErr(t.profile.imageTooLarge); return; }
      setAvatar(compressed);
    } catch { setErr(t.profile.invalidImage); }
  }, [t]);

  const save = useCallback(async () => {
    setSaving(true); setErr(null); setMsg(null);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ avatar, country: country || null }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || t.profile.error); return; }
      setMsg(t.profile.saved);
    } catch { setErr(t.profile.error); } finally { setSaving(false); }
  }, [avatar, country, t]);

  return (
    <main className="relative min-h-screen">
      <GlowBackground />

      <header className="relative z-10 border-b border-white/5 bg-[#070f1e]/80 backdrop-blur-sm">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <a href="/" className="block">
            <div
              className="font-black text-xl uppercase tracking-[3px]"
              style={{
                background: "linear-gradient(135deg, #f15bb5 0%, #9b5de5 50%, #00d2ff 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              SKY PLAY
            </div>
          </a>
          <a href="/duel" className="text-xs text-white/40 hover:text-white transition font-medium flex items-center gap-1">
            <ArrowLeft className="w-3 h-3" />
            {t.duel.history.backToDuel}
          </a>
        </div>
      </header>

      <section className="relative z-10 max-w-2xl mx-auto px-4 py-8 pb-20">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-black text-white">{t.profile.title}</h1>
          <p className="text-sm text-white/40 mt-1">{t.profile.subtitle}</p>
        </div>

        {loading && (
          <div className="flex flex-col items-center gap-3 py-16">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: "rgba(255,255,255,0.2)" }} />
            <p className="text-sm text-white/30">{t.profile.loading}</p>
          </div>
        )}

        {!loading && !authed && (
          <div className="rounded-2xl border p-10 text-center" style={{ backgroundColor: "rgba(13,27,46,0.7)", borderColor: "rgba(255,255,255,0.08)" }}>
            <p className="text-sm text-white/40">{t.profile.loginRequired}</p>
          </div>
        )}

        {!loading && authed && (
          <div className="rounded-2xl border p-6 flex flex-col gap-6" style={{ backgroundColor: "rgba(13,27,46,0.7)", borderColor: "rgba(255,255,255,0.08)" }}>
            {/* Live preview */}
            <div className="flex items-center gap-4">
              <PlayerBadge username={username} avatar={avatar} country={country || null} size={64} hideName />
              <div>
                <p className="text-lg font-bold text-white">{username}</p>
                {country && (
                  <p className="text-xs text-white/40">{countryToFlag(country)} {countryName(country, locale)}</p>
                )}
              </div>
            </div>

            {/* Photo */}
            <div>
              <p className="text-xs font-bold text-white/50 mb-2">{t.profile.photoLabel}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold transition"
                  style={{ backgroundColor: "rgba(0,200,255,0.12)", border: "1px solid rgba(0,200,255,0.3)", color: "#00c8ff" }}
                >
                  <Upload className="w-3.5 h-3.5" />
                  {t.profile.choosePhoto}
                </button>
                {avatar && (
                  <button
                    onClick={() => setAvatar(null)}
                    className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold transition"
                    style={{ backgroundColor: "rgba(253,46,95,0.12)", border: "1px solid rgba(253,46,95,0.3)", color: "#FD2E5F" }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {t.profile.removePhoto}
                  </button>
                )}
              </div>
              <p className="text-[10px] text-white/25 mt-1.5">{t.profile.photoHint}</p>
              <input ref={fileRef} type="file" accept="image/*" onChange={onPickFile} className="hidden" />
            </div>

            {/* Country */}
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-white/50">{t.profile.countryLabel}</span>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-[#00c8ff]/50"
              >
                <option value="">{t.profile.countryPlaceholder}</option>
                {COUNTRY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {countryToFlag(code)} {countryName(code, locale)}
                  </option>
                ))}
              </select>
            </label>

            {/* Save */}
            <div className="flex items-center gap-3">
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-bold transition disabled:opacity-40"
                style={{ backgroundColor: "rgba(46,204,113,0.15)", border: "1px solid rgba(46,204,113,0.35)", color: "#2ecc71" }}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {saving ? t.profile.saving : t.profile.save}
              </button>
              {msg && <span className="text-xs font-bold" style={{ color: "#2ecc71" }}>{msg}</span>}
              {err && <span className="text-xs font-bold" style={{ color: "#FD2E5F" }}>{err}</span>}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
