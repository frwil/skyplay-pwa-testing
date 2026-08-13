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
function hexToBytes(h) { if(!h) return []; const b=[]; for(let i=0;i<h.length;i+=2) b.push(parseInt(h.substring(i,i+2),16)); return b; }

(async () => {
  // Take baseline snapshots of multiple regions
  const regions = [
    {a:0x0B00, s:256}, {a:0x0D00, s:256}, {a:0x0E00, s:256},
    {a:0xB200, s:256}, {a:0xB400, s:256}, {a:0x8000, s:256},
  ];
  const before = {};
  for (const r of regions) {
    before[r.a] = hexToBytes(await read(r.a, r.s));
  }
  console.log('BASELINE TAKEN — TAKE DAMAGE NOW');
  await new Promise(r => setTimeout(r, 5000));
  console.log('READING AFTER DAMAGE...');

  // Read after damage and compare
  const changed = [];
  for (const r of regions) {
    const after = hexToBytes(await read(r.a, r.s));
    for (let i = 0; i < after.length; i++) {
      if (before[r.a][i] !== after[i]) {
        const addr = r.a + i;
        const diff = before[r.a][i] - after[i];
        if (diff > 0 && before[r.a][i] >= 50 && before[r.a][i] <= 150) {
          changed.push({addr: addr.toString(16).padStart(4,'0'), before: before[r.a][i], after: after[i], diff});
        }
      }
    }
  }
  changed.sort((a,b) => b.diff - a.diff);
  console.log('Decreased (in 50-150 range, likely health):');
  for (const c of changed) console.log('0x'+c.addr + ': ' + c.before + ' -> ' + c.after + ' (-' + c.diff + ')');

  // Also show ANY changed bytes
  console.log('\nAll changed bytes:');
  for (const r of regions) {
    const after = hexToBytes(await read(r.a, r.s));
    for (let i = 0; i < after.length; i++) {
      if (before[r.a][i] !== after[i]) {
        console.log('0x'+(r.a+i).toString(16).padStart(4,'0')+': '+before[r.a][i]+' -> '+after[i]);
      }
    }
  }
  s.close();
})();
