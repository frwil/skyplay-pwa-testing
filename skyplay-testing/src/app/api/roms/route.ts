import { NextResponse } from "next/server";
import { readdir } from "fs/promises";
import { join, extname } from "path";
import { detectSystem } from "@/lib/emulator/EmulatorAdapter";
import type { RomEntry, SystemType } from "@/lib/emulator/types";

/**
 * CPS1 ROMs share the .zip extension with NeoGeo, so extension-based detection
 * can't tell them apart. This map overrides the system for known CPS1 titles.
 * Source of truth: duel_games table in Turso (system = 'cps1').
 */
const CPS1_ROMS = new Set<string>([
  "dino.zip",            // Cadillacs and Dinosaurs
  // Future CPS1 games can be added here
]);

/**
 * GET /api/roms
 *
 * Lists all ROM files in public/roms/ with known extensions.
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
        let system: SystemType | null = detectSystem(ext);
        // CPS1 override: these .zip files are CPS1, not NeoGeo
        if (system === "neogeo" && CPS1_ROMS.has(e.name)) {
          system = "cps1";
        }
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
