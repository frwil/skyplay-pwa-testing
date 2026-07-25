/**
 * Quick diagnostic: test which addressing scheme works for snes9x READ_CORE_RAM.
 *
 * SNES WRAM is at bus addresses $7E:0000 - $7F:FFFF (128KB).
 * In snes9x libretro, RETRO_MEMORY_SYSTEM_RAM maps this as a flat buffer.
 *
 * READ_CORE_RAM expects an offset into that buffer, so:
 *   - Scheme A: offset-based — address 0x0BFC reads $7E:0BFC
 *   - Scheme B: full-address — address 0x7E0BFC reads $7E:0BFC
 *
 * We test by reading the first few bytes of WRAM (offset 0x0000-0x000F).
 * If Scheme A works, READ_CORE_RAM 0 16 returns valid hex.
 * If Scheme B works, READ_CORE_RAM 7e0000 16 returns valid hex.
 *
 * Usage: docker exec game-server-game-server-1 node /tmp/test-addressing.mjs
 * (requires RetroArch running with SFA2 loaded)
 */

import { createSocket } from "dgram";
import { Buffer } from "buffer";

const HOST = "127.0.0.1";
const PORT = 55355;

function readRam(sock, addr, size) {
  return new Promise((resolve, reject) => {
    const cmd = Buffer.from(`READ_CORE_RAM ${addr.toString(16)} ${size}\n`);
    const timer = setTimeout(() => {
      sock.removeAllListeners("message");
      reject(new Error(`Timeout at 0x${addr.toString(16)}`));
    }, 3000);

    const handler = (msg) => {
      const text = msg.toString().trim();
      if (!text.startsWith("READ_CORE_RAM")) return;
      const parts = text.split(/\s+/);
      if (parts.length < 3) return;
      const respAddr = parseInt(parts[1], 16);
      if (respAddr !== addr) return;
      clearTimeout(timer);
      sock.removeListener("message", handler);
      resolve(parts.slice(2).join(""));
    };
    sock.on("message", handler);
    sock.send(cmd, PORT, HOST);
  });
}

async function main() {
  const sock = createSocket("udp4");

  // Test 1: Scheme A — offset-based (0x0000)
  console.log("Test 1: READ_CORE_RAM 0 16 (offset-based, $7E:0000)...");
  try {
    const hex = await readRam(sock, 0x0000, 16);
    if (hex === "-1" || hex.length === 0) {
      console.log(`  ❌ Failed: got "${hex}"`);
    } else {
      console.log(`  ✅ Got ${hex.length / 2} bytes: ${hex}`);
    }
  } catch (e) {
    console.log(`  ❌ ${e.message}`);
  }

  // Test 2: Scheme B — full SNES address (0x7E0000)
  console.log("Test 2: READ_CORE_RAM 7e0000 16 (full-address, $7E:0000)...");
  try {
    const hex = await readRam(sock, 0x7E0000, 16);
    if (hex === "-1" || hex.length === 0) {
      console.log(`  ❌ Failed: got "${hex}"`);
    } else {
      console.log(`  ✅ Got ${hex.length / 2} bytes: ${hex}`);
    }
  } catch (e) {
    console.log(`  ❌ ${e.message}`);
  }

  // Test 3: Suggested P1 health address with both schemes
  console.log("\nTest 3: P1 Health address (suggested $7E:0BFC)...");
  try {
    const hex = await readRam(sock, 0x0BFC, 1);
    console.log(`  Offset 0x0BFC → ${hex === "-1" ? "INVALID" : `0x${hex}`}`);
  } catch (e) {
    console.log(`  Offset 0x0BFC → ${e.message}`);
  }
  try {
    const hex = await readRam(sock, 0x7E0BFC, 1);
    console.log(`  Full   0x7E0BFC → ${hex === "-1" ? "INVALID" : `0x${hex}`}`);
  } catch (e) {
    console.log(`  Full   0x7E0BFC → ${e.message}`);
  }

  // Test 4: GET_STATUS — verify communication works at all
  console.log("\nTest 4: GET_STATUS...");
  try {
    const status = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), 2000);
      const h = (msg) => {
        const text = msg.toString().trim();
        if (text.startsWith("GET_STATUS")) {
          clearTimeout(t);
          sock.removeListener("message", h);
          resolve(text);
        }
      };
      sock.on("message", h);
      sock.send("GET_STATUS\n", PORT, HOST);
    });
    console.log(`  ✅ ${status}`);
  } catch (e) {
    console.log(`  ❌ ${e.message}`);
  }

  sock.close();
  console.log("\n✅ Done.");
}

main().catch(console.error);
