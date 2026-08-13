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
  const DUR = 35000;
  const start = Date.now();
  console.log('t(s)\t0B4A\t802B\t802D\tB2C0');
  let last = {};
  while (Date.now() - start < DUR) {
    const a = b2i(await read(s, 0x0B4A, 1));
    const b = b2i(await read(s, 0x802B, 1));
    const d = b2i(await read(s, 0x802D, 1));
    const c = b2i(await read(s, 0xB2C0, 1));
    const key = a+','+b+','+d+','+c;
    if (key !== last.key) {
      const t = ((Date.now() - start) / 1000).toFixed(1);
      console.log(t + '\t' + a + '\t' + b + '\t' + d + '\t' + c);
      last = {key, a, b, d, c};
    }
    await new Promise(r => setTimeout(r, 350));
  }
  s.close();
  console.log('done.');
})();
