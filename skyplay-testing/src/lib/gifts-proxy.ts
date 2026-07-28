import { SignJWT } from "jose";

/** Get the Platform-main API base URL from env vars. */
export function getPlatformUrl(): string {
  return (
    process.env.PLATFORM_API_URL ||
    process.env.NEXT_PUBLIC_PLATFORM_API_URL ||
    "http://localhost:3000"
  );
}

/** Create a short-lived HS256 JWT for Platform-main service-to-service auth.
 *  Uses the same secret as Platform-main's JwtCustomStrategy. */
export async function createPlatformJwt(
  userId: string,
  username: string,
): Promise<string> {
  const secret = new TextEncoder().encode(
    process.env.JWT_SECRET || process.env.AUTH_SECRET || "dev-secret",
  );

  return new SignJWT({
    sub: userId,
    username,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
}

/** Generic fetch wrapper to proxy a request to Platform-main.
 *  `jwt` is optional — use for authenticated endpoints. */
export async function proxyToPlatform(
  method: string,
  path: string,
  body?: unknown,
  jwt?: string,
): Promise<Response> {
  const baseUrl = getPlatformUrl();
  const url = `${baseUrl}${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (jwt) {
    headers["Authorization"] = `Bearer ${jwt}`;
  }

  return fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Extract user info from the Next.js auth_token cookie (server-side).
 *  Returns { userId, username } or null if not authenticated. */
export async function getUserFromRequest(
  req: Request,
): Promise<{ userId: string; username: string } | null> {
  try {
    const { cookies } = await import("next/headers");
    const token = (await cookies()).get("auth_token")?.value;
    if (!token) return null;

    const { jwtVerify } = await import("jose");
    const secret = new TextEncoder().encode(
      process.env.AUTH_SECRET || "dev-secret",
    );

    const { payload } = await jwtVerify(token, secret);
    const userId = String(payload.userId ?? "");
    if (!userId) return null;

    // Look up username from Turso DB
    let username = `User-${userId}`;
    try {
      const { getDb } = await import("@/lib/db");
      const db = await getDb();
      const rs = await db.execute({
        sql: "SELECT username FROM users WHERE id = ?",
        args: [Number(userId)],
      });
      const row = rs.rows[0] as unknown as { username: string } | undefined;
      if (row?.username) username = row.username;
    } catch {
      // Fallback — username from DB lookup is non-critical
    }

    return { userId, username };
  } catch {
    return null;
  }
}
