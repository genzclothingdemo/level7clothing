import "server-only";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { USER_COOKIE } from "./auth-cookie";
import { normalisePhone } from "./phone";

export { USER_COOKIE };

// See resolveSecret() in ./auth.ts — the dev fallback must never sign real
// customer sessions in production.
const SECRET = (() => {
  const configured = process.env.AUTH_SECRET || process.env.JWT_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET is not set. Refusing to sign customer sessions with the " +
        "development fallback key in production."
    );
  }
  return "level7-dev-secret-change-me";
})();

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

/**
 * Sign in with **a mobile number and a password** — or, for the accounts that
 * predate that rule, with an email address.
 *
 * ## Why there are two doors
 *
 * The mobile number became the identity on 2026-09-26: it is the unique column,
 * it is what a signup must provide, and it is what this function looks up
 * first. Email stopped being unique in the same change, because two people
 * genuinely do share one inbox — which is precisely why it cannot be the thing
 * you sign in as.
 *
 * But one live account was created before any of that and has `phone: null`.
 * There is no number to type, and no amount of correct design makes typing one
 * work for them. Refusing the email door would have locked that person out of
 * their own orders, so the door stays open, and it is handled here rather than
 * left to whoever notices. The login form leads with the number and offers the
 * email as the second way in.
 *
 * ## What a shared email does to the email door
 *
 * Nothing dangerous, and it is worth stating why rather than leaving it to be
 * rediscovered. When several accounts hold one address, the password decides:
 * each candidate is compared in `createdAt` order and the first match wins.
 * That is exactly as strong as email+password was yesterday — a caller still
 * has to know a password that hashes against a specific row. It cannot fall
 * through to "some other account with the same address", because bcrypt has to
 * match *that row's* hash.
 *
 * `findUnique({ where: { email } })` is what used to be here, and it is now a
 * **runtime throw** rather than a wrong answer — `email` is no longer a unique
 * column, so Prisma refuses the call. `tsc` does not catch it.
 */
export async function authenticateUser(
  identifier: string,
  password: string
): Promise<UserSession | null> {
  const typed = (identifier ?? "").trim();
  if (!typed || !password) return null;

  // A number first: it is the identity, and `normalisePhone` accepts every
  // spelling a person might type (`09313…`, `+91 93131…`, a bare ten digits).
  const phone = normalisePhone(typed);
  const candidates = phone
    ? await prisma.user.findMany({ where: { phone }, take: 1 })
    : typed.includes("@")
      ? await prisma.user.findMany({
          where: { email: typed.toLowerCase() },
          // Oldest first, so a shared address resolves the same way every time.
          orderBy: { createdAt: "asc" },
        })
      : [];

  for (const user of candidates) {
    if (await bcrypt.compare(password, user.passwordHash)) {
      return { id: user.id, email: user.email, name: user.name };
    }
  }
  return null;
}

/** Random URL-safe token for password-reset links. */
export function generateResetToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
