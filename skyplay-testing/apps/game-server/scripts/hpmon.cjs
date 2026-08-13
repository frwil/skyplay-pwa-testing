// Robust health monitor — sequential reads, no removeAllListeners
const dgram = require('dgram');

function read(addr, size) {
  return new Promise(r => {
    const sock = dgram.createSocket('udp4');
    const cmd = Buffer.from('READ_CORE_RAM ' + addr.toString(16) + ' ' + size + '\n');
    let buf = '';
    const t = setTimeout(() => { try { sock.close(); } catch{} r(null); }, 1500);
    sock.on('message', m => {
      buf += m.toString();
      const parts = buf.trim().split(/\s+/);
      if (parts[0]==='READ_CORE_RAM' && parseInt(parts[1],16)===addr) {
        clearTimeout(t);
        try { sock.close(); } catch{}
        r(parts.slice(2).join(''));
      }
    });
    sock.send(cmd, 55355, '127.0.0.1');
  });
}
function v(h) { return h ? parseInt(h,16) : -1; }

// Addresses to monitor: health candidates + lives
const ADDRS = [
  {a:0x0B46, n:'B46'}, {a:0x0B48, n:'B48'}, {a:0x0B4A, n:'B4A'},
  {a:0x0B4C, n:'B4C'}, {a:0x0B4E, n:'B4E'},
  {a:0x802B, n:'802B'}, {a:0x802D, n:'802D'}, {a:0x802F, n:'802F'},
  {a:0xB2C0, n:'B2C0'}, {a:0x85F9, n:'85F9'},
];

(async () => {
  console.log('Monitoring ' + ADDRS.length + ' addresses every 400ms for 40s...');
  console.log('TAKE DAMAGE!');
  console.log('t(s)\t' + ADDRS.map(a=>a.n).join('\t'));

  const start = Date.now();
  let prev = {};
  const DUR = 40000;

  while (Date.now() - start < DUR) {
    const vals = {};
    for (const addr of ADDRS) {
      vals[addr.n] = v(await read(addr.a, 1));
    }
    const key = Object.values(vals).join(',');
    if (key !== prev.key) {
      const t = ((Date.now() - start) / 1000).toFixed(1);
      console.log(t + '\t' + ADDRS.map(a=>vals[a.n]).join('\t'));
      prev = {key, ...vals};

      // Auto-detect drops from 140+ range
      for (const a of ADDRS) {
        if (prev[a.n] !== undefined && vals[a.n] < prev[a.n] && prev[a.n] >= 100) {
          console.log('>>> DROP: ' + a.n + ' ' + prev[a.n] + ' -> ' + vals[a.n] + ' (-' + (prev[a.n]-vals[a.n]) + ')');
        }
      }
    }
    await new Promise(r => setTimeout(r, 400));
  }
  console.log('done.');
})();
