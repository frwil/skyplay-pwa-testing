/**
 * Self-contained launcher: starts RetroArch with KOF2002, waits for it to
 * be ready, then runs the discovery. Cleans up on exit.
 *
 * Usage:
 *   docker cp ... game-server-game-server-1:/tmp/
 *   docker exec game-server-game-server-1 node /tmp/run-kof2002-discovery.mjs
 */
import { spawn } from "child_process";
import { createSocket } from "dgram";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const DISPLAY = ":99";
const RA_PORT = 55355;
const ROM = "/roms/kof2002.zip";
const CORE = "/usr/lib/libretro/fbneo_libretro.so";
const DURATION_S = parseInt(process.argv[2]) || 90;

// ── Minimal RetroArch config ──────────────────────────────────────────
const RA_CONFIG = `
video_driver = "gl"
video_fullscreen = "false"
video_windowed_fullscreen = "false"
custom_viewport_width = "960"
custom_viewport_height = "672"
custom_viewport_x = "0"
custom_viewport_y = "0"
video_scale_integer = "false"
video_smooth = "false"
audio_enable = "false"
video_font_enable = "false"
network_cmd_enable = "true"
network_cmd_port = "${RA_PORT}"
input_overlay_enable = "false"
fps_show = "false"
menu_driver = "rgui"
`.trim();

// ── Xvfb start ────────────────────────────────────────────────────────
function startXvfb() {
  return new Promise((resolve, reject) => {
    const xvfb = spawn("Xvfb", [DISPLAY, "-screen", "0", "960x672x24"], {
      stdio: "ignore",
    });
    xvfb.on("error", reject);
    // Give it a moment to start
    setTimeout(() => resolve(xvfb), 2000);
  });
}

// ── RetroArch start ───────────────────────────────────────────────────
function startRetroArch() {
  return new Promise((resolve, reject) => {
    const cfgPath = join(tmpdir(), "ra-discovery.cfg");
    writeFileSync(cfgPath, RA_CONFIG, "utf-8");

    const ra = spawn("retroarch", [
      "-L", CORE,
      ROM,
      "--appendconfig", cfgPath,
      "-v",
    ], {
      env: { ...process.env, DISPLAY },
      stdio: ["ignore", "ignore", "pipe"],
    });

    let started = false;
    ra.stderr.on("data", (d) => {
      const txt = d.toString();
      process.stderr.write(`[ra] ${txt}`);
      if (!started && (txt.includes("loaded") || txt.includes("opened"))) {
        started = true;
        setTimeout(() => resolve({ ra, cfgPath }), 3000);
      }
    });

    ra.on("error", reject);
    ra.on("exit", (code) => {
      if (!started) reject(new Error(`RetroArch exited early with code ${code}`));
    });

    // Fallback: resolve after 8s even if no "loaded" message
    setTimeout(() => {
      if (!started) {
        started = true;
        resolve({ ra, cfgPath });
      }
    }, 8000);
  });
}

// ── Wait for UDP readiness ────────────────────────────────────────────
function waitForUdp() {
  return new Promise((resolve, reject) => {
    const udp = createSocket("udp4");
    let attempts = 0;
    const maxAttempts = 30;

    const tryRead = () => {
      attempts++;
      let resolved = false;

      const handler = (msg) => {
        if (resolved) return;
        resolved = true;
        udp.removeListener("message", handler);
        clearTimeout(timer);
        udp.close();
        resolve(true);
      };

      const timer = setTimeout(() => {
        if (resolved) return;
        udp.removeListener("message", handler);
        if (attempts >= maxAttempts) {
          udp.close();
          reject(new Error(`UDP not ready after ${maxAttempts} attempts`));
        } else {
          setTimeout(tryRead, 1000);
        }
      }, 2000);

      udp.on("message", handler);
      udp.send(Buffer.from(`READ_CORE_RAM 8238 1\n`), RA_PORT, "127.0.0.1");
    };

    tryRead();
  });
}

// ── Import and run the discovery ──────────────────────────────────────
async function main() {
  console.log("🚀 Starting KOF2002 discovery environment...");

  // 1. Start Xvfb
  console.log("   Starting Xvfb on", DISPLAY, "...");
  const xvfb = await startXvfb();
  console.log("   ✅ Xvfb started");

  // 2. Start RetroArch
  console.log("   Starting RetroArch with KOF2002...");
  const { ra, cfgPath } = await startRetroArch();
  console.log("   ✅ RetroArch started");

  // 3. Wait for UDP
  console.log("   Waiting for RetroArch UDP readiness...");
  await waitForUdp();
  console.log("   ✅ UDP ready\n");

  // 4. Run the discovery
  console.log(`🔍 Running RAM discovery for ${DURATION_S}s...`);
  console.log("   ⚠️  Press INSERT COIN + START in the game if needed to reach char select");
  console.log("   (Waiting 10s for you to navigate to char select / match start)\n");
  await new Promise(r => setTimeout(r, 10000));

  // Dynamically import the discovery script
  await import("/tmp/discover-kof2002.mjs").catch(async (err) => {
    console.error("Import failed, running inline discovery instead:", err.message);
    await runInlineDiscovery(DURATION_S);
  });

  // 5. Cleanup
  console.log("\n🧹 Cleaning up...");
  ra.kill("SIGTERM");
  xvfb.kill("SIGTERM");
  try { unlinkSync(cfgPath); } catch {}
  console.log("✅ Done.");
}

// ── Inline discovery (fallback if import fails) ───────────────────────

const KOF98_ADDRS = {
  health:   { p1: 0x8238, p2: 0x8438 },
  timer:    { primary: 0xA83A, alt: 0x85D2 },
  char:     { p1: 0x823F, p2: 0x843F },
  mode_kof98: { p1: 0x821E, p2: 0x841E },
  mode_old: { p1: 0x81F0, p2: 0x83F0 },
  active:   { p1: 0x8256, p2: 0x8456 },
  matchFlag: 0xA840,
  lost:     { p1: 0xA859, p2: 0xA868 },
  pickOrder: {
    p1: [0x15CB, 0x15CA, 0x15CD],
    p2: [0x17CB, 0x17CA, 0x17CD],
  },
  teamBase: {
    p1: { base: 0xA84E, offsets: [0, 1, 3] },
    p2: { base: 0xA85E, offsets: [0, 2, 3] },
  },
};

async function runInlineDiscovery(durationS) {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const sock = createSocket("udp4");

  function readRam(addr, size) {
    return new Promise((resolve) => {
      const cmd = Buffer.from(`READ_CORE_RAM ${addr.toString(16)} ${size}\n`);
      let buf = "";
      const t = setTimeout(() => { sock.removeAllListeners("message"); resolve(null); }, 2000);
      const h = (msg) => {
        buf += msg.toString();
        const lines = buf.split("\n"); buf = lines.pop() || "";
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length < 3 || parts[0] !== "READ_CORE_RAM") continue;
          if (parseInt(parts[1], 16) !== addr) continue;
          clearTimeout(t); sock.removeListener("message", h);
          resolve(parts.slice(2).join(""));
          return;
        }
      };
      sock.on("message", h);
      sock.send(cmd, RA_PORT, "127.0.0.1");
    });
  }

  // Compute read range
  const allAddrs = [
    KOF98_ADDRS.health.p1, KOF98_ADDRS.health.p2,
    KOF98_ADDRS.char.p1, KOF98_ADDRS.char.p2,
    KOF98_ADDRS.mode_kof98.p1, KOF98_ADDRS.mode_kof98.p2,
    KOF98_ADDRS.mode_old.p1, KOF98_ADDRS.mode_old.p2,
    KOF98_ADDRS.active.p1, KOF98_ADDRS.active.p2,
    KOF98_ADDRS.matchFlag,
    KOF98_ADDRS.lost.p1, KOF98_ADDRS.lost.p2,
    ...KOF98_ADDRS.pickOrder.p1, ...KOF98_ADDRS.pickOrder.p2,
    KOF98_ADDRS.teamBase.p1.base + Math.max(...KOF98_ADDRS.teamBase.p1.offsets),
    KOF98_ADDRS.teamBase.p2.base + Math.max(...KOF98_ADDRS.teamBase.p2.offsets),
    KOF98_ADDRS.timer.primary, KOF98_ADDRS.timer.alt,
  ];
  const minAddr = Math.min(...allAddrs);
  const maxAddr = Math.max(...allAddrs);
  const chunkSize = maxAddr + 2 - minAddr;

  const off = (addr) => (addr - minAddr) * 2;
  const readByte = (hex, addr) => {
    const o = off(addr);
    if (!hex || o < 0 || o + 2 > hex.length) return -1;
    return parseInt(hex.substring(o, o + 2), 16);
  };

  const history = [];
  const t0 = Date.now();
  const deadline = t0 + durationS * 1000;
  let poll = 0;

  while (Date.now() < deadline) {
    await sleep(500);
    poll++;
    const hex = await readRam(minAddr, chunkSize);
    if (!hex) continue;

    const snap = {
      hp1: readByte(hex, KOF98_ADDRS.health.p1),
      hp2: readByte(hex, KOF98_ADDRS.health.p2),
      t: readByte(hex, KOF98_ADDRS.timer.primary),
      c1: readByte(hex, KOF98_ADDRS.char.p1),
      c2: readByte(hex, KOF98_ADDRS.char.p2),
      mode1_kof98: readByte(hex, KOF98_ADDRS.mode_kof98.p1),
      mode2_kof98: readByte(hex, KOF98_ADDRS.mode_kof98.p2),
      mode1_old: readByte(hex, KOF98_ADDRS.mode_old.p1),
      mode2_old: readByte(hex, KOF98_ADDRS.mode_old.p2),
      active1: readByte(hex, KOF98_ADDRS.active.p1),
      active2: readByte(hex, KOF98_ADDRS.active.p2),
      flag: readByte(hex, KOF98_ADDRS.matchFlag),
      lost1: readByte(hex, KOF98_ADDRS.lost.p1),
      lost2: readByte(hex, KOF98_ADDRS.lost.p2),
      pick1: KOF98_ADDRS.pickOrder.p1.map(a => readByte(hex, a)),
      pick2: KOF98_ADDRS.pickOrder.p2.map(a => readByte(hex, a)),
      team1: KOF98_ADDRS.teamBase.p1.offsets.map(o => readByte(hex, KOF98_ADDRS.teamBase.p1.base + o)),
      team2: KOF98_ADDRS.teamBase.p2.offsets.map(o => readByte(hex, KOF98_ADDRS.teamBase.p2.base + o)),
    };
    history.push(snap);
    const el = ((Date.now() - t0) / 1000).toFixed(0);
    process.stdout.write(`\r   #${poll} (${el}s) HP1=0x${snap.hp1.toString(16)} HP2=0x${snap.hp2.toString(16)} T=${snap.t} C1=0x${snap.c1.toString(16)} C2=0x${snap.c2.toString(16)} flag=0x${snap.flag.toString(16)} lost P1=${snap.lost1} P2=${snap.lost2}   `);
  }
  console.log("\n");
  sock.close();

  // ── Report ────────────────────────────────────────────────────────
  const uniq = (arr, fn) => [...new Set(arr.map(fn))];

  console.log("══════════════════════════════════════════════════");
  console.log("📊 KOF2002 DISCOVERY RESULTS");
  console.log("══════════════════════════════════════════════════\n");

  console.log("🏥 Health (0x8238/0x8438):");
  console.log(`   P1: ${uniq(history, s => "0x"+s.hp1.toString(16)).join(", ")}`);
  console.log(`   P2: ${uniq(history, s => "0x"+s.hp2.toString(16)).join(", ")}\n`);

  console.log("⏱️  Timer (0xA83A/0x85D2):");
  console.log(`   Primary: ${uniq(history, s => s.t).slice(0,30).join("→")}`);
  console.log(`   Alt:     ${uniq(history, s => s.t).slice(0,30).join("→")}\n`);

  console.log("⚙️  Gauge Mode — KOF98 addr (0x821E/0x841E):");
  console.log(`   P1: ${uniq(history, s => s.mode1_kof98)} (1=ADV, 0=EXT)`);
  console.log(`   P2: ${uniq(history, s => s.mode2_kof98)}`);
  const modeKof98Ok = [...new Set(history.map(s => s.mode1_kof98))].every(v => v === 0 || v === 1);
  console.log(`   ${modeKof98Ok ? "✅ STABLE 0/1" : "❌ UNSTABLE"}\n`);

  console.log("⚙️  Gauge Mode — OLD addr (0x81F0/0x83F0):");
  console.log(`   P1: ${uniq(history, s => s.mode1_old)}`);
  console.log(`   P2: ${uniq(history, s => s.mode2_old)}`);
  const modeOldOk = [...new Set(history.map(s => s.mode1_old))].every(v => v === 0 || v === 1);
  console.log(`   ${modeOldOk ? "✅ STABLE 0/1" : "❌ UNSTABLE"}\n`);

  console.log("👤 Char IDs (0x823F/0x843F):");
  console.log(`   P1: ${uniq(history, s => "0x"+s.c1.toString(16)).join(", ")}`);
  console.log(`   P2: ${uniq(history, s => "0x"+s.c2.toString(16)).join(", ")}\n`);

  console.log("🎯 Active char (0x8256/0x8456):");
  console.log(`   P1: ${uniq(history, s => "0x"+s.active1.toString(16)).join(", ")}`);
  console.log(`   P2: ${uniq(history, s => "0x"+s.active2.toString(16)).join(", ")}\n`);

  console.log(`🚩 Match flag (0xA840): ${uniq(history, s => "0x"+s.flag.toString(16)).join(", ")}\n`);

  console.log("💀 Lost counters (0xA859/0xA868):");
  console.log(`   P1: ${uniq(history, s => s.lost1).join("→")}`);
  console.log(`   P2: ${uniq(history, s => s.lost2).join("→")}\n`);

  console.log("📋 Pick order (0x15CB/CA/CD + 0x17CB/CA/CD):");
  for (const s of history.filter((_, i) => i % 10 === 0).slice(-5)) {
    console.log(`   P1: [${s.pick1.map(v=>"0x"+v.toString(16)).join(", ")}]  P2: [${s.pick2.map(v=>"0x"+v.toString(16)).join(", ")}]`);
  }
  console.log();

  console.log("👥 Team roster (0xA84E/0xA85E):");
  for (const s of history.filter((_, i) => i % 10 === 0).slice(-5)) {
    console.log(`   P1: [${s.team1.map(v=>"0x"+v.toString(16)).join(", ")}]  P2: [${s.team2.map(v=>"0x"+v.toString(16)).join(", ")}]`);
  }
}

main().catch((err) => {
  console.error("❌ Fatal:", err.message);
  process.exit(1);
});
