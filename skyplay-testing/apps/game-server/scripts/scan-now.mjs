/**
 * Quick scan: we're ALREADY in combat — scan now.
 * Finds all bytes = 96, polls them at 100ms, tracks decreases.
 */

import { createSocket } from "dgram";
import { Buffer } from "buffer";

const HOST = "127.0.0.1";
const PORT = 55355;
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

async function readChunk(sock, addr, size) {
  try {
    const r = await udpCmd(sock, "READ_CORE_RAM " + addr.toString(16) + " " + size);
    const parts = r.split(" ");
    const data = parts.slice(2).join("");
    const bytes = new Map();
    for (let i = 0; i < data.length; i += 2) {
      const b = parseInt(data.substring(i, i + 2), 16);
      if (!isNaN(b)) bytes.set(addr + i / 2, b);
    }
    return bytes;
  } catch { return new Map(); }
}

async function main() {
  const sock = createSocket("udp4");
  const t0 = Date.now();

  // Verify RetroArch
  try {
    const s = await udpCmd(sock, "GET_STATUS");
   ;console.log("📡 " + s);
  } catch {
   ;console.log("❌ No RetroArch");
    sock.close();
    return;
  }

  // Step 1: Find ALL bytes = 96 in first 8KB
  console.log("\n🔍 Scanning for bytes = 96 in first 8KB...");
  const allData = new Map();
  for (let base = 0; base < 0x2000; base += 64) {
    const chunk = await readChunk(sock, base, 64);
    for (const [a, v] of chunk) allData.set(a, v);
    if (base % 1024 === 0) process.stdout.write(".");
  }

  const hits96 = [];
  for (const [addr, val] of allData) {
    if (val === 96) hits96.push(addr);
  }
  console.log("\n   " + hits96.length + " bytes = 96");
  console.log("   " + hits96.map((a) => "0x" + a.toString(16).toUpperCase()).join(", "));

  // Also find ALL values in 85-100 range
  const nearHits = [];
  for (const [addr, val] of allData) {
    if (val >= 85 && val <= 100 && val !== 96) nearHits.push({ addr, val });
  }
  console.log("\n   Near-96 values (85-100, !=96):");
  for (const h of nearHits.slice(0, 20)) {
   ;console.log("   $7E:" + h.addr.toString(16).padStart(4).toUpperCase() + " = " + h.val);
  }

  // Step 2: Build candidate list
  const candidateSet = new Set(hits96);
  for (const a of hits96) {
    for (let d = -4; d <= 4; d++) if (a + d >= 0 && a + d < 0x2000) candidateSet.add(a + d);
  }
  // Add full direct page
  for (let a = 0; a < 0x100; a++) candidateSet.add(a);
  // Add USA PAR addresses
  [0x073E, 0x09BE, 0x073D, 0x073F, 0x09BD, 0x09BF].forEach((a) => candidateSet.add(a));
  // Add all near-hits
  for (const h of nearHits) candidateSet.add(h.addr);

  const allAddrs = [...candidateSet].filter((a) => a >= 0 && a < 0x2000).sort((a, b) => a - b);

  console.log("\n📊 Polling " + allAddrs.length + " addresses at 100ms for 90s");

  // Step 3: Poll and track changes
  const decreases = new Map();
  const increases = new Map();
  const valueRange = new Map();
  const prevVals = {};

  // Init
  for (const addr of allAddrs) {
    const v = allData.get(addr);
    if (v !== undefined) {
      prevVals[addr] = v;
      valueRange.set(addr, { min: v, max: v });
    }
  }

  const deadline = Date.now() + 90000;
  let pollNum = 0;

  while (Date.now() < deadline) {
    await sleep(100);
    pollNum++;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    // Read in batches
    const curr = new Map();
    for (let i = 0; i < allAddrs.length; i++) {
      const addr = allAddrs[i];
      const chunk = await readChunk(sock, addr, 1);
      for (const [a, v] of chunk) curr.set(a, v);
      if (i % 4 === 0) await sleep(2);
    }

    let changes = [];
    for (const addr of allAddrs) {
      const prev = prevVals[addr];
      const cur = curr.get(addr);
      if (prev !== undefined && cur !== undefined && prev !== cur) {
        changes.push({ addr, prev, cur, delta: cur - prev });
        if (cur < prev) decreases.set(addr, (decreases.get(addr) || 0) + 1);
        if (cur > prev) increases.set(addr, (increases.get(addr) || 0) + 1);
        const range = valueRange.get(addr);
        if (range) {
          if (cur < range.min) range.min = cur;
          if (cur > range.max) range.max = cur;
        }
        prevVals[addr] = cur;
      }
    }

    if (changes.length > 0 && changes.length <= 10) {
      const s = changes.map((c) => "0x" + c.addr.toString(16) + ":" + c.prev + "→" + c.cur).join(" ");
      console.log("   [" + elapsed + "s] " + s);
    }

    if (pollNum % 50 === 0) {
      const top = [...decreases.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
      console.log("\n   ── Top 8 decreasing ──");
      for (const [a, c] of top) {
        const cur = prevVals[a];
        const range = valueRange.get(a);
        console.log("   $7E:" + a.toString(16).padStart(4).toUpperCase() +
          "  r=" + (range ? range.min + "-" + range.max : "?") +
          "  now=" + cur + "  ↓" + c);
      }
      console.log("");
    }
  }

  // ── FINAL ──
  console.log("\n" + "=".repeat(60));
  console.log("📊 RESULTS (" + pollNum + " polls)");
  console.log("=".repeat(60));

  console.log("\n🔻 All decreasing addresses:");
  const dec = [...decreases.entries()].sort((a, b) => b[1] - a[1]);
  for (const [a, c] of dec) {
    const range = valueRange.get(a);
    const cur = prevVals[a];
    let note = "";
    if (range && range.max >= 80 && cur <= 80 && c >= 5) note = " ⭐ HEALTH";
    if (c > pollNum * 0.3) note = " ⏱️ TIMER?";
    console.log("   $7E:" + a.toString(16).padStart(4).toUpperCase() +
      "  " + (range ? range.min + "→" + range.max : "?") +
      "  now=" + cur + "  ↓" + c + note);
  }

  // Show what's currently at 96
  const final96 = Object.entries(prevVals).filter(([, v]) => v === 96).map(([a]) => parseInt(a));
  console.log("\n📍 Still at 96: " + final96.map((a) => "0x" + a.toString(16).toUpperCase()).join(", "));

  sock.close();
  console.log("\n✅ Done.");
}

main().catch(console.error);
