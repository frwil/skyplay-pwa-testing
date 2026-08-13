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
        clearTimeout(t); s.removeAllListeners('message');
        r(parts.slice(2).join(''));
      }
    });
    s.send(cmd, 55355, '127.0.0.1');
  });
}
function b2i(h) { return h ? parseInt(h,16) : 'N/A'; }
(async () => {
  let h;
  console.log('Health 0x0B4A:', b2i(await read(0x0B4A, 1)), '(damaged < 144)');
  console.log('0x85F9:', b2i(await read(0x85F9, 1)));
  console.log('0xB2C0:', b2i(await read(0xB2C0, 1)));
  console.log('Level 0x84F2:', b2i(await read(0x84F2, 1)));
  // Score 10100 = 0x2774
  h = await read(0x804C, 8); console.log('Score@804C:', h);
  h = await read(0xB270, 48); console.log('B270:', h);
  s.close();
})();
