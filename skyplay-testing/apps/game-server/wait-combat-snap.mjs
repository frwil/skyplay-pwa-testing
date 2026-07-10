// Wait for stable combat (matchFlag 0x40/0x48) then take TWO full-RAM snapshots.
// Usage inside container:  node /tmp/wait-combat-snap.mjs <prefix>
//   -> writes /tmp/ram-<prefix>a.bin and /tmp/ram-<prefix>b.bin
import { createSocket } from "dgram";
import { writeFileSync } from "fs";
const HOST = "127.0.0.1", PORT = 55355;
const prefix = process.argv[2] || "cap";
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
    const CHUNK = 64, START = 0, END = 0x10000;
    const addrs = []; for (let a = START; a < END; a += CHUNK) addrs.push(a);
    const sock = createSocket("udp4"); const data = new Map(); let buf = "";
    sock.on("message", (m) => { buf += m.toString(); const ls = buf.split("\n"); buf = ls.pop() || ""; for (const l of ls) { if (!l.trim()) continue; const p = l.trim().split(/\s+/); if (p[0] !== "READ_CORE_RAM") continue; const a = parseInt(p[1], 16); const h = p.slice(2).join(""); if (h === "-1") continue; try { data.set(a, Buffer.from(h, "hex")); } catch {} } });
    (async () => {
      for (let round = 0; round < 10; round++) {
        const missing = addrs.filter((a) => !data.has(a));
        if (!missing.length) break;
        for (const a of missing) sock.send(Buffer.from(`READ_CORE_RAM ${a.toString(16)} ${CHUNK}\n`), PORT, HOST);
        await sleep(1000);
      }
      const bytes = Buffer.alloc(END);
      for (const [a, b] of data) b.copy(bytes, a);
      const path = `/tmp/ram-${label}.bin`;
      writeFileSync(path, bytes);
      console.log(`saved ${path} (${data.size}/${addrs.length} chunks = ${(100 * data.size / addrs.length).toFixed(1)}%)`);
      sock.close(); resolve();
    })();
  });
}

(async () => {
  const t0 = Date.now();
  console.log(`# waiting for stable combat (flag 0x40/0x48), prefix=${prefix} ...`);
  let stable = false;
  while (Date.now() - t0 < 90000) {
    const f = await readByte(0xA840);
    if (f === 0x40 || f === 0x48) { stable = true; break; }
    await sleep(500);
  }
  if (!stable) { console.log("# TIMEOUT — never reached stable combat"); process.exit(2); }
  console.log("# stable combat detected — capturing snapshot A");
  await snapshot(`${prefix}a`);
  await sleep(1200);
  console.log("# capturing snapshot B");
  await snapshot(`${prefix}b`);
  console.log("# DONE");
})();
