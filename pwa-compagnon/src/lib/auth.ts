import { NextRequest, NextResponse } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";

// ── Password utilities ──

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ── JWT utilities ──

const AUTH_SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || "skyplay-dev-secret-change-in-production"
);

const COOKIE_NAME = "auth_token";
const TOKEN_MAX_AGE = 60 * 60 * 24; // 24 hours

export interface AuthPayload {
  userId: number;
  role: string;
}

export async function signToken(payload: AuthPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_MAX_AGE}s`)
    .sign(AUTH_SECRET);
}

export async function verifyToken(
  token: string
): Promise<AuthPayload | null> {
  try {
    const { payload } = await jwtVerify(token, AUTH_SECRET);
    return {
      userId: payload.userId as number,
      role: payload.role as string,
    };
  } catch {
    return null;
  }
}

// ── Cookie utilities ──

export function setAuthCookie(response: NextResponse, token: string): void {
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TOKEN_MAX_AGE,
  });
}

export function clearAuthCookie(response: NextResponse): void {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

// ── Request helper ──

export async function getAuthFromRequest(
  request: NextRequest
): Promise<AuthPayload | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

// ── Role guard ──

export function requireAdmin(
  auth: AuthPayload | null
): auth is AuthPayload {
  if (!auth) return false;
  return auth.role === "admin" || auth.role === "superadmin";
}
