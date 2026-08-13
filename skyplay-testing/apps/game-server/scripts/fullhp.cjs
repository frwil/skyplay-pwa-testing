const dgram = require('dgram');
function read(sock, addr, size) {
  return new Promise(r => {
    const cmd = Buffer.from('READ_CORE_RAM ' + addr.toString(16) + ' ' + size + '\n');
    let buf = '';
    const t = setTimeout(() => { sock.removeAllListeners('message'); r(null); }, 1500);
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
(async () => {
  const s = dgram.createSocket('udp4');
  const allBytes = new Uint8Array(65536);
  const CHUNK = 256;

  // Phase 1: read all 64KB
  console.log('Phase 1: reading all 64KB RAM...');
  for (let addr = 0; addr < 65536; addr += CHUNK) {
    const hex = await read(s, addr, CHUNK);
    if (hex) {
      for (let i = 0; i < hex.length; i += 2) {
        allBytes[addr + i/2] = parseInt(hex.substring(i, i+2), 16);
      }
    }
    if (addr % 4096 === 0) process.stdout.write('\r  ' + (addr/65536*100).toFixed(0) + '%');
  }
  console.log('\r  100% — Full RAM read.');

  // Phase 2: find health candidates (80-150)
  const candidates = [];
  for (let i = 0; i < 65536; i++) {
    if (allBytes[i] >= 80 && allBytes[i] <= 150) candidates.push(i);
  }
  console.log('Phase 2: ' + candidates.length + ' health candidates found.');

  // Phase 3: monitor all candidates for drops
  console.log('Phase 3: monitoring for drops (45s)...');
  console.log('TAKE DAMAGE NOW!');
  const start = Date.now();
  const DUR = 45000;
  let prev = new Map();
  const confirmed = new Map(); // addr -> {drops: [{from,to,delta}], times: []}

  while (Date.now() - start < DUR) {
    // Read in batches of 16 candidates at a time
    for (let i = 0; i < candidates.length; i += 16) {
      const batch = candidates.slice(i, i+16);
      for (const addr of batch) {
        const hex = await read(s, addr, 1);
        if (!hex) continue;
        const val = parseInt(hex, 16);
        if (prev.has(addr) && prev.get(addr) > val) {
          const from = prev.get(addr);
          const delta = from - val;
          if (!confirmed.has(addr)) confirmed.set(addr, []);
          confirmed.get(addr).push({from, to: val, delta, t: ((Date.now()-start)/1000).toFixed(1)});
        }
        prev.set(addr, val);
      }
      await new Promise(r => setTimeout(r, 30));
    }
  }

  // Phase 4: report
  console.log('\n=== RESULTS: Addresses that DECREASED ===');
  if (confirmed.size === 0) {
    console.log('NO drops detected. Did you take damage?');
  } else {
    const sorted = [...confirmed.entries()].sort((a,b) => b[1].length - a[1].length);
    for (const [addr, drops] of sorted) {
      console.log('0x'+addr.toString(16).padStart(4,'0')+': ' + drops.length + ' drops — ' +
        drops.map(d => d.from+'->'+d.to+'(-'+d.delta+')@'+d.t+'s').join(', '));
    }
  }
  s.close();
})();
