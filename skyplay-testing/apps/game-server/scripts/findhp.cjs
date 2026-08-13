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
function hexToBytes(h) {
  if (!h) return [];
  const b = [];
  for (let i = 0; i < h.length; i += 2) b.push(parseInt(h.substring(i,i+2),16));
  return b;
}
(async () => {
  // Read broad regions to find values near 144 (CPS1 max health)
  const regions = [
    { a: 0x0B40, s: 64, name: '0B40' },
    { a: 0x0D00, s: 64, name: '0D00' },
    { a: 0x0E00, s: 64, name: '0E00' },
    { a: 0x8000, s: 64, name: '8000' },
    { a: 0xB2D0, s: 64, name: 'B2D0' },
    { a: 0xB460, s: 64, name: 'B460' },
    { a: 0x8400, s: 64, name: '8400' },
  ];
  for (const r of regions) {
    const hex = await read(r.a, r.s);
    const bytes = hexToBytes(hex);
    // Find any byte >= 100 (near 144 max)
    const high = [];
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] >= 80 && bytes[i] <= 160) high.push({off: (r.a+i).toString(16), val: bytes[i]});
    }
    console.log(r.name + ' high(80-160):', high.map(h => h.off + '=' + h.val).join(' '));
  }
  s.close();
})();
