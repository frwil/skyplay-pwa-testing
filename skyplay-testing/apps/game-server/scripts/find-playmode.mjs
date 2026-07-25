/**
 * SFA2 Play Mode (Manual/Auto) Discovery Script
 *
 * Binary flag: 0x00 = Manual, 0x01 = Auto
 * Set during character select (after speed selection), persists through match.
 *
 * Methodology:
 *   1. save   — Start match with P1=MANUAL, P2=MANUAL → full WRAM snapshot
 *   2. compare — Start match with P1=AUTO, P2=MANUAL (same chars) → diff
 *
 * We look for bytes that changed 0x00→0x01 (Manual→Auto) in the P1 player block.
 *
 * Usage:
 *   node scripts/find-playmode.mjs save
 *   node scripts/find-playmode.mjs compare
 */

import { createSocket } from "dgram";
import { Buffer } from "buffer";
import { readFileSync, writeFileSync, existsSync } from "fs";

const HOST = "127.0.0.1", PORT = 55355, CHUNK = 256;
const SNAPSHOT_PATH = "/tmp/sfa2-playmode-snapshot.json";

// Known SFA2 addresses
const HEALTH_ADDR = 0x1D3D;
const CHAR_P1_ADDR = 0x1C07;
const CHAR_P2_ADDR = 0x1C08;
const TIMER_ADDR = 0x1B7D;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function udpCmd(sock, cmd) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), 1500);
    const h = (m) => {
      const txt = m.toString().trim();
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
  process.stdout.write("   Scanning 0x0000-0x1FFF...");
  for (let addr = 0x0000; addr < 0x2000; addr += CHUNK) {
    const size = Math.min(CHUNK, 0x2000 - addr);
    const chunk = await readChunk(sock, addr, size);
    for (const [a, v] of chunk) all.set(a, v);
    if (addr % 0x0400 === 0) process.stdout.write(` ${addr.toString(16)}`);
  }
  console.log(`\n   ✅ ${all.size} bytes captured`);
  return all;
}

async function readLive(sock) {
  const rHealth = await udpCmd(sock, `READ_CORE_RAM ${HEALTH_ADDR.toString(16)} 4`);
  const rTimer = await udpCmd(sock, `READ_CORE_RAM ${TIMER_ADDR.toString(16)} 2`);
  const rChar = await udpCmd(sock, `READ_CORE_RAM ${CHAR_P1_ADDR.toString(16)} 2`);
  if (!rHealth || !rTimer || !rChar) return null;

  const hParts = rHealth.split(" "); const hData = hParts.slice(2).join("");
  const tParts = rTimer.split(" "); const tData = tParts.slice(2).join("");
  const cParts = rChar.split(" "); const cData = cParts.slice(2).join("");

  return {
    p1Real: parseInt(hData.substring(0, 2), 16),
    p1Vis:  parseInt(hData.substring(2, 4), 16),
    p2Real: parseInt(hData.substring(4, 6), 16),
    p2Vis:  parseInt(hData.substring(6, 8), 16),
    timerRaw: parseInt(tData.substring(0, 2), 16),
    timerSub: parseInt(tData.substring(2, 4), 16),
    p1Char: parseInt(cData.substring(0, 2), 16),
    p2Char: parseInt(cData.substring(2, 4), 16),
  };
}

function liveLine(d) {
  const timerBcd = bcdToDec(d.timerRaw);
  const timerStr = timerBcd !== null ? `${timerBcd}s` : `0x${d.timerRaw.toString(16)}`;
  return `P1:❤️${d.p1Real}/👤${d.p1Char}  P2:❤️${d.p2Real}/👤${d.p2Char}  ⏱️${timerStr}`;
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const mode = process.argv[2];
  if (mode !== "save" && mode !== "compare") {
    console.log("Usage: node scripts/find-playmode.mjs save|compare");
    console.log("  save    — P1=MANUAL + P2=MANUAL snapshot");
    console.log("  compare — P1=AUTO + P2=MANUAL diff vs saved");
    process.exit(1);
  }

  const sock = createSocket("udp4");

  let status;
  try { status = await udpCmd(sock, "GET_STATUS"); } catch { status = null; }
  if (!status || !status.includes("PLAYING")) {
    console.log("❌ Game not running. Start a match first.");
    sock.close(); return;
  }
  console.log("📡 " + status.trim());

  // Quick live read to confirm we're in-match
  const live = await readLive(sock);
  if (live) {
    console.log(`   ${liveLine(live)}`);
  }

  if (mode === "save") {
    // ── SAVE: P1=Manual, P2=Manual ──
    console.log("\n📸 SAVE MODE — Ensure P1=MANUAL and P2=MANUAL");
    console.log("   (select Manual mode on the mode select screen)\n");

    const snap = await dumpFullWram(sock);
    const obj = {};
    for (const [a, v] of snap) obj[a] = v;
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(obj));
    console.log(`\n✅ Snapshot saved: ${Object.keys(obj).length} bytes → ${SNAPSHOT_PATH}`);

    // Show known addresses for reference
    console.log("\n📋 Reference values from this snapshot:");
    console.log(`   P1 Health (0x${HEALTH_ADDR.toString(16)}): ${snap.get(HEALTH_ADDR)}`);
    console.log(`   P2 Health (0x${(HEALTH_ADDR+2).toString(16)}): ${snap.get(HEALTH_ADDR+2)}`);
    console.log(`   P1 Char  (0x${CHAR_P1_ADDR.toString(16)}): ${snap.get(CHAR_P1_ADDR)}`);
    console.log(`   P2 Char  (0x${CHAR_P2_ADDR.toString(16)}): ${snap.get(CHAR_P2_ADDR)}`);
    console.log(`   Timer    (0x${TIMER_ADDR.toString(16)}): ${snap.get(TIMER_ADDR)}`);

    // Show bytes that are 0x01 nearby char IDs (potential mode flags already set)
    console.log("\n🔍 Bytes = 0x01 near P1 char (0x1C07) — candidates if already Manual=0x01?:");
    for (let off = -8; off <= 8; off++) {
      const addr = CHAR_P1_ADDR + off;
      const val = snap.get(addr);
      if (val !== undefined) {
        const marker = val === 0x01 ? " ⭐ 0x01!" : val === 0x00 ? " (0x00)" : "";
        if (marker) console.log(`   0x${addr.toString(16).toUpperCase()}: ${val}${marker}`);
      }
    }

    console.log("\n📌 Now restart, select P1=AUTO, P2=MANUAL, same chars, then run:");
    console.log("   node scripts/find-playmode.mjs compare\n");

  } else {
    // ── COMPARE: P1=Auto, P2=Manual ──
    if (!existsSync(SNAPSHOT_PATH)) {
      console.log(`❌ No snapshot at ${SNAPSHOT_PATH}. Run "save" first with P1=MANUAL.`);
      sock.close(); return;
    }

    console.log("\n📂 Loading Manual snapshot...");
    const raw = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf-8"));
    const snap1 = new Map();
    for (const [k, v] of Object.entries(raw)) snap1.set(Number(k), Number(v));
    console.log(`   ${snap1.size} bytes loaded`);

    console.log("\n📸 COMPARE MODE — Ensure P1=AUTO and P2=MANUAL");
    console.log("   (same characters as the save snapshot)\n");

    const snap2 = await dumpFullWram(sock);

    // ── Analysis ──
    const exact01 = [];        // 0x00→0x01 (Manual→Auto)
    const exact10 = [];        // 0x01→0x00 (Auto→Manual — P2 stayed Manual, shouldn't exist)
    const charZone = [];       // near P1 char (0x1C00-0x1C10)
    const healthZone = [];     // near health (0x1D30-0x1D50)
    const playerZone = [];     // broader player area (0x1C00-0x1D50)
    const allChanges = [];     // every changed byte

    for (const [addr, v1] of snap1) {
      const v2 = snap2.get(addr);
      if (v2 === undefined || v1 === v2) continue;

      allChanges.push({ addr, old: v1, new: v2 });

      if (v1 === 0x00 && v2 === 0x01) exact01.push({ addr, old: v1, new: v2 });
      if (v1 === 0x01 && v2 === 0x00) exact10.push({ addr, old: v1, new: v2 });

      if (addr >= 0x1C00 && addr <= 0x1C10) charZone.push({ addr, old: v1, new: v2 });
      if (addr >= 0x1D30 && addr <= 0x1D50) healthZone.push({ addr, old: v1, new: v2 });
      if (addr >= 0x1C00 && addr <= 0x1D50) playerZone.push({ addr, old: v1, new: v2 });
    }

    console.log(`\n${"═".repeat(60)}`);
    console.log(`📊 PLAY MODE DISCOVERY RESULTS`);
    console.log(`${"═".repeat(60)}`);

    console.log(`\n📊 Total changed bytes: ${allChanges.length}`);

    // ── Primary result: 0x00→0x01 candidates ──
    if (exact01.length > 0) {
      console.log(`\n✅ EXACT 0x00→0x01 (Manual→Auto): ${exact01.length} candidates`);
      for (const c of exact01.sort((a,b) => a.addr-b.addr)) {
        const nearP1Char = Math.abs(c.addr - CHAR_P1_ADDR) <= 16;
        const nearP2Char = Math.abs(c.addr - CHAR_P2_ADDR) <= 16;
        const nearHealth = Math.abs(c.addr - HEALTH_ADDR) <= 16;
        const tags = [];
        if (nearP1Char) tags.push("P1_CHAR_ZONE");
        if (nearP2Char) tags.push("P2_CHAR_ZONE");
        if (nearHealth) tags.push("HEALTH_ZONE");
        const tagStr = tags.length > 0 ? ` ← ${tags.join(", ")}` : "";
        console.log(`   0x${c.addr.toString(16).padStart(4).toUpperCase()}${tagStr}`);
      }
    } else {
      console.log(`\n❌ No exact 0x00→0x01 transitions found.`);
      console.log(`   The mode flag may use different values, or the snapshot was taken`);
      console.log(`   at different game states.`);
    }

    // ── Player block zone changes ──
    console.log(`\n📍 PLAYER BLOCK changes (0x1C00-0x1D50): ${playerZone.length}`);
    for (const c of playerZone.sort((a,b) => a.addr-b.addr)) {
      const distP1 = c.addr - CHAR_P1_ADDR;
      const distHealth = c.addr - HEALTH_ADDR;
      const pos = distP1 >= -16 && distP1 <= 16
        ? `P1_CHAR${distP1 >= 0 ? "+" : ""}${distP1}`
        : distHealth >= -16 && distHealth <= 16
          ? `HEALTH${distHealth >= 0 ? "+" : ""}${distHealth}`
          : "";
      const star = (c.old === 0 && c.new === 1) ? " ⭐" : "";
      console.log(`   0x${c.addr.toString(16).padStart(4).toUpperCase()}: ${String(c.old).padStart(3)}→${String(c.new).padStart(3)}  ${pos}${star}`);
    }

    // ── Other zones of interest ──
    const otherInteresting = allChanges.filter(c =>
      c.addr < 0x1C00 || c.addr > 0x1D50
    ).filter(c => c.new <= 0x01 || c.old <= 0x01);
    if (otherInteresting.length > 0) {
      console.log(`\n📍 OTHER low-value changes (outside player block, 0x00/0x01): ${otherInteresting.length}`);
      for (const c of otherInteresting.sort((a,b) => a.addr-b.addr)) {
        console.log(`   0x${c.addr.toString(16).padStart(4).toUpperCase()}: ${c.old}→${c.new}`);
      }
    }

    // ── Show reference values ──
    console.log("\n📋 Reference values (current snapshot):");
    console.log(`   P1 Char  (0x${CHAR_P1_ADDR.toString(16)}): ${snap2.get(CHAR_P1_ADDR)} (was ${snap1.get(CHAR_P1_ADDR)})`);
    console.log(`   P2 Char  (0x${CHAR_P2_ADDR.toString(16)}): ${snap2.get(CHAR_P2_ADDR)} (was ${snap1.get(CHAR_P2_ADDR)})`);

    // Show full hexdump of P1 char neighborhood
    console.log("\n🔍 Neighborhood of P1 char (0x1C07) — current vs saved:");
    console.log("   Addr   Saved  Current  Δ");
    for (let off = -12; off <= 12; off++) {
      const addr = CHAR_P1_ADDR + off;
      const v1 = snap1.get(addr);
      const v2 = snap2.get(addr);
      if (v1 !== undefined || v2 !== undefined) {
        const delta = (v1 !== v2) ? ` ← ${v1}→${v2}` : "";
        const marker = addr === CHAR_P1_ADDR ? " ← P1 CHAR" : addr === CHAR_P2_ADDR ? " ← P2 CHAR" : "";
        console.log(`   0x${addr.toString(16).toUpperCase()}:  0x${(v1??0).toString(16).padStart(2)}    0x${(v2??0).toString(16).padStart(2)}   ${delta}${marker}`);
      }
    }
  }

  sock.close();
}

main().catch(console.error);
