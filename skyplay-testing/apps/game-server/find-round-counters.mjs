/**
 * SFA2 Round Counter Finder v4 — simplified, no ESM, no ping phase
 * Run: docker exec game-server-game-server-1 node /tmp/find-round-counters.mjs
 */
const { createSocket } = require("dgram");

const PORT = 55355;
const POLL_MS = 800;
const RAM_END = 0x2000;

const CHUNKS = [];
for (let addr = 0; addr < RAM_END; addr += 256) {
  CHUNKS.push({ addr, size: Math.min(256, RAM_END - addr) });
}

function readSnapshot() {
  return new Promise((resolve) => {
    const udp = createSocket("udp4");
    const data = new Map(); let received = 0; let buf = "";
    const t = setTimeout(() => { udp.close(); resolve(data); }, 3000);
    udp.on("message", (msg) => {
      buf += msg.toString(); const lines = buf.split("\n"); buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const p = line.trim().split(/\s+/);
        if (p.length < 3 || p[0] !== "READ_CORE_RAM") continue;
        const addr = parseInt(p[1], 16), hex = p.slice(2).join("");
        if (hex === "-1") continue;
        try { data.set(addr, Buffer.from(hex, "hex")); received++; } catch {}
      }
      if (received >= CHUNKS.length) { clearTimeout(t); udp.close(); resolve(data); }
    });
    udp.on("error", () => { clearTimeout(t); try { udp.close(); } catch {} resolve(data); });
    for (const { addr, size } of CHUNKS) {
      try { udp.send(Buffer.from("READ_CORE_RAM " + addr.toString(16) + " " + size + "\n"), PORT, "127.0.0.1"); } catch { break; }
    }
  });
}

function gb(data, addr) {
  for (const [ca, buf] of data) { if (addr >= ca && addr < ca + buf.length) return buf[addr - ca]; }
  return undefined;
}

function diff(a, b) {
  const changes = [];
  for (let addr = 0; addr < RAM_END; addr++) {
    const va = gb(a, addr), vb = gb(b, addr);
    if (va !== undefined && vb !== undefined && va !== vb) changes.push({ addr, old: va, new: vb, delta: vb - va });
  }
  return changes;
}

async function main() {
  console.log("🔍 Round Counter Finder v4");

  // Wait for match (timer >= 90, HP > 0x50)
  console.log("Waiting for active match...");
  let baseline;
  while (true) {
    const snap = await readSnapshot();
    if (snap.size === 0) { await new Promise(r => setTimeout(r, 1000)); continue; }
    const t = gb(snap, 0x1B7D), hp1 = gb(snap, 0x1D3D);
    if (t && t >= 90 && hp1 && hp1 >= 0x50) { baseline = snap; console.log("Match! T=" + t + " HP1=0x" + hp1.toString(16)); break; }
    await new Promise(r => setTimeout(r, 1000));
  }

  const info = (s) => ({ t: gb(s, 0x1B7D), hp1: gb(s, 0x1D3D), hp2: gb(s, 0x1D3F), c1: gb(s, 0x1C07), c2: gb(s, 0x1C08) });
  const bi = info(baseline);
  console.log("📸 Baseline — C1=0x" + (bi.c1?.toString(16)||"?") + " C2=0x" + (bi.c2?.toString(16)||"?") + " HP1=0x" + (bi.hp1?.toString(16)||"?") + " HP2=0x" + (bi.hp2?.toString(16)||"?") + " T=" + bi.t);

  let prev = baseline, pi = bi, roundN = 0;

  console.log("🔄 Monitoring...\n");
  setInterval(async () => {
    const snap = await readSnapshot();
    if (snap.size === 0) return;
    const si = info(snap);
    if (si.t === undefined || si.hp1 === undefined || si.hp2 === undefined) return;

    // KO detection: health drops to 0
    const koHappening = (si.hp1 <= 5 && pi.hp1 > 5) || (si.hp2 <= 5 && pi.hp2 > 5);
    // Round reset: timer jumps back to 99
    const roundReset = si.t >= 95 && pi.t !== undefined && pi.t < 30;

    if (koHappening || roundReset) {
      roundN++;
      const winner = si.hp1 <= 5 ? "P2" : (si.hp2 <= 5 ? "P1" : (roundReset ? "UNKNOWN" : "?"));
      const stamp = new Date().toISOString().substring(11, 23);
      console.log("\n[" + stamp + "] 🏁 ROUND #" + roundN + " END — " + winner + " wins");
      console.log("  Before: HP1=0x" + (pi.hp1?.toString(16)||"?") + " HP2=0x" + (pi.hp2?.toString(16)||"?") + " T=" + pi.t);
      console.log("  After:  HP1=0x" + si.hp1.toString(16) + " HP2=0x" + si.hp2.toString(16) + " T=" + si.t);

      const changes = diff(prev, snap);
      const cands = changes.filter(c => (c.old === 0 && c.new === 1) || (c.old === 1 && c.new === 2) || (c.old === 0 && c.new === 2));

      if (cands.length > 0) {
        console.log("  🔥 ROUND COUNTER CANDIDATES (" + cands.length + "):");
        for (const c of cands) {
          const icon = c.old === 0 && c.new === 1 ? "⭐0→1" : c.old === 1 && c.new === 2 ? "🏆1→2" : "⚡0→2";
          console.log("    0x" + c.addr.toString(16).padStart(4,"0") + ": " + c.old + "→" + c.new + " " + icon);
        }
      } else {
        console.log("  ❌ No 0→1/1→2/0→2 in 0x0000-0x2000");
        const small = changes.filter(c => Math.abs(c.delta) <= 10);
        console.log("  Small changes (" + small.length + "):");
        for (const c of small.slice(0, 25)) {
          console.log("    0x" + c.addr.toString(16).padStart(4,"0") + ": 0x" + c.old.toString(16).padStart(2,"0") + "→0x" + c.new.toString(16).padStart(2,"0") + " (" + (c.delta>0?"+":"") + c.delta + ")");
        }
        if (small.length > 25) console.log("    ... +" + (small.length-25) + " more");
      }

      prev = snap; pi = si;
      return;
    }
    prev = snap; pi = si;
  }, POLL_MS);
}
main().catch(e => console.error("FATAL:", e));
