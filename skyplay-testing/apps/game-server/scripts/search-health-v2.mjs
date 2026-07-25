/**
 * V2: Broader search. SFA2 SNES health may not be stored as raw 96.
 * Try common representations:
 *   100 (percentage), 176 (arcade), 144 (alt arcade),
 *   48 (half bar), 0-255 linear, 16-bit values
 *
 * Also: the "no changes after START" suggests game might be PAUSED
 * or in a static state. Try GET_STATUS to verify RetroArch is responding.
 *
 * Usage: docker exec game-server-game-server-1 node /tmp/search-health-v2.mjs
 */

import { createSocket } from "dgram";
import { Buffer } from "buffer";
import { writeFileSync } from "fs";

const HOST = "127.0.0.1";
const PORT = 55355;
const CHUNK = 256;
const WRAM_SIZE = 0x20000;

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

async function dumpWRAM(sock, label) {
  const data = Buffer.alloc(WRAM_SIZE, 0);
  let ok = 0, fail = 0;

  for (let addr = 0; addr < WRAM_SIZE; addr += CHUNK) {
    try {
      const hex = await readRam(sock, addr, CHUNK);
      if (hex === "-1" || hex.length === 0) { fail++; continue; }
      for (let i = 0; i < hex.length; i += 2) {
        const b = parseInt(hex.substring(i, i + 2), 16);
        if (!isNaN(b) && addr + i/2 < WRAM_SIZE) data[addr + i/2] = b;
      }
      ok++;
    } catch { fail++; }
    if ((addr / CHUNK) % 128 === 0) {
      process.stdout.write(`\r   ${Math.round(addr/WRAM_SIZE*100)}% `);
    }
  }
  console.log(`ok=${ok} fail=${fail}`);
  return data;
}

function countValues(data, ...values) {
  const counts = {};
  for (const v of values) counts[v] = 0;
  for (let i = 0; i < data.length; i++) {
    if (counts[data[i]] !== undefined) counts[data[i]]++;
  }
  return counts;
}

function findMostFrequentInRange(data, min, max, topN = 30) {
  const freq = {};
  for (let i = 0; i < data.length; i++) {
    if (data[i] >= min && data[i] <= max) {
      freq[data[i]] = (freq[data[i]] || 0) + 1;
    }
  }
  return Object.entries(freq)
    .map(([k, v]) => ({ value: parseInt(k), count: v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

function findLocations(data, value) {
  const locs = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i] === value) locs.push(i);
  }
  return locs;
}

async function main() {
  const sock = createSocket("udp4");

  // First verify RetroArch is responding
  console.log("🎮 Verifying RetroArch...");
  try {
    const status = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), 3000);
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
    console.log(`   ${status}\n`);
  } catch (e) {
    console.log(`   FAILED: ${e.message}\n`);
    sock.close();
    return;
  }

  // Full dump
  console.log("📸 Full WRAM dump...");
  const dump = await dumpWRAM(sock, "dump1");
  writeFileSync("/tmp/wram-full.bin", dump);
  console.log(`   Saved ${dump.length} bytes\n`);

  // Search for common health values
  const healthValues = [48, 72, 96, 100, 120, 144, 168, 176, 192, 208, 255];
  console.log("🔍 Common health values in WRAM:");
  for (const v of healthValues) {
    const locs = findLocations(dump, v);
    if (locs.length > 0 && locs.length <= 100) {
      console.log(`   ${v}: ${locs.length} addresses`);
      for (const addr of locs.slice(0, 10)) {
        console.log(`      $7E:${addr.toString(16).padStart(5).toUpperCase()}`);
      }
      if (locs.length > 10) console.log(`      ... and ${locs.length - 10} more`);
    } else if (locs.length > 100) {
      console.log(`   ${v}: ${locs.length} addresses (too many)`);
    } else {
      console.log(`   ${v}: 0`);
    }
  }

  // Most frequent values in range 0-255 (game state candidates)
  console.log("\n📊 Most frequent values in 0-255 range:");
  const freq = findMostFrequentInRange(dump, 0, 255, 40);
  for (const f of freq) {
    console.log(`   ${f.value.toString().padStart(3)}: ${f.count.toString().padStart(5)} occurrences`);
  }

  // 16-bit analysis: find all 16-bit values in 0-200 range (health/damage)
  console.log("\n🔢 16-bit values as health candidates (range 0-200, in first 8KB):");
  const seen16 = new Set();
  for (let i = 0; i < 0x2000; i += 2) {
    const val16 = (dump[i] << 8) | dump[i + 1];
    if (val16 > 0 && val16 <= 200) {
      const key = `${val16}`;
      if (!seen16.has(key)) {
        seen16.add(key);
        console.log(`   $7E:${i.toString(16).padStart(4).toUpperCase()} = ${val16} (hi=${dump[i]}, lo=${dump[i+1]})`);
      }
    }
    if (seen16.size > 30) break;
  }

  // Check if the game state changed by injecting multiple inputs
  console.log("\n🎮 Testing if RetroArch responds to inputs...");
  const snap1 = await dumpWRAM(sock, "snap1");

  // Send multiple different button presses
  const sock2 = createSocket("udp4");
  function sendCmd(cmd) {
    return new Promise(r => sock2.send(Buffer.from(cmd + "\n"), PORT, HOST, () => setTimeout(r, 30)));
  }

  // Press A (btn 0) + START (btn 3) on P1
  await sendCmd("INPUT 0 0 1"); await sleep(80);
  await sendCmd("INPUT 0 0 0"); await sleep(30);
  await sendCmd("INPUT 0 3 1"); await sleep(80);
  await sendCmd("INPUT 0 3 0"); await sleep(30);

  // Move D-pad right + press A
  await sendCmd("INPUT 0 7 1"); await sleep(50);
  await sendCmd("INPUT 0 7 0"); await sleep(30);
  await sendCmd("INPUT 0 0 1"); await sleep(80);
  await sendCmd("INPUT 0 0 0"); await sleep(100);

  const snap2 = await dumpWRAM(sock, "snap2");
  sock2.close();

  // Diff
  const changes = [];
  for (let i = 0; i < snap1.length; i++) {
    if (snap1[i] !== snap2[i]) {
      changes.push({ addr: i, before: snap1[i], after: snap2[i] });
      if (changes.length > 200) break;
    }
  }

  console.log(`   Bytes changed: ${changes.length} (out of ${snap1.length})`);

  if (changes.length === 0) {
    console.log("\n⚠️  ZERO bytes changed — RetroArch not processing inputs!");
    console.log("   The game may be paused or in a frozen state.");
    console.log("   Try a fresh RetroArch session.");
  } else {
    console.log("\n   Sample changes:");
    for (const c of changes.slice(0, 30)) {
      const addr = "$7E:" + c.addr.toString(16).padStart(5).toUpperCase();
      console.log(`   ${addr}  ${c.before} → ${c.after}`);
    }
  }

  sock.close();
  console.log("\n✅ Done.");
}

main().catch(console.error);
