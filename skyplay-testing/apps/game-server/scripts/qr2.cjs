const dgram = require('dgram');
const s = dgram.createSocket('udp4');
function read(addr, size) {
  return new Promise(r => {
    const cmd = Buffer.from('READ_CORE_RAM ' + addr.toString(16) + ' ' + size + '\n');
    let buf = '';
    const t = setTimeout(() => { s.removeAllListeners('message'); r(null); }, 1500);
    s.on('message', m => {
      buf += m.toString();
      const parts = buf.trim().split(/\s+/);
      if (parts[0]==='READ_CORE_RAM' && parseInt(parts[1],16)===addr) {
        clearTimeout(t); s.removeAllListeners('message'); r(parts.slice(2).join(''));
      }
    });
    s.send(cmd, 55355, '127.0.0.1');
  });
}
async function main() {
  const tests = [
    { n: 'CharP1_a_0xB277', a: 0xB277, s: 1 },
    { n: 'CharP1_b_0x863A', a: 0x863A, s: 1 },
    { n: 'CharP2_a_0xB3F7', a: 0xB3F7, s: 1 },
    { n: 'CharP2_b_0x8646', a: 0x8646, s: 1 },
    { n: 'Health_0x0B4A', a: 0x0B4A, s: 2 },
    { n: 'Region_B270', a: 0xB270, s: 16 },
    { n: 'Lives_alt_0x0E27', a: 0x0E27, s: 2 },
    { n: 'Lives_vfy_0x85F9', a: 0x85F9, s: 1 },
    { n: 'ScoreSearch_804C', a: 0x804C, s: 6 },
    { n: 'ScoreSearch_8090', a: 0x8090, s: 6 },
  ];
  for (const t of tests) {
    const hex = await read(t.a, t.s);
    if (!hex) { console.log(t.n + ': NO_RESP'); continue; }
    const bytes = [];
    for (let i=0; i<hex.length; i+=2) bytes.push(parseInt(hex.substring(i,i+2),16));
    console.log(t.n + (t.s>1?'':'  ') + ': [' + bytes.join(',') + ']');
  }
  s.close();
  console.log('Done.');
}
main();
