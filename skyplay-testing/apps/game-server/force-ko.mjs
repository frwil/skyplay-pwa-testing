// Force KO by writing 0 to P1 health, then scan to find active char change
import { createSocket } from "dgram";

const HOST = "127.0.0.1";
const PORT = 55355;
const P1_HEALTH = 0x8238;

const sock = createSocket("udp4");
let buf = "";

// First, read current P1 health
function readHealth() {
  return new Promise((resolve) => {
    sock.once("message", (msg) => {
      const text = msg.toString().trim();
      const parts = text.split(/\s+/);
      if (parts.length >= 3) {
        const val = parseInt(parts[2], 16);
        console.log(`Current P1 health: 0x${val.toString(16)} (${val} / 103)`);
        resolve(val);
      } else {
        resolve(-1);
      }
    });
    sock.send(Buffer.from(`READ_CORE_RAM ${P1_HEALTH.toString(16)} 1\n`), PORT, HOST);
  });
}

async function main() {
  const health = await readHealth();
  if (health <= 0) {
    console.log("P1 already dead, no need to force KO");
    sock.close();
    return;
  }

  // Write 0 to P1 health to force KO
  console.log(`Writing 0x00 to P1 health at 0x${P1_HEALTH.toString(16)}...`);
  sock.send(Buffer.from(`WRITE_CORE_RAM ${P1_HEALTH.toString(16)} 00\n`), PORT, HOST);

  setTimeout(async () => {
    console.log("Checking if health changed...");
    const newHealth = await readHealth();
    if (newHealth <= 1) {
      console.log("✅ P1 health set to 0! Character switch should happen now.");
      console.log("Watch the game — Benimaru should appear as P1's active character.");
    } else {
      console.log(`Health still at ${newHealth} — WRITE_CORE_RAM may not be supported.`);
    }
    sock.close();
  }, 500);
}

main();
