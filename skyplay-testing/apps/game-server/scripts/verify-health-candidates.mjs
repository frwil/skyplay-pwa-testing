/**
 * Targeted health address verification.
 *
 * Strategy:
 * 1. Full scan first 2KB — find ALL addresses that = 96 (or near it)
 * 2. Narrow to candidates that CHANGED during combat transition
 * 3. Poll only those ~15 candidates every 100ms
 * 4. Inject alternating attacks (P1→P2, P2→P1) via UDP INPUT
 * 5. Track which addresses decrease on hit → P1/P2 health
 * 6. Track which address counts down steadily → timer
 *
 * Usage: docker exec game-server-game-server-1 node /tmp/verify-health-candidates.mjs [duration_secs]
 */

import { createSocket } from "dgram";
import { Buffer } from "buffer";

const HOST = "127.0.0.1";
const PORT = 55355;
const POLL_INTERVAL = 100; // ms

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function udpCmd(sock, cmd) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${cmd.split(" ")[0]}`)), 3000);
    const handler = (msg) => {
      const text = msg.toString();
      if (!text.startsWith(cmd.split(" ")[0])) return;
      clearTimeout(timer);
      sock.removeListener("message", handler);
      resolve(text);
    };
    sock.on("message", handler);
    sock.send(Buffer.from(cmd + "\n"), PORT, HOST);
  });
}

function sendInputFireForget(sock, port, button, pressed) {
  sock.send(Buffer.from(`INPUT ${port} ${button} ${pressed ? 1 : 0}\n`), PORT, HOST);
}

async function readByte(sock, addr) {
  try {
    const hex = await udpCmd(sock, `READ_CORE_RAM ${addr.toString(16)} 1`);
    const parts = hex.split(" ");
    if (parts.length < 3) return null;
    const val = parseInt(parts[2], 16);
    return isNaN(val) ? null : val;
  } catch {
    return null;
  }
}

async function readBytes(sock, addrs) {
  const results = {};
  // Read in parallel-ish by batching
  for (const addr of addrs) {
    const val = await readByte(sock, addr);
    if (val !== null) results[addr] = val;
    await sleep(10); // small gap to avoid UDP flooding
  }
  return results;
}

// Initial scan: find all bytes = 96 in first 2KB
async function scanFor96(sock) {
  const hits = [];
  for (let addr = 0; addr < 0x0800; addr += 64) {
    const size = Math.min(64, 0x0800 - addr);
    try {
      const hex = await udpCmd(sock, `READ_CORE_RAM ${addr.toString(16)} ${size}`);
      const parts = hex.split(" ");
      const data = parts.slice(2).join("");
      for (let i = 0; i < data.length; i += 2) {
        const b = parseInt(data.substring(i, i + 2), 16);
        if (b === 96) hits.push(addr + i / 2);
      }
    } catch {}
    if ((addr / 64) % 4 === 0) process.stdout.write(".");
  }
  return hits;
}

// The known promising candidates from combat-transition scan
const KNOWN_CANDIDATES = [
  // Jumped TO 96 at combat start (T+28s "ROUND 1 FIGHT!")
  0x0504, 0x0506, 0x050E, 0x05BC, 0x06A0, 0x06AA,
  // Dropped FROM 96
  0x06A9, 0x06B5,
  // Near 96 (value 97)
  0x015E, 0x06A4, 0x06A6,
  // Additional addresses from the 0x500-0x6C0 cluster
  0x0500, 0x0502, 0x0508, 0x050A, 0x050C,
  0x06A2, 0x06A8, 0x06AC, 0x06B0, 0x06B4,
];

async function main() {
  const duration = parseInt(process.argv[2]) || 60;
  const sock = createSocket("udp4");

  console.log("🎯 SFA2 Health Address Verification");
  console.log("=".repeat(60));

  // Step 1: Verify RetroArch is alive and PLAYING
  console.log("\n📡 Checking RetroArch status...");
  try {
    const status = await udpCmd(sock, "GET_STATUS");
    console.log(`   ${status}`);
  } catch (e) {
    console.log(`   ❌ ${e.message}`);
    sock.close();
  }

  // Step 2: Scan for ALL bytes = 96 in first 2KB (current state)
  console.log("\n🔍 Scanning for bytes = 96 in first 2KB...");
  const hits96 = await scanFor96(sock);
  console.log(`\n   Found ${hits96.length} addresses = 96`);
  console.log("   " + hits96.map(a => `0x${a.toString(16).toUpperCase()}`).join(", "));

  // Step 3: Build candidate list = known candidates + current 96-hits
  const candidateSet = new Set([...KNOWN_CANDIDATES, ...hits96]);
  const candidates = [...candidateSet].sort((a, b) => a - b);

  // Also add neighbors (±1, ±2 bytes) for 16-bit context
  for (const addr of hits96) {
    candidateSet.add(addr - 1);
    candidateSet.add(addr + 1);
    candidateSet.add(addr - 2);
    candidateSet.add(addr + 2);
  }
  const allAddrs = [...candidateSet].filter(a => a >= 0 && a < 0x0800).sort((a, b) => a - b);

  console.log(`\n📋 Polling ${allAddrs.length} addresses every ${POLL_INTERVAL}ms for ${duration}s`);
  console.log(`   Candidates: ${allAddrs.map(a => "0x" + a.toString(16).padStart(4).toUpperCase()).join(", ")}`);

  // Step 4: Start attack injection loop (alternating P1→P2, P2→P1)
  console.log("\n🥊 Starting attack injection...");
  let attackPhase = 0; // 0 = P1 attacks, 1 = P2 attacks
  let attackCount = 0;

  const attackInterval = setInterval(() => {
    const player = attackPhase === 0 ? 0 : 1; // P1 or P2
    // Aggressive combo: forward + punch
    sendInputFireForget(sock, player, 7, 1); // Right (toward opponent for P1)
    sendInputFireForget(sock, player, 0, 1); // B (medium punch)

    setTimeout(() => {
      sendInputFireForget(sock, player, 7, 0);
      sendInputFireForget(sock, player, 0, 0);
    }, 80);

    attackCount++;
    if (attackCount % 20 === 0) {
      attackPhase = 1 - attackPhase; // Switch attacker every 20 attacks (~4s)
      console.log(`\n   🔄 Switch: P${attackPhase + 1} attacking (${attackCount} total)`);
    }
  }, 200);

  // Step 5: Poll addresses at 100ms
  console.log("\n📊 Polling (format: T+s addr=val changes)...");
  const history = []; // [{ time, addr, val }]
  const prevValues = {};

  // Initialize prev values
  const init = await readBytes(sock, allAddrs);
  for (const [addr, val] of Object.entries(init)) {
    prevValues[addr] = val;
  }

  const t0 = Date.now();
  const deadline = t0 + duration * 1000;
  let pollNum = 0;

  // Track interesting events
  const decreases = new Map(); // addr → count of decreases
  const increases = new Map(); // addr → count of increases

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL);
    pollNum++;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    const current = await readBytes(sock, allAddrs);
    const changes = [];

    for (const addr of allAddrs) {
      const prev = prevValues[addr];
      const curr = current[addr];
      if (curr !== undefined && prev !== undefined && prev !== curr) {
        changes.push({ addr, prev, curr, delta: curr - prev });
        prevValues[addr] = curr;

        if (curr < prev) {
          decreases.set(addr, (decreases.get(addr) || 0) + 1);
        } else if (curr > prev) {
          increases.set(addr, (increases.get(addr) || 0) + 1);
        }
      }
    }

    if (changes.length > 0) {
      const addrList = changes
        .filter(c => Math.abs(c.delta) > 0)
        .map(c => `0x${c.addr.toString(16).padStart(4).toUpperCase()}:${c.prev}→${c.curr}`)
        .join(" ");
      console.log(`   T+${elapsed}s #${pollNum}: ${addrList}`);
      history.push({ time: elapsed, changes });
    }

    // Every 10 polls, show summary
    if (pollNum % 50 === 0) {
      console.log(`\n   --- Summary at T+${elapsed}s (${decreases.size} decreasing, ${increases.size} increasing) ---`);
      if (decreases.size > 0) {
        const top = [...decreases.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
        console.log("   Most decreasing: " + top.map(([a, n]) => `0x${a.toString(16).padStart(4).toUpperCase()}(${n}↓)`).join(", "));
      }
    }
  }

  // Cleanup
  clearInterval(attackInterval);

  // Step 6: Final report
  console.log("\n\n" + "=".repeat(60));
  console.log("📊 FINAL REPORT");
  console.log("=".repeat(60));

  console.log("\n🔻 Addresses that DECREASED (potential health bars):");
  const decSorted = [...decreases.entries()].sort((a, b) => b[1] - a[1]);
  for (const [addr, count] of decSorted) {
    const hex = "0x" + addr.toString(16).padStart(4).toUpperCase();
    console.log(`   $7E:${hex} — ${count} decreases`);
  }

  console.log("\n🔺 Addresses that INCREASED:");
  const incSorted = [...increases.entries()].sort((a, b) => b[1] - a[1]);
  for (const [addr, count] of incSorted.slice(0, 10)) {
    const hex = "0x" + addr.toString(16).padStart(4).toUpperCase();
    console.log(`   $7E:${hex} — ${count} increases`);
  }

  // Show steady countdown candidates (timer — decreases every N polls)
  console.log("\n⏱️  Steady countdown candidates (decreased > 40% of polls):");
  const threshold = pollNum * 0.4;
  const steady = decSorted.filter(([, count]) => count > threshold);
  for (const [addr, count] of steady) {
    const hex = "0x" + addr.toString(16).padStart(4).toUpperCase();
    console.log(`   $7E:${hex} — ${count}/${pollNum} decreases (${(count/pollNum*100).toFixed(0)}%)`);
  }

  sock.close();
  console.log("\n✅ Done.");
}

main().catch(console.error);
