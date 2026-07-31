import "server-only";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { prisma } from "./prisma";

export const ADMIN_COOKIE = "level7_admin";

const SECRET =
  process.env.AUTH_SECRET ||
  process.env.JWT_SECRET ||
  "level7-dev-secret-change-me";

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
export async function getAdminSession(): Promise<AdminSession | null> {
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
