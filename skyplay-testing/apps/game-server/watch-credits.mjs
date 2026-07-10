// Find the KOF98/Neo Geo credits counter in RAM.
// The credit byte is STABLE between coins and steps +1 on each coin insert. We build a
// "stable set" from several baseline reads (no coin), then insert coins one at a time and
// report stable bytes that change on >=2 inserts (ideally monotonic +1) — that's the credit.
// Run inside the container:  DISPLAY=:99 node /tmp/watch-credits.mjs
import { createSocket } from "dgram";
import { spawnSync } from "child_process";
const HOST = "127.0.0.1", PORT = 55355, WIN = "8388610";
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
const regs = [];
for (let a = 0; a < 0x10000; a += 0x400) regs.push([a, 0x400]);
async function snap() {
  for (const [a, c] of regs) { req(a, c); await sleep(10); }
  await sleep(500);
  return new Map(mem);
}
const env = { ...process.env, DISPLAY: ":99" };
const focus = () => spawnSync("xdotool", ["windowfocus", "--sync", WIN], { env });
function coin() {
  spawnSync("xdotool", ["keydown", "--window", WIN, "Shift_R"], { env });
  spawnSync("sleep", ["0.1"], { env });
  spawnSync("xdotool", ["keyup", "--window", WIN, "Shift_R"], { env });
}
(async () => {
  const NB = 4, NC = 3;
  const b = [];
  for (let i = 0; i < NB; i++) b.push(await snap());
  const stable = new Set();
  for (const [a, v] of b[0]) {
    let ok = true;
    for (let i = 1; i < NB; i++) if (b[i].get(a) !== v) { ok = false; break; }
    if (ok) stable.add(a);
  }
  console.log(`flag=0x${((b[NB - 1].get(0xA840) || 0).toString(16))} readable=${b[NB - 1].size} stableBytes=${stable.size}`);
  let prev = b[NB - 1];
  const hits = new Map(); // addr -> [ [coinIdx, old, new], ... ]
  for (let k = 0; k < NC; k++) {
    focus(); coin(); await sleep(600);
    const cur = await snap();
    for (const a of stable) {
      const p = prev.get(a), v = cur.get(a);
      if (p !== undefined && v !== undefined && p !== v) {
        if (!hits.has(a)) hits.set(a, []);
        hits.get(a).push([k, p, v]);
      }
    }
    prev = cur;
  }
  const rows = [...hits.entries()].filter(([, ev]) => ev.length >= 2).sort((x, y) => x[0] - y[0]);
  console.log(`candidates (changed on >=2 of ${NC} coins):`);
  for (const [a, ev] of rows) {
    const mono = ev.every(([, p, v]) => v === (p + 1) % 256);
    console.log(`  0x${a.toString(16)}${mono ? " [MONO +1]" : ""}: ${ev.map(([k, p, v]) => `c${k}:${p}->${v}`).join("  ")}`);
  }
  if (!rows.length) console.log("  (none — coin may not register, or credit not in a stable byte)");
  s.close();
})();
