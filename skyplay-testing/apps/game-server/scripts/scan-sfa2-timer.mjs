/**
 * Scans SNES RAM for the SFA2 round timer address.
 *
 * The timer counts down from 99 (0x63) to 0 during a round.
 * We scan the lower SNES WRAM ($7E0000-$7E3FFF, 16KB) and log
 * every byte in the range 0-99 (0x00-0x63) that changes between polls.
 *
 * Usage: node scripts/scan-sfa2-timer.mjs
 *
 * Requires: a running game-server Docker container with an active SFA2 match.
 * RetroArch must be listening on UDP 55355.
 */

import { createSocket } from "dgram";
import { Buffer } from "buffer";

const RA_HOST = "127.0.0.1";
const RA_PORT = 55355;

// SNES WRAM: $7E0000 - $7FFFFF (128KB)
// We scan the lower 16KB ($7E0000-$7E3FFF) where most game state lives.
const SCAN_START = 0x7E0000;
const SCAN_END = 0x7E4000;  // scan 16KB
const CHUNK = 256;           // RetroArch max safe chunk

/** Send a READ_CORE_RAM command and return the hex bytes. */
function readRam(sock, addr, size) {
  return new Promise((resolve, reject) => {
    const cmd = Buffer.from(`READ_CORE_RAM ${addr.toString(16)} ${size}\n`);
    const timer = setTimeout(() => { sock.removeAllListeners("message"); reject(new Error(`Timeout at 0x${addr.toString(16)}`)); }, 3000);

    const handler = (msg) => {
      const text = msg.toString();
      if (!text.startsWith("READ_CORE_RAM")) return;
      const parts = text.split(" ");
      // Format: READ_CORE_RAM <addr> <hexbytes>
      if (parts.length < 3) return;
      const respAddr = parseInt(parts[1], 16);
      if (respAddr !== addr) return; // not our response
      clearTimeout(timer);
      sock.removeListener("message", handler);
      const hex = parts.slice(2).join("");
      resolve(hex);
    };
    sock.on("message", handler);
    sock.send(cmd, RA_PORT, RA_HOST);
  });
}

/** Parse hex string into array of bytes. */
function parseHex(hex) {
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16));
  }
  return bytes;
}

async function main() {
  const sock = createSocket("udp4");

  console.log("🔍 SFA2 Timer Scanner — scanning SNES WRAM $7E0000-$7E3FFF");
  console.log("   Make sure a match is IN PROGRESS (timer counting down).\n");

  // Scan full range in chunks
  const allBytes = new Map(); // addr -> byte value

  for (let addr = SCAN_START; addr < SCAN_END; addr += CHUNK) {
    const size = Math.min(CHUNK, SCAN_END - addr);
    try {
      const hex = await readRam(sock, addr, size);
      const bytes = parseHex(hex);
      for (let i = 0; i < bytes.length; i++) {
        allBytes.set(addr + i, bytes[i]);
      }
    } catch (e) {
      console.error(`  ❌ Error at 0x${addr.toString(16)}: ${e.message}`);
    }
    if ((addr - SCAN_START) % 4096 === 0) {
      const pct = Math.round((addr - SCAN_START) / (SCAN_END - SCAN_START) * 100);
      process.stdout.write(`\r  Scanning... ${pct}%`);
    }
  }
  console.log(`\r  Scanned ${allBytes.size} bytes.`);

  // Filter: bytes in range 0-99 (0x00-0x63 = valid timer values)
  const candidates = [];
  for (const [addr, val] of allBytes) {
    if (val >= 1 && val <= 99) {  // 1-99 (skip 0 = common null/default)
      candidates.push({ addr, val, hex: val.toString(16).padStart(2, "0") });
    }
  }

  // Group by value and show the most "timer-like" candidates
  // Timer values are typically in a single byte, not shared with other game state
  console.log(`\n📊 Found ${candidates.length} bytes in range 1-99:\n`);

  // Sort by address
  candidates.sort((a, b) => a.addr - b.addr);

  // Show all candidates grouped in rows of 8
  for (let i = 0; i < candidates.length; i += 8) {
    const row = candidates.slice(i, i + 8)
      .map(c => `$${c.addr.toString(16).toUpperCase().padStart(6, "0")}=${c.val.toString().padStart(2, " ")}`)
      .join("  ");
    console.log(`  ${row}`);
  }

  // Now wait 2 seconds and scan again to find what changed
  console.log("\n⏳ Waiting 2s, then re-scanning to find changing values...");
  await new Promise(r => setTimeout(r, 2000));

  console.log("🔁 Second scan...");
  const changed = [];
  for (const [addr, oldVal] of allBytes) {
    try {
      const hex = await readRam(sock, addr, 1);
      const newVal = parseInt(hex, 16);
      if (newVal !== oldVal) {
        changed.push({ addr, oldVal, newVal });
      }
    } catch {}
  }

  const timerCandidates = changed.filter(c => c.newVal >= 0 && c.newVal <= 99);
  if (timerCandidates.length > 0) {
    console.log(`\n🎯 ${timerCandidates.length} bytes changed (in timer range 0-99):`);
    for (const c of timerCandidates) {
      console.log(`  $${c.addr.toString(16).toUpperCase().padStart(6, "0")}: ${c.oldVal} → ${c.newVal}`);
    }
  } else {
    console.log("\n⚠️  No bytes in timer range changed. Timer might have been at 0 or > 99.");
  }

  sock.close();
  console.log("\n✅ Done.");
}

main().catch(console.error);
