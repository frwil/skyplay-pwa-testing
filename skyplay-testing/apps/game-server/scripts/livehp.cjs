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
function toBytes(h) { if(!h) return []; const b=[]; for(let i=0;i<h.length;i+=2) b.push(parseInt(h.substring(i,i+2),16)); return b; }

(async () => {
  const s = dgram.createSocket('udp4');
  const DUR = 60000;
  const start = Date.now();
  let prev = null;
  console.log('Watching 0x0B00-0x0B60 for health drops (60s)...');
  console.log('PLAY NORMALLY — I will auto-detect damage');

  while (Date.now() - start < DUR) {
    const hex = await read(s, 0x0B00, 96);
    if (!hex) { await new Promise(r => setTimeout(r, 100)); continue; }
    const bytes = toBytes(hex);
    if (prev) {
      const drops = [];
      for (let i = 0; i < bytes.length; i++) {
        if (prev[i] > bytes[i] && prev[i] >= 80 && prev[i] <= 150) {
          drops.push({off: (0x0B00+i).toString(16).padStart(4,'0'), from: prev[i], to: bytes[i], drop: prev[i]-bytes[i]});
        }
      }
      if (drops.length) {
        const t = ((Date.now()-start)/1000).toFixed(1);
        console.log('\n!!! DAMAGE DETECTED at ' + t + 's !!!');
        for (const d of drops) console.log('  0x'+d.off + ': ' + d.from + ' -> ' + d.to + ' (-' + d.drop + ')');
      }
    }
    prev = bytes;
    await new Promise(r => setTimeout(r, 200));
  }
  console.log('done.');
  s.close();
})();
