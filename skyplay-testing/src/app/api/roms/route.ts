import { NextResponse } from "next/server";
import { readdir } from "fs/promises";
import { join } from "path";

/**
 * GET /api/roms
 *
 * Lists all .nes ROM files available in public/roms/.
 * Returns { roms: [{ name, path, size }] }.
 */
export async function GET() {
  try {
    const romsDir = join(process.cwd(), "public", "roms");
    const entries = await readdir(romsDir, { withFileTypes: true });

    const roms = entries
      .filter((e) => e.isFile() && e.name.endsWith(".nes"))
      .map((e) => ({
        name: e.name.replace(/\.nes$/i, ""),
        path: `/roms/${e.name}`,
        size: 0, // size is not available from Dirent; will be determined on fetch
      }));

    return NextResponse.json({ roms });
  } catch {
    // Directory doesn't exist or is empty — return empty list
    return NextResponse.json({ roms: [] });
  }
}
