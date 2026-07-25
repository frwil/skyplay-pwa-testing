/**
 * Check USA PAR health addresses on European SFA2 ROM.
 * USA PAR codes: P1 health = 7E073E, P2 health = 7E09BE
 * Values in RetroArch are offset-based (no bank prefix).
 */

import { createSocket } from "dgram";
import { Buffer } from "buffer";

const s = createSocket("udp4");

function udpCmd(cmd) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), 2000);
    const h = (m) => {
      const txt = m.toString();
      if (!txt.startsWith(cmd.split(" ")[0])) return;
      clearTimeout(t);
      s.removeListener("message", h);
      resolve(txt);
    };
    s.on("message", h);
    s.send(Buffer.from(cmd + "\n"), 55355, "127.0.0.1");
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // Build list: target addresses + neighbors
  const targets = [0x073E, 0x0740, 0x09BE, 0x09C0, 0x00EB, 0x015E, 0x0132];
  const all = new Set(targets);
  for (const a of targets) {
    for (let d = -4; d <= 4; d++) all.add(a + d);
  }
  const sorted = [...all].filter((a) => a >= 0 && a < 0x2000).sort((a, b) => a - b);

  console.log("=== Checking USA PAR health addresses on European ROM ===\n");

  // Read all addresses
  const values = {};
  for (const addr of sorted) {
    try {
      const resp = await udpCmd("READ_CORE_RAM " + addr.toString(16) + " 1");
      const parts = resp.split(" ");
      const val = parseInt(parts[2], 16);
      if (!isNaN(val)) {
        values[addr] = val;
        let marker = "";
        if (addr === 0x073e) marker = "  <-- P1 HEALTH (USA PAR)";
        if (addr === 0x09be) marker = "  <-- P2 HEALTH (USA PAR)";
        if (addr === 0x00eb) marker = "  <-- direct page 96";
        const hexAddr = addr.toString(16).padStart(4).toUpperCase();
        console.log("  $7E:" + hexAddr + " = " + val.toString().padStart(3) + marker);
      }
    } catch (e) {
      // skip timeouts
    }
  }

  // Now inject multiple A-press attacks from P1
  console.log("\n=== Injecting 5x A-press from P1 (player 0) ===");
  for (let i = 0; i < 5; i++) {
    s.send(Buffer.from("INPUT 0 8 1\n"), 55355, "127.0.0.1");
    await sleep(80);
    s.send(Buffer.from("INPUT 0 8 0\n"), 55355, "127.0.0.1");
    await sleep(200);
  }

  // Re-check key addresses
  console.log("\nAfter P1 attacks:");
  const keys = [0x073e, 0x09be, 0x00eb, 0x015e, 0x0132];
  for (const addr of keys) {
    try {
      const resp = await udpCmd("READ_CORE_RAM " + addr.toString(16) + " 1");
      const parts = resp.split(" ");
      const val = parseInt(parts[2], 16);
      if (!isNaN(val)) {
        const prev = values[addr];
        const delta = prev !== undefined ? val - prev : 0;
        const deltaStr = delta !== 0 ? " (Δ" + (delta > 0 ? "+" : "") + delta + ")" : " (unchanged)";
        console.log("  $7E:" + addr.toString(16).padStart(4).toUpperCase() + " = " + val + deltaStr);
      }
    } catch (e) {}
  }

  // Also scan for any bytes that equal 96 in first 0x1000
  console.log("\n=== Quick scan: bytes = 96 in first 4KB ===");
  const hits96 = [];
  for (let base = 0; base < 0x1000; base += 64) {
    try {
      const resp = await udpCmd("READ_CORE_RAM " + base.toString(16) + " 64");
      const parts = resp.split(" ");
      const data = parts.slice(2).join("");
      for (let i = 0; i < data.length; i += 2) {
        const b = parseInt(data.substring(i, i + 2), 16);
        if (b === 96) hits96.push(base + i / 2);
      }
    } catch (e) {}
  }
  console.log("  Found " + hits96.length + " addresses = 96");
  console.log("  " + hits96.map((a) => "0x" + a.toString(16).toUpperCase()).join(", "));

  s.close();
  console.log("\nDone.");
}

main().catch(console.error);
