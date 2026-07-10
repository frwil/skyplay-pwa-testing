// Locate P1's actual team [Leona=09, Chang=13, Vice=1d] and P2 [Yuri=08, Kyo=00, Benimaru=01]
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
const P1_KNOWN = [0x09, 0x13, 0x1d]; // Leona, Chang, Vice
const P2_KNOWN = [0x0a, 0x09, 0x0b]; // Ralf, Leona, Clark (CPU)

const CHUNK = 256;
const REGIONS = [{ start: 0x8000, end: 0xC000 }, { start: 0x0000, end: 0x8000 }, { start: 0xC000, end: 0x10000 }];
let sentChunks = 0;
for (const r of REGIONS) for (let a = r.start; a < r.end; a += CHUNK) sentChunks++;

const sock = createSocket("udp4");
const data = new Map();
let received = 0, buf = "";

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
    try { data.set(addr, Buffer.from(hex, "hex")); received++; } catch {}
  }
});

function findSeq(b, seq) {
  const m = [];
  for (let i = 0; i <= b.length - seq.length; i++) {
    let ok = true;
    for (let j = 0; j < seq.length; j++) if (b[i+j] !== seq[j]) { ok = false; break; }
    if (ok) m.push(i);
  }
  return m;
}

setTimeout(() => {
  console.log(`\n=== SCAN (${received}/${sentChunks} chunks) ===`);
  const found = { p1: [], p2: [] };
  for (const [addr, b] of data) {
    for (const off of findSeq(b, Buffer.from(P1_KNOWN))) found.p1.push(addr + off);
    for (const off of findSeq(b, Buffer.from(P2_KNOWN))) found.p2.push(addr + off);
  }
  console.log(`\n--- P1 team [09 13 1d = Leona,Chang,Vice] ---`);
  found.p1.length ? found.p1.forEach(a => console.log(`  0x${a.toString(16)}`)) : console.log("  NOT FOUND");
  console.log(`\n--- P2 team [08 00 01 = Yuri,Kyo,Benimaru] ---`);
  found.p2.length ? found.p2.forEach(a => console.log(`  0x${a.toString(16)}`)) : console.log("  NOT FOUND");

  // Dump A840-A870 to see what's actually there
  console.log(`\n--- A840-A870 raw ---`);
  for (const [addr, b] of data) {
    if (addr > 0xA870 || addr + b.length < 0xA840) continue;
    for (let i = 0; i < b.length; i++) {
      const abs = addr + i;
      if (abs >= 0xA840 && abs <= 0xA870) {
        const id = b[i];
        const nm = NAMES[id] ? ` = ${NAMES[id]}` : "";
        process.stdout.write(`0x${abs.toString(16)}:${id.toString(16).padStart(2,"0")}${nm}  `);
      }
    }
  }
  console.log("");
  sock.close();
}, 5000);

for (const r of REGIONS) for (let a = r.start; a < r.end; a += CHUNK) sock.send(Buffer.from(`READ_CORE_RAM ${a.toString(16)} ${Math.min(CHUNK, r.end-a)}\n`), PORT, HOST);
console.log("Scanning full work RAM...");
