// Find a reliable "perfect round" indicator in KOF98 RAM.
// On each round end (per-player loss counter 0xA859/0xA868 steps), dump a focused region so
// perfect vs normal rounds can be diffed. Correlate with user-reported PERFECT/normal per round.
// Read-only. Run inside the container:  node /tmp/watch-perfect.mjs 600
import { createSocket } from "dgram";
const HOST = "127.0.0.1", PORT = 55355;
const s = createSocket("udp4");
const mem = new Map();
s.on("message", (m) => {
  const p = m.toString().trim().split(/\s+/);
  if (p[0] !== "READ_CORE_RAM") return;
  const a = parseInt(p[1], 16);
  const h = p.slice(2).join("");
  if (h === "-1") return;
  for (let i = 0; i < h.length / 2; i++) mem.set(a + i, parseInt(h.substr(i * 2, 2), 16));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const req = (a, c) => s.send(Buffer.from(`READ_CORE_RAM ${a.toString(16)} ${c}\n`), PORT, HOST);
// Regions likely to hold a win-type/perfect flag: match-state block (wins/losses at 0xA856/59/68/69)
// and the early player structs (health/active).
const REGS = [[0xA840, 0x50], [0x8230, 0x30], [0x8430, 0x30]];
const hx = (v) => v === undefined ? "??" : v.toString(16).padStart(2, "0");
const row = (base, n) => { let out = ""; for (let i = 0; i < n; i++) out += hx(mem.get(base + i)) + " "; return out.trim(); };
const readAll = () => REGS.forEach(([a, c]) => req(a, c));
const wall = () => new Date().toISOString().substr(11, 12);
(async () => {
  const DUR = (parseInt(process.argv[2]) || 600) * 1000;
  const t0 = Date.now();
  console.log(`# watch-perfect start (${(DUR / 1000) | 0}s) — dumps region on each round end`);
  let prevL1 = -1, prevL2 = -1, round = 0;
  while (Date.now() - t0 < DUR) {
    readAll();
    await sleep(200);
    const l1 = mem.get(0xA859), l2 = mem.get(0xA868);
    if (l1 === undefined || l2 === undefined) continue;
    if (prevL1 < 0) { prevL1 = l1; prevL2 = l2; continue; }
    // Re-baseline on char-select reset (counters drop to 0)
    if (l1 < prevL1 || l2 < prevL2) { prevL1 = l1; prevL2 = l2; round = 0; console.log(`[${wall()}] --- new match (counters reset) ---`); continue; }
    const d1 = l1 - prevL1, d2 = l2 - prevL2;
    if (d1 === 0 && d2 === 0) continue;
    round++;
    const who = (d1 > 0 && d2 > 0) ? "DRAW" : (d2 > 0 ? "P1 won" : "P2 won");
    prevL1 = l1; prevL2 = l2;
    // Dump twice (immediately + after 250ms) to catch a briefly-latched flag.
    console.log(`[${wall()}] ROUND ${round} END — ${who}  (L1=${l1} L2=${l2}  hp1=${mem.get(0x8238)} hp2=${mem.get(0x8438)}  act1=${hx(mem.get(0x8256))} act2=${hx(mem.get(0x8456))})`);
    console.log(`    A840: ${row(0xA840, 0x50)}`);
    console.log(`    8230: ${row(0x8230, 0x30)}`);
    console.log(`    8430: ${row(0x8430, 0x30)}`);
    readAll(); await sleep(280);
    console.log(`    +280ms A840: ${row(0xA840, 0x50)}`);
  }
  console.log("# DONE");
  s.close();
})();
