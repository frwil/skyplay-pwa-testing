const sharp = require('sharp');

async function main() {
  const { data, info } = await sharp('D:/Skyplay/skyplay-testing/apps/game-server/debug-frame-1.png')
    .raw().toBuffer({ resolveWithObject: true });
  const { width } = info;

  // Reference: gameplay HUD green background
  const REF_R = 51, REF_G = 153, REF_B = 34;

  console.log('Pixel-level scan of top bar (y=0-20) for ANY deviation from green (' + REF_R + ',' + REF_G + ',' + REF_B + '):');
  console.log('');

  let foundAny = false;
  for (let y = 0; y <= 20; y++) {
    for (let x = 0; x < width; x++) {
      const off = (y * width + x) * 3;
      const r = data[off], g = data[off+1], b = data[off+2];
      const dr = Math.abs(r - REF_R);
      const dg = Math.abs(g - REF_G);
      const db = Math.abs(b - REF_B);
      const totalDev = dr + dg + db;

      // Show any pixel that deviates from the green background
      if (totalDev >= 10) {
        if (!foundAny) {
          console.log('Found non-green pixels:');
          foundAny = true;
        }
        console.log('  (' + x + ',' + y + '): RGB=(' + r + ',' + g + ',' + b + ') dev=' + totalDev + ' (dr=' + dr + ' dg=' + dg + ' db=' + db + ')');
        if (x > 1100) break; // limit output
      }
    }
  }

  if (!foundAny) {
    console.log('NO deviation from green found in top bar (y=0-20).');
    console.log('Checking if top bar is truly uniform...');

    // Verify: check if ALL pixels in top bar are exactly (51,153,34)
    let count = 0, match = 0;
    for (let y = 0; y <= 20; y++) {
      for (let x = 0; x < width; x++) {
        const off = (y * width + x) * 3;
        const r = data[off], g = data[off+1], b = data[off+2];
        count++;
        if (r === REF_R && g === REF_G && b === REF_B) match++;
      }
    }
    console.log('Top bar pixels matching exactly (' + REF_R + ',' + REF_G + ',' + REF_B + '): ' + match + '/' + count + ' (' + (match/count*100).toFixed(1) + '%)');

    // Show the actual unique colors in top bar
    const colors = new Map();
    for (let y = 0; y <= 20; y++) {
      for (let x = 0; x < width; x++) {
        const off = (y * width + x) * 3;
        const key = data[off] + ',' + data[off+1] + ',' + data[off+2];
        colors.set(key, (colors.get(key) || 0) + 1);
      }
    }
    console.log('Unique colors in top bar: ' + colors.size);
    const sorted = [...colors.entries()].sort((a, b) => b[1] - a[1]);
    sorted.forEach(([c, n]) => console.log('  ' + c + ': ' + n + ' px'));
  }
}
main().catch(e => console.error(e));
