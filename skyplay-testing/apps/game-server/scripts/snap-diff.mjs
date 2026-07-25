/**
 * Snapshot-on-damage: baseline now, diff on next damage.
 * Focuses on values in 50-100 range that decrease.
 */

import { createSocket } from "dgram";
import { Buffer } from "buffer";

const HOST = "127.0.0.1";
const PORT = 55355;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function udpCmd(sock, cmd) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), 1500);
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

async function dump4K(sock) {
  const all = new Map();
  for (let addr = 0; addr < 0x1000; addr += 128) {
    try {
      const r = await udpCmd(sock, "READ_CORE_RAM " + addr.toString(16) + " 128");
      const parts = r.split(" "); const data = parts.slice(2).join("");
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

  try { console.log("📡 " + (await udpCmd(sock, "GET_STATUS"))); }
  catch { console.log("NO RA"); sock.close(); return; }

  // BASELINE
  console.log("\n📸 BASELINE snapshot...");
  const baseline = await dump4K(sock);
  console.log("   " + baseline.size + " bytes in first 4KB");

  // Show current health-range values (50-100)
  const healthRange = [];
  for (const [a, v] of baseline) {
    if (v >= 50 && v <= 100) healthRange.push({ addr: a, val: v });
  }
  console.log("\n📍 Current values in 50-100 range (" + healthRange.length + " bytes):");
  for (const h of healthRange.slice(0, 40)) {
    console.log("   0x" + h.addr.toString(16).padStart(4) + " = " + h.val);
  }
  if (healthRange.length > 40) console.log("   ... and " + (healthRange.length - 40) + " more");

  // Now poll at 200ms, tracking only decreases in 50-100 range
  console.log("\n🔄 Polling every 200ms — Ctrl+C after damage to see diff");
  console.log("   Watching for ANY decrease in 50-100 range\n");

  let prev = baseline;
  const decreases = new Map(); // addr → { count, max }
  let poll = 0;

  // Run for 90s max
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await sleep(200);
    poll++;
    const curr = await dump4K(sock);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    for (const [addr, val] of curr) {
      const pv = prev.get(addr);
      if (pv === undefined) continue;

      // Only track decreases in 50-100 range
      if (pv >= 50 && pv <= 100 && val < pv && val >= 0) {
        const diff = pv - val;
        if (!decreases.has(addr)) decreases.set(addr, { count: 0, max: pv, min: pv, diffs: [] });
        const s = decreases.get(addr);
        s.count++;
        if (pv > s.max) s.max = pv;
        if (val < s.min) s.min = val;
        s.diffs.push({ from: pv, to: val, diff, time: elapsed });
        if (s.diffs.length > 5) s.diffs.shift(); // keep last 5
      }

      prev.set(addr, val);
    }

    // Every 5s show top candidates
    if (poll % 25 === 0) {
      const top = [...decreases.entries()]
        .filter(([, s]) => s.count >= 2)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 8);

      if (top.length > 0) {
        console.log("\n── Top decreasing (T+" + elapsed + "s) ──");
        for (const [addr, s] of top) {
          const lastDiffs = s.diffs.map(d => d.from + "→" + d.to).join(" ");
          console.log("   $7E:" + addr.toString(16).padStart(4).toUpperCase() +
            "  range=" + s.min + "→" + s.max + "  ↓" + s.count + "  [" + lastDiffs + "]");
        }
        console.log("");
      }
    }
  }

  // Final report
  console.log("\n\n" + "=".repeat(60));
  console.log("📊 HEALTH CANDIDATES (decreased in 50-100 range ≥3x):");
  console.log("=".repeat(60));

  const final = [...decreases.entries()]
    .filter(([, s]) => s.count >= 3)
    .sort((a, b) => b[1].count - a[1].count);

  for (const [addr, s] of final.slice(0, 20)) {
    const lastDiffs = s.diffs.map(d => d.from + "→" + d.to).join(" ");
    let tag = "";
    if (s.max >= 90 && s.min <= 70 && s.count >= 5) tag = " ⭐⭐⭐ HEALTH";
    else if (s.max >= 85 && s.count >= 5) tag = " ⭐⭐";

    console.log("   $7E:" + addr.toString(16).padStart(4).toUpperCase() +
      "  " + s.max + "→" + s.min + "  ↓" + s.count + "  [" + lastDiffs + "]" + tag);
  }

  if (final.length === 0) {
    console.log("   (none found — no decreases detected in health range)");
  }

  sock.close();
  console.log("\n✅ Done.");
}

main().catch(console.error);
