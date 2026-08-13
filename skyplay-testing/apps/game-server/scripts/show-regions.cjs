const sharp = require('sharp');

async function main() {
  const { data, info } = await sharp('D:/Skyplay/skyplay-testing/apps/game-server/debug-frame-1.png')
    .raw().toBuffer({ resolveWithObject: true });
  const { width } = info;
  console.log('Frame: ' + info.width + 'x' + info.height);

  // Show top bar regions as ASCII
  const regions = [
    { name: 'A (350-400)', x: 350, y: 0, w: 50, h: 18 },
    { name: 'B (400-450)', x: 400, y: 0, w: 50, h: 18 },
    { name: 'C (450-500)', x: 450, y: 0, w: 50, h: 18 },
    { name: 'D (500-550)', x: 500, y: 0, w: 50, h: 18 },
    { name: 'E (850-900)', x: 850, y: 0, w: 50, h: 18 },
    { name: 'F (900-950)', x: 900, y: 0, w: 50, h: 18 },
    { name: 'G (950-1010)', x: 950, y: 0, w: 60, h: 18 },
    { name: 'H (850-950 y0-30)', x: 850, y: 0, w: 100, h: 30 },
  ];

  for (const reg of regions) {
    console.log('\n=== Zone ' + reg.name + ' ===');
    for (let y = reg.y; y < reg.y + reg.h; y += 2) {
      let line = '';
      for (let x = reg.x; x < reg.x + reg.w; x += 2) {
        const off = (y * width + x) * 3;
        const r = data[off], g = data[off+1], b = data[off+2];
        const lum = (r + g + b) / 3;
        if (lum < 30) line += ' ';
        else if (lum < 80) line += '.';
        else if (lum < 120) line += ':';
        else if (lum < 160) line += 'o';
        else if (lum < 200) line += 'O';
        else line += '#';
      }
      console.log(line);
    }
  }
}
main().catch(e => console.error(e));
