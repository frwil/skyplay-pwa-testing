import { NextResponse } from "next/server";
import { readdir } from "fs/promises";
import { join, extname } from "path";
import { detectSystem } from "@/lib/emulator/EmulatorAdapter";
import type { RomEntry } from "@/lib/emulator/types";

/**
 * GET /api/roms
 *
 * Lists all ROM files in public/roms/ with known extensions
 * (.nes, .sfc, .smc, .gb, .gbc, .gba).
 * Returns { roms: [{ name, path, size, system }] }.
 */
export async function GET() {
  try {
    const romsDir = join(process.cwd(), "public", "roms");
    const entries = await readdir(romsDir, { withFileTypes: true });

    const roms: RomEntry[] = entries
      .filter((e) => e.isFile())
      .map((e) => {
        const ext = extname(e.name).toLowerCase();
        const system = detectSystem(ext);
        if (!system) return null;
        return {
          name: e.name.replace(/\.[^.]+$/, ""),
          path: `/roms/${e.name}`,
          size: 0,
          system,
        };
      })
      .filter((r): r is RomEntry => r !== null);

    return NextResponse.json({ roms });
  } catch {
    return NextResponse.json({ roms: [] });
  }
}
