/**
 * Scanner for SFA2 SNES health + timer RAM addresses.
 *
 * Strategy: poll the SNES WRAM ($7E:0000-$7E:1FFF, first 8KB where most game
 * state lives) every ~300ms, and track which bytes:
 *   a) Are in range 0-144 (potential health values)
 *   b) Are in range 1-99 (potential timer values)
 *   c) Change over time (to filter out static data)
 *
 * Uses RetroArch's network_cmd interface (READ_CORE_RAM via UDP 55355).
 *
 * For snes9x libretro core, the address parameter to READ_CORE_RAM is the
 * offset into RETRO_MEMORY_SYSTEM_RAM (SNES WRAM). SNES bus $7E:XXXX → offset XXXX.
 * So $7E:0BFC → READ_CORE_RAM 0bfc 1
 *
 * Usage: Copy to container, then run during an active SFA2 match:
 *   docker cp scripts/scan-sfa2-health.mjs game-server-game-server-1:/tmp/
 *   docker exec game-server-game-server-1 node /tmp/scan-sfa2-health.mjs 120
 *
 * Args: duration in seconds (default 60)
 */

import { createSocket } from "dgram";
import { Buffer } from "buffer";

const HOST = "127.0.0.1";
const PORT = 55355;

// SNES WRAM scan range: $7E:0000 to $7E:1FFF (first 8KB)
// Most game variables (health, timer, round counter, score) live here.
// Full WRAM = 128KB ($7E:0000-$7F:FFFF), but 8KB is enough for live state.
const SCAN_START = 0x0000;
const SCAN_END = 0x2000; // 8KB
const CHUNK = 256;       // max safe chunk per READ_CORE_RAM

// Suggested addresses from SNES community research:
const SUGGESTED = {
  p1Health: [0x0BFC, 0x0B00, 0x0C00],
  p2Health: [0x122C, 0x1200, 0x1300],
  timer:    [0x18E0, 0x18E1, 0x0A00, 0x0A10],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readRam(sock, addr, size) {
  return new Promise((resolve, reject) => {
    const cmd = Buffer.from(`READ_CORE_RAM ${addr.toString(16)} ${size}\n`);
    const timer = setTimeout(() => {
      sock.removeAllListeners("message");
      reject(new Error(`Timeout at 0x${addr.toString(16)}`));
    }, 3000);

    const handler = (msg) => {
      const text = msg.toString();
      if (!text.startsWith("READ_CORE_RAM")) return;
      const parts = text.split(" ");
      if (parts.length < 3) return;
      const respAddr = parseInt(parts[1], 16);
      if (respAddr !== addr) return;
      clearTimeout(timer);
      sock.removeListener("message", handler);
      const hex = parts.slice(2).join("");
      resolve(hex);
    };
    sock.on("message", handler);
    sock.send(cmd, PORT, HOST);
  });
}

function parseHex(hex) {
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16));
  }
  return bytes;
}

async function readChunk(sock, addr, size) {
  try {
    const hex = await readRam(sock, addr, size);
    return parseHex(hex);
  } catch (e) {
    return null;
  }
}

async function readAll(sock) {
  const bytes = new Map();
  for (let addr = SCAN_START; addr < SCAN_END; addr += CHUNK) {
    const size = Math.min(CHUNK, SCAN_END - addr);
    const chunk = await readChunk(sock, addr, size);
    if (chunk) {
      for (let i = 0; i < chunk.length; i++) {
        bytes.set(addr + i, chunk[i]);
      }
    }
  }
  return bytes;
}

async function main() {
  const duration = (parseInt(process.argv[2]) || 60);
  const sock = createSocket("udp4");

  console.log("🔍 SFA2 Health/Timer Scanner");
  console.log(`   Scanning WRAM $7E:0000-$7E:1FFF (8KB) for ${duration}s`);
  console.log("   Make sure a match is IN PROGRESS.\n");

  // --- Scan 1: initial snapshot ---
  console.log("📸 Initial snapshot...");
  const snap1 = await readAll(sock);
  console.log(`   Got ${snap1.size} bytes.`);

  // Show values at suggested addresses
  console.log("\n📋 Suggested addresses (initial read):");
  for (const [label, addrs] of Object.entries(SUGGESTED)) {
    for (const addr of addrs) {
      const val = snap1.get(addr);
      if (val !== undefined) {
        console.log(`   ${label.padEnd(10)} 0x${addr.toString(16).padStart(4)} = ${val} (0x${val.toString(16)})`);
      }
    }
  }

  // --- Start polling loop ---
  console.log(`\n🔄 Polling every 300ms for ${duration}s...`);
  const history = []; // [{ addr, values: [v0, v1, v2, ...] }]
  const t0 = Date.now();
  const deadline = t0 + duration * 1000;

  // Initialize history from snap1
  for (const [addr, val] of snap1) {
    history.push({ addr, values: [val] });
  }

  let poll = 0;
  while (Date.now() < deadline) {
    await sleep(300);
    poll++;
    const snap = await readAll(sock);

    for (const entry of history) {
      const val = snap.get(entry.addr);
      entry.values.push(val !== undefined ? val : entry.values[entry.values.length - 1]);
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    process.stdout.write(`\r   Poll #${poll} (${elapsed}s) — ${snap.size} bytes`);
  }
  console.log();

  // --- Analyze: find bytes that change ---
  console.log("\n📊 Analysis: bytes that changed during polling\n");

  const changers = history
    .filter(e => {
      const uniq = new Set(e.values);
      return uniq.size > 1; // value changed at least once
    })
    .sort((a, b) => a.addr - b.addr);

  console.log(`   ${changers.length} bytes changed (out of ${history.length} total)\n`);

  // Group by value range
  const healthRange = changers.filter(e => {
    const max = Math.max(...e.values);
    const min = Math.min(...e.values);
    return max <= 176 && min >= 0; // SNES health: often 0-176 or 0-144
  });
  const timerRange = changers.filter(e => {
    const max = Math.max(...e.values);
    const min = Math.min(...e.values);
    return max <= 99 && min >= 0;
  });

  console.log(`🏥 Potential health bytes (0-176 range): ${healthRange.length}`);
  for (const e of healthRange) {
    const vals = e.values.slice(0, 10).join(",");
    const addrHex = "0x" + e.addr.toString(16).padStart(4).toUpperCase();
    console.log(`   $7E:${addrHex.slice(2)}  vals=[${vals}...]  (${e.values.length} polls)`);
  }

  console.log(`\n⏱️  Potential timer bytes (0-99 range): ${timerRange.length}`);
  for (const e of timerRange) {
    const vals = e.values.slice(0, 10).join(",");
    const addrHex = "0x" + e.addr.toString(16).padStart(4).toUpperCase();
    console.log(`   $7E:${addrHex.slice(2)}  vals=[${vals}...]  (${e.values.length} polls)`);
  }

  // Show suggested addresses with full value history
  console.log("\n🎯 Suggested address tracking:");
  for (const [label, addrs] of Object.entries(SUGGESTED)) {
    for (const addr of addrs) {
      const entry = history.find(e => e.addr === addr);
      if (entry) {
        const vals = entry.values.join(",");
        console.log(`   ${label.padEnd(10)} $7E:${addr.toString(16).padStart(4).toUpperCase()} = [${vals}]`);
      } else {
        console.log(`   ${label.padEnd(10)} $7E:${addr.toString(16).padStart(4).toUpperCase()} = NOT READABLE`);
      }
    }
  }

  sock.close();
  console.log("\n✅ Done.");
}

main().catch(console.error);
