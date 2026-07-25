/**
 * Fast polling scanner: dump first 2KB every 500ms.
 * Captures the transition from menu → combat, flagging bytes that
 * jump to health-like values (48-176 range).
 *
 * Usage: docker exec game-server-game-server-1 node /tmp/scan-combat-transition.mjs 90
 */

import { createSocket } from "dgram";
import { Buffer } from "buffer";

const HOST = "127.0.0.1";
const PORT = 55355;
const SCAN_SIZE = 0x0800; // First 2KB (direct page + stack)
const CHUNK = 256;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readRam(sock, addr, size) {
  return new Promise((resolve, reject) => {
    const cmd = Buffer.from(`READ_CORE_RAM ${addr.toString(16)} ${size}\n`);
    const timer = setTimeout(() => reject(new Error(`Timeout at ${addr.toString(16)}`)), 3000);
    const handler = (msg) => {
      const text = msg.toString();
      if (!text.startsWith("READ_CORE_RAM")) return;
      const parts = text.split(" ");
      if (parts.length < 3) return;
      if (parseInt(parts[1], 16) !== addr) return;
      clearTimeout(timer);
      sock.removeListener("message", handler);
      resolve(parts.slice(2).join(""));
    };
    sock.on("message", handler);
    sock.send(cmd, PORT, HOST);
  });
}

async function readAll(sock) {
  const bytes = new Map();
  for (let addr = 0; addr < SCAN_SIZE; addr += CHUNK) {
    const size = Math.min(CHUNK, SCAN_SIZE - addr);
    const hex = await readRam(sock, addr, size);
    if (hex && hex !== "-1") {
      for (let i = 0; i < hex.length; i += 2) {
        const b = parseInt(hex.substring(i, i + 2), 16);
        if (!isNaN(b)) bytes.set(addr + i/2, b);
      }
    }
  }
  return bytes;
}

async function main() {
  const duration = parseInt(process.argv[2]) || 90;
  const sock = createSocket("udp4");

  console.log("⚡ SFA2 Combat Transition Scanner");
  console.log(`   Scanning ${SCAN_SIZE} bytes (first 2KB WRAM) every 500ms for ${duration}s`);
  console.log("   Looking for health jumps when combat starts.\n");

  const t0 = Date.now();
  const deadline = t0 + duration * 1000;

  // Take initial snapshot
  const prev = await readAll(sock);
  console.log(`📸 Initial: ${prev.size} bytes at T+${Math.round((Date.now() - t0) / 1000)}s\n`);

  // Track which addresses jumped to health-like values
  const jumps = new Map(); // addr → { from, to, pollNumber }

  let poll = 1;
  const log = []; // each entry: { poll, time, newJumps: [...] }

  while (Date.now() < deadline) {
    await sleep(500);
    poll++;
    const curr = await readAll(sock);
    const elapsed = Math.round((Date.now() - t0) / 1000);

    // Find jumps to health-like values (48-176, our candidate health range)
    const newJumps = [];
    for (const [addr, val] of curr) {
      const oldVal = prev.get(addr);
      if (oldVal !== undefined && oldVal !== val) {
        // Health-like: both old AND new values
        const oldInRange = oldVal >= 0 && oldVal <= 200;
        const newInRange = val >= 48 && val <= 176;
        const bigJump = Math.abs(val - oldVal) > 40;

        if (newInRange && bigJump) {
          const key = `${addr}`;
          if (!jumps.has(key)) {
            jumps.set(key, { addr, from: oldVal, to: val, poll, elapsed });
            newJumps.push({ addr, from: oldVal, to: val });
          } else {
            // Update if value changed again
            const existing = jumps.get(key);
            if (val !== existing.to) {
              existing.to = val;
              existing.poll = poll;
            }
          }
        }
      }
    }

    if (newJumps.length > 0) {
      console.log(`\n🔔 T+${elapsed}s (poll #${poll}): ${newJumps.length} new health-like jumps`);
      for (const j of newJumps) {
        console.log(`   $7E:${j.addr.toString(16).padStart(4).toUpperCase()}  ${j.from} → ${j.to}`);
      }
      log.push({ poll, elapsed, newJumps });
    }

    // Update prev
    for (const [addr, val] of curr) prev.set(addr, val);

    if (poll % 20 === 0) {
      process.stdout.write(`\r   Poll #${poll} (T+${elapsed}s) — ${jumps.size} jumps tracked`);
    }
  }
  console.log();

  // Report
  console.log("\n" + "=".repeat(60));
  console.log("📊 HEALTH CANDIDATES (addresses that jumped to 48-176 range):");
  console.log("=".repeat(60));

  if (jumps.size === 0) {
    console.log("   (none found — match may not have reached combat)");
  } else {
    // Sort by address
    const sorted = [...jumps.values()].sort((a, b) => a.addr - b.addr);
    for (const j of sorted) {
      console.log(`   $7E:${j.addr.toString(16).padStart(4).toUpperCase()}  ${j.from} → ${j.to}  (poll #${j.poll}, T+${j.elapsed}s)`);
    }
  }

  // Also show ALL addresses that ended up at 96 or near it
  const final = await readAll(sock);
  console.log("\n🎯 Addresses currently = 96 (final snapshot):");
  const at96 = [];
  for (const [addr, val] of final) {
    if (val === 96) at96.push(addr);
  }
  for (const addr of at96.slice(0, 20)) {
    // Show 16-bit context
    const hi = final.get(addr) || 0;
    const lo = final.get(addr + 1) || 0;
    console.log(`   $7E:${addr.toString(16).padStart(4).toUpperCase()} = 96  (16-bit with next: ${(hi<<8)|lo})`);
  }

  sock.close();
  console.log("\n✅ Done.");
}

main().catch(console.error);
