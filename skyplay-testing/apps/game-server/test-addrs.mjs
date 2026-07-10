import { createSocket } from "dgram";

const sock = createSocket("udp4");
const responses = [];

const labels = {
  0x8238: "P1 (current 0x8238)",
  0x8438: "P2 (current 0x8438)",
  0x81a4: "P1 (0x1081A4→offset 0x81A4)",
  0x83a4: "P2 (0x1083A4→offset 0x83A4)",
  0x8080: "spare",
  0x8280: "spare",
};

sock.on("message", (msg) => {
  const text = msg.toString().trim();
  const parts = text.split(/\s+/);
  if (parts.length >= 3) {
    const addr = parseInt(parts[1], 16);
    const val = parts[2];
    const label = labels[addr] || ("0x" + addr.toString(16));
    console.log(label + " = 0x" + val + " (" + parseInt(val, 16) + ")");
  }
});

// Scan a broader area around both candidate addresses
const toScan = [];
for (let base of [0x81a0, 0x8230, 0x83a0, 0x8430]) {
  for (let off = 0; off < 16; off++) {
    toScan.push(base + off);
  }
}

let i = 0;
function next() {
  if (i >= toScan.length) {
    setTimeout(() => { sock.close(); console.log("DONE"); }, 1000);
    return;
  }
  sock.send("READ_CORE_RAM " + toScan[i].toString(16) + " 1\n", 55355, "127.0.0.1");
  i++;
  setTimeout(next, 50);
}
next();
