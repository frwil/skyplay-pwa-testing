import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

/**
 * Binary text template for matching against text overlay frames.
 * Stored as packed rows of uint32 for fast XOR comparison.
 */
export interface TextTemplate {
  /** Display name, e.g. "FIGHT!", "ROUND 1", "KO" */
  name: string;
  /** Binarized bitmap: array of rows, each row is N uint32 values. */
  rows: Uint32Array[];
  /** Template width in pixels. */
  w: number;
  /** Template height in pixels. */
  h: number;
  /** Bright-pixel count in this template (for overlap scoring). */
  brightPixels: number;
}

/**
 * Template-based text overlay identifier.
 *
 * When the TextEventDetector fires (bright-pixel spike detected), the
 * TemplateMatcher compares the captured frame against pre-loaded templates
 * (binarized at the same threshold) to identify WHICH text appeared —
 * FIGHT!, ROUND X, KO, PERFECT, TIME OVER, or DRAW GAME.
 *
 * Matching uses simple pixel overlap: count bright pixels that appear in
 * both the frame and the template, normalized by the template's total
 * bright count. A score >= 0.60 (60% overlap) is considered a match.
 *
 * Templates are loaded as PNG files from /recordings/text-templates/,
 * named after the text type (e.g. "fight.png", "round-1.png", "ko.png").
 */
export class TemplateMatcher {
  private templates: TextTemplate[] = [];
  private readonly threshold: number; // 0-255
  private readonly minOverlap: number; // 0-1

  constructor(
    threshold: number = 180,
    minOverlap: number = 0.60,
  ) {
    this.threshold = threshold;
    this.minOverlap = minOverlap;
  }

  /** Load a PNG template from disk and register it under the given name. */
  loadTemplate(name: string, pngPath: string): boolean {
    try {
      const raw = this.pngToRaw(pngPath);
      if (!raw) return false;
      const { w, h, bitmap } = this.binarizeRaw(raw);
      const rows = this.packRows(bitmap, w, h);
      const brightPixels = rows.reduce((sum, row) => {
        for (let i = 0; i < row.length; i++) sum += this.popcount(row[i]);
        return sum;
      }, 0);
      this.templates.push({ name, rows, w, h, brightPixels });
      console.log(`[template-matcher] ✅ Loaded "${name}": ${w}x${h}, ${brightPixels} bright pixels`);
      return true;
    } catch (e) {
      console.log(`[template-matcher] ❌ Failed to load "${name}" from ${pngPath}: ${(e as Error).message}`);
      return false;
    }
  }

  /** Load all PNG templates from the templates directory. */
  loadAllFromDir(dir: string = "/recordings/text-templates"): number {
    if (!existsSync(dir)) {
      console.log(`[template-matcher] No template directory: ${dir}`);
      return 0;
    }
    let loaded = 0;
    try {
      const files = readdirSync(dir);
      for (const f of files) {
        if (!f.toLowerCase().endsWith(".png")) continue;
        const name = f.replace(/\.png$/i, "").replace(/-/g, " ").toUpperCase();
        const fullPath = join(dir, f);
        if (this.loadTemplate(name, fullPath)) loaded++;
      }
    } catch (e) {
      console.log(`[template-matcher] Error reading template dir: ${(e as Error).message}`);
    }
    console.log(`[template-matcher] Loaded ${loaded} templates from ${dir}`);
    return loaded;
  }

  /**
   * Identify which template best matches the given raw RGB24 frame.
   * Returns the template name and confidence (0-1), or null if no match.
   */
  identify(frame: Buffer, w: number, h: number): { name: string; confidence: number } | null {
    if (this.templates.length === 0) return null;

    // Binarize the incoming frame
    const { bitmap: frameBitmap } = this.binarizeRaw({ data: frame, w, h });
    const frameRows = this.packRows(frameBitmap, w, h);

    let bestName = "";
    let bestScore = 0;

    for (const tmpl of this.templates) {
      // Slide the template across the frame, find best overlap position
      const score = this.bestOverlap(frameRows, w, h, tmpl);
      if (score > bestScore) {
        bestScore = score;
        bestName = tmpl.name;
      }
    }

    if (bestScore >= this.minOverlap) {
      return { name: bestName, confidence: bestScore };
    }
    return null; // no reliable match
  }

  /** Check if any templates are loaded. */
  hasTemplates(): boolean {
    return this.templates.length > 0;
  }

  // ── Internal helpers ─────────────────────────────────────────────

  /** Compute best overlap score between frame and template via sliding window.
   *  Score = overlapping bright pixels / template bright pixels. */
  private bestOverlap(
    frameRows: Uint32Array[],
    fw: number, fh: number,
    tmpl: TextTemplate,
  ): number {
    // If template is smaller than frame, slide within the frame
    const maxDX = Math.max(0, fw - tmpl.w);
    const maxDY = Math.max(0, fh - tmpl.h);
    // If template is larger, scale it down (or just pad the frame)
    // For now, assume template fits within the frame crop
    if (maxDX < 0 || maxDY < 0) {
      // Template is larger than frame — compare at origin only
      return this.overlapAt(frameRows, fw, fh, tmpl, 0, 0);
    }

    // Sample several positions (center, offset) for performance
    // Full sliding-window search is O(w*h*W*H) which is too slow at 60fps
    const positions: Array<[number, number]> = [];
    // Center position
    positions.push([Math.floor(maxDX / 2), Math.floor(maxDY / 2)]);
    // Quarter positions
    if (maxDX > 4) {
      positions.push([Math.floor(maxDX / 4), Math.floor(maxDY / 4)]);
      positions.push([Math.floor(3 * maxDX / 4), Math.floor(maxDY / 4)]);
      positions.push([Math.floor(maxDX / 4), Math.floor(3 * maxDY / 4)]);
      positions.push([Math.floor(3 * maxDX / 4), Math.floor(3 * maxDY / 4)]);
    }

    let best = 0;
    for (const [dx, dy] of positions) {
      const s = this.overlapAt(frameRows, fw, fh, tmpl, dx, dy);
      if (s > best) best = s;
    }
    return best;
  }

  /** Compute overlap at a specific (dx, dy) offset. */
  private overlapAt(
    frameRows: Uint32Array[],
    fw: number, fh: number,
    tmpl: TextTemplate,
    dx: number, dy: number,
  ): number {
    // Only compare the overlapping region
    const ow = Math.min(fw - dx, tmpl.w);
    const oh = Math.min(fh - dy, tmpl.h);
    if (ow <= 0 || oh <= 0) return 0;

    let matchCount = 0;
    let totalBright = 0;

    for (let ty = 0; ty < oh; ty++) {
      const tmplRow = tmpl.rows[ty];
      // Get frame row bits at the right offset
      const frameRowBits = this.extractRowBits(frameRows, dy + ty, dx, ow);
      // Count overlapping bright pixels (AND)
      const overlap = this.andCount(frameRowBits, tmplRow, Math.min(ow, 32));
      matchCount += overlap;
      // Count template bright pixels in this row
      for (let i = 0; i < Math.ceil(ow / 32); i++) {
        const mask = (i * 32 + 32 <= ow) ? 0xFFFFFFFF : (1 << (ow % 32)) - 1;
        totalBright += this.popcount(tmplRow[i] & mask);
      }
    }

    if (totalBright === 0) return 0;
    return matchCount / totalBright;
  }

  /** Extract a row of bits from packed frame rows, shifted by dx. */
  private extractRowBits(frameRows: Uint32Array[], row: number, dx: number, w: number): Uint32Array {
    if (row < 0 || row >= frameRows.length) return new Uint32Array(Math.ceil(w / 32));
    const src = frameRows[row];
    const out = new Uint32Array(Math.ceil(w / 32));
    const shift = dx % 32;
    const wordOffset = Math.floor(dx / 32);
    for (let i = 0; i < out.length && (i + wordOffset) < src.length; i++) {
      let val = src[i + wordOffset] >>> shift;
      if (shift > 0 && (i + wordOffset + 1) < src.length) {
        val |= src[i + wordOffset + 1] << (32 - shift);
      }
      out[i] = val;
    }
    return out;
  }

  /** Count overlapping 1-bits between two uint32 arrays. */
  private andCount(a: Uint32Array, b: Uint32Array, words: number): number {
    let count = 0;
    const n = Math.min(words, a.length, b.length);
    for (let i = 0; i < n; i++) {
      count += this.popcount(a[i] & b[i]);
    }
    return count;
  }

  /** Convert raw RGB24 pixel data to a 1-bit/pixel bitmap using the configured threshold.
   *  Uses the same max-channel logic as TextEventDetector.countBrightPixels(). */
  private binarizeRaw(raw: { data: Buffer; w: number; h: number }): { w: number; h: number; bitmap: Uint8Array } {
    const { data, w, h } = raw;
    const total = w * h;
    const bitmap = new Uint8Array(total);
    const thresh = this.threshold;

    for (let i = 0; i < total; i++) {
      const r = data[i * 3];
      const g = data[i * 3 + 1];
      const b = data[i * 3 + 2];
      bitmap[i] = (r > thresh || g > thresh || b > thresh) ? 1 : 0;
    }
    return { w, h, bitmap };
  }

  /** Pack a 1-byte-per-pixel bitmap into uint32 rows. */
  private packRows(bitmap: Uint8Array, w: number, h: number): Uint32Array[] {
    const rows: Uint32Array[] = [];
    const wordsPerRow = Math.ceil(w / 32);
    for (let y = 0; y < h; y++) {
      const row = new Uint32Array(wordsPerRow);
      for (let x = 0; x < w; x++) {
        if (bitmap[y * w + x]) {
          const wordIdx = Math.floor(x / 32);
          const bitIdx = x % 32;
          row[wordIdx] |= (1 << bitIdx);
        }
      }
      rows.push(row);
    }
    return rows;
  }

  /** Read a PNG file and return raw RGBA pixels as RGB24. */
  private pngToRaw(pngPath: string): { data: Buffer; w: number; h: number } | null {
    try {
      // Read PNG and extract raw pixels via ImageMagick (available in container)
      const { execSync } = require("child_process");
      // Convert to PPM (raw RGB24) format, which we can parse directly
      const ppm = execSync(`convert "${pngPath}" -depth 8 ppm:-`, { timeout: 5000, maxBuffer: 50 * 1024 * 1024 });
      return this.parsePPM(ppm);
    } catch (e) {
      console.log(`[template-matcher] Failed to convert PNG: ${(e as Error).message}`);
      return null;
    }
  }

  /** Parse a raw PPM (P6) buffer into { data, w, h }. */
  private parsePPM(ppm: Buffer): { data: Buffer; w: number; h: number } | null {
    try {
      // Find end of header (after maxval)
      let pos = 0;
      const readToken = (): string => {
        // Skip whitespace and comments
        while (pos < ppm.length) {
          const c = ppm[pos];
          if (c === 35) { // '#'
            while (pos < ppm.length && ppm[pos] !== 10) pos++;
            continue;
          }
          if (c === 32 || c === 10 || c === 13 || c === 9) { pos++; continue; }
          break;
        }
        const start = pos;
        while (pos < ppm.length && ppm[pos] !== 32 && ppm[pos] !== 10 && ppm[pos] !== 13 && ppm[pos] !== 9) pos++;
        return ppm.subarray(start, pos).toString();
      };

      const magic = readToken();
      if (magic !== "P6") return null;
      const w = parseInt(readToken(), 10);
      const h = parseInt(readToken(), 10);
      const maxval = parseInt(readToken(), 10);
      if (isNaN(w) || isNaN(h) || isNaN(maxval)) return null;

      // Skip the single whitespace character after maxval
      pos++;
      const data = ppm.subarray(pos, pos + w * h * 3);
      // If maxval > 255, we need to convert 16-bit to 8-bit
      if (maxval > 255) {
        const scaled = Buffer.alloc(w * h * 3);
        for (let i = 0; i < w * h * 3; i++) {
          scaled[i] = Math.round((data[i * 2] * 256 + data[i * 2 + 1]) / 257);
        }
        return { data: scaled, w, h };
      }
      return { data: Buffer.from(data), w, h };
    } catch {
      return null;
    }
  }

  /** Count set bits in a uint32 (popcount). */
  private popcount(n: number): number {
    n = n - ((n >>> 1) & 0x55555555);
    n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
    return (((n + (n >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
  }
}
