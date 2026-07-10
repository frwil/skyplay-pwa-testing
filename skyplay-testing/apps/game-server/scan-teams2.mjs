// Reliable team-address finder: full work-RAM scan with RETRANSMISSION (no packet loss),
// searches for each team's 3 IDs contiguous in ANY order, and locates rare team-member IDs.
import { createSocket } from "dgram";

const HOST = "127.0.0.1";
const PORT = 55355;
const NAMES = {
  0x00:"Kyo",0x01:"Benimaru",0x02:"Daimon",0x03:"Terry",0x04:"Andy",0x05:"Joe",
  0x06:"Ryo",0x07:"Robert",0x08:"Yuri",0x09:"Leona",0x0A:"Ralf",0x0B:"Clark",
  0x0C:"Athena",0x0D:"Kensou",0x0E:"Chin",0x0F:"Chizuru",0x10:"Mai",0x11:"King",
  0x12:"Kim",0x13:"Chang",0x14:"Choi",0x15:"Yashiro",0x16:"Shermie",0x17:"Chris",
  0x18:"Yamazaki",0x19:"BlueMary",0x1A:"Billy",0x1B:"Iori",0x1C:"Mature",0x1D:"Vice",
  0x1E:"Heidern",0x1F:"Takuma",0x20:"Saisyu",0x21:"HeavyD",0x22:"Lucky",0x23:"Brian",
  0x24:"Rugal",0x25:"Shingo",
};

// This round's teams (order = selection order, but we search any permutation)
const P1 = [0x09, 0x13, 0x1d]; // Leona, Chang, Vice
const P2 = [0x0a, 0x09, 0x0b]; // Ralf, Leona, Clark
// Rare IDs to locate individually (exclude 0x09 Leona which is in both / common defaults 00,01,02)
const RARE = [0x13, 0x1d, 0x0b, 0x0a, 0x11];

const CHUNK = 64; // smaller chunks → fewer bytes lost per dropped packet
const START = 0x0000, END = 0x10000;
const addrs = [];
for (let a = START; a < END; a += CHUNK) addrs.push(a);

const sock = createSocket("udp4");
const data = new Map();
let buf = "";

sock.on("message", (msg) => {
  buf += msg.toString();
  const lines = buf.split("\n"); buf = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3 || parts[0] !== "READ_CORE_RAM") continue;
    const addr = parseInt(parts[1], 16);
    const hex = parts.slice(2).join("");
    if (hex === "-1") continue;
    try { data.set(addr, Buffer.from(hex, "hex")); } catch {}
  }
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function sameSet(a, b) {
  const s = [...b].sort();
  const t = [...a].sort();
  return s.length === t.length && s.every((v, i) => v === t[i]);
}

async function main() {
  // Retransmission rounds until we have every chunk (or 6 tries)
  for (let round = 0; round < 6; round++) {
    const missing = addrs.filter(a => !data.has(a));
    if (missing.length === 0) break;
    for (const a of missing) {
      sock.send(Buffer.from(`READ_CORE_RAM ${a.toString(16)} ${CHUNK}\n`), PORT, HOST);
      if (missing.length > 200 && (a & 0x3ff) === 0) await sleep(1); // gentle pacing
    }
    await sleep(1200);
    console.log(`Round ${round + 1}: have ${data.size}/${addrs.length} chunks`);
  }

  // Flatten into one contiguous byte view
  const bytes = new Uint8Array(END);
  const present = new Uint8Array(END);
  for (const [addr, b] of data) for (let i = 0; i < b.length; i++) { bytes[addr + i] = b[i]; present[addr + i] = 1; }

  // 1. Contiguous triplet matching either team in ANY order
  console.log(`\n=== Contiguous 3-byte triplets matching a full team (any order) ===`);
  let hits = 0;
  for (let a = START; a < END - 2; a++) {
    if (!present[a] || !present[a+1] || !present[a+2]) continue;
    const tri = [bytes[a], bytes[a+1], bytes[a+2]];
    if (sameSet(tri, P1)) { console.log(`  P1 @0x${a.toString(16)}: ${tri.map(x=>NAMES[x]).join(",")}`); hits++; }
    if (sameSet(tri, P2)) { console.log(`  P2 @0x${a.toString(16)}: ${tri.map(x=>NAMES[x]).join(",")}`); hits++; }
  }
  if (!hits) console.log("  none");

  // 2. All addresses of rare team-member IDs (reveals real clusters)
  console.log(`\n=== Addresses of rare team IDs ===`);
  for (const id of RARE) {
    const found = [];
    for (let a = START; a < END; a++) if (present[a] && bytes[a] === id) found.push(a);
    console.log(`  ${NAMES[id]} (0x${id.toString(16)}): ${found.length ? found.map(a=>"0x"+a.toString(16)).join(" ") : "none"}`);
  }

  console.log(`\nCoverage: ${data.size}/${addrs.length} chunks (${(100*data.size/addrs.length).toFixed(1)}%)`);
  sock.close();
}

console.log("Scanning full work RAM with retransmission...");
main();
