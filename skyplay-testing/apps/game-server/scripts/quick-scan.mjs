/**
 * Quick full-WRAM scanner — adapté pour match en cours.
 * Utilise des chunks de 1024 bytes pour un dump complet en ~15-20s.
 * Puis surveille les candidats santé en temps réel.
 */

import { createSocket } from "dgram";
import { Buffer } from "buffer";

const HOST = "127.0.0.1";
const PORT = 55355;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function udpCmd(sock, cmd) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), 3000);
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

async function readChunk(sock, addr, size) {
  try {
    const r = await udpCmd(sock, `READ_CORE_RAM ${addr.toString(16)} ${size}`);
    const parts = r.split(" ");
    const data = parts.slice(2).join("");
    const bytes = [];
    for (let i = 0; i < data.length; i += 2) {
      const b = parseInt(data.substring(i, i + 2), 16);
      if (!isNaN(b)) bytes.push(b);
    }
    return bytes;
  } catch { return null; }
}

async function quickDump(sock) {
  const all = new Map();
  const CHUNK = 1024;
  const TOTAL = 0x20000;
  let done = 0, fails = 0;

  for (let addr = 0; addr < TOTAL; addr += CHUNK) {
    const bytes = await readChunk(sock, addr, CHUNK);
    if (bytes) {
      for (let i = 0; i < bytes.length; i++) all.set(addr + i, bytes[i]);
    } else { fails++; }
    done++;
    if (done % 16 === 0) process.stderr.write(`\r   ${((addr/TOTAL)*100).toFixed(0)}%`);
  }
  process.stderr.write(`\r   100% (${fails} fails)\n`);
  return all;
}

async function main() {
  const sock = createSocket("udp4");
  const t0 = Date.now();

  try {
    const status = await udpCmd(sock, "GET_STATUS");
    console.log("📡 " + status);
  } catch {
    console.log("❌ No RA"); sock.close(); return;
  }

  // PHASE 1: Quick baseline of FULL 128KB
  console.log("\n📸 Full 128KB WRAM baseline (1024-byte chunks, ~15-20s)...");
  const baseline = await quickDump(sock);
  const t1 = ((Date.now() - t0)/1000).toFixed(1);
  console.log(`   ${baseline.size} bytes in ${t1}s`);

  // Find all values in health range
  const inHealthRange = [];
  for (const [addr, val] of baseline) {
    if (val >= 40 && val <= 100 && addr > 0xFF) {
      inHealthRange.push({addr, val});
    }
  }

  // Group by value
  const byVal = new Map();
  for (const h of inHealthRange) byVal.set(h.val, (byVal.get(h.val)||0)+1);

  // Show bytes at key values
  console.log("\n📍 Bytes at key health values in FULL 128KB:");
  for (const target of [96, 88, 80, 72, 64, 56, 48]) {
    const addrs = inHealthRange.filter(h => h.val === target);
    const addrList = addrs.slice(0,8).map(a => "0x"+a.addr.toString(16).padStart(5)).join(" ");
    console.log(`   val=${target}: ${addrs.length}x  [${addrList}${addrs.length>8?" ...":""}]`);
  }

  // Find IDENTICAL adjacent pairs (potential 16-bit health)
  const pairs = [];
  const seen = new Set();
  for (const {addr, val} of inHealthRange) {
    if (seen.has(addr)) continue;
    const next = baseline.get(addr+1);
    if (next === val && val >= 80) { // focus on high values
      pairs.push({addr, val});
      seen.add(addr); seen.add(addr+1);
    }
  }
  console.log(`\n🔗 Identical adjacent pairs (val≥80): ${pairs.length}`);
  for (const p of pairs.slice(0,20)) {
    console.log(`   0x${p.addr.toString(16).padStart(5)}: ${p.val} | +1: ${p.val}`);
  }

  // Also search for "damage taken" pattern: find TWO addresses N bytes apart with same value
  // (P1 and P2 health may be at fixed offset like +0x200 or +0x280)
  console.log("\n🔍 Searching for mirrored values at +0x200 and +0x280 offsets...");
  for (const offset of [0x200, 0x280, 0x100, 0x180, 0x300, 0x380, 0x400]) {
    const matches = [];
    for (const {addr, val} of inHealthRange) {
      if (val >= 85 && val <= 100) {
        const mirror = baseline.get(addr + offset);
        if (mirror === val) matches.push({addr, val});
      }
    }
    if (matches.length > 0) {
      console.log(`   +0x${offset.toString(16)}: ${matches.length} mirrored pairs at val 85-100`);
      for (const m of matches.slice(0,5)) {
        console.log(`     0x${m.addr.toString(16).padStart(5)}=${m.val} ↔ 0x${(m.addr+offset).toString(16).padStart(5)}=${m.val}`);
      }
    }
  }

  // PHASE 2: Monitor all bytes at 96 + pairs at high values
  const monitor = new Set();
  for (const h of inHealthRange) if (h.val >= 90) monitor.add(h.addr);
  for (const p of pairs) { monitor.add(p.addr); monitor.add(p.addr+1); }

  console.log(`\n⏱️ Monitoring ${monitor.size} addresses (val≥90 + pair members)...`);
  console.log("   Will log any decrease. Ctrl+C to stop.\n");

  let prev = baseline;
  let poll = 0;
  const deadline = Date.now() + 600000;

  // Build efficient read ranges
  const sorted = [...monitor].sort((a,b)=>a-b);
  const ranges = [];
  let rs = sorted[0], re = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - re <= 32) { re = sorted[i]; }
    else { ranges.push({start:rs, end:re}); rs = sorted[i]; re = sorted[i]; }
  }
  ranges.push({start:rs, end:re});
  console.log(`   ${ranges.length} ranges\n`);

  while (Date.now() < deadline) {
    poll++;
    const curr = new Map();
    for (const r of ranges) {
      const bytes = await readChunk(sock, r.start, r.end - r.start + 1);
      if (bytes) for (let i = 0; i < bytes.length; i++) curr.set(r.start+i, bytes[i]);
    }

    const changes = [];
    for (const addr of monitor) {
      const pv = prev.get(addr), cv = curr.get(addr);
      if (pv !== undefined && cv !== undefined && cv < pv && pv - cv >= 3) {
        changes.push({addr, prev:pv, curr:cv, diff:pv-cv});
      }
    }

    if (changes.length > 0) {
      const el = ((Date.now()-t0)/1000).toFixed(1);
      console.log(`\n🔻 T+${el}s #${poll}:`);
      for (const c of changes.sort((a,b)=>b.diff-a.diff)) {
        // Show surrounding context
        const ctx = [];
        for (let i = -3; i <= 3; i++) {
          const cv2 = curr.get(c.addr+i);
          if (cv2 !== undefined) ctx.push(`${i>0?"+":""}${i}:${cv2}`);
        }
        console.log(`   0x${c.addr.toString(16).padStart(5)}  ${c.prev}→${c.curr} (Δ-${c.diff})  [${ctx.join(" ")}]`);
      }
    }

    if (poll % 100 === 0) {
      process.stderr.write(`\r   T+${((Date.now()-t0)/1000).toFixed(0)}s #${poll}`);
    }

    prev = curr;
    await sleep(80);
  }

  sock.close();
  console.log("\n✅ Done.");
}
main().catch(console.error);
