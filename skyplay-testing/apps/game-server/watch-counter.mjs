// Watch candidate RAM bytes for a per-player "characters lost / round-win" counter.
// The player structs mirror at +0x200, so a real counter shows P1 byte at addr and P2 byte
// at addr+0x200. We poll a window around the known structs and log every change with a
// timestamp + context (health, matchFlag, active char) so it can be correlated with the
// round-result events. Run inside the container:  node watch-counter.mjs 300 > /tmp/counter.log
import { createSocket } from "dgram";
const HOST = "127.0.0.1", PORT = 55355;
const sock = createSocket("udp4");
let buf = "";
const mem = new Map();
sock.on("message", (m) => {
  buf += m.toString();
  const ls = buf.split("\n"); buf = ls.pop() || "";
  for (const l of ls) {
    const p = l.trim().split(/\s+/);
    if (p[0] !== "READ_CORE_RAM") continue;
    const a = parseInt(p[1], 16);
    const h = p.slice(2).join("");
    if (h === "-1") continue;
    for (let i = 0; i < h.length / 2; i++) mem.set(a + i, parseInt(h.substr(i * 2, 2), 16));
  }
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function req(a, c) { sock.send(Buffer.from(`READ_CORE_RAM ${a.toString(16)} ${c}\n`), PORT, HOST); }

// Candidate windows (P1). Each is also read at +0x200 (P2 mirror).
const WINDOWS = [
  [0x8200, 0x70], // full early player struct: health 0x8238, active char 0x8256, per-player state
  [0xA838, 0x48], // matchFlag 0xA840, roster 0xA84E.., possible per-player win/defeat counters
];
const allAddrs = [];
for (const [base, len] of WINDOWS) {
  for (let a = base; a < base + len; a++) { allAddrs.push(a); allAddrs.push(a + 0x200); }
}

const t0 = Date.now();
const rel = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6);
const prev = new Map();

// Noisy addresses to ignore: the round timer (0xA83A/0xA83B 16-bit) and its frame
// sub-counters (0xA83C/0xA83D) change every poll and drown the signal. We hunt for
// SLOW counters (chars eliminated / active slot index) that only step on real KOs.
const DENY = new Set([0xA83A, 0xA83B, 0xA83C, 0xA83D]);

(async () => {
  const DUR = (parseInt(process.argv[2]) || 300) * 1000;
  console.log(`# watch-counter start — ${allAddrs.length} addrs, ${(DUR/1000)|0}s`);
  const row = (base, n) => { let s = ""; for (let i = 0; i < n; i++) { const v = mem.get(base + i); s += (v === undefined ? "??" : v.toString(16).padStart(2, "0")) + " "; } return s.trim(); };
  let tick = 0;
  while (Date.now() - t0 < DUR) {
    for (const [base, len] of WINDOWS) { req(base, len); req(base + 0x200, len); }
    await sleep(350);
    const changes = [];
    for (const a of allAddrs) {
      const v = mem.get(a);
      if (v === undefined) continue;
      const p = prev.get(a);
      if (p !== undefined && p !== v && !DENY.has(a)) changes.push([a, p, v]);
      prev.set(a, v);
    }
    const flag = mem.get(0xA840), h1 = mem.get(0x8238), h2 = mem.get(0x8438);
    const ac1 = mem.get(0x8256), ac2 = mem.get(0x8456);
    const ctx = `flag=${hx(flag)} hp1=${h1} hp2=${h2} ac1=${hx(ac1)} ac2=${hx(ac2)}`;
    for (const [a, p, v] of changes) {
      // Flag bytes that look like small counters (0..6) and have a mirror partner.
      const mark = (v <= 6 && p <= 6) ? " ⭐" : "";
      const wall = new Date().toISOString().substr(11, 12);
      console.log(`[${wall} t=${rel()}] 0x${a.toString(16)}  ${hx(p)}→${hx(v)}  (${ctx})${mark}`);
    }
    // Periodic absolute-value snapshot of the roster/counter region (~every 3s) so the
    // 0→1→2→3 progression of any per-player counter is visible even mid-match.
    if (tick++ % 9 === 0) {
      console.log(`[t=${rel()}] SNAP A848:[${row(0xA848, 0x28)}] 8250:[${row(0x8250, 8)}] 8450:[${row(0x8450, 8)}] (${ctx})`);
    }
  }
  console.log("# DONE");
  sock.close();
})();
function hx(v) { return v === undefined ? "??" : "0x" + v.toString(16).padStart(2, "0"); }
