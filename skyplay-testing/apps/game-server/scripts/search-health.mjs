/**
 * GameShark-style memory search: dump full SNES WRAM, search for specific values.
 *
 * Strategy:
 * 1. Dump ALL 128KB WRAM via READ_CORE_RAM (512 chunks of 256 bytes)
 * 2. Search for bytes that equal 96 (SFA2 max health) or 99 (timer max)
 * 3. Take a second dump, find addresses that changed
 * 4. Inject an attack, take a third dump, find addresses where 96 decreased
 *
 * Usage: docker exec game-server-game-server-1 node /tmp/search-health.mjs
 */

import { createSocket } from "dgram";
import { Buffer } from "buffer";
import { writeFileSync } from "fs";

const HOST = "127.0.0.1";
const PORT = 55355;
const CHUNK = 256;
const WRAM_SIZE = 0x20000; // 128KB

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
      resolve(parts.slice(2).join(""));
    };
    sock.on("message", handler);
    sock.send(cmd, PORT, HOST);
  });
}

async function dumpWRAM(sock) {
  const data = Buffer.alloc(WRAM_SIZE, 0);
  let chunksOk = 0;
  let chunksFail = 0;

  for (let addr = 0; addr < WRAM_SIZE; addr += CHUNK) {
    try {
      const hex = await readRam(sock, addr, CHUNK);
      if (hex === "-1" || hex.length === 0) {
        chunksFail++;
        continue;
      }
      for (let i = 0; i < hex.length; i += 2) {
        const byte = parseInt(hex.substring(i, i + 2), 16);
        if (!isNaN(byte) && addr + i/2 < WRAM_SIZE) {
          data[addr + i/2] = byte;
        }
      }
      chunksOk++;
    } catch (e) {
      chunksFail++;
    }

    if ((addr / CHUNK) % 64 === 0) {
      const pct = ((addr / WRAM_SIZE) * 100).toFixed(0);
      process.stdout.write(`\r   ${pct}% (${addr}/${WRAM_SIZE}) ok=${chunksOk} fail=${chunksFail}`);
    }
  }
  console.log(`\n   Done: ${chunksOk} chunks ok, ${chunksFail} failed`);
  return data;
}

function findValue(data, value) {
  const hits = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i] === value) hits.push(i);
  }
  return hits;
}

function findRange(data, min, max) {
  const hits = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i] >= min && data[i] <= max) hits.push(i);
  }
  return hits;
}

function sendInput(sock, port, button, pressed) {
  return new Promise((resolve) => {
    const cmd = Buffer.from(`INPUT ${port} ${button} ${pressed ? 1 : 0}\n`);
    sock.send(cmd, PORT, HOST, () => setTimeout(resolve, 50));
  });
}

async function pressKey(sock, port, button, durationMs = 100) {
  await sendInput(sock, port, button, true);
  await sleep(durationMs);
  await sendInput(sock, port, button, false);
  await sleep(50);
}

async function main() {
  const sock = createSocket("udp4");

  console.log("🎮 SFA2 GameShark Health Search");
  console.log("=".repeat(60));

  // Step 1: Full WRAM dump
  console.log("\n📸 Dump 1: Full WRAM (128KB)...");
  const dump1 = await dumpWRAM(sock);
  writeFileSync("/tmp/wram-dump1.bin", dump1);
  console.log(`   Saved ${dump1.length} bytes to /tmp/wram-dump1.bin`);

  // Step 2: Search for value 96 (health max)
  const hits96 = findValue(dump1, 96);
  console.log(`\n🔍 Bytes = 96: ${hits96.length} addresses`);
  if (hits96.length > 0 && hits96.length < 50) {
    for (const addr of hits96) {
      console.log(`   $7E:${addr.toString(16).padStart(4).toUpperCase()} = 96`);
    }
  } else if (hits96.length >= 50) {
    console.log(`   (too many to list — ${hits96.length} total)`);
    // Show first 20
    for (const addr of hits96.slice(0, 20)) {
      console.log(`   $7E:${addr.toString(16).padStart(4).toUpperCase()} = 96`);
    }
    console.log(`   ... and ${hits96.length - 20} more`);
  }

  // Search for value 99 (timer max, if 2-digit)
  const hits99 = findValue(dump1, 99);
  console.log(`\n🔍 Bytes = 99: ${hits99.length} addresses`);
  if (hits99.length <= 20) {
    for (const addr of hits99) {
      console.log(`   $7E:${addr.toString(16).padStart(4).toUpperCase()} = 99`);
    }
  }

  // Step 3: Press START once, take a second dump, diff
  console.log("\n🎮 Pressing START (port 0, btn 3)...");
  await pressKey(sock, 0, 3);
  await sleep(500); // Let the game react

  console.log("📸 Dump 2: After START press...");
  const dump2 = await dumpWRAM(sock);
  writeFileSync("/tmp/wram-dump2.bin", dump2);

  // Find bytes that changed between dump1 and dump2
  console.log("\n🔄 Changed bytes:");
  const changed = [];
  for (let i = 0; i < dump1.length; i++) {
    if (dump1[i] !== dump2[i]) {
      changed.push({ addr: i, before: dump1[i], after: dump2[i] });
    }
  }
  console.log(`   ${changed.length} bytes changed`);

  // Only show bytes that changed to/from interesting values
  const interesting = changed.filter(c => {
    const b = c.before, a = c.after;
    // Health-like: either value in 0-176 range and changed significantly
    return (b <= 176 && a <= 176 && Math.abs(b - a) > 0);
  });

  if (interesting.length <= 50) {
    for (const c of interesting) {
      const addr = "$7E:" + c.addr.toString(16).padStart(4).toUpperCase();
      console.log(`   ${addr}  ${c.before} → ${c.after}`);
    }
  } else {
    console.log(`   ${interesting.length} health-range changes (too many)`);
    // Show bytes that changed to/from exactly 96
    const from96 = changed.filter(c => c.before === 96 || c.after === 96);
    console.log(`\n   Changes involving 96:`);
    for (const c of from96) {
      const addr = "$7E:" + c.addr.toString(16).padStart(4).toUpperCase();
      console.log(`   ${addr}  ${c.before} → ${c.after}`);
    }
  }

  // Step 4: Show addresses where 96 is at common health addresses
  console.log("\n🎯 Potential health addresses (bytes = 96 in dump1):");
  const interesting96 = hits96.filter(a => a < 0x2000); // First 8KB only
  console.log(`   In first 8KB: ${interesting96.length} bytes = 96`);

  // Also check 16-bit values for 96*256 + X patterns
  console.log("\n🔢 16-bit scan in first 2KB:");
  for (let i = 0; i < 0x0800; i += 2) {
    const val16 = (dump1[i] << 8) | dump1[i + 1];
    // Health-related: 96*256 = 24576, so val16 near 24576
    if (val16 >= 24000 && val16 <= 25000) {
      console.log(`   $7E:${i.toString(16).padStart(4).toUpperCase()} = ${val16} (${dump1[i]}*256 + ${dump1[i+1]})`);
    }
  }

  sock.close();
  console.log("\n✅ Done. Raw dumps saved in /tmp/wram-dump*.bin");
}

main().catch(console.error);
