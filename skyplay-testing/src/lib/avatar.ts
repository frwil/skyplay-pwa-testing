/**
 * Deterministic identicon generator — a GitHub-style 5×5 symmetric pixel avatar rendered
 * as an SVG `data:` URL usable directly as an `<img src>`. No external dependency, and
 * isomorphic (Node `Buffer` on the server, `btoa` in the browser).
 *
 * Same `seed` always yields the same avatar + palette, so a user's generated face is stable
 * across renders and re-seeds. Used to backfill random-but-stable profile photos for players
 * who never uploaded one (see the profile seed in `db.ts`).
 */

/** FNV-1a 32-bit hash → unsigned int. Stable, fast, dependency-free. */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** UTF-8 safe base64 for both Node and the browser. */
function toBase64(str: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(str, "utf8").toString("base64");
  // Browser: encode UTF-8 first so non-ASCII survives btoa.
  return btoa(unescape(encodeURIComponent(str)));
}

/**
 * Build a `data:image/svg+xml;base64,…` identicon for `seed`.
 * `size` is the SVG viewport in px (the image itself is vector, so it scales cleanly).
 */
export function generateIdenticon(seed: string, size = 120): string {
  const h = hashSeed(seed || "?");
  const hue = h % 360;
  const fg = `hsl(${hue}, 62%, 56%)`;
  const bg = `hsl(${(hue + 210) % 360}, 24%, 15%)`;

  const cells = 5;
  const cell = size / cells;
  // Symmetric pattern: decide the left 3 columns from a rolling LCG, mirror to the right.
  let bits = h || 1;
  const nextBit = (): boolean => {
    bits = (Math.imul(bits, 1103515245) + 12345) >>> 0;
    return (bits & 0x40) !== 0;
  };

  let rects = "";
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < 3; x++) {
      if (!nextBit()) continue;
      const ry = (y * cell).toFixed(2);
      rects += `<rect x="${(x * cell).toFixed(2)}" y="${ry}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}"/>`;
      if (x < 2) {
        const mx = ((cells - 1 - x) * cell).toFixed(2);
        rects += `<rect x="${mx}" y="${ry}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}"/>`;
      }
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" fill="${bg}"/>` +
    `<g fill="${fg}">${rects}</g></svg>`;

  return `data:image/svg+xml;base64,${toBase64(svg)}`;
}

/** Deterministically pick one code from `codes` for `seed` (stable per seed). */
export function pickFromSeed<T>(seed: string, list: T[]): T {
  return list[hashSeed(`${seed}#pick`) % list.length];
}
