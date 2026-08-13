const dgram = require('dgram');
const s = dgram.createSocket('udp4');

function read(addr, size) {
  return new Promise(r => {
    const cmd = Buffer.from(`READ_CORE_RAM ${addr.toString(16)} ${size}\n`);
    let buf = '';
    const t = setTimeout(() => { s.removeAllListeners('message'); r(null); }, 1500);
    s.on('message', m => {
      buf += m.toString();
      const parts = buf.trim().split(/\s+/);
      if (parts[0]==='READ_CORE_RAM' && parseInt(parts[1],16)===addr) {
        clearTimeout(t);
        s.removeAllListeners('message');
        r(parts.slice(2).join(''));
      }
    });
    s.send(cmd, 55355, '127.0.0.1');
  });
}

async function main() {
  const tests = [
    { name: 'Health_P1', addr: 0x0B4A, size: 1 },
    { name: 'Health_P2', addr: 0x0B4E, size: 1 },
    { name: 'Lives', addr: 0x85F9, size: 1 },
    { name: 'CharID', addr: 0xB3F7, size: 1 },
    { name: 'Level', addr: 0x84F2, size: 1 },
    { name: 'Cheat_Health', addr: 0xB2E1, size: 1 },
    { name: 'Cheat_Lives', addr: 0xB317, size: 1 },
    { name: 'Continue_flag', addr: 0xB274, size: 1 },
    { name: 'Region_0B4A_10bytes', addr: 0x0B4A, size: 10 },
    { name: 'Region_85F0_10bytes', addr: 0x85F0, size: 10 },
    { name: 'Region_84F0_10bytes', addr: 0x84F0, size: 10 },
  ];

  for (const t of tests) {
    const hex = await read(t.addr, t.size);
    if (!hex) { console.log(`${t.name} (0x${t.addr.toString(16)}): NO RESPONSE`); continue; }
    const bytes = [];
    for (let i=0; i<hex.length; i+=2) bytes.push(parseInt(hex.substring(i,i+2),16));
    console.log(`${t.name} (0x${t.addr.toString(16)}): [${bytes.join(', ')}]`);
  }
  s.close();
  console.log('Done.');
}
main();
