// Quick targeted scanner: monitors 0xA800-0xA900 for team roster data
// Run this DURING character select or early gameplay
import { createSocket } from "dgram";

const HOST = "127.0.0.1";
const PORT = 55355;
const NAMES = {
  0x00:"Kyo", 0x01:"Benimaru", 0x02:"Daimon", 0x03:"Terry", 0x04:"Andy",
  0x05:"Joe", 0x06:"Ryo", 0x07:"Robert", 0x08:"Yuri", 0x09:"Leona",
  0x0A:"Ralf", 0x0B:"Clark", 0x0C:"Athena", 0x0D:"Kensou", 0x0E:"Chin",
  0x0F:"Chizuru", 0x10:"Mai", 0x11:"King", 0x12:"Kim", 0x13:"Chang",
  0x14:"Choi", 0x15:"Yashiro", 0x16:"Shermie", 0x17:"Chris",
  0x18:"Yamazaki", 0x19:"BlueMary", 0x1A:"Billy", 0x1B:"Iori",
  0x1C:"Mature", 0x1D:"Vice", 0x1E:"Heidern", 0x1F:"Takuma",
  0x20:"Saisyu", 0x21:"HeavyD", 0x22:"Lucky", 0x23:"Brian",
  0x24:"Rugal", 0x25:"Shingo",
};
const VALID = new Set(Object.keys(NAMES).map(Number));

// Known team selections for this test
const P1_KNOWN = [0x00, 0x01, 0x02]; // Kyo, Benimaru, Daimon
const P2_KNOWN = [0x08, 0x00, 0x01]; // Yuri, Kyo, Benimaru

// Scan: full work RAM to find BOTH team sequences
// Focus on 0x8000-0xC000 where game state lives, but also scan 0x0000-0x10000
const REGIONS = [
  { start: 0x8000, end: 0xC000 },
  { start: 0x0000, end: 0x8000 },
  { start: 0xC000, end: 0x10000 },
];
const CHUNK = 256;

let sentChunks = 0;
for (const r of REGIONS) {
  for (let a = r.start; a < r.end; a += CHUNK) {
    sentChunks++;
  }
}

const sock = createSocket("udp4");
const data = new Map();
let received = 0;
let buf = "";

sock.on("message", (msg) => {
  buf += msg.toString();
  const lines = buf.split("\n");
  buf = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3 || parts[0] !== "READ_CORE_RAM") continue;
    const addr = parseInt(parts[1], 16);
    const hex = parts.slice(2).join("");
    if (hex === "-1") continue;
    try { data.set(addr, Buffer.from(hex, "hex")); received++; } catch {}
  }
});

function findSeq(buf, seq) {
  const matches = [];
  for (let i = 0; i <= buf.length - seq.length; i++) {
    let ok = true;
    for (let j = 0; j < seq.length; j++) { if (buf[i+j] !== seq[j]) { ok = false; break; } }
    if (ok) matches.push(i);
  }
  return matches;
}

// After 8 seconds, process results
setTimeout(() => {
  console.log(`\n=== SCAN RESULTS (${received}/${sentChunks} chunks) ===\n`);

  // 1. Search for exact team byte sequences
  const found = { p1: [], p2: [] };
  for (const [addr, buf] of data) {
    for (const off of findSeq(buf, Buffer.from(P1_KNOWN))) {
      found.p1.push(addr + off);
    }
    for (const off of findSeq(buf, Buffer.from(P2_KNOWN))) {
      found.p2.push(addr + off);
    }
  }

  console.log("--- P1 Team (00 01 02 = Kyo, Benimaru, Daimon) ---");
  if (found.p1.length > 0) {
    found.p1.forEach(a => console.log(`  FOUND at 0x${a.toString(16).padStart(4,"0")}`));
  } else {
    console.log("  NOT FOUND in RAM");
  }

  console.log("\n--- P2 Team (08 00 01 = Yuri, Kyo, Benimaru) ---");
  if (found.p2.length > 0) {
    found.p2.forEach(a => console.log(`  FOUND at 0x${a.toString(16).padStart(4,"0")}`));
  } else {
    console.log("  NOT FOUND in RAM");
  }

  // 2. Dump 0xA800-0xA900 area (roster region near timer)
  console.log("\n--- Roster area 0xA800-0xA900 ---");
  for (const [addr, buf] of data) {
    if (addr < 0xA800 || addr >= 0xA900) continue;
    for (let i = 0; i < buf.length; i += 32) {
      const slice = [...buf.slice(i, Math.min(i+32, buf.length))];
      const hex = slice.map(b => b.toString(16).padStart(2,"0")).join(" ");
      const ascii = slice.map(b => (b >= 0x20 && b < 0x7F) ? String.fromCharCode(b) : ".").join("");
      console.log(`  ${(addr+i).toString(16).padStart(4,"0")}: ${hex}  ${ascii}`);
    }
  }

  // 3. Search for runs of 3+ valid char IDs and show unique ones
  console.log("\n--- All unique 3-byte valid-char runs (work RAM: 0x8000-0xC000) ---");
  const seen = new Set();
  for (const [addr, buf] of data) {
    if (addr < 0x8000 || addr >= 0xC000) continue;
    for (let i = 0; i < buf.length - 2; i++) {
      if (VALID.has(buf[i]) && VALID.has(buf[i+1]) && VALID.has(buf[i+2]) &&
          !(buf[i]===0 && buf[i+1]===0 && buf[i+2]===0)) {
        const key = `${buf[i]},${buf[i+1]},${buf[i+2]}`;
        if (!seen.has(key)) {
          seen.add(key);
          console.log(`  0x${(addr+i).toString(16).padStart(4,"0")}: ${buf[i].toString(16).padStart(2,"0")} ${buf[i+1].toString(16).padStart(2,"0")} ${buf[i+2].toString(16).padStart(2,"0")} = ${NAMES[buf[i]]}, ${NAMES[buf[i+1]]}, ${NAMES[buf[i+2]]}`);
        }
      }
    }
  }

  // 4. Dump 0x8100-0x8200 and 0x8300-0x8400 for comparison
  console.log("\n--- P1 0x81E0-0x8210 ---");
  for (const [addr, buf] of data) {
    if (addr < 0x81E0 || addr >= 0x8210) continue;
    for (let i = 0; i < buf.length; i += 32) {
      const slice = [...buf.slice(i, Math.min(i+32, buf.length))];
      const hex = slice.map(b => b.toString(16).padStart(2,"0")).join(" ");
      console.log(`  ${(addr+i).toString(16).padStart(4,"0")}: ${hex}`);
    }
  }
  console.log("\n--- P2 0x83E0-0x8410 ---");
  for (const [addr, buf] of data) {
    if (addr < 0x83E0 || addr >= 0x8410) continue;
    for (let i = 0; i < buf.length; i += 32) {
      const slice = [...buf.slice(i, Math.min(i+32, buf.length))];
      const hex = slice.map(b => b.toString(16).padStart(2,"0")).join(" ");
      console.log(`  ${(addr+i).toString(16).padStart(4,"0")}: ${hex}`);
    }
  }

  sock.close();
  console.log("\nDONE");
}, 8000);

// Send requests
for (const r of REGIONS) {
  for (let a = r.start; a < r.end; a += CHUNK) {
    sock.send(Buffer.from(`READ_CORE_RAM ${a.toString(16)} ${Math.min(CHUNK, r.end-a)}\n`), PORT, HOST);
  }
}
console.log(`Scanning ${sentChunks} chunks... waiting for game to be in character select/early match.`);
