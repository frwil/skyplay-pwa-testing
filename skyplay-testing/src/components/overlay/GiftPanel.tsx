"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Gift, Coins, MessageCircle, Loader2, Check } from "lucide-react";

/** Mirror of the Prisma Gift model (from API) */
interface GiftItem {
  id: string;
  name: string;
  iconUrl: string;
  animationUrl?: string;
  coinPrice: number;
  diamondValue: number;
  category: string;
  isActive: boolean;
  cooldownSec?: number;
}

/** Wallet data from /api/gifts/wallet */
interface WalletData {
  id: string;
  userId: string;
  skyCoins: number;
  diamonds: number;
  totalGifted: number;
  totalEarned: number;
  sentCount: number;
  receivedCount: number;
}

const CATEGORIES = ["FREE", "COMMON", "RARE", "EPIC", "LEGENDARY"] as const;

const CATEGORY_EMOJI: Record<string, string> = {
  FREE: "🎁",
  COMMON: "🎈",
  RARE: "🔮",
  EPIC: "💎",
  LEGENDARY: "👑",
};

const CATEGORY_COLORS: Record<string, string> = {
  FREE: "border-gray-400/30 text-gray-300",
  COMMON: "border-green-400/30 text-green-300",
  RARE: "border-blue-400/30 text-blue-300",
  EPIC: "border-purple-400/30 text-purple-300",
  LEGENDARY: "border-yellow-400/30 text-yellow-300",
};

const CATEGORY_BG: Record<string, string> = {
  FREE: "rgba(156,163,175,0.08)",
  COMMON: "rgba(74,222,128,0.08)",
  RARE: "rgba(96,165,250,0.08)",
  EPIC: "rgba(168,85,247,0.08)",
  LEGENDARY: "rgba(250,204,21,0.08)",
};

interface GiftPanelProps {
  open: boolean;
  onClose: () => void;
  /** The user who receives the gift (streamer/opponent). */
  receiverId: string;
  /** Current session ID for real-time gift overlay forwarding. */
  sessionId?: string | null;
  /** Called when a gift is successfully sent. */
  onGiftSent?: () => void;
}

export default function GiftPanel({
  open,
  onClose,
  receiverId,
  sessionId,
  onGiftSent,
}: GiftPanelProps) {
  // ── Catalog ────────────────────────────────────────────
  const [catalog, setCatalog] = useState<GiftItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // ── Wallet ─────────────────────────────────────────────
  const [wallet, setWallet] = useState<WalletData | null>(null);

  // ── Selection ──────────────────────────────────────────
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [selectedGift, setSelectedGift] = useState<GiftItem | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("");

  // ── Send state ─────────────────────────────────────────
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // ── Cooldowns per gift ─────────────────────────────────
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({});

  // ── Fetch catalog ──────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setCatalogLoading(true);
    setCatalogError(null);
    setSendSuccess(false);
    setSendError(null);
    setSelectedGift(null);
    setQuantity(1);
    setMessage("");

    fetch("/api/gifts/catalog")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch catalog");
        return res.json();
      })
      .then((data: { gifts: GiftItem[] }) => {
        setCatalog(data.gifts || []);
        setCatalogLoading(false);
      })
      .catch((err) => {
        setCatalogError(err instanceof Error ? err.message : "Erreur");
        setCatalogLoading(false);
      });
  }, [open]);

  // ── Fetch wallet ───────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    fetch("/api/gifts/wallet", { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch wallet");
        return res.json();
      })
      .then((data: WalletData) => setWallet(data))
      .catch(() => { /* non-critical — wallet balance is a nice-to-have */ });
  }, [open]);

  // ── Filtered + sorted gifts ────────────────────────────
  const filteredGifts = activeCategory
    ? catalog.filter((g) => g.category === activeCategory)
    : catalog;

  // ── Helpers ────────────────────────────────────────────
  const totalCost = selectedGift ? selectedGift.coinPrice * quantity : 0;
  const canAfford = wallet ? wallet.skyCoins >= totalCost : false;
  const cooldownRemaining = selectedGift ? (cooldowns[selectedGift.id] ?? 0) : 0;
  const isOnCooldown = cooldownRemaining > 0;

  // ── Send gift ──────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!selectedGift || isOnCooldown || !canAfford) return;
    setSending(true);
    setSendError(null);
    setSendSuccess(false);

    try {
      const res = await fetch("/api/gifts/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          giftId: selectedGift.id,
          receiverId,
          quantity,
          message: message.trim() || undefined,
          sessionId: sessionId || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Échec de l'envoi" }));
        throw new Error(err.error || err.message || "Échec de l'envoi");
      }

      const data = await res.json();
      // Update wallet from response
      if (data.skyCoinsRemaining !== undefined) {
        setWallet((prev) => prev ? { ...prev, skyCoins: data.skyCoinsRemaining } : prev);
      }

      // Set cooldown
      if (selectedGift.cooldownSec && selectedGift.cooldownSec > 0) {
        setCooldowns((prev) => ({
          ...prev,
          [selectedGift.id]: selectedGift.cooldownSec!,
        }));
      }

      setSendSuccess(true);
      onGiftSent?.();

      // Reset selection after a brief success flash
      setTimeout(() => {
        setSendSuccess(false);
        setSelectedGift(null);
        setQuantity(1);
        setMessage("");
      }, 1500);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSending(false);
    }
  }, [selectedGift, quantity, message, receiverId, sessionId, isOnCooldown, canAfford, onGiftSent]);

  // ── Cooldown tick ──────────────────────────────────────
  useEffect(() => {
    const activeCooldowns = Object.entries(cooldowns).filter(([, v]) => v > 0);
    if (activeCooldowns.length === 0) return;

    const timer = setInterval(() => {
      setCooldowns((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const [id, sec] of Object.entries(next)) {
          if (sec > 0) {
            next[id] = sec - 1;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [cooldowns]);

  // ── Render ─────────────────────────────────────────────
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-3xl border w-full max-w-lg mx-4 max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95"
        style={{
          backgroundColor: "rgba(13,27,46,0.98)",
          borderColor: "rgba(0,200,255,0.2)",
          boxShadow: "0 0 60px rgba(0,200,255,0.15)",
        }}
      >
        {/* ── Header ─────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 pt-6 pb-3">
          <div className="flex items-center gap-2">
            <Gift className="w-5 h-5" style={{ color: "#00c8ff" }} />
            <h2 className="text-lg font-black text-white">Envoyer un cadeau</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4 text-white/40" />
          </button>
        </div>

        {/* ── Wallet balance ──────────────────────────── */}
        {wallet && (
          <div className="px-6 pb-3">
            <div
              className="flex items-center gap-3 rounded-xl px-4 py-2.5 text-xs"
              style={{ backgroundColor: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="flex items-center gap-1.5">
                <Coins className="w-3.5 h-3.5" style={{ color: "#ffd700" }} />
                <span className="font-bold text-white">{wallet.skyCoins.toLocaleString()}</span>
                <span className="text-white/30">SkyCoins</span>
              </div>
              <div className="w-px h-4" style={{ backgroundColor: "rgba(255,255,255,0.08)" }} />
              <div className="flex items-center gap-1.5">
                <span className="text-sm">💎</span>
                <span className="font-bold text-white">{wallet.diamonds.toLocaleString()}</span>
                <span className="text-white/30">Diamonds</span>
              </div>
            </div>
          </div>
        )}

        {/* ── Category tabs ───────────────────────────── */}
        <div className="px-6 pb-3 flex gap-1.5 overflow-x-auto scrollbar-none">
          <button
            onClick={() => setActiveCategory("")}
            className={`px-3 py-1 rounded-full text-[11px] font-bold whitespace-nowrap transition-all ${
              activeCategory === ""
                ? "text-white border"
                : "text-white/40 border"
            }`}
            style={{
              backgroundColor: activeCategory === "" ? "rgba(0,200,255,0.15)" : "transparent",
              borderColor: activeCategory === "" ? "rgba(0,200,255,0.3)" : "rgba(255,255,255,0.08)",
            }}
          >
            Tous
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1 rounded-full text-[11px] font-bold whitespace-nowrap transition-all border ${
                activeCategory === cat
                  ? CATEGORY_COLORS[cat]
                  : "text-white/40 border-transparent"
              }`}
              style={{
                backgroundColor: activeCategory === cat
                  ? CATEGORY_BG[cat]
                  : "transparent",
              }}
            >
              {CATEGORY_EMOJI[cat]} {cat}
            </button>
          ))}
        </div>

        {/* ── Gift grid ────────────────────────────────── */}
        <div className="px-6 pb-3 overflow-y-auto flex-1">
          {catalogLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-white/30" />
            </div>
          ) : catalogError ? (
            <p className="text-center text-xs py-10" style={{ color: "#fd2e5f" }}>
              {catalogError}
            </p>
          ) : filteredGifts.length === 0 ? (
            <p className="text-center text-xs py-10 text-white/25">
              Aucun cadeau dans cette catégorie
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {filteredGifts.map((gift) => {
                const isSelected = selectedGift?.id === gift.id;
                const emoji = gift.iconUrl || CATEGORY_EMOJI[gift.category] || "🎁";
                const giftCooldown = cooldowns[gift.id] ?? 0;

                return (
                  <button
                    key={gift.id}
                    onClick={() => {
                      if (giftCooldown > 0) return;
                      setSelectedGift(gift);
                      setQuantity(1);
                      setSendError(null);
                    }}
                    disabled={giftCooldown > 0}
                    className={`relative rounded-2xl p-3 flex flex-col items-center gap-1.5 transition-all border text-center disabled:opacity-40 ${
                      isSelected
                        ? "scale-105"
                        : "hover:scale-105"
                    }`}
                    style={{
                      backgroundColor: isSelected
                        ? "rgba(0,200,255,0.1)"
                        : "rgba(255,255,255,0.03)",
                      borderColor: isSelected
                        ? "rgba(0,200,255,0.3)"
                        : "rgba(255,255,255,0.06)",
                    }}
                  >
                    {/* Icon */}
                    <span className="text-3xl">{emoji}</span>
                    {/* Name */}
                    <span className="text-[10px] font-bold text-white leading-tight">
                      {gift.name}
                    </span>
                    {/* Price + Value */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-bold" style={{ color: "#ffd700" }}>
                        🪙 {gift.coinPrice}
                      </span>
                      <span className="text-[9px] text-white/25">
                        +{gift.diamondValue}💎
                      </span>
                    </div>
                    {/* Cooldown overlay */}
                    {giftCooldown > 0 && (
                      <div className="absolute inset-0 rounded-2xl flex items-center justify-center bg-black/40">
                        <span className="text-xs font-bold text-white/60">{giftCooldown}s</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Selected gift details + quantity ─────────── */}
        {selectedGift && (
          <div
            className="px-6 py-3 border-t mx-6"
            style={{ borderColor: "rgba(255,255,255,0.06)" }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">
                  {selectedGift.iconUrl || CATEGORY_EMOJI[selectedGift.category] || "🎁"}
                </span>
                <div>
                  <p className="text-sm font-bold text-white">{selectedGift.name}</p>
                  <p className="text-[10px] text-white/30">
                    {selectedGift.coinPrice} coins &rarr; +{selectedGift.diamondValue}💎 pour le streamer
                  </p>
                </div>
              </div>
              {/* Quantity selector */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  disabled={quantity <= 1}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold transition-colors disabled:opacity-30"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.06)",
                    color: "rgba(255,255,255,0.6)",
                  }}
                >
                  -
                </button>
                <span
                  className="w-8 text-center text-sm font-bold"
                  style={{ color: "#00c8ff" }}
                >
                  {quantity}
                </span>
                <button
                  onClick={() => setQuantity((q) => Math.min(99, q + 1))}
                  disabled={quantity >= 99}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold transition-colors disabled:opacity-30"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.06)",
                    color: "rgba(255,255,255,0.6)",
                  }}
                >
                  +
                </button>
              </div>
            </div>

            {/* Total cost */}
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] text-white/30">Total</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold" style={{ color: "#ffd700" }}>
                  🪙 {totalCost}
                </span>
                {!canAfford && wallet && (
                  <span className="text-[10px]" style={{ color: "#fd2e5f" }}>
                    (solde insuffisant)
                  </span>
                )}
              </div>
            </div>

            {/* Message input */}
            <div className="relative mb-3">
              <MessageCircle className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/20" />
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 200))}
                placeholder="Message (optionnel)"
                maxLength={200}
                className="w-full pl-9 pr-3 py-2 rounded-xl text-xs focus:outline-none"
                style={{
                  backgroundColor: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "rgba(255,255,255,0.7)",
                }}
              />
            </div>

            {/* Send button */}
            <button
              onClick={handleSend}
              disabled={!canAfford || isOnCooldown || sending}
              className="w-full py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              style={{
                backgroundColor: sendSuccess
                  ? "rgba(74,222,128,0.15)"
                  : "rgba(0,200,255,0.15)",
                border: `1px solid ${
                  sendSuccess
                    ? "rgba(74,222,128,0.35)"
                    : "rgba(0,200,255,0.35)"
                }`,
                color: sendSuccess ? "#4ade80" : "#00c8ff",
              }}
            >
              {sending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : sendSuccess ? (
                <>
                  <Check className="w-4 h-4" />
                  Envoyé !
                </>
              ) : isOnCooldown ? (
                `Patientez ${cooldownRemaining}s...`
              ) : (
                <>
                  <Gift className="w-4 h-4" />
                  Envoyer {quantity > 1 ? `×${quantity}` : ""} ({totalCost} 🪙)
                </>
              )}
            </button>

            {/* Error */}
            {sendError && (
              <p className="text-[10px] mt-2 text-center" style={{ color: "#fd2e5f" }}>
                {sendError}
              </p>
            )}
          </div>
        )}

        {/* ── Footer hint ──────────────────────────────── */}
        <div className="px-6 py-3 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <p className="text-[9px] text-center text-white/20">
            Les Diamonds sont convertibles en XAF · Taux actuel : 1💎 = 1 XAF
          </p>
        </div>
      </div>
    </div>
  );
}
