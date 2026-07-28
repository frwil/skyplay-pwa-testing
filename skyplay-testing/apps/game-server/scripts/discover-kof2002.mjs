/**
 * KOF2002 RAM Discovery Script
 * =============================
 * Verifies which KOF98 addresses also work for KOF2002 (same NeoGeo engine).
 * Also discovers the KOF2002 character roster mapping.
 *
 * Run while a KOF2002 match is IN PROGRESS (past char select, timer counting down):
 *   docker cp apps/game-server/scripts/discover-kof2002.mjs game-server-game-server-1:/tmp/
 *   docker exec game-server-game-server-1 node /tmp/discover-kof2002.mjs
 *
 * The script polls known KOF98 addresses and their neighborhoods for 120s.
 */

import { createSocket } from "dgram";

const HOST = "127.0.0.1";
const PORT = 55355;
const POLL_MS = 500; // poll every 500ms
const DURATION_S = parseInt(process.argv[2]) || 120;

// ── Known KOF98 addresses (to test against KOF2002) ──────────────────
const KOF98_ADDRESSES = {
  health:   { p1: 0x8238, p2: 0x8438 },
  timer:    { primary: 0xA83A, alt: 0x85D2 },
  char:     { p1: 0x823F, p2: 0x843F },
  mode:     { p1_kof98: 0x821E, p2_kof98: 0x841E, p1_old: 0x81F0, p2_old: 0x83F0 },
  active:   { p1: 0x8256, p2: 0x8456 },
  matchFlag: 0xA840,
  lost:     { p1: 0xA859, p2: 0xA868 },
  pickOrder: {
    p1: [0x15CB, 0x15CA, 0x15CD], // [1st, 2nd, 3rd] in fight order
    p2: [0x17CB, 0x17CA, 0x17CD],
  },
  teamBase: {
    p1: { base: 0xA84E, offsets: [0, 1, 3] },
    p2: { base: 0xA85E, offsets: [0, 2, 3] },
  },
};

// ── Utility ───────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readRam(sock, addr, size) {
  return new Promise((resolve) => {
    const cmd = Buffer.from(`READ_CORE_RAM ${addr.toString(16)} ${size}\n`);
    let buf = "";
    const timer = setTimeout(() => { sock.removeAllListeners("message"); resolve(null); }, 2000);

    const handler = (msg) => {
      buf += msg.toString();
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length < 3) continue;
        if (parts[0] !== "READ_CORE_RAM") continue;
        const rspAddr = parseInt(parts[1], 16);
        if (rspAddr !== addr) continue;
        const hex = parts.slice(2).join("");
        clearTimeout(timer);
        sock.removeListener("message", handler);
        resolve(hex === "-1" ? null : hex);
        return;
      }
    };
    sock.on("message", handler);
    sock.send(cmd, PORT, HOST);
  });
}

function hexToBytes(hex) {
  if (!hex) return [];
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16));
  }
  return bytes;
}

// ── Read all test points in a single efficient chunk ──────────────────
// Compute the minimal span covering all addresses of interest
function computeReadRange() {
  const addrs = [
    KOF98_ADDRESSES.health.p1, KOF98_ADDRESSES.health.p2,
    KOF98_ADDRESSES.char.p1, KOF98_ADDRESSES.char.p2,
    KOF98_ADDRESSES.mode.p1_kof98, KOF98_ADDRESSES.mode.p2_kof98,
    KOF98_ADDRESSES.mode.p1_old, KOF98_ADDRESSES.mode.p2_old,
    KOF98_ADDRESSES.active.p1, KOF98_ADDRESSES.active.p2,
    KOF98_ADDRESSES.matchFlag,
    KOF98_ADDRESSES.lost.p1, KOF98_ADDRESSES.lost.p2,
    ...KOF98_ADDRESSES.pickOrder.p1, ...KOF98_ADDRESSES.pickOrder.p2,
    KOF98_ADDRESSES.teamBase.p1.base + Math.max(...KOF98_ADDRESSES.teamBase.p1.offsets),
    KOF98_ADDRESSES.teamBase.p2.base + Math.max(...KOF98_ADDRESSES.teamBase.p2.offsets),
  ];
  const minAddr = Math.min(...addrs);
  const maxAddr = Math.max(...addrs);
  return { minAddr, maxAddr, size: maxAddr + 2 - minAddr };
}

// ── Parse all fields from a chunk read ────────────────────────────────

function parseSnapshot(hex, minAddr) {
  if (!hex) return null;
  const off = (addr) => (addr - minAddr) * 2;

  const readByte = (addr) => {
    const o = off(addr);
    if (o < 0 || o + 2 > hex.length) return -1;
    return parseInt(hex.substring(o, o + 2), 16);
  };

  return {
    health: {
      p1: readByte(KOF98_ADDRESSES.health.p1),
      p2: readByte(KOF98_ADDRESSES.health.p2),
    },
    timer: {
      primary: readByte(KOF98_ADDRESSES.timer.primary),
      alt: readByte(KOF98_ADDRESSES.timer.alt),
    },
    chars: {
      p1: readByte(KOF98_ADDRESSES.char.p1),
      p2: readByte(KOF98_ADDRESSES.char.p2),
    },
    mode: {
      p1_kof98: readByte(KOF98_ADDRESSES.mode.p1_kof98),
      p2_kof98: readByte(KOF98_ADDRESSES.mode.p2_kof98),
      p1_old: readByte(KOF98_ADDRESSES.mode.p1_old),
      p2_old: readByte(KOF98_ADDRESSES.mode.p2_old),
    },
    active: {
      p1: readByte(KOF98_ADDRESSES.active.p1),
      p2: readByte(KOF98_ADDRESSES.active.p2),
    },
    matchFlag: readByte(KOF98_ADDRESSES.matchFlag),
    lost: {
      p1: readByte(KOF98_ADDRESSES.lost.p1),
      p2: readByte(KOF98_ADDRESSES.lost.p2),
    },
    pickOrder: {
      p1: KOF98_ADDRESSES.pickOrder.p1.map(a => readByte(a)),
      p2: KOF98_ADDRESSES.pickOrder.p2.map(a => readByte(a)),
    },
    teamSlots: {
      p1: KOF98_ADDRESSES.teamBase.p1.offsets.map(o => readByte(KOF98_ADDRESSES.teamBase.p1.base + o)),
      p2: KOF98_ADDRESSES.teamBase.p2.offsets.map(o => readByte(KOF98_ADDRESSES.teamBase.p2.base + o)),
    },
  };
}

// ── Also do a wide scan of the team/lost/pick-order region ───────────

async function scanRegion(sock, start, end) {
  const allBytes = new Map();
  for (let addr = start; addr < end; addr += 256) {
    const size = Math.min(256, end - addr);
    const hex = await readRam(sock, addr, size);
    if (hex) {
      const bytes = hexToBytes(hex);
      for (let i = 0; i < bytes.length; i++) {
        allBytes.set(addr + i, bytes[i]);
      }
    }
  }
  return allBytes;
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const sock = createSocket("udp4");
  const { minAddr, size } = computeReadRange();

  console.log("🔍 KOF2002 RAM Discovery");
  console.log(`   Polling 0x${minAddr.toString(16)}-0x${(minAddr + size).toString(16)} every ${POLL_MS}ms for ${DURATION_S}s`);
  console.log("   ⚠️  Make sure a KOF2002 match is IN PROGRESS (past char select)\n");

  // Quick pre-check: can we read from RetroArch?
  const testHex = await readRam(sock, 0x8238, 1);
  if (!testHex) {
    console.error("❌ Cannot reach RetroArch UDP. Is a game loaded?");
    sock.close();
    process.exit(1);
  }
  console.log("✅ RetroArch UDP reachable. Starting poll...\n");

  // ── Continuous focused poll ─────────────────────────────────────────
  const history = [];
  let pollCount = 0;
  const t0 = Date.now();
  const deadline = t0 + DURATION_S * 1000;

  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    pollCount++;
    const hex = await readRam(sock, minAddr, size);
    const snap = parseSnapshot(hex, minAddr);
    if (snap) {
      history.push({ t: Date.now() - t0, ...snap });
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      process.stdout.write(`\r   Poll #${pollCount} (${elapsed}s) — HP1=${snap.health.p1} HP2=${snap.health.p2} T=${snap.timer.primary} flag=0x${snap.matchFlag?.toString(16)||"?"} lost P1=${snap.lost.p1} P2=${snap.lost.p2}   `);
    }
  }
  console.log("\n");

  sock.close();

  // ── Analysis ────────────────────────────────────────────────────────

  console.log("═══════════════════════════════════════════════════════");
  console.log("📊 ANALYSIS");
  console.log("═══════════════════════════════════════════════════════\n");

  // 1. Health — should vary 0..0x67 (103)
  const healthVals = { p1: new Set(), p2: new Set() };
  for (const s of history) {
    if (s.health.p1 >= 0) healthVals.p1.add(s.health.p1);
    if (s.health.p2 >= 0) healthVals.p2.add(s.health.p2);
  }
  console.log("🏥 Health (expected: varies 0-0x67):");
  console.log(`   P1 0x${KOF98_ADDRESSES.health.p1.toString(16)}: ${[...healthVals.p1].sort((a,b)=>a-b).slice(0,15).join(",")}... (${healthVals.p1.size} unique values)`);
  console.log(`   P2 0x${KOF98_ADDRESSES.health.p2.toString(16)}: ${[...healthVals.p2].sort((a,b)=>a-b).slice(0,15).join(",")}... (${healthVals.p2.size} unique values)`);
  const healthOK = healthVals.p1.size > 3 && Math.max(...[...healthVals.p1]) <= 0x67;
  console.log(`   Status: ${healthOK ? "✅ LOOKS VALID" : "⚠️  SUSPECT — check values"}\n`);

  // 2. Timer — should count down
  const timerVals = { primary: [], alt: [] };
  for (const s of history) {
    if (s.timer.primary >= 0) timerVals.primary.push(s.timer.primary);
    if (s.timer.alt >= 0) timerVals.alt.push(s.timer.alt);
  }
  const timerTrend = timerVals.primary.length >= 10
    ? (timerVals.primary[0] > timerVals.primary[timerVals.primary.length - 1] ? "DECREASING ✅" : "NOT decreasing ⚠️")
    : "?";
  console.log("⏱️  Timer (expected: 99→0 countdown):");
  console.log(`   Primary 0x${KOF98_ADDRESSES.timer.primary.toString(16)}: ${timerVals.primary.slice(0,20).join("→")} (${timerTrend})`);
  console.log(`   Alt     0x${KOF98_ADDRESSES.timer.alt.toString(16)}: ${timerVals.alt.slice(0,20).join("→")}\n`);

  // 3. Character IDs
  const charVals = { p1: new Set(), p2: new Set() };
  for (const s of history) {
    if (s.chars.p1 >= 0) charVals.p1.add(s.chars.p1);
    if (s.chars.p2 >= 0) charVals.p2.add(s.chars.p2);
  }
  console.log("👤 Character IDs (expected: valid char IDs, may change on KO):");
  console.log(`   P1 0x${KOF98_ADDRESSES.char.p1.toString(16)}: ${[...charVals.p1].map(v=>"0x"+v.toString(16)).join(", ")}`);
  console.log(`   P2 0x${KOF98_ADDRESSES.char.p2.toString(16)}: ${[...charVals.p2].map(v=>"0x"+v.toString(16)).join(", ")}\n`);

  // 4. Mode — test BOTH addresses (0x821E vs 0x81F0)
  console.log("⚙️  Gauge Mode (1=ADVANCED, 0=EXTRA):");
  const modeKof98 = { p1: new Set(), p2: new Set() };
  const modeOld = { p1: new Set(), p2: new Set() };
  for (const s of history) {
    if (s.mode.p1_kof98 >= 0) modeKof98.p1.add(s.mode.p1_kof98);
    if (s.mode.p2_kof98 >= 0) modeKof98.p2.add(s.mode.p2_kof98);
    if (s.mode.p1_old >= 0) modeOld.p1.add(s.mode.p1_old);
    if (s.mode.p2_old >= 0) modeOld.p2.add(s.mode.p2_old);
  }
  const evaluateMode = (label, addr, vals) => {
    const arr = [...vals];
    const stable = arr.length <= 2 && arr.every(v => v === 0 || v === 1);
    const stableStr = stable ? "✅ STABLE 0/1" : `❌ UNSTABLE (${arr.join(",")})`;
    console.log(`   ${label} 0x${addr.toString(16)}: ${stableStr} — vals: ${arr.join(", ")}`);
    return stable;
  };
  const kof98AddrOK = evaluateMode("P1 (KOF98 addr)", KOF98_ADDRESSES.mode.p1_kof98, modeKof98.p1) &&
                      evaluateMode("P2 (KOF98 addr)", KOF98_ADDRESSES.mode.p2_kof98, modeKof98.p2);
  const oldAddrOK = evaluateMode("P1 (OLD addr) ", KOF98_ADDRESSES.mode.p1_old, modeOld.p1) &&
                    evaluateMode("P2 (OLD addr) ", KOF98_ADDRESSES.mode.p2_old, modeOld.p2);
  console.log(`   → KOF98 address (0x821E/0x841E) ${kof98AddrOK ? "✅ CORRECT for KOF2002" : "❌ WRONG for KOF2002"}`);
  console.log(`   → OLD address  (0x81F0/0x83F0) ${oldAddrOK ? "✅ CORRECT for KOF2002" : "❌ WRONG for KOF2002"}\n`);

  // 5. Active character
  const activeVals = { p1: new Set(), p2: new Set() };
  for (const s of history) {
    if (s.active.p1 >= 0) activeVals.p1.add(s.active.p1);
    if (s.active.p2 >= 0) activeVals.p2.add(s.active.p2);
  }
  console.log("🎯 Active (fighting) character (expected: char ID, changes on KO):");
  console.log(`   P1 0x${KOF98_ADDRESSES.active.p1.toString(16)}: ${[...activeVals.p1].map(v=>"0x"+v.toString(16)).join(", ")} (${activeVals.p1.size} unique)`);
  console.log(`   P2 0x${KOF98_ADDRESSES.active.p2.toString(16)}: ${[...activeVals.p2].map(v=>"0x"+v.toString(16)).join(", ")} (${activeVals.p2.size} unique)\n`);

  // 6. Match flag
  const flagVals = new Set();
  for (const s of history) {
    if (s.matchFlag >= 0) flagVals.add(s.matchFlag);
  }
  console.log(`🚩 Match flag 0x${KOF98_ADDRESSES.matchFlag.toString(16)}: ${[...flagVals].map(v=>"0x"+v.toString(16)).join(", ")}`);
  const hasCombat = [...flagVals].some(v => v === 0x40 || v === 0x48);
  const hasCharSelect = [...flagVals].some(v => v === 0x00);
  console.log(`   Has combat (0x40/0x48): ${hasCombat ? "✅" : "❌"}`);
  console.log(`   Has char select (0x00): ${hasCharSelect ? "✅" : "❌"}\n`);

  // 7. Lost counters
  const lostHistory = [];
  for (const s of history) {
    if (s.lost.p1 >= 0 && s.lost.p2 >= 0) {
      lostHistory.push({ p1: s.lost.p1, p2: s.lost.p2 });
    }
  }
  const lostUnique = new Set(lostHistory.map(l => `${l.p1},${l.p2}`));
  console.log("💀 Lost counters (expected: 0→1→2→3 per player):");
  console.log(`   P1 0x${KOF98_ADDRESSES.lost.p1.toString(16)} / P2 0x${KOF98_ADDRESSES.lost.p2.toString(16)}`);
  console.log(`   States observed: ${[...lostUnique].join(" | ")}`);
  const lostMax = lostHistory.reduce((m, l) => ({ p1: Math.max(m.p1, l.p1), p2: Math.max(m.p2, l.p2) }), { p1: 0, p2: 0 });
  console.log(`   Max seen: P1=${lostMax.p1} P2=${lostMax.p2} (expect up to 3)`);
  const lostOK = lostMax.p1 <= 3 && lostMax.p2 <= 3 && lostUnique.size > 1;
  console.log(`   Status: ${lostOK ? "✅ LOOKS VALID" : "⚠️  NEEDS MORE DATA"}\n`);

  // 8. Team roster
  console.log("👥 Team roster (expected: 3 valid char IDs per player, stable during match):");
  const teamHistory = { p1: new Set(), p2: new Set() };
  for (const s of history) {
    const p1Str = s.teamSlots.p1.filter(v => v >= 0).join(",");
    const p2Str = s.teamSlots.p2.filter(v => v >= 0).join(",");
    if (p1Str) teamHistory.p1.add(p1Str);
    if (p2Str) teamHistory.p2.add(p2Str);
  }
  console.log(`   P1 base=0x${KOF98_ADDRESSES.teamBase.p1.base.toString(16)} offsets=${JSON.stringify(KOF98_ADDRESSES.teamBase.p1.offsets)}: ${[...teamHistory.p1].map(s => `[${s}]`).join(" ")}`);
  console.log(`   P2 base=0x${KOF98_ADDRESSES.teamBase.p2.base.toString(16)} offsets=${JSON.stringify(KOF98_ADDRESSES.teamBase.p2.offsets)}: ${[...teamHistory.p2].map(s => `[${s}]`).join(" ")}`);
  const teamOK = teamHistory.p1.size <= 3 && teamHistory.p2.size <= 3;
  console.log(`   Status: ${teamOK ? "✅ STABLE" : "⚠️  UNSTABLE — may need different offsets"}\n`);

  // 9. Pick order
  console.log("📋 Pick order (fight order buffer):");
  for (const s of history.slice(-5)) {
    const p1Order = s.pickOrder.p1.filter(v => v >= 0).map(v => "0x"+v.toString(16)).join(", ");
    const p2Order = s.pickOrder.p2.filter(v => v >= 0).map(v => "0x"+v.toString(16)).join(", ");
    console.log(`   [${((s.t/1000).toFixed(0))}s] P1: [${p1Order}]  P2: [${p2Order}]`);
  }
  const pickP1Vals = new Set(history.map(s => s.pickOrder.p1.join(",")));
  const pickP2Vals = new Set(history.map(s => s.pickOrder.p2.join(",")));
  const pickOK = pickP1Vals.size <= 3 && pickP2Vals.size <= 3;
  console.log(`   Status: ${pickOK ? "✅ STABLE" : "⚠️  UNSTABLE — pick order addresses may differ"}\n`);

  // ── Broad region scan (one-shot) ────────────────────────────────────
  console.log("═══════════════════════════════════════════════════════");
  console.log("🔬 BROAD REGION SCAN (0x1500-0x1600 + 0xA840-0xA870)");
  console.log("═══════════════════════════════════════════════════════\n");

  const sock2 = createSocket("udp4");

  // Scan pick order neighborhood
  console.log("📋 Pick-order candidate region (0x1500-0x1600):");
  const pickRegion = await scanRegion(sock2, 0x1500, 0x1600);
  // Find sequences of 3 valid char IDs
  const validChar = (v) => v >= 0x00 && v <= 0x3F; // KOF2002 may have up to ~50 chars
  const triplets = [];
  for (let addr = 0x1500; addr <= 0x15FD; addr++) {
    const a = pickRegion.get(addr), b = pickRegion.get(addr+1), c = pickRegion.get(addr+2);
    if (a !== undefined && b !== undefined && c !== undefined &&
        validChar(a) && validChar(b) && validChar(c) &&
        !(a === 0x00 && b === 0x00 && c === 0x00)) {
      triplets.push({ addr, ids: [a, b, c] });
    }
  }
  if (triplets.length > 0) {
    const seen = new Set();
    for (const t of triplets) {
      const key = t.ids.join(",");
      if (!seen.has(key)) {
        seen.add(key);
        console.log(`   0x${t.addr.toString(16)}: [${t.ids.map(v=>"0x"+v.toString(16)).join(", ")}]`);
      }
    }
    if (seen.size <= 5) console.log("   ✅ Pick-order region readable — few stable candidates");
    else console.log("   ⚠️  Many candidates — char select may not be active");
  } else {
    console.log("   ❌ No valid character triplets found. Is the match in char select?");
  }
  console.log();

  // Scan lost-counter neighborhood
  console.log("💀 Lost-counter candidate region (0xA840-0xA870):");
  const lostRegion = await scanRegion(sock2, 0xA840, 0xA870);
  // Dump the region
  const lines = [];
  for (let addr = 0xA840; addr < 0xA870; addr += 16) {
    const vals = [];
    for (let i = 0; i < 16; i++) {
      const v = lostRegion.get(addr + i);
      vals.push(v !== undefined ? v.toString(16).padStart(2,"0") : "??");
    }
    lines.push(`   0x${addr.toString(16)}: ${vals.join(" ")}`);
  }
  console.log(lines.join("\n"));
  console.log();

  // Show known addresses in this region
  console.log("   Known KOF98 addresses in this region:");
  for (const [label, addr] of [
    ["matchFlag", 0xA840],
    ["P1 lost", 0xA859],
    ["P2 lost", 0xA868],
    ["P1 team[0]", 0xA84E],
    ["P1 team[1]", 0xA84F],
    ["P1 team[2]", 0xA851],
    ["P2 team[0]", 0xA85E],
    ["P2 team[1]", 0xA860],
    ["P2 team[2]", 0xA861],
  ]) {
    const v = lostRegion.get(addr);
    console.log(`   ${label.padEnd(14)} 0x${addr.toString(16)} = 0x${v !== undefined ? v.toString(16) : "??"}`);
  }

  sock2.close();

  // ── Summary ─────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("📋 SUMMARY — KOF2002 vs KOF98 Address Compatibility");
  console.log("═══════════════════════════════════════════════════════\n");

  const results = [
    ["Health P1/P2", "0x8238/0x8438", healthOK],
    ["Timer", "0xA83A/0x85D2", timerTrend.includes("✅")],
    ["Char IDs", "0x823F/0x843F", charVals.p1.size > 0 && charVals.p2.size > 0],
    ["Mode (KOF98 addr)", "0x821E/0x841E", kof98AddrOK],
    ["Mode (OLD addr)", "0x81F0/0x83F0", oldAddrOK],
    ["Active char", "0x8256/0x8456", activeVals.p1.size >= 1 && activeVals.p2.size >= 1],
    ["Match flag", "0xA840", hasCombat || hasCharSelect],
    ["Lost counters", "0xA859/0xA868", lostOK],
    ["Team roster", "0xA84E/0xA85E+offsets", teamOK],
    ["Pick order", "0x15CB..0x17CD", pickOK],
  ];

  for (const [label, addr, ok] of results) {
    console.log(`   ${ok ? "✅" : "❌"} ${label.padEnd(20)} ${addr}`);
  }

  const confirmed = results.filter(r => r[2]).length;
  console.log(`\n   ${confirmed}/${results.length} addresses confirmed compatible`);
  console.log("\n✅ Discovery complete. Use confirmed addresses in game-runner.ts + game-config.ts.");
}

main().catch(console.error);
