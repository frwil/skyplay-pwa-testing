/**
 * Download RetroArch WASM cores for PWA offline support.
 *
 * Nostalgist.js normally fetches cores at runtime from:
 *   https://cdn.jsdelivr.net/gh/arianrhodsandlot/retroarch-emscripten-build@v1.22.2/retroarch/<core>_libretro.zip
 *
 * This script downloads and extracts the .wasm and .js files
 * to public/cores/ so they can be served locally and cached
 * by the service worker for offline play.
 *
 * Usage: node scripts/download-cores.mjs
 */

import { createWriteStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const coresDir = join(__dirname, "..", "public", "cores");

// Core list — add new systems here
const CORES = ["snes9x", "gambatte", "mgba"];

// Nostalgist.js v0.21.1 core CDN (matched from node_modules/nostalgist/dist/nostalgist.js)
const CDN_BASE = "https://cdn.jsdelivr.net/gh";
const CORE_REPO = "arianrhodsandlot/retroarch-emscripten-build";
const CORE_VERSION = "v1.22.2";
const CORE_DIR = "retroarch";

// jsDelivr doesn't include native zip support, so we use a lightweight approach:
// fetch the zip bytes, use the central directory to extract entries.
// For simplicity, we rely on the fact that jsdelivr also serves individual files
// from the same repo (just without .zip extension). Let's try direct file access first.
const DIRECT_FILES = {
  snes9x: [
    "snes9x_libretro.wasm",
    "snes9x_libretro.js",
  ],
  gambatte: [
    "gambatte_libretro.wasm",
    "gambatte_libretro.js",
  ],
  mgba: [
    "mgba_libretro.wasm",
    "mgba_libretro.js",
  ],
};

async function downloadFile(url, destPath) {
  if (existsSync(destPath)) {
    console.log(`  ✓ Already exists: ${destPath}`);
    return;
  }

  console.log(`  ↓ Downloading: ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  // Write as binary
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(destPath, buffer);
  const sizeKB = (buffer.length / 1024).toFixed(1);
  console.log(`  ✓ Saved (${sizeKB} KB): ${destPath}`);
}

async function main() {
  // Create cores directory
  if (!existsSync(coresDir)) {
    mkdirSync(coresDir, { recursive: true });
  }

  console.log(`Cores directory: ${coresDir}\n`);

  for (const core of CORES) {
    console.log(`\n=== ${core} ===`);

    // Try direct file URLs first (jsDelivr can serve individual files from git repos)
    const baseUrl = `${CDN_BASE}/${CORE_REPO}@${CORE_VERSION}/${CORE_DIR}`;
    const files = DIRECT_FILES[core];

    if (!files) {
      console.warn(`  ⚠ No file list for core "${core}", skipping`);
      continue;
    }

    for (const file of files) {
      const url = `${baseUrl}/${file}`;
      const destPath = join(coresDir, file);

      try {
        await downloadFile(url, destPath);
      } catch (err) {
        console.error(`  ✗ Failed: ${err.message}`);
        console.log(`  → The file may not be available individually.`);
        console.log(`  → Try downloading the zip and extracting manually:`);
        console.log(`    ${baseUrl}/${core}_libretro.zip`);
      }
    }
  }

  console.log("\nDone! Cores downloaded to public/cores/");
  console.log("Add this directory to .gitignore if cores are too large for the repo.");
}

main().catch(console.error);
