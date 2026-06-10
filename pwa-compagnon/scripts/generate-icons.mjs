// Generate PWA icons for SKY PLAY Compagnon
// Run: node scripts/generate-icons.mjs

import sharp from "sharp";
import { mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");
const iconsDir = join(publicDir, "icons");

mkdirSync(iconsDir, { recursive: true });

const SIZES = [
  { size: 192, name: "icon-192x192.png" },
  { size: 512, name: "icon-512x512.png" },
];

// SKY PLAY brand colors
const BG_DARK = "#070f1e";
const CYAN = "#00c8ff";
const GOLD = "#ffd700";
const PINK = "#FD2E5F";
const PURPLE = "#9b5de5";

async function generateIcon(size, name) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.42;

  // SVG with SKY PLAY branding
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="${size}" y2="${size}">
          <stop offset="0%" stop-color="#0d1b2e"/>
          <stop offset="100%" stop-color="#070f1e"/>
        </linearGradient>
        <linearGradient id="logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${CYAN}"/>
          <stop offset="50%" stop-color="${PURPLE}"/>
          <stop offset="100%" stop-color="${PINK}"/>
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="${size * 0.035}" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>

      <!-- Background rounded square -->
      <rect x="0" y="0" width="${size}" height="${size}" rx="${size * 0.22}" fill="url(#bg)"/>

      <!-- Accent ring -->
      <circle
        cx="${cx}" cy="${cy}" r="${r + 4}"
        fill="none"
        stroke="${CYAN}"
        stroke-width="${size * 0.025}"
        opacity="0.15"
      />

      <!-- Letter S stylized -->
      <text
        x="${cx}"
        y="${cy}"
        text-anchor="middle"
        dominant-baseline="central"
        font-family="Inter, system-ui, sans-serif"
        font-weight="900"
        font-size="${size * 0.5}"
        fill="url(#logo)"
        filter="url(#glow)"
      >S</text>

      <!-- Small accent dot -->
      <circle
        cx="${size * 0.75}" cy="${size * 0.28}" r="${size * 0.06}"
        fill="${GOLD}" opacity="0.9"
      />
    </svg>
  `;

  const outputPath = join(iconsDir, name);
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  console.log(`  ✓ ${name} (${size}×${size})`);
}

async function main() {
  console.log("Generating PWA icons...");
  for (const { size, name } of SIZES) {
    await generateIcon(size, name);
  }
  console.log("Done!");
}

main().catch(console.error);
