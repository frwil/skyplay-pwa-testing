const sharp = require('sharp');

async function main() {
  const { data, info } = await sharp('D:/Skyplay/skyplay-testing/apps/game-server/debug-frame-1.png')
    .raw().toBuffer({ resolveWithObject: true });
  const { width } = info;

  const candidates = [
    { name: 'ZONE 1 - Bas centre (score?)', x: 420, y: 575, w: 120, h: 30 },
    { name: 'ZONE 2 - Bas droite (score?)', x: 900, y: 575, w: 120, h: 30 },
    { name: 'ZONE 3 - Haut droite (~391)', x: 370, y: 0, w: 100, h: 25 },
    { name: 'ZONE 4 - Barre du haut complète', x: 0, y: 0, w: 1152, h: 25 },
    { name: 'ZONE 5 - Bas complet (HUD)', x: 300, y: 575, w: 550, h: 40 },
    { name: 'ZONE 6 - Droite milieu (x700-800 y0-60)', x: 700, y: 0, w: 100, h: 60 },
  ];

  for (const zone of candidates) {
    console.log('\n' + '='.repeat(80));
    console.log(zone.name + '  (' + zone.x + ',' + zone.y + ' ' + zone.w + 'x' + zone.h + ')');
    console.log('='.repeat(80));

    for (let y = zone.y; y < zone.y + zone.h; y++) {
      let line = '';
      for (let x = zone.x; x < zone.x + zone.w; x++) {
        const off = (y * width + x) * 3;
        const r = data[off], g = data[off+1], b = data[off+2];

        // Color-coded characters
        if (r === 0 && g === 0 && b === 0) line += ' ';        // black
        else if (r === 51 && g === 153 && b === 34) line += '▒'; // green bg
        else if (b > r + 40 && b > g + 40) line += '█';        // intense blue
        else if (b > r + 20 && b > g + 20) line += '▓';        // medium blue
        else if (b > r && b > g) line += '░';                   // slight blue
        else if (r > g + 40 && r > b + 40) line += 'R';         // intense red
        else if (r > g && r > b) line += 'r';                    // red-ish
        else if (r > 200 && g > 200 && b > 200) line += '#';    // white
        else if (g > r && g > b) line += 'g';                    // green-ish (not bg)
        else line += '·';                                        // other
      }
      console.log(line);
    }
  }
}
main().catch(e => console.error(e));
