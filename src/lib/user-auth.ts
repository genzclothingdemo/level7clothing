import "server-only";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { prisma } from "./prisma";

export const USER_COOKIE = "level7_user";

const SECRET =
  process.env.AUTH_SECRET ||
  process.env.JWT_SECRET ||
  "level7-dev-secret-change-me";

export type UserSession = { id: string; email: string; name: string };

// Sticky login: a long-lived token, re-issued on every authenticated action
// (login/signup/reset/profile/order) so active shoppers effectively never
// get logged out.
const SESSION_DAYS = 400;

export function signUserToken(session: UserSession): string {
  return jwt.sign(session, SECRET, { expiresIn: `${SESSION_DAYS}d` });
}

export function verifyUserToken(token: string): UserSession | null {
  try {
    const decoded = jwt.verify(token, SECRET) as UserSession & {
      iat?: number;
      exp?: number;
    };
    return { id: decoded.id, email: decoded.email, name: decoded.name };
  } catch {
    return null;
  }
}

/** Read the current customer session from cookies (server side). */
export async function getUserSession(): Promise<UserSession | null> {
  const store = await cookies();
  const token = store.get(USER_COOKIE)?.value;
  if (!token) return null;
  return verifyUserToken(token);
}

export async function setUserCookie(session: UserSession) {
  const store = await cookies();
  store.set(USER_COOKIE, signUserToken(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * SESSION_DAYS,
  });
}

export async function clearUserCookie() {
  const store = await cookies();
  store.delete(USER_COOKIE);
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/** Verify email/password against the User table. */
export async function authenticateUser(
  email: string,
  password: string
): Promise<UserSession | null> {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  return { id: user.id, email: user.email, name: user.name };
}

/** Random URL-safe token for password-reset links. */
export function generateResetToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
