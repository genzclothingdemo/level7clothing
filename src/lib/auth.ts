import "server-only";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { ADMIN_COOKIE } from "./auth-cookie";

export { ADMIN_COOKIE };

const SECRET = resolveSecret();

/**
 * Signing key for admin sessions. A build-time constant fallback is fine for
 * local dev but must never reach production — anyone who has read this repo
 * could forge an admin session with it.
 */
function resolveSecret(): string {
  const configured = process.env.AUTH_SECRET || process.env.JWT_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET is not set. Refusing to sign admin sessions with the " +
        "development fallback key in production."
    );
  }
  return "level7-dev-secret-change-me";
}

export type AdminSession = { id: string; email: string; name?: string };

export function signAdminToken(session: AdminSession): string {
  return jwt.sign(session, SECRET, { expiresIn: "7d" });
}

export function verifyAdminToken(token: string): AdminSession | null {
  try {
    const decoded = jwt.verify(token, SECRET) as AdminSession & {
      iat?: number;
      exp?: number;
    };
    return { id: decoded.id, email: decoded.email, name: decoded.name };
  } catch {
    return null;
  }
}

/** Verify email/password against DB admins, with an env-credential fallback. */
export async function authenticateAdmin(
  email: string,
  password: string
): Promise<AdminSession | null> {
  const normalized = email.trim().toLowerCase();

  const admin = await prisma.adminUser.findUnique({
    where: { email: normalized },
  });

  if (admin) {
    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) return null;
    return { id: admin.id, email: admin.email, name: admin.name ?? undefined };
  }

  // Fallback: allow login via env vars when no admin row exists yet.
  const envEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const envPassword = process.env.ADMIN_PASSWORD;
  if (envEmail && envPassword && normalized === envEmail && password === envPassword) {
    return { id: "env-admin", email: envEmail, name: "Admin" };
  }

  return null;
}

/** Read the current admin session from the request cookies (server side). */
/**
 * Local-only development bypass for the admin gate.
 *
 * Why this exists: admin pages are the one part of this app that nothing in
 * CI can see. `tsc` and `next build` both pass on React Server Component
 * boundary violations — passing an icon component across the server/client
 * line, or calling a `"use client"` function from a server page — because
 * those only throw when a page actually *renders*. Two of them reached
 * production on 2026-09-22 for exactly that reason.
 *
 * Three independent conditions, ALL of which must hold. Any one of them is
 * enough to keep it off; together they mean it cannot be switched on in
 * production by a stray environment variable:
 *
 *   1. `NODE_ENV !== "production"` — a production build never bypasses.
 *   2. `!process.env.VERCEL` — Vercel sets this on every deployment,
 *      including preview builds, so this can never be on in a deployed app.
 *   3. `ADMIN_DEV_BYPASS === "1"` — explicit opt-in. Absent by default, and
 *      it is NOT in `.env.example`, so it cannot be copied into a real
 *      environment by accident.
 *
 * It is deliberately not a password shortcut: no credential is read, typed or
 * stored anywhere. It simply returns a clearly-labelled local session.
 */
function devBypassSession(): AdminSession | null {
  if (process.env.NODE_ENV === "production") return null;
  if (process.env.VERCEL) return null;
  if (process.env.ADMIN_DEV_BYPASS !== "1") return null;
  return { email: "dev-bypass@localhost", name: "Local dev" } as AdminSession;
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const bypass = devBypassSession();
  if (bypass) return bypass;

  const store = await cookies();
  const token = store.get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  return verifyAdminToken(token);
}

export async function setAdminCookie(session: AdminSession) {
  const store = await cookies();
  store.set(ADMIN_COOKIE, signAdminToken(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearAdminCookie() {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}
