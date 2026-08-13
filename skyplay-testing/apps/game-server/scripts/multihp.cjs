const dgram = require('dgram');
const sock = dgram.createSocket('udp4');

function read(addr, size) {
  return new Promise(r => {
    const cmd = Buffer.from('READ_CORE_RAM ' + addr.toString(16) + ' ' + size + '\n');
    let buf = '';
    const t = setTimeout(() => { sock.removeAllListeners('message'); r(null); }, 800);
    const handler = m => {
      buf += m.toString();
      const parts = buf.trim().split(/\s+/);
      if (parts[0]==='READ_CORE_RAM' && parseInt(parts[1],16)===addr) {
        clearTimeout(t); sock.removeListener('message', handler);
        r(parts.slice(2).join(''));
      }
    };
    sock.on('message', handler);
    sock.send(cmd, 55355, '127.0.0.1');
  });
}

// Scan for bytes 80-160 across multiple regions simultaneously
const REGIONS = [
  {a:0x0B00, s:192}, {a:0x0D00, s:192}, {a:0x0E00, s:192},
  {a:0x8000, s:192}, {a:0xB200, s:192}, {a:0xB400, s:192},
  {a:0x8400, s:192}, {a:0x8600, s:192},
];

(async () => {
  // Phase 1: find all high-value bytes in parallel
  console.log('Scanning for health candidates (80-160)...');
  const candidates = [];
  for (const r of REGIONS) {
    const hex = await read(r.a, r.s);
    if (!hex) { console.log('FAIL: 0x'+r.a.toString(16)); continue; }
    for (let i = 0; i < hex.length; i += 2) {
      const b = parseInt(hex.substring(i,i+2), 16);
      if (b >= 80 && b <= 160) {
        candidates.push({addr: r.a + i/2, val: b});
      }
    }
  }
  console.log('Found ' + candidates.length + ' candidates across ' + REGIONS.length + ' regions.');
  if (candidates.length === 0) { console.log('Weird — reading a few raw values:'); console.log('0B4A:', await read(0x0B4A, 1)); console.log('802B:', await read(0x802B, 1)); sock.close(); return; }

  // Show top candidates
  candidates.sort((a,b) => b.val - a.val);
  console.log('Top candidates: ' + candidates.slice(0, 15).map(c => '0x'+c.addr.toString(16)+'='+c.val).join(', '));

  // Phase 2: rapid poll just these addresses
  console.log('\nRapid monitoring (300ms cycle, 40s)... TAKE DAMAGE!');
  const start = Date.now();
  const prev = new Map();
  const drops = [];

  while (Date.now() - start < 40000) {
    // Read all candidates as fast as possible
    for (const c of candidates) {
      const hex = await read(c.addr, 1);
      if (!hex) continue;
      const val = parseInt(hex, 16);
      if (prev.has(c.addr) && prev.get(c.addr) > val) {
        const from = prev.get(c.addr);
        drops.push({addr: c.addr, from, to: val, delta: from-val});
      }
      prev.set(c.addr, val);
    }
  }

  if (drops.length === 0) {
    console.log('\nNO drops detected. Values stayed constant or increased.');
    // Show final values
    const final = [];
    for (const c of candidates) {
      const hex = await read(c.addr, 1);
      if (hex) final.push({addr: c.addr, val: parseInt(hex,16)});
    }
    console.log('Final values: ' + final.map(f => '0x'+f.addr.toString(16)+'='+f.val).join(', '));
  } else {
    console.log('\n!!! DROPS DETECTED !!!');
    const grouped = {};
    for (const d of drops) {
      const k = '0x'+d.addr.toString(16).padStart(4,'0');
      if (!grouped[k]) grouped[k] = [];
      grouped[k].push(d.from+'->'+d.to+'(-'+d.delta+')');
    }
    for (const [addr, events] of Object.entries(grouped)) {
      console.log(addr + ': ' + events.join(', '));
    }
  }
  sock.close();
})();
