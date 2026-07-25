import { createSocket } from "dgram";
import { Buffer } from "buffer";

const s = createSocket("udp4");
function cmd(c) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), 1000);
    const h = m => { const txt = m.toString(); if (!txt.startsWith(c.split(" ")[0])) return; clearTimeout(t); s.removeListener("message", h); resolve(txt); };
    s.on("message", h); s.send(Buffer.from(c + "\n"), 55355, "127.0.0.1");
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const t0 = Date.now();
  console.log(await cmd("GET_STATUS"));

  // Read 0x0680-0x06C0 for full context of P1 candidate area
  const r = await cmd("READ_CORE_RAM 680 64");
  const parts = r.split(" "); const data = parts.slice(2).join("");
  console.log("\n=== 0x0680-0x06C0 (P1 area) ===");
  for (let i = 0; i < data.length && i < 60; i += 2) {
    const addr = 0x680 + i/2;
    const b = parseInt(data.substring(i, i+2), 16);
    if (!isNaN(b) && b !== 0) {
      console.log("  0x" + addr.toString(16).padStart(4) + " = " + b + (addr === 0x6a0 ? " ← P1" : ""));
    }
  }

  // P2 at +0x200: 0x08A0
  const p2a = await cmd("READ_CORE_RAM 8a0 2");
  console.log("\n0x08A0-8A1 (P2+0x200): " + p2a.split(" ").slice(2).join(" "));

  // P2 at +0x280: 0x0920
  const p2b = await cmd("READ_CORE_RAM 920 2");
  console.log("0x0920-0921 (P2+0x280): " + p2b.split(" ").slice(2).join(" "));

  // Fast poll of just 0x06A0 at 30ms for 30s
  console.log("\n=== Fast poll 0x06A0 every 30ms ===");
  let prev = null;
  for (let i = 0; i < 500; i++) {
    try {
      const r = await cmd("READ_CORE_RAM 6a0 1");
      const v = parseInt(r.split(" ")[2], 16);
      if (prev !== null && v !== prev) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        console.log("⚡ [" + elapsed + "s] 0x06A0: " + prev + "→" + v + " (Δ" + (v - prev) + ")");
      }
      prev = v;
    } catch {}
    await sleep(30);
  }

  s.close();
  console.log("\nDone.");
}
main().catch(console.error);
