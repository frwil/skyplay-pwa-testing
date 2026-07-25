/**
 * Damage differential scanner — based on user's methodology.
 * Looks for ANY byte that decreases by 5-40 points (typical damage range).
 * Excludes oscillating addresses (audio/graphics that go back up).
 *
 * Usage: docker exec game-server-game-server-1 node /tmp/scan-damage.mjs
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

async function dump8K(sock) {
  const all = new Map();
  for (let addr = 0; addr < SCAN_SIZE; addr += CHUNK) {
    try {
      const r = await udpCmd(sock, "READ_CORE_RAM " + addr.toString(16) + " " + CHUNK);
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
  catch { console.log("❌ No RA"); sock.close(); return; }

  console.log("\n🔍 Damage Differential Scanner");
  console.log("   Looking for decreases of 5-40 points (damage range)");
  console.log("   Oscillating addresses will be filtered out.\n");

  // Take baseline snapshot
  console.log("📸 Baseline snapshot...");
  let prev = await dump8K(sock);
  console.log("   " + prev.size + " bytes\n");

  // Track damage candidates: addr → { decreases: count, increases: count, minVal, maxVal, lastDecrease }
  const stats = new Map();
  const damageLog = []; // { time, addr, prev, curr }

  const deadline = Date.now() + 120000;
  let poll = 0;

  while (Date.now() < deadline) {
    poll++;
    const start = Date.now();
    const curr = await dump8K(sock);
    const pollTime = Date.now() - start;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    const newDamage = [];

    for (const [addr, val] of curr) {
      const pv = prev.get(addr);
      if (pv === undefined) continue;

      const diff = pv - val; // positive = decrease
      if (diff >= 5 && diff <= 40) {
        // Track stats
        if (!stats.has(addr)) stats.set(addr, { decreases: 0, increases: 0, minVal: 255, maxVal: 0 });
        const s = stats.get(addr);
        s.decreases++;
        if (val < s.minVal) s.minVal = val;
        if (pv > s.maxVal) s.maxVal = pv;
        newDamage.push({ addr, prev: pv, curr: val, diff });
      } else if (val > pv) {
        if (stats.has(addr)) stats.get(addr).increases++;
      }
    }

    if (newDamage.length > 0 && newDamage.length <= 8) {
      console.log("🔻 [" + elapsed + "s] Damage candidates (poll=" + pollTime + "ms):");
      for (const d of newDamage) {
        console.log("   $7E:" + d.addr.toString(16).padStart(4).toUpperCase() +
          "  " + d.prev + " → " + d.curr + "  (Δ-" + d.diff + ")");
      }
    } else if (newDamage.length > 8) {
      console.log("🔻 [" + elapsed + "s] " + newDamage.length + " damage-range decreases");
    }

    prev = curr;

    if (poll % 10 === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      const realCandidates = [...stats.entries()]
        .filter(([, s]) => s.decreases >= 3 && s.increases < s.decreases) // more decreases than increases = not oscillating
        .length;
      process.stdout.write("\r   T+" + elapsed + "s #" + poll + " | " + stats.size + " total candidates | " + realCandidates + " non-oscillating");
    }
  }

  console.log("\n\n" + "=".repeat(60));
  console.log("📊 DAMAGE CANDIDATES (decreased ≥3x, not oscillating)");
  console.log("=".repeat(60));

  const real = [...stats.entries()]
    .filter(([, s]) => s.decreases >= 3 && s.increases < s.decreases)
    .sort((a, b) => b[1].decreases - a[1].decreases);

  for (const [addr, s] of real.slice(0, 30)) {
    const range = s.maxVal - s.minVal;
    const healthLike = s.maxVal <= 100 && s.minVal >= 0;
    let tag = "";
    if (healthLike && s.decreases >= 5) tag = " ⭐ HEALTH";
    if (s.maxVal === 96) tag += " 🔥 MAX=96";

    console.log("   $7E:" + addr.toString(16).padStart(4).toUpperCase() +
      "  max=" + s.maxVal + " min=" + s.minVal +
      "  ↓" + s.decreases + " ↑" + s.increases + tag);
  }

  sock.close();
  console.log("\n✅ Done.");
}

main().catch(console.error);
