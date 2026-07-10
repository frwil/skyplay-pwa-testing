// Capture one full-RAM snapshot per ROUND during stable combat, to isolate a "perfect"
// indicator by its cross-round signature. Ground truth (user): P2 wins R1 perfect,
// R2 normal KO, R3 time-over. A P2 perfect counter should read 0 in R1 combat, then 1
// from R2 combat onward (increments only after the perfect round); its P1 mirror stays 0.
// Also dumps focused regions immediately at each round-end to catch a transient win-type flag.
// Usage inside container:  node /tmp/capture-rounds-perfect.mjs [maxRounds]
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
      for (let r = 0; r < 10; r++) { const miss = addrs.filter((a) => !data.has(a)); if (!miss.length) break; for (const a of miss) sock.send(Buffer.from(`READ_CORE_RAM ${a.toString(16)} ${CHUNK}\n`), PORT, HOST); await sleep(1000); }
      const bytes = Buffer.alloc(END); for (const [a, b] of data) b.copy(bytes, a);
      writeFileSync(`/tmp/ram-${label}.bin`, bytes);
      console.log(`  saved ram-${label}.bin (${(100 * data.size / addrs.length).toFixed(0)}%)`); sock.close(); resolve();
    })();
  });
}
const flagIs = (f) => f === 0x40 || f === 0x48;
async function waitStable(timeoutMs) { const t = Date.now(); while (Date.now() - t < timeoutMs) { const f = await readByte(0xA840); if (flagIs(f)) return true; await sleep(300); } return false; }

(async () => {
  const MAX = parseInt(process.argv[2]) || 6;
  console.log("# capture-rounds-perfect — one snapshot per round's stable combat");
  let round = 0;
  while (round < MAX) {
    if (!(await waitStable(60000))) { console.log("# timeout waiting for combat — stop"); break; }
    round++;
    const l1 = await readByte(0xA859), l2 = await readByte(0xA868);
    console.log(`[round ${round}] stable combat — L1=${l1} L2=${l2}  capturing...`);
    await snapshot(`pk${round}`);
    // Wait for this round to END: a loss counter steps, OR flag leaves combat (KO/time-over/transition).
    const baseL1 = l1, baseL2 = l2;
    let ended = false;
    const te = Date.now();
    while (Date.now() - te < 200000) {
      const f = await readByte(0xA840);
      const n1 = await readByte(0xA859), n2 = await readByte(0xA868);
      if ((n1 != null && n1 > baseL1) || (n2 != null && n2 > baseL2)) { console.log(`  round ${round} END — L1=${n1} L2=${n2} flag=0x${(f||0).toString(16)}`); ended = true; break; }
      await sleep(150);
    }
    if (!ended) { console.log("  round-end not detected in 120s — stop"); break; }
    const n1 = await readByte(0xA859), n2 = await readByte(0xA868);
    if ((n1 != null && n1 >= 3) || (n2 != null && n2 >= 3)) { console.log(`# match over (L1=${n1} L2=${n2}) — capturing final state`); await sleep(500); await snapshot(`pkFinal`); break; }
  }
  console.log("# DONE");
})();
