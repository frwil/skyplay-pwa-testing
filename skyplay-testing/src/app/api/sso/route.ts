import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getDb } from "@/lib/db";
import { signToken, setAuthCookie } from "@/lib/auth";

/**
 * SSO handoff — point d'entrée depuis la plateforme SKY PLAY (façade publique).
 *
 * La plateforme (API NestJS) forge un JWT court (HS256, 5 min) signé avec le secret
 * PARTAGÉ `EMULATOR_SSO_SECRET` (DISTINCT de `AUTH_SECRET`), transportant l'identité
 * { sub: username, isAdmin }. Ici on vérifie ce jeton, on retrouve/crée l'utilisateur
 * local Turso, on pose notre propre cookie de session (`auth_token`) puis on redirige
 * vers /duel. Le cheat code de la plateforme ne transite JAMAIS ici — seul le jeton le fait.
 *
 * Wallet séparé : un nouvel utilisateur SSO non-admin est crédité de 10000 SKY (une ligne
 * `sky_transactions` kind='seed'), comme les comptes de test. Les admins ont un solde infini.
 */

const STARTER_BALANCE = 10000;

function ssoError(request: NextRequest, reason: string): NextResponse {
  return NextResponse.redirect(new URL(`/login?sso_error=${reason}`, request.url));
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return ssoError(request, "missing");

  const secretRaw = process.env.EMULATOR_SSO_SECRET;
  if (!secretRaw) {
    console.error("SSO: EMULATOR_SSO_SECRET manquant côté émulateur");
    return NextResponse.json({ error: "SSO non configuré" }, { status: 500 });
  }

  // 1. Vérifier le jeton (signature + expiration).
  let username: string;
  let isAdmin: boolean;
  try {
    const secret = new TextEncoder().encode(secretRaw);
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    username = String(payload.sub ?? "").trim().slice(0, 50);
    isAdmin = payload.isAdmin === true;
    if (!username) return ssoError(request, "invalid");
  } catch {
    return ssoError(request, "expired");
  }

  try {
    const db = await getDb();

    // Identité stable = email namespacé (évite toute collision avec les comptes PIN).
    const platformEmail = `${username.toLowerCase()}@platform.sso`;
    const role = isAdmin ? "admin" : "user";

    // 2. Retrouver l'utilisateur SSO existant par email.
    const existing = await db.execute({
      sql: "SELECT id, role FROM users WHERE email = ? LIMIT 1",
      args: [platformEmail],
    });

    let userId: number;
    if (existing.rows.length > 0) {
      userId = Number(existing.rows[0].id);
      // Synchroniser le rôle avec la plateforme (promotion / rétrogradation).
      if ((existing.rows[0].role as string) !== role) {
        await db.execute({ sql: "UPDATE users SET role = ? WHERE id = ?", args: [role, userId] });
      }
    } else {
      // 3. Créer le compte local. Username plateforme brut, suffixé seulement en cas de collision.
      let uname = username;
      const clash = await db.execute({
        sql: "SELECT id FROM users WHERE username = ? LIMIT 1",
        args: [uname],
      });
      if (clash.rows.length > 0) {
        uname = `${username.slice(0, 44)}-${Math.floor(1000 + Math.random() * 9000)}`;
      }

      const inserted = await db.execute({
        sql: "INSERT INTO users (username, email, role) VALUES (?, ?, ?)",
        args: [uname, platformEmail, role],
      });
      userId = Number(inserted.lastInsertRowid);

      // 4. Créditer le solde de départ (non-admins uniquement ; les admins sont illimités).
      if (!isAdmin && STARTER_BALANCE > 0) {
        await db.execute({
          sql: "INSERT INTO sky_transactions (user_id, amount, kind, note) VALUES (?, ?, 'seed', ?)",
          args: [userId, STARTER_BALANCE, "SSO platform welcome"],
        });
      }
    }

    // 5. Ouvrir la session locale (cookie httpOnly) et rediriger vers l'arène.
    const localToken = await signToken({ userId, role });
    const response = NextResponse.redirect(new URL("/duel", request.url));
    setAuthCookie(response, localToken);
    return response;
  } catch (error) {
    console.error("GET /api/sso error:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}
