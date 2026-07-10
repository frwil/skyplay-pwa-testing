import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAuthFromRequest } from "@/lib/auth";

/** Max stored avatar size (base64 data URL). The client compresses to well under this. */
const MAX_AVATAR_CHARS = 300_000; // ~220 KB decoded

/** ISO-3166 alpha-2 (two letters) or empty to clear. */
function normalizeCountry(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const c = input.trim().toUpperCase();
  if (c === "") return null;
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

/** GET /api/profile — the caller's profile (username, avatar, country). */
export async function GET(req: NextRequest) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return NextResponse.json({ error: "Authentification requise" }, { status: 401 });

  const db = await getDb();
  const rs = await db.execute({
    sql: "SELECT id, username, role, avatar_base64, country FROM users WHERE id = ?",
    args: [auth.userId],
  });
  if (rs.rows.length === 0) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
  const r = rs.rows[0];
  return NextResponse.json({
    profile: {
      id: Number(r.id),
      username: (r.username as string) ?? "",
      role: (r.role as string) ?? "user",
      avatar: (r.avatar_base64 as string) ?? null,
      country: (r.country as string) ?? null,
    },
  });
}

/**
 * POST /api/profile { avatar?, country? }
 * Update the caller's avatar (base64 data URL, or null/"" to clear) and/or country (ISO alpha-2).
 * Only the provided fields are touched.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthFromRequest(req);
    if (!auth) return NextResponse.json({ error: "Authentification requise" }, { status: 401 });

    const body = (await req.json()) as { avatar?: string | null; country?: string | null };
    const sets: string[] = [];
    const args: (string | number | null)[] = [];

    if ("avatar" in body) {
      const avatar = body.avatar;
      if (avatar && typeof avatar === "string") {
        if (!avatar.startsWith("data:image/")) {
          return NextResponse.json({ error: "Format d'image invalide" }, { status: 400 });
        }
        if (avatar.length > MAX_AVATAR_CHARS) {
          return NextResponse.json({ error: "Image trop volumineuse" }, { status: 413 });
        }
        sets.push("avatar_base64 = ?");
        args.push(avatar);
      } else {
        sets.push("avatar_base64 = NULL");
      }
    }

    if ("country" in body) {
      const country = normalizeCountry(body.country);
      if (country) { sets.push("country = ?"); args.push(country); }
      else { sets.push("country = NULL"); }
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: "Rien à mettre à jour" }, { status: 400 });
    }

    const db = await getDb();
    args.push(auth.userId);
    await db.execute({ sql: `UPDATE users SET ${sets.join(", ")} WHERE id = ?`, args });

    const rs = await db.execute({
      sql: "SELECT id, username, role, avatar_base64, country FROM users WHERE id = ?",
      args: [auth.userId],
    });
    const r = rs.rows[0];
    return NextResponse.json({
      success: true,
      profile: {
        id: Number(r.id),
        username: (r.username as string) ?? "",
        role: (r.role as string) ?? "user",
        avatar: (r.avatar_base64 as string) ?? null,
        country: (r.country as string) ?? null,
      },
    });
  } catch (error) {
    console.error("POST /api/profile error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}
