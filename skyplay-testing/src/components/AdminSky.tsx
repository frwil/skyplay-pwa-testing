"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n/TranslationContext";
import { Coins, Search, Loader2, RefreshCw, Scale, Video } from "lucide-react";

interface LedgerEntry {
  amount: number;
  kind: string;
  challengeId: number | null;
  sessionId: string | null;
  note: string | null;
  createdAt: string | null;
}

interface LookupResult {
  user: { id: number; username: string; role: string };
  balance: number | null;
  unlimitedSky: boolean;
  ledger: LedgerEntry[];
}

interface Dispute {
  sessionId: string;
  challengeId: number | null;
  player1Id: number;
  player2Id: number;
  player1Name: string | null;
  player2Name: string | null;
  amount: number;
  system: string;
  rom: string;
  createdAt: string | null;
  /** Plan A: admin proxy link to the match recording, present only when one was uploaded. */
  recordingUrl?: string;
}

type DisputeAction = "refund_both" | "award_winner" | "all_to_bank" | "split";

/** Admin SKY tools: manual balance adjustment + duel dispute resolution. */
export default function AdminSky() {
  const { t } = useTranslation();
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-black text-white flex items-center gap-2">
          <Coins className="w-5 h-5" style={{ color: "#ffd700" }} />
          {t.admin.sky.title}
        </h2>
        <p className="text-sm text-white/40 mt-1">{t.admin.sky.subtitle}</p>
      </div>
      <AdjustPanel />
      <DisputesPanel />
    </div>
  );
}

function AdjustPanel() {
  const { t } = useTranslation();
  const a = t.admin.sky.adjust;
  const [query, setQuery] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [data, setData] = useState<LookupResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const lookup = useCallback(async () => {
    if (!query.trim()) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetch(`/api/admin/sky/adjust?query=${encodeURIComponent(query.trim())}`, { credentials: "include" });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || a.notFound); setData(null); return; }
      setData(d);
    } catch { setErr(a.notFound); } finally { setBusy(false); }
  }, [query, a.notFound]);

  const apply = useCallback(async () => {
    const amt = Number(amount);
    if (!query.trim() || !Number.isFinite(amt) || Math.round(amt) === 0) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetch("/api/admin/sky/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ query: query.trim(), amount: Math.round(amt), note: note.trim() || undefined }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || a.notFound); return; }
      setData(d);
      setMsg(a.applied(d.applied ?? Math.round(amt)));
      setAmount(""); setNote("");
    } catch { setErr(a.notFound); } finally { setBusy(false); }
  }, [query, amount, note, a]);

  return (
    <div className="rounded-2xl border p-5" style={{ backgroundColor: "rgba(13,27,46,0.6)", borderColor: "rgba(255,255,255,0.08)" }}>
      <h3 className="text-sm font-bold text-white mb-4">{a.title}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-white/50">
          {a.queryLabel}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={a.queryPlaceholder}
            className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-[#00c8ff]/50"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/50">
          {a.amountLabel}
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={a.amountPlaceholder}
            inputMode="numeric"
            className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-[#00c8ff]/50"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/50 sm:col-span-2">
          {a.noteLabel}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={a.notePlaceholder}
            className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-[#00c8ff]/50"
          />
        </label>
      </div>

      <div className="flex gap-2 mt-4">
        <button
          onClick={lookup}
          disabled={busy || !query.trim()}
          className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold transition disabled:opacity-40"
          style={{ backgroundColor: "rgba(0,200,255,0.12)", border: "1px solid rgba(0,200,255,0.3)", color: "#00c8ff" }}
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          {a.lookup}
        </button>
        <button
          onClick={apply}
          disabled={busy || !query.trim() || !amount.trim()}
          className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold transition disabled:opacity-40"
          style={{ backgroundColor: "rgba(46,204,113,0.12)", border: "1px solid rgba(46,204,113,0.3)", color: "#2ecc71" }}
        >
          {busy ? a.applying : a.apply}
        </button>
      </div>

      {err && <p className="mt-3 text-xs font-bold" style={{ color: "#FD2E5F" }}>{err}</p>}
      {msg && <p className="mt-3 text-xs font-bold" style={{ color: "#2ecc71" }}>{msg}</p>}

      {data && (
        <div className="mt-5 rounded-xl border p-4" style={{ backgroundColor: "rgba(0,0,0,0.25)", borderColor: "rgba(255,255,255,0.08)" }}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-white">
              {data.user.username} <span className="text-white/30 font-normal">#{data.user.id} · {data.user.role}</span>
            </span>
            <span className="text-sm font-black tabular-nums" style={{ color: "#ffd700" }}>
              {a.currentBalance}: {data.unlimitedSky ? a.unlimited : `${data.balance} SKY`}
            </span>
          </div>
          <div className="mt-3">
            <p className="text-[10px] uppercase tracking-wide text-white/30 mb-1.5">{a.recentMovements}</p>
            {data.ledger.length === 0 ? (
              <p className="text-xs text-white/30">{a.noMovements}</p>
            ) : (
              <ul className="flex flex-col gap-1 max-h-52 overflow-y-auto pr-1">
                {data.ledger.map((l, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 text-[11px] rounded-lg px-2.5 py-1.5" style={{ backgroundColor: "rgba(255,255,255,0.03)" }}>
                    <span className="text-white/50">{l.kind}{l.note ? ` · ${l.note}` : ""}</span>
                    <span className="tabular-nums font-bold" style={{ color: l.amount >= 0 ? "#2ecc71" : "#FD2E5F" }}>
                      {l.amount > 0 ? "+" : ""}{l.amount}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DisputesPanel() {
  const { t } = useTranslation();
  const d = t.admin.sky.disputes;
  const [disputes, setDisputes] = useState<Dispute[] | null>(null);
  const [totals, setTotals] = useState<{ openEscrow: number; bank: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/duel/disputes", { credentials: "include" });
      if (!res.ok) { setDisputes([]); return; }
      const j = await res.json();
      setDisputes(Array.isArray(j.disputes) ? j.disputes : []);
      if (j.totals) setTotals(j.totals);
    } catch { setDisputes([]); } finally { setBusy(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="rounded-2xl border p-5" style={{ backgroundColor: "rgba(13,27,46,0.6)", borderColor: "rgba(255,255,255,0.08)" }}>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Scale className="w-4 h-4" style={{ color: "#e67e22" }} />
          {d.title}
        </h3>
        <button onClick={load} disabled={busy} className="flex items-center gap-1 text-xs text-white/40 hover:text-white transition disabled:opacity-40">
          <RefreshCw className={`w-3 h-3 ${busy ? "animate-spin" : ""}`} />
          {d.refresh}
        </button>
      </div>
      <p className="text-xs text-white/40 mb-3">{d.subtitle}</p>

      {totals && (
        <div className="flex gap-4 mb-4 text-xs">
          <span className="text-white/50">{d.openEscrow}: <span className="font-bold tabular-nums text-white/80">{totals.openEscrow} SKY</span></span>
          <span className="text-white/50">{d.bank}: <span className="font-bold tabular-nums text-white/80">{totals.bank} SKY</span></span>
        </div>
      )}

      {disputes === null && <div className="py-6 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-white/20" /></div>}
      {disputes !== null && disputes.length === 0 && <p className="text-sm text-white/30 py-4">{d.none}</p>}
      {disputes !== null && disputes.length > 0 && (
        <div className="flex flex-col gap-3">
          {disputes.map((dispute) => (
            <DisputeCard key={dispute.sessionId} dispute={dispute} onResolved={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function DisputeCard({ dispute, onResolved }: { dispute: Dispute; onResolved: () => void }) {
  const { t } = useTranslation();
  const d = t.admin.sky.disputes;
  const [action, setAction] = useState<DisputeAction>("refund_both");
  const [winnerId, setWinnerId] = useState<number>(dispute.player1Id);
  const [p1Amount, setP1Amount] = useState("");
  const [p2Amount, setP2Amount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const p1Label = dispute.player1Name || `#${dispute.player1Id}`;
  const p2Label = dispute.player2Name || `#${dispute.player2Id}`;

  const resolve = useCallback(async () => {
    setBusy(true); setMsg(null);
    const params: Record<string, unknown> = {};
    if (action === "award_winner") params.winnerId = winnerId;
    if (action === "split") { params.p1Amount = Math.round(Number(p1Amount) || 0); params.p2Amount = Math.round(Number(p2Amount) || 0); }
    try {
      const res = await fetch("/api/admin/duel/dispute/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sessionId: dispute.sessionId, action, params }),
      });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || "Error"); return; }
      setMsg(j.resolved ? d.resolved : d.alreadyResolved);
      setTimeout(onResolved, 700);
    } catch { setMsg("Error"); } finally { setBusy(false); }
  }, [action, winnerId, p1Amount, p2Amount, dispute.sessionId, d, onResolved]);

  return (
    <div className="rounded-xl border p-3.5" style={{ backgroundColor: "rgba(0,0,0,0.25)", borderColor: "rgba(230,126,34,0.25)" }}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-white/85 truncate">{p1Label} <span className="text-white/30">vs</span> {p2Label}</p>
          <p className="text-[10px] text-white/30 font-mono truncate">{dispute.sessionId}</p>
          {dispute.recordingUrl && (
            <a
              href={dispute.recordingUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold transition hover:opacity-80"
              style={{ color: "#e67e22" }}
            >
              <Video className="w-3 h-3" />
              {d.watchRecording}
            </a>
          )}
        </div>
        <span className="text-sm font-black tabular-nums whitespace-nowrap" style={{ color: "#ffd700" }}>
          {d.pot}: {dispute.amount} SKY
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {([
          ["refund_both", d.actions.refundBoth],
          ["award_winner", d.actions.awardWinner],
          ["all_to_bank", d.actions.allToBank],
          ["split", d.actions.split],
        ] as [DisputeAction, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setAction(key)}
            className="rounded-lg px-2.5 py-1 text-[11px] font-bold transition"
            style={action === key
              ? { backgroundColor: "rgba(0,200,255,0.15)", color: "#00c8ff", border: "1px solid rgba(0,200,255,0.35)" }
              : { backgroundColor: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            {label}
          </button>
        ))}
      </div>

      {action === "award_winner" && (
        <label className="flex items-center gap-2 text-xs text-white/50 mb-3">
          {d.chooseWinner}:
          <select
            value={winnerId}
            onChange={(e) => setWinnerId(Number(e.target.value))}
            className="rounded-lg bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none"
          >
            <option value={dispute.player1Id}>{p1Label}</option>
            <option value={dispute.player2Id}>{p2Label}</option>
          </select>
        </label>
      )}

      {action === "split" && (
        <div className="flex gap-2 mb-3">
          <label className="flex flex-col gap-1 text-[11px] text-white/50 flex-1">
            {d.splitP1} ({p1Label})
            <input value={p1Amount} onChange={(e) => setP1Amount(e.target.value)} inputMode="numeric" placeholder="0"
              className="rounded-lg bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none" />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-white/50 flex-1">
            {d.splitP2} ({p2Label})
            <input value={p2Amount} onChange={(e) => setP2Amount(e.target.value)} inputMode="numeric" placeholder="0"
              className="rounded-lg bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none" />
          </label>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={resolve}
          disabled={busy}
          className="rounded-lg px-4 py-1.5 text-xs font-bold transition disabled:opacity-40"
          style={{ backgroundColor: "rgba(230,126,34,0.15)", border: "1px solid rgba(230,126,34,0.35)", color: "#e67e22" }}
        >
          {busy ? d.resolving : d.resolve}
        </button>
        {msg && <span className="text-xs font-bold text-white/70">{msg}</span>}
      </div>
    </div>
  );
}
