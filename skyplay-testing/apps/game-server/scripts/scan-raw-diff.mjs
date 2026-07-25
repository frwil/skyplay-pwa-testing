/**
 * Raw differential scanner — no filtering, just track ALL changes.
 * Starts immediately, runs for N seconds, reports every byte that
 * changed and HOW it changed (full value history).
 *
 * Targeted at the most promising ranges from full scan.
 *
 * Usage: docker exec game-server-game-server-1 node /tmp/scan-raw-diff.mjs 90
 */

import { createSocket } from "dgram";
import { Buffer } from "buffer";

const HOST = "127.0.0.1";
const PORT = 55355;

const RANGES = [
  { start: 0x00000, end: 0x00020, label: "low-vars" },
  { start: 0x000D0, end: 0x000E4, label: "DA-region" },
  { start: 0x00280, end: 0x002A0, label: "280-region" },
  { start: 0x00300, end: 0x00320, label: "300-region" },
  { start: 0x00400, end: 0x00460, label: "400-region" },
  { start: 0x00500, end: 0x005A0, label: "500-region" },
  { start: 0x01000, end: 0x01020, label: "1000-region" },
  { start: 0x01380, end: 0x013A0, label: "1380-region" },
  { start: 0x014F0, end: 0x01540, label: "14F0-region" },
  { start: 0x01870, end: 0x01880, label: "1870-region" },
  { start: 0x018D0, end: 0x018E2, label: "18D0-region" },
  { start: 0x01928, end: 0x01960, label: "1928-region" },
  { start: 0x01A90, end: 0x01AB0, label: "1A90-region" },
  { start: 0x01B10, end: 0x01BF0, label: "1B10-region" },
  { start: 0x01D30, end: 0x01D50, label: "1D30-region" },
  { start: 0x01E70, end: 0x01EC0, label: "1E70-region" },
  { start: 0x01F30, end: 0x01F40, label: "1F30-region" },
];

const INTERVAL = 200; // ms between polls

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

async function readRange(sock, start, end) {
  try {
    const hex = await readRam(sock, start, end);
    return parseHex(hex);
  } catch (e) {
    return null;
  }
}

function fmtAddr(a) { return "0x" + a.toString(16).padStart(4).toUpperCase(); }

async function main() {
  const duration = parseInt(process.argv[2]) || 90;
  const sock = createSocket("udp4");

  console.log("🔍 SFA2 Raw Differential Scanner");
  console.log(`   ${RANGES.length} ranges, poll every ${INTERVAL}ms for ${duration}s\n`);

  // Initial snapshot
  const history = new Map();
  for (const r of RANGES) {
    const bytes = await readRange(sock, r.start, r.end);
    if (bytes) {
      for (let i = 0; i < bytes.length; i++) {
        history.set(r.start + i, [bytes[i]]);
      }
    }
  }
  console.log(`📸 Initial: ${history.size} bytes`);

  // Take a second snapshot to find already-changing addresses
  await sleep(INTERVAL);
  for (const r of RANGES) {
    const bytes = await readRange(sock, r.start, r.end);
    if (bytes) {
      for (let i = 0; i < bytes.length; i++) {
        const arr = history.get(r.start + i);
        if (arr) arr.push(bytes[i]);
      }
    }
  }

  // Find which bytes changed between poll 1 and 2
  const preExisting = [];
  for (const [addr, vals] of history) {
    if (vals[0] !== vals[1]) preExisting.push(addr);
  }
  console.log(`   Already changing: ${preExisting.length} bytes`);

  const t0 = Date.now();
  const deadline = t0 + duration * 1000;
  let poll = 2;

  while (Date.now() < deadline) {
    await sleep(INTERVAL);
    poll++;

    for (const r of RANGES) {
      const bytes = await readRange(sock, r.start, r.end);
      if (bytes) {
        for (let i = 0; i < bytes.length; i++) {
          const arr = history.get(r.start + i);
          if (arr) arr.push(bytes[i]);
        }
      }
    }

    if (poll % 15 === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      process.stdout.write(`\r   Poll #${poll} (${elapsed}s)`);
    }
  }
  console.log();

  // Find ALL changing bytes
  const changers = [];
  for (const [addr, vals] of history) {
    const uniq = new Set(vals);
    if (uniq.size > 1) {
      changers.push({ addr, vals, changes: uniq.size, min: Math.min(...vals), max: Math.max(...vals) });
    }
  }

  changers.sort((a, b) => a.addr - b.addr);

  console.log(`\n📊 ${changers.length} bytes changed (out of ${history.size})\n`);

  // Group by behavior patterns
  // Health-like: starts at 96 OR jumps to 96 when combat starts, then decreases
  const healthLike = changers.filter(c => {
    const v = c.vals;
    // Starts at ~96 and later goes below 80 (took damage)
    return v[0] >= 90 && v[0] <= 100 && c.min < 80;
  });

  // Health-like v2: starts at 0, jumps to 96, and stays there or decreases
  const jumpers = changers.filter(c => {
    const v = c.vals;
    return v[0] <= 10 && c.max >= 90 && c.max <= 100;
  });

  // Timer-like: counts down from 99 or oscillates in 1-99 range
  const timerLike = changers.filter(c => {
    const v = c.vals;
    // Check if values are in range 0-99 and change frequently
    return c.min >= 0 && c.max <= 99 && c.changes > 10;
  });

  console.log("=" .repeat(70));
  console.log("🏥 HEALTH-LIKE (start ~96, dropped below 80):");
  for (const c of healthLike) {
    const allVals = c.vals.join(",");
    console.log(`   $7E:${fmtAddr(c.addr)}  ${c.min}..${c.max}  vals=[${allVals}]`);
  }
  if (healthLike.length === 0) console.log("   (none)");

  console.log("\n🏥 JUMPED 0→96 (combat-start health):");
  for (const c of jumpers) {
    const allVals = c.vals.join(",");
    console.log(`   $7E:${fmtAddr(c.addr)}  ${c.min}..${c.max}  vals=[${allVals}]`);
  }
  if (jumpers.length === 0) console.log("   (none)");

  console.log("\n⏱️  TIMER-LIKE (0-99, frequent changes):");
  for (const c of timerLike.slice(0, 15)) {
    const v = c.vals;
    const sample = v.filter((_, i) => i % 25 === 0 || i === v.length - 1).join(",");
    console.log(`   $7E:${fmtAddr(c.addr)}  ${c.min}..${c.max}  chg=${c.changes}  vals=[${sample}]`);
  }
  if (timerLike.length > 15) console.log(`   ... and ${timerLike.length - 15} more`);

  // Show ALL changers with full value lists for manual analysis
  console.log("\n📋 ALL CHANGING BYTES (full history):");
  for (const c of changers) {
    const v = c.vals;
    // Only show first 50 and last few values if long
    let valsStr;
    if (v.length <= 30) {
      valsStr = v.join(",");
    } else {
      valsStr = v.slice(0, 15).join(",") + " ... " + v.slice(-10).join(",");
    }
    console.log(`   $7E:${fmtAddr(c.addr)}  ${c.min}..${c.max}  chg=${c.changes}  [${valsStr}]`);
  }

  sock.close();
  console.log("\n✅ Done.");
}

main().catch(console.error);
