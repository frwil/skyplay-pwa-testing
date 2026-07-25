/**
 * SFA2 (Europe) Real-Time Health Monitor
 *
 * Addresses discovered 2026-07-25:
 *   P1: 0x1D3D (real health), 0x1D3E (visual/shadow health)
 *   P2: 0x1D3F (real health), 0x1D40 (visual/shadow health)
 *
 * Reads 8 bytes around 0x1D3C at max speed (~15ms/poll).
 * Shows live health bars, hit detection, KO detection, round resets.
 *
 * Usage: cat this | docker exec -i game-server-game-server-1 sh -c "cat > /tmp/hm.mjs && node /tmp/hm.mjs"
 */

import { createSocket } from "dgram";
import { Buffer } from "buffer";

const HOST = "127.0.0.1";
const PORT = 55355;
const BASE = 0x1D3C; // read 8 bytes from here to cover 1D3D-1D40
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function udpCmd(sock, cmd) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), 2000);
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

async function readHealth(sock) {
  try {
    const r = await udpCmd(sock, `READ_CORE_RAM ${BASE.toString(16)} 8`);
    const parts = r.split(" ");
    const data = parts.slice(2).join("");
    return {
      p1Real: parseInt(data.substring(2, 4), 16),   // offset +1 = 0x1D3D
      p1Vis:  parseInt(data.substring(4, 6), 16),   // offset +2 = 0x1D3E
      p2Real: parseInt(data.substring(6, 8), 16),   // offset +3 = 0x1D3F
      p2Vis:  parseInt(data.substring(8, 10), 16),  // offset +4 = 0x1D40
    };
  } catch { return null; }
}

function bar(val, max = 96) {
  const pct = Math.max(0, val / max);
  const w = 30;
  const filled = Math.round(pct * w);
  const empty = w - filled;
  let color;
  if (pct > 0.6) color = "\x1b[32m"; // green
  else if (pct > 0.3) color = "\x1b[33m"; // yellow
  else color = "\x1b[31m"; // red
  return color + "█".repeat(filled) + "\x1b[90m" + "░".repeat(empty) + "\x1b[0m";
}

function resetScreen() {
  process.stdout.write("\x1b[2J\x1b[H"); // clear screen, home cursor
}

async function main() {
  const sock = createSocket("udp4");

  try {
    const status = await udpCmd(sock, "GET_STATUS");
    if (!status.includes("PLAYING")) {
      console.log("❌ " + status);
      sock.close();
      return;
    }
  } catch {
    console.log("❌ No RetroArch");
    sock.close();
    return;
  }

  // State tracking
  let prev = null;
  let p1MaxDmg = 0, p2MaxDmg = 0;
  const events = [];
  let round = 1;

  resetScreen();
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║   🎮 SFA2 Health Monitor — Live                     ║");
  console.log("║   P1: 0x1D3D (real) + 0x1D3E (visual)              ║");
  console.log("║   P2: 0x1D3F (real) + 0x1D40 (visual)              ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  const deadline = Date.now() + 600000; // 10 min
  let poll = 0;
  let startTime = Date.now();

  while (Date.now() < deadline) {
    poll++;
    const h = await readHealth(sock);

    if (!h) {
      await sleep(50);
      continue;
    }

    // Detect round reset (both back to 96)
    if (prev && prev.p1Real < 30 && h.p1Real >= 90 && h.p2Real >= 90) {
      round++;
      p1MaxDmg = 0; p2MaxDmg = 0;
      events.push({ type: "NEW_ROUND", round, time: ((Date.now() - startTime) / 1000).toFixed(1) });
      console.log(`\n🔄 ROUND ${round} — health reset\n`);
    }

    // Detect P1 hit
    if (prev && (prev.p1Real - h.p1Real) >= 3) {
      const dmg = prev.p1Real - h.p1Real;
      if (dmg > p1MaxDmg) p1MaxDmg = dmg;
      events.push({ type: "P1_HIT", dmg, from: pct(prev.p1Real), to: pct(h.p1Real), time: ((Date.now() - startTime) / 1000).toFixed(1) });
      console.log(`\x1b[34m  👊 P1 hit!  -${dmg}  (${pct(prev.p1Real)}% → ${pct(h.p1Real)}%)\x1b[0m`);
    }

    // Detect P2 hit
    if (prev && (prev.p2Real - h.p2Real) >= 3) {
      const dmg = prev.p2Real - h.p2Real;
      if (dmg > p2MaxDmg) p2MaxDmg = dmg;
      events.push({ type: "P2_HIT", dmg, from: pct(prev.p2Real), to: pct(h.p2Real), time: ((Date.now() - startTime) / 1000).toFixed(1) });
      console.log(`\x1b[31m  👊 P2 hit!  -${dmg}  (${pct(prev.p2Real)}% → ${pct(h.p2Real)}%)\x1b[0m`);
    }

    // Detect KO
    if (prev && h.p1Real === 0 && prev.p1Real > 0) {
      console.log(`\n💀 P1 KO!  (max hit: ${p1MaxDmg})\n`);
    }
    if (prev && h.p2Real === 0 && prev.p2Real > 0) {
      console.log(`\n💀 P2 KO!  (max hit: ${p2MaxDmg})\n`);
    }

    // Show health every 2 polls (~30ms) to avoid flicker
    if (poll % 2 === 0) {
      // Move cursor up to refresh in-place
      if (poll > 2) process.stdout.write("\x1b[12A");

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  ╭─ P1 ───────────────────────╮   ╭─ P2 ───────────────────────╮`);
      console.log(`  │ Real: ${pad3(h.p1Real)}/96 ${bar(h.p1Real)} │   │ Real: ${pad3(h.p2Real)}/96 ${bar(h.p2Real)} │`);
      console.log(`  │ Vis : ${pad3(h.p1Vis)}/96 ${bar(h.p1Vis)} │   │ Vis : ${pad3(h.p2Vis)}/96 ${bar(h.p2Vis)} │`);
      console.log(`  ╰────────────────────────────╯   ╰────────────────────────────╯`);
      console.log(`  P1 diff: ${pad3(h.p1Vis - h.p1Real)} (shadow)              P2 diff: ${pad3(h.p2Vis - h.p2Real)} (shadow)`);
      console.log(`  Round ${round} | T+${elapsed}s | poll #${poll}`);
      console.log(`  Last hit: P1 max ${p1MaxDmg} dmg | P2 max ${p2MaxDmg} dmg`);
      console.log("");
    }

    prev = h;
    await sleep(14); // ~70 polls/sec max, throttled to ~35/sec with processing
  }

  sock.close();
  console.log("\n✅ Monitor stopped.");
}

function pct(val) { return Math.round(val / 96 * 100); }
function pad3(n) { const s = String(n); return " ".repeat(3 - s.length) + s; }

main().catch(console.error);
