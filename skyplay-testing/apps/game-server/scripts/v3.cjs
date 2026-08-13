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
function b2i(hex) { return hex ? parseInt(hex,16) : 'N/A'; }
async function main() {
  let h;
  console.log('=== HEALTH ===');
  h = await read(0x0B4A, 1); console.log('0x0B4A Health P1: ' + b2i(h) + ' (damaged=<144)');

  console.log('=== LIVES (expect 1) ===');
  h = await read(0x85F9, 1); console.log('0x85F9: ' + b2i(h));
  h = await read(0x0E27, 1); console.log('0x0E27: ' + b2i(h));
  h = await read(0xB2C0, 1); console.log('0xB2C0: ' + b2i(h));
  h = await read(0x84FF, 1); console.log('0x84FF: ' + b2i(h));

  console.log('=== CHAR ID (Hannah, expect diff from Mustapha=1) ===');
  h = await read(0xB270, 32); console.log('0xB270: ' + h);
  h = await read(0x8630, 32); console.log('0x8630: ' + h);

  console.log('=== LEVEL ===');
  h = await read(0x84F2, 1); console.log('0x84F2: ' + b2i(h));
  h = await read(0x84D9, 1); console.log('0x84D9: ' + b2i(h));

  console.log('=== SCORE (58900 = 0xE614) ===');
  h = await read(0x804C, 6); console.log('0x804C: ' + h);
  console.log('Done.');
  s.close();
}
main();
