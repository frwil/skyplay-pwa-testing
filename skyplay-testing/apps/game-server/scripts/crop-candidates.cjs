const sharp = require('sharp');
const path = require('path');

async function main() {
  const framePath = 'D:/Skyplay/skyplay-testing/apps/game-server/debug-frame-1.png';
  const outDir = 'D:/Skyplay/skyplay-testing/apps/game-server/candidates';
  require('fs').mkdirSync(outDir, { recursive: true });

  // Candidate score areas in the top bar (y=0 confirmed by user)
  const candidates = [
    { name: 'A-top-left',      x: 0,   y: 0, w: 200, h: 25 },
    { name: 'B-top-mid-left',  x: 200, y: 0, w: 200, h: 25 },
    { name: 'C-top-center',    x: 380, y: 0, w: 200, h: 25 },
    { name: 'D-top-mid-right', x: 580, y: 0, w: 200, h: 25 },
    { name: 'E-top-right1',    x: 780, y: 0, w: 200, h: 25 },
    { name: 'F-top-right2',    x: 950, y: 0, w: 202, h: 25 },
    { name: 'G-current-391',   x: 380, y: 0, w: 70,  h: 25 },
    { name: 'H-credit-area',   x: 340, y: 0, w: 110, h: 25 },
    // Also check slightly below top bar in case score is at y=2-5
    { name: 'I-below-bar-1',   x: 500, y: 20, w: 300, h: 30 },
    { name: 'J-below-bar-2',   x: 800, y: 20, w: 300, h: 30 },
  ];

  for (const c of candidates) {
    const outPath = path.join(outDir, c.name + '.png');
    await sharp(framePath)
      .extract({ left: c.x, top: c.y, width: c.w, height: c.h })
      .resize(c.w * 3, c.h * 3, { kernel: 'nearest' }) // 3x zoom, no interpolation
      .toFile(outPath);
    console.log('Created: ' + outPath + ' (' + c.w + 'x' + c.h + ' -> ' + (c.w*3) + 'x' + (c.h*3) + ')');
  }

  // Also create a contrast-enhanced version of each to reveal faint text
  console.log('');
  console.log('Creating contrast-enhanced versions...');
  for (const c of candidates) {
    const { data, info: meta } = await sharp(framePath)
      .extract({ left: c.x, top: c.y, width: c.w, height: c.h })
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Stretch contrast: anything not pure green (51,153,34) or black gets boosted
    const refR = 51, refG = 153, refB = 34;
    const boosted = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i += 3) {
      const r = data[i], g = data[i+1], b = data[i+2];
      const isGreen = r === refR && g === refG && b === refB;
      const isBlack = r === 0 && g === 0 && b === 0;
      if (!isGreen && !isBlack) {
        // Boost non-background pixels to make them visible
        boosted[i] = 255;
        boosted[i+1] = 255;
        boosted[i+2] = 0; // yellow for visibility
      } else {
        boosted[i] = r;
        boosted[i+1] = g;
        boosted[i+2] = b;
      }
    }

    const outPath = path.join(outDir, c.name + '-boost.png');
    await sharp(boosted, { raw: { width: c.w, height: c.h, channels: 3 } })
      .resize(c.w * 3, c.h * 3, { kernel: 'nearest' })
      .toFile(outPath);
    console.log('Created: ' + outPath);
  }
}
main().catch(e => console.error(e));
