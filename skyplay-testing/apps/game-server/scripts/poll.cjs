const dgram = require('dgram');
function read(sock, addr, size) {
  return new Promise(r => {
    const cmd = Buffer.from('READ_CORE_RAM ' + addr.toString(16) + ' ' + size + '\n');
    let buf = '';
    const t = setTimeout(() => { sock.removeAllListeners('message'); r(null); }, 1000);
    sock.on('message', m => {
      buf += m.toString();
      const parts = buf.trim().split(/\s+/);
      if (parts[0]==='READ_CORE_RAM' && parseInt(parts[1],16)===addr) {
        clearTimeout(t); sock.removeAllListeners('message');
        r(parts.slice(2).join(''));
      }
    });
    sock.send(cmd, 55355, '127.0.0.1');
  });
}
function b2i(h) { return h ? parseInt(h,16) : -1; }
(async () => {
  const s = dgram.createSocket('udp4');
  const DUR = 30000;
  const start = Date.now();
  console.log('t(s)\thealth\t85F9\tB2C0\t84F2');
  let lastH = -1, lastL = -1, lastC = -1, lastLvl = -1;
  while (Date.now() - start < DUR) {
    const h = b2i(await read(s, 0x0B4A, 1));
    const l = b2i(await read(s, 0x85F9, 1));
    const c = b2i(await read(s, 0xB2C0, 1));
    const lvl = b2i(await read(s, 0x84F2, 1));
    if (h !== lastH || l !== lastL || c !== lastC || lvl !== lastLvl) {
      const t = ((Date.now() - start) / 1000).toFixed(1);
      console.log(t + '\t' + h + '\t' + l + '\t' + c + '\t' + lvl);
      lastH = h; lastL = l; lastC = c; lastLvl = lvl;
    }
    await new Promise(r => setTimeout(r, 400));
  }
  s.close();
  console.log('done.');
})();
