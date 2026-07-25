/**
 * SFA2 Combined Live Monitor + Character ID Snapshot
 *
 * Displays real-time health (P1/P2) + BCD timer while taking a full WRAM
 * snapshot for the double-match character ID search.
 *
 * Usage:
 *   node find-chars.mjs save    → snapshot + live monitor (run during Ryu vs Ryu)
 *   node find-chars.mjs compare → snapshot + diff + live monitor (run during Ken vs Ken)
 */

import { createSocket } from "dgram";
import { Buffer } from "buffer";
import { readFileSync, writeFileSync, existsSync } from "fs";

const HOST = "127.0.0.1", PORT = 55355, CHUNK = 256;
const SNAPSHOT_PATH = "/tmp/sfa2-snapshot.json";
const HEALTH_ADDR = 0x1D3D;
const TIMER_ADDR = 0x1B7D;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function udpCmd(sock, cmd) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), 1500);
    const h = (m) => {
      const txt = m.toString();
      if (!txt.startsWith(cmd.split(" ")[0])) return;
      clearTimeout(t); sock.removeListener("message", h);
      resolve(txt);
    };
    sock.on("message", h);
    sock.send(Buffer.from(cmd + "\n"), PORT, HOST);
  });
}

function bcdToDec(val) {
  if (val > 0x99 || (val >> 4) > 9 || (val & 0xF) > 9) return null;
  return ((val >> 4) * 10) + (val & 0xF);
}

function healthBar(val, max) {
  const pct = Math.round((val / max) * 100);
  const w = 20;
  const filled = Math.round((pct / 100) * w);
  const color = pct > 60 ? "\x1b[32m" : pct > 30 ? "\x1b[33m" : "\x1b[31m";
  return `${color}${"█".repeat(filled)}${"\x1b[90m"}${"░".repeat(w - filled)}\x1b[0m ${String(pct).padStart(3)}%`;
}

async function readChunk(sock, addr, size) {
  try {
    const r = await udpCmd(sock, `READ_CORE_RAM ${addr.toString(16)} ${size}`);
    if (!r) return new Map();
    const parts = r.split(" ");
    const data = parts.slice(2).join("");
    if (data === "-1") return new Map();
    const bytes = new Map();
    for (let i = 0; i < data.length; i += 2) {
      const b = parseInt(data.substring(i, i + 2), 16);
      if (!isNaN(b)) bytes.set(addr + i / 2, b);
    }
    return bytes;
  } catch { return new Map(); }
}

async function dumpFullWram(sock) {
  const all = new Map();
  for (let addr = 0x0000; addr < 0x2000; addr += CHUNK) {
    const size = Math.min(CHUNK, 0x2000 - addr);
    const chunk = await readChunk(sock, addr, size);
    for (const [a, v] of chunk) all.set(a, v);
  }
  return all;
}

async function readLive(sock) {
  const rHealth = await udpCmd(sock, `READ_CORE_RAM ${HEALTH_ADDR.toString(16)} 4`);
  const rTimer = await udpCmd(sock, `READ_CORE_RAM ${TIMER_ADDR.toString(16)} 2`);
  if (!rHealth || !rTimer) return null;

  const hParts = rHealth.split(" "); const hData = hParts.slice(2).join("");
  const tParts = rTimer.split(" "); const tData = tParts.slice(2).join("");

  return {
    p1Real: parseInt(hData.substring(0, 2), 16),
    p1Vis:  parseInt(hData.substring(2, 4), 16),
    p2Real: parseInt(hData.substring(4, 6), 16),
    p2Vis:  parseInt(hData.substring(6, 8), 16),
    timerRaw: parseInt(tData.substring(0, 2), 16),
    timerSub: parseInt(tData.substring(2, 4), 16),
  };
}

async function liveMonitor(sock, label) {
  console.log(`\n${"─".repeat(55)}`);
  console.log(`  LIVE: ${label}`);
  console.log(`${"─".repeat(55)}`);

  let tick = 0;
  const iv = setInterval(async () => {
    const d = await readLive(sock);
    if (!d) return;

    const timerBcd = bcdToDec(d.timerRaw);
    const lines = [];
    lines.push(`\x1b[2J\x1b[H`);
    lines.push(`┌──── SFA2 ${label} ──── ${new Date().toISOString().slice(11,19)} ──── Tick:${tick} ────────┐`);
    lines.push(`│`);
    lines.push(`│  ❤️  P1: ${healthBar(d.p1Real, 96)}  │  shadow: ${String(d.p1Vis).padStart(3)}`);
    lines.push(`│  ❤️  P2: ${healthBar(d.p2Real, 96)}  │  shadow: ${String(d.p2Vis).padStart(3)}`);
    if (timerBcd !== null) {
      lines.push(`│  ⏱️  Timer: ${timerBcd}s  (raw:0x${d.timerRaw.toString(16).toUpperCase()} sub:${d.timerSub})`);
    } else {
      lines.push(`│  ⏱️  Timer: raw=0x${d.timerRaw.toString(16).toUpperCase()} sub=${d.timerSub}`);
    }
    lines.push(`│`);
    lines.push(`└──────────────────────────────────────────────────────────────────────────┘`);
    process.stdout.write(lines.join("\n"));
    tick++;
  }, 250);

  return iv;
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "save" && mode !== "compare") {
    console.log("Usage: node find-chars.mjs save|compare");
    console.log("  save    — Ryu vs Ryu snapshot + live monitor");
    console.log("  compare — Ken vs Ken snapshot + diff vs saved + live monitor");
    process.exit(1);
  }

  const sock = createSocket("udp4");

  let status;
  try { status = await udpCmd(sock, "GET_STATUS"); } catch { status = null; }
  if (!status || !status.includes("PLAYING")) {
    console.log("❌ Game not running. Start a match first.");
    sock.close(); return;
  }
  console.log("📡 " + status);

  if (mode === "save") {
    // ── SAVE MODE ──
    console.log("\n📸 Phase 1: Full WRAM snapshot (0x0000-0x1FFF)...");
    console.log("   ⚠️  Make sure P1=Ryu AND P2=Ryu!\n");

    // Start live monitor in background via staggered reads during dump
    const snap = await dumpFullWram(sock);
    const obj = {};
    for (const [a, v] of snap) obj[a] = v;
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(obj));
    console.log(`\n✅ Snapshot: ${Object.keys(obj).length} bytes → ${SNAPSHOT_PATH}`);

    // Now start live monitor
    const iv = await liveMonitor(sock, "Ryu vs Ryu [SNAPSHOT SAVED]");
    console.log("\n📌 Snapshot saved. Keep playing or quit.");
    console.log("   When ready for Ken vs Ken: restart match and run: node find-chars.mjs compare\n");

    // Keep running until Ctrl+C
    process.on("SIGINT", () => { clearInterval(iv); sock.close(); process.exit(0); });

  } else {
    // ── COMPARE MODE ──
    if (!existsSync(SNAPSHOT_PATH)) {
      console.log(`❌ No snapshot at ${SNAPSHOT_PATH}. Run "save" first during Ryu vs Ryu.`);
      sock.close(); return;
    }

    console.log("\n📂 Loading Ryu vs Ryu snapshot...");
    const raw = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf-8"));
    const snap1 = new Map();
    for (const [k, v] of Object.entries(raw)) snap1.set(Number(k), Number(v));
    console.log(`   ${snap1.size} bytes loaded`);

    console.log("\n📸 Phase 1: Current snapshot (should be Ken vs Ken)...");
    const snap2 = await dumpFullWram(sock);

    // ── Diff analysis ──
    const exact01 = [];  // 0x00→0x01
    const healthZone = [];  // 0x1D30-0x1D50 changes
    const timerZone = [];   // 0x1B70-0x1B90 changes

    for (const [addr, v1] of snap1) {
      const v2 = snap2.get(addr);
      if (v2 === undefined || v1 === v2) continue;

      if (v1 === 0x00 && v2 === 0x01) exact01.push({ addr, old: v1, new: v2 });
      if (addr >= 0x1D30 && addr <= 0x1D50) healthZone.push({ addr, old: v1, new: v2 });
      if (addr >= 0x1B70 && addr <= 0x1B90) timerZone.push({ addr, old: v1, new: v2 });
    }

    console.log(`\n${"═".repeat(55)}`);
    console.log(`📊 CHARACTER ID RESULTS`);
    console.log(`${"═".repeat(55)}`);

    if (exact01.length > 0) {
      console.log(`\n✅ EXACT 0x00→0x01 (Ryu→Ken): ${exact01.length} candidates`);
      for (const c of exact01.sort((a,b) => a.addr-b.addr)) {
        console.log(`   0x${c.addr.toString(16).padStart(4).toUpperCase()}`);
      }
    } else {
      console.log(`\n❌ No exact 0x00→0x01 transitions.`);
    }

    console.log(`\n📍 HEALTH ZONE changes (0x1D30-0x1D50): ${healthZone.length}`);
    for (const c of healthZone) {
      const tag = (c.old === 0 && c.new === 1) ? " ⭐⭐⭐" : c.new <= 0x12 ? " 🔸" : "";
      console.log(`   0x${c.addr.toString(16).padStart(4).toUpperCase()}: ${c.old}→${c.new}${tag}`);
    }
    if (healthZone.length === 0) console.log("   (no changes — char IDs elsewhere)");

    console.log(`\n📍 TIMER ZONE changes (0x1B70-0x1B90): ${timerZone.length}`);
    for (const c of timerZone) {
      const tag = (c.old === 0 && c.new === 1) ? " ⭐⭐⭐" : c.new <= 0x12 ? " 🔸" : "";
      console.log(`   0x${c.addr.toString(16).padStart(4).toUpperCase()}: ${c.old}→${c.new}${tag}`);
    }

    // ── Live monitor ──
    const iv = await liveMonitor(sock, `Ken vs Ken [COMPARE — ${exact01.length} char ID candidates]`);
    console.log(`\n📌 ${exact01.length} candidates found. Watch the live display above.`);
    console.log("   Ctrl+C to stop.\n");

    process.on("SIGINT", () => { clearInterval(iv); sock.close(); process.exit(0); });
  }
}

main().catch(console.error);
