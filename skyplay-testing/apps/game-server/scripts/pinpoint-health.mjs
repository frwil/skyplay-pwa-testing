/**
 * PINPOINT: Monitor ONLY 0x1D3F and 0x1D40 at max speed.
 * These are the only candidates that appeared during combat with health-like range.
 *
 * Theory: 0x1D3F = P1 health, 0x1D40 = P2 health (or vice versa)
 * Both should start at 96 in Round 3, decrease when damaged.
 */

import { createSocket } from "dgram";
import { Buffer } from "buffer";

const HOST = "127.0.0.1";
const PORT = 55355;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Read 16 bytes around 0x1D3F (covers 0x1D30-0x1D4F)
function udpCmd(sock, cmd) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), 1000);
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

async function readHealthPair(sock) {
  // Read 32 bytes starting at 0x1D30 (covers 0x1D3F and 0x1D40 with context)
  const r = await udpCmd(sock, "READ_CORE_RAM 1d30 32");
  const parts = r.split(" ");
  const data = parts.slice(2).join("");
  const vals = {};
  for (let i = 0; i < data.length; i += 2) {
    const b = parseInt(data.substring(i, i + 2), 16);
    if (!isNaN(b)) vals[0x1d30 + i / 2] = b;
  }
  return vals;
}

async function main() {
  const sock = createSocket("udp4");
  const t0 = Date.now();

  console.log("🎯 PINPOINT: Monitoring 0x1D3F & 0x1D40");
  console.log("=" .repeat(50));

  try {
    const s = await udpCmd(sock, "GET_STATUS");
    console.log("📡 " + s);
  } catch {
    console.log("❌ No RetroArch");
    sock.close();
    return;
  }

  // Initial reading
  let prev = await readHealthPair(sock);
  const p1cand = prev[0x1d3f];
  const p2cand = prev[0x1d40];
  console.log("\n📍 INITIAL:");
  console.log("   0x1D3F = " + p1cand + "  (P1 health candidate)");
  console.log("   0x1D40 = " + p2cand + "  (P2 health candidate)");
  console.log("   Neighbors: 0x1D3D=" + prev[0x1d3d] + " 0x1D3E=" + prev[0x1d3e] +
    " 0x1D41=" + prev[0x1d41] + " 0x1D42=" + prev[0x1d42]);

  // Also check the direct page candidate
  const dp = await udpCmd(sock, "READ_CORE_RAM eb 2");
  const dpParts = dp.split(" ");
  console.log("   0x00EB (direct page) = " + parseInt(dpParts[2], 16));

  console.log("\n🔄 Polling at max speed — tell me when damage happens!\n");

  const history = [];
  let pollNum = 0;
  const deadline = Date.now() + 120000;

  while (Date.now() < deadline) {
    pollNum++;
    const start = Date.now();
    const curr = await readHealthPair(sock);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const pollTime = Date.now() - start;

    const v1 = curr[0x1d3f];
    const v2 = curr[0x1d40];
    const pv1 = prev[0x1d3f];
    const pv2 = prev[0x1d40];

    const changes = [];
    if (v1 !== pv1) changes.push("0x1D3F: " + pv1 + "→" + v1 + " (Δ" + (v1 - pv1) + ")");
    if (v2 !== pv2) changes.push("0x1D40: " + pv2 + "→" + v2 + " (Δ" + (v2 - pv2) + ")");

    if (changes.length > 0) {
      console.log("⚡ [" + elapsed + "s] " + changes.join(" | "));
      history.push({ time: elapsed, v1, v2, changes });
    }

    prev = curr;

    if (pollNum % 20 === 0) {
      process.stdout.write("\r   #" + pollNum + " T+" + elapsed + "s | 0x1D3F=" + v1 + " 0x1D40=" + v2 + " | " + pollTime + "ms/poll");
    }

    // Dynamic sleep: target 50ms per poll
    const sleepTime = Math.max(5, 50 - pollTime);
    await sleep(sleepTime);
  }

  // Final
  console.log("\n\n📊 HISTORY (" + history.length + " changes over " + pollNum + " polls)");
  for (const h of history) {
    console.log("   [" + h.time + "s] 0x1D3F=" + h.v1 + " 0x1D40=" + h.v2);
  }

  sock.close();
  console.log("\n✅ Done.");
}

main().catch(console.error);
