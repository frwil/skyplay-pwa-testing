/**
 * FAST scanner — reads 8KB in 256-byte chunks (32 reads per poll).
 * Tracks ALL changes, focuses on decreases in health range (40-100).
 */

import { createSocket } from "dgram";
import { Buffer } from "buffer";

const HOST = "127.0.0.1";
const PORT = 55355;
const SCAN_SIZE = 0x2000; // 8KB
const CHUNK = 256;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function udpCmd(sock, cmd) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), 2000);
    const h = (m) => {
      const txt = m.toString();
      if (!txt.startsWith(cmd.split(" ")[0])) return;
      clearTimeout(t);
      sock.removeListener("message", h);
      resolve(txt);
    };
    sock.on("message", h);
    sock.send(Buffer.from(cmd + "\n"), PORT, HOST);
  });
}

async function dump8K(sock) {
  const all = new Map();
  for (let addr = 0; addr < SCAN_SIZE; addr += CHUNK) {
    try {
      const r = await udpCmd(sock, "READ_CORE_RAM " + addr.toString(16) + " " + CHUNK);
      const parts = r.split(" ");
      const data = parts.slice(2).join("");
      for (let i = 0; i < data.length; i += 2) {
        const b = parseInt(data.substring(i, i + 2), 16);
        if (!isNaN(b)) all.set(addr + i / 2, b);
      }
    } catch {}
  }
  return all;
}

async function main() {
  const sock = createSocket("udp4");
  const t0 = Date.now();

  console.log("🎮 FAST SFA2 Health Scanner");
  console.log("=" .repeat(60));

  // Verify RetroArch
  try {
    const s = await udpCmd(sock, "GET_STATUS");
    console.log("📡 " + s);
  } catch {
    console.log("❌ No RetroArch");
    sock.close();
    return;
  }

  // Initial dump
  console.log("\n📸 Initial 8KB dump...");
  let prev = await dump8K(sock);
  console.log("   " + prev.size + " bytes");

  // Show bytes = 96
  const initial96 = [];
  for (const [a, v] of prev) if (v === 96) initial96.push(a);
  console.log("   " + initial96.length + " bytes = 96: " + initial96.map((a) => "0x" + a.toString(16).toUpperCase()).join(", "));

  // Tracking
  const decreases = new Map();
  const increases = new Map();
  const valueHistory = new Map(); // addr → [values over time]
  for (const [a, v] of prev) valueHistory.set(a, [v]);

  console.log("\n🔄 Polling 8KB every ~300ms for 90s...\n");

  const deadline = Date.now() + 90000;
  let poll = 0;

  while (Date.now() < deadline) {
    const pollStart = Date.now();
    const curr = await dump8K(sock);
    const pollTime = Date.now() - pollStart;
    poll++;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    // Track changes
    const changed = [];
    const healthDecreases = [];

    for (const [addr, val] of curr) {
      const pv = prev.get(addr);
      if (pv !== undefined && pv !== val) {
        changed.push({ addr, prev: pv, val, delta: val - pv });

        if (val < pv) decreases.set(addr, (decreases.get(addr) || 0) + 1);
        if (val > pv) increases.set(addr, (increases.get(addr) || 0) + 1);

        // Track health range
        if (pv >= 40 && pv <= 100 && val >= 0 && val <= 100 && (val < pv)) {
          healthDecreases.push({ addr, prev: pv, val, delta: val - pv });
        }

        // Track history for top candidates
        if (!valueHistory.has(addr)) valueHistory.set(addr, []);
        valueHistory.get(addr).push(val);
      }
    }

    // Update prev
    prev = curr;

    // Log
    if (healthDecreases.length > 0) {
      console.log("🔻 [" + elapsed + "s] HEALTH RANGE DECREASES (poll took " + pollTime + "ms):");
      for (const h of healthDecreases) {
        console.log("   $7E:" + h.addr.toString(16).padStart(4).toUpperCase() +
          "  " + h.prev + " → " + h.val + "  (Δ" + h.delta + ")");
      }
    } else if (changed.length > 0 && changed.length <= 10) {
      console.log("   [" + elapsed + "s] " + changed.length + " changes");
    }

    // Every 30 polls, show top decreasing
    if (poll % 30 === 0) {
      const top = [...decreases.entries()]
        .filter(([, c]) => c >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      if (top.length > 0) {
        console.log("\n── Top decreasing (poll #" + poll + ", T+" + elapsed + "s) ──");
        for (const [a, c] of top) {
          const hist = valueHistory.get(a) || [];
          const range = hist.length > 1 ? Math.min(...hist) + "→" + Math.max(...hist) : "?";
          const cur = hist[hist.length - 1];
          console.log("   $7E:" + a.toString(16).padStart(4).toUpperCase() +
            "  range=" + range + "  now=" + cur + "  ↓" + c);
        }
        console.log("");
      }
    }

    if (poll % 10 === 0) {
      process.stdout.write("\r   poll #" + poll + " T+" + elapsed + "s | " +
        decreases.size + "↓ " + increases.size + "↑ | poll=" + pollTime + "ms");
    }
  }

  // ── FINAL REPORT ──
  console.log("\n\n" + "=".repeat(60));
  console.log("📊 FINAL REPORT (" + poll + " polls in " + ((Date.now()-t0)/1000).toFixed(0) + "s)");
  console.log("=".repeat(60));

  // Best health candidates: decreased multiple times, in health range
  console.log("\n🎯 HEALTH CANDIDATES (decreased ≥3x, current value ≤90):");
  const dec = [...decreases.entries()]
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1]);

  for (const [addr, count] of dec) {
    const hist = valueHistory.get(addr) || [];
    const cur = hist.length > 0 ? hist[hist.length - 1] : "?";
    const min = hist.length > 1 ? Math.min(...hist) : cur;
    const max = hist.length > 1 ? Math.max(...hist) : cur;
    const hex = addr.toString(16).padStart(4).toUpperCase();

    let tag = "";
    // Health starts at 96 and decreases
    if (max === 96 && min < 80 && count >= 5) tag = " ⭐⭐⭐ P1/P2 HEALTH";
    else if (max >= 85 && min < 90 && count >= 5) tag = " ⭐⭐ LIKELY HEALTH";
    // Timer counts down steadily
    if (count > poll * 0.2 && cur <= 20) tag += " ⏱️ TIMER";

    console.log("   $7E:" + hex + "  " + max + "→" + min + "  now=" + cur + "  ↓" + count + tag);
  }

  // Show currently at 96
  const final96 = [];
  for (const [a, v] of prev) if (v === 96) final96.push(a);
  console.log("\n📍 Still at 96: " + final96.map((a) => "0x" + a.toString(16).toUpperCase()).join(", "));

  sock.close();
  console.log("\n✅ Done.");
}

main().catch(console.error);
