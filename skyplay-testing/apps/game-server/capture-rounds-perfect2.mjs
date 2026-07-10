// Persistent, score-keyed per-round RAM capture for "perfect" discovery.
// Robust to arm-timing: it snapshots full RAM the first time it sees each distinct score
// state (L1,L2) in STABLE combat, labeling files ram-pk_<L1>_<L2>.bin. Resets on a fresh
// match (both counters back to 0). Ground truth to correlate (user): P2 wins R1 perfect,
// R2 normal KO, R3 time-over -> scores seen 0_0 (R1), 1_0 (R2), 2_0 (R3), final 3_0.
// A P2 "perfect" counter should read 0 at 0_0 and 1 from 1_0 onward (mirror P1 stays 0).
// Usage inside container:  node /tmp/capture-rounds-perfect2.mjs [durationSec]
import { createSocket } from "dgram";
import { writeFileSync } from "fs";
const HOST = "127.0.0.1", PORT = 55355;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function readByte(addr) {
  return new Promise((resolve) => {
    const s = createSocket("udp4"); let done = false;
    const fin = (v) => { if (done) return; done = true; try { s.close(); } catch {} resolve(v); };
    s.on("message", (x) => { const p = x.toString().trim().split(/\s+/); if (p[0] !== "READ_CORE_RAM") return; const h = p.slice(2).join(""); if (h === "-1") return fin(null); fin(parseInt(h.substr(0, 2), 16)); });
    s.on("error", () => fin(null));
    try { s.send(Buffer.from(`READ_CORE_RAM ${addr.toString(16)} 1\n`), PORT, HOST); } catch { fin(null); }
    setTimeout(() => fin(null), 400);
  });
}
function snapshot(label) {
  return new Promise((resolve) => {
    const CHUNK = 64, END = 0x10000; const addrs = []; for (let a = 0; a < END; a += CHUNK) addrs.push(a);
    const sock = createSocket("udp4"); const data = new Map(); let buf = "";
    sock.on("message", (m) => { buf += m.toString(); const ls = buf.split("\n"); buf = ls.pop() || ""; for (const l of ls) { if (!l.trim()) continue; const p = l.trim().split(/\s+/); if (p[0] !== "READ_CORE_RAM") continue; const a = parseInt(p[1], 16); const h = p.slice(2).join(""); if (h === "-1") continue; try { data.set(a, Buffer.from(h, "hex")); } catch {} } });
    (async () => {
      for (let r = 0; r < 10; r++) { const miss = addrs.filter((a) => !data.has(a)); if (!miss.length) break; for (const a of miss) sock.send(Buffer.from(`READ_CORE_RAM ${a.toString(16)} ${CHUNK}\n`), PORT, HOST); await sleep(900); }
      const bytes = Buffer.alloc(END); for (const [a, b] of data) b.copy(bytes, a);
      writeFileSync(`/tmp/ram-${label}.bin`, bytes);
      console.log(`  saved ram-${label}.bin (${(100 * data.size / addrs.length).toFixed(0)}%)`); sock.close(); resolve();
    })();
  });
}
const stable = (f) => (f & 0xf0) === 0x40; // any combat sub-state 0x40..0x4f (0x40/0x44/0x48/0x4b)
(async () => {
  const DUR = (parseInt(process.argv[2]) || 600) * 1000; const t0 = Date.now();
  console.log(`# capture-rounds-perfect2 (persistent ${DUR/1000|0}s) — score-keyed snapshots`);
  const seen = new Set(); let capturing = false; let lastKey = "";
  while (Date.now() - t0 < DUR) {
    const f = await readByte(0xA840);
    const l1 = await readByte(0xA859), l2 = await readByte(0xA868);
    if (l1 == null || l2 == null || f == null) { await sleep(200); continue; }
    // Fresh match: scores at 0 in char-select/combat -> (re)start a capture window.
    if (l1 === 0 && l2 === 0) {
      if (!capturing || seen.size > 1 || (seen.size === 1 && !seen.has("0_0"))) {
        seen.clear(); capturing = true; console.log(`[${new Date(Date.now()).toISOString().substr(11,8)}] fresh match window armed`);
      }
    }
    if (l1 >= 3 || l2 >= 3) {
      const key = `final_${l1}_${l2}`;
      if (capturing && !seen.has(key)) { seen.add(key); console.log(`[match over L1=${l1} L2=${l2}] capturing final`); await snapshot(`pk_final_${l1}_${l2}`); capturing = false; console.log("# one clean match captured — stopping"); break; }
      await sleep(200); continue;
    }
    if (capturing && stable(f)) {
      const key = `${l1}_${l2}`;
      if (!seen.has(key)) { seen.add(key); console.log(`[score ${key}] stable combat — capturing`); await snapshot(`pk_${key}`); lastKey = key; }
    }
    await sleep(150);
  }
  console.log("# DONE");
})();
