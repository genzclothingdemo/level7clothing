import "server-only";
import { cache } from "react";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { prisma } from "./prisma";
import { ADMIN_COOKIE } from "./auth-cookie";
import {
  AdminReadOnlyError,
  READ_ONLY_MESSAGE,
  canWrite,
  humaniseAction,
  isAdminMode,
  logAdminActivity,
  readLiveTempAdmin,
  tempAdminState,
  verbFor,
  type AdminMode,
} from "./temp-admin";

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

/**
 * Who is signed in to the admin.
 *
 * **Widened, not repurposed.** `id`, `email` and `name` mean exactly what they
 * always did, so every existing caller — the panel layout's `session.email`,
 * `changeAdminPassword`'s `session.id`, the rate-limit keys in `push.ts` and
 * the chat route — reads back the same thing. Two fields were added:
 *
 * - `mode` — what this holder is allowed to do. `"full"` for the permanent
 *   owner and for a full-access temporary admin; `"readonly"` for one given
 *   view-only access. Absent from a token minted before temporary admins
 *   existed, which resolves to `"full"`: those could only ever have been the
 *   owner.
 * - `tempAdminId` — set **only** when the session belongs to a `TempAdmin` row.
 *   Its absence is what tells `getAdminSession` there is no row to re-check, so
 *   the owner's every request still costs zero extra queries.
 */
export type AdminSession = {
  id: string;
  email: string;
  name?: string;
  mode: AdminMode;
  tempAdminId?: string;
};

export function signAdminToken(session: AdminSession): string {
  return jwt.sign(session, SECRET, { expiresIn: "7d" });
}

export function verifyAdminToken(token: string): AdminSession | null {
  try {
    const decoded = jwt.verify(token, SECRET) as AdminSession & {
      iat?: number;
      exp?: number;
    };
    return {
      id: decoded.id,
      email: decoded.email,
      name: decoded.name,
      // A token issued before this feature has no `mode` claim. It can only
      // have been the permanent admin — temporary ones did not exist — so
      // `full` is the correct reading rather than a permissive guess.
      mode: isAdminMode(decoded.mode) ? decoded.mode : "full",
      tempAdminId: decoded.tempAdminId,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Signing in                                                         */
/* ------------------------------------------------------------------ */

/**
 * Why a sign-in was refused, in the words the login screen prints.
 *
 * A temporary admin whose access was switched off or has run out gets told
 * *that*, not "invalid email or password". The distinction is safe to make:
 * it is only ever reached after the password has already been verified, so it
 * reveals nothing to someone who does not have the credentials.
 */
export type AdminAuthResult =
  | { ok: true; session: AdminSession }
  | { ok: false; reason: string };

const BAD_CREDENTIALS = "Invalid email or password";

/**
 * Verify email/password against the permanent admin, then the temporary ones,
 * with an env-credential fallback.
 *
 * Order matters. `AdminUser` is checked first, so the owner can always get in;
 * `createTempAdmin` refuses an email that collides with an `AdminUser` for
 * exactly that reason — a temporary account on that address would be
 * unreachable and the owner would have no idea why.
 */
export async function authenticateAdmin(
  email: string,
  password: string
): Promise<AdminAuthResult> {
  const normalized = email.trim().toLowerCase();

  const admin = await prisma.adminUser.findUnique({
    where: { email: normalized },
  });

  if (admin) {
    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) return { ok: false, reason: BAD_CREDENTIALS };
    return {
      ok: true,
      session: {
        id: admin.id,
        email: admin.email,
        name: admin.name ?? undefined,
        mode: "full",
      },
    };
  }

  const temp = await prisma.tempAdmin
    .findUnique({ where: { email: normalized } })
    .catch(() => null);

  if (temp) {
    const ok = await bcrypt.compare(password, temp.passwordHash);
    if (!ok) return { ok: false, reason: BAD_CREDENTIALS };

    // The password was right, so the honest answer is why it still will not
    // work. Checked here *and* on every subsequent request — this is the
    // sign-in half; `getAdminSession` is the other.
    const state = tempAdminState(temp);
    if (state === "disabled") {
      return {
        ok: false,
        reason:
          "This access has been switched off. Ask the store owner to turn it back on.",
      };
    }
    if (state === "expired") {
      return {
        ok: false,
        reason: `This access expired on ${temp.expiresAt?.toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}. Ask the store owner to extend it.`,
      };
    }

    const mode: AdminMode = isAdminMode(temp.mode) ? temp.mode : "readonly";

    await prisma.tempAdmin
      .update({ where: { id: temp.id }, data: { lastLoginAt: new Date() } })
      .catch(() => null);

    await logAdminActivity({
      tempAdminId: temp.id,
      action: "login",
      path: "/admin/login",
      detail: `Signed in with ${mode === "full" ? "full" : "view-only"} access`,
    });

    return {
      ok: true,
      session: {
        id: temp.id,
        email: temp.email,
        name: temp.name,
        mode,
        tempAdminId: temp.id,
      },
    };
  }

  // Fallback: allow login via env vars when no admin row exists yet.
  const envEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const envPassword = process.env.ADMIN_PASSWORD;
  if (envEmail && envPassword && normalized === envEmail && password === envPassword) {
    return {
      ok: true,
      session: { id: "env-admin", email: envEmail, name: "Admin", mode: "full" },
    };
  }

  return { ok: false, reason: BAD_CREDENTIALS };
}

/* ------------------------------------------------------------------ */
/*  Reading the session                                                */
/* ------------------------------------------------------------------ */

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
 *
 * `mode: "full"` because it stands in for the owner. `id` is a real string
 * rather than the `undefined` the old cast let through — `push.ts` and the chat
 * route key their rate limits on it, and every local bypass sharing the key
 * `a:undefined` was a live bug hiding behind a cast.
 */
function devBypassSession(): AdminSession | null {
  if (process.env.NODE_ENV === "production") return null;
  if (process.env.VERCEL) return null;
  if (process.env.ADMIN_DEV_BYPASS !== "1") return null;
  return {
    id: "dev-bypass",
    email: "dev-bypass@localhost",
    name: "Local dev",
    mode: "full",
  };
}

/**
 * Read the current admin session from the request cookies (server side).
 *
 * Memoised with React's `cache()` for the length of one request, which is the
 * pattern the Next docs give for a session check
 * (`node_modules/next/dist/docs/01-app/02-guides/authentication.md`, "Creating a
 * Data Access Layer"). It matters more here than it looks: the panel layout,
 * every server action fired from a page and several API routes all call this,
 * and for a **temporary** admin each call would otherwise be its own round trip
 * to Mumbai. CLAUDE.md already records what a per-request query multiplier does
 * to this app's connection pool.
 *
 * ## The session is re-decided on every request, not minted once
 *
 * A JWT is a snapshot. If the mode, the switch or the expiry were read from the
 * cookie, then switching someone off would do nothing until their seven-day
 * token ran out — which is exactly the hole this is supposed to close. So the
 * token is trusted for one thing only: **which row to read.** Everything that
 * decides what the holder may do comes back from the database, so
 *
 *   - switched off → signed out on the next request;
 *   - expired      → signed out on the next request;
 *   - deleted      → signed out on the next request;
 *   - full → view-only → the next write is refused.
 *
 * The permanent owner's token carries no `tempAdminId`, so none of this runs
 * for them and the admin costs exactly the queries it did before.
 */
export const getAdminSession = cache(async function getAdminSession(): Promise<AdminSession | null> {
  const store = await cookies();
  const token = store.get(ADMIN_COOKIE)?.value;
  const claims = token ? verifyAdminToken(token) : null;

  /**
   * **A real session outranks the dev bypass.**
   *
   * The bypass used to be checked first, which meant that with
   * `ADMIN_DEV_BYPASS=1` set you could not sign in locally at all — every
   * request came back as the owner no matter whose cookie was on it, so a
   * view-only account was untestable without editing `.env` and restarting.
   * That is not a safe thing to have to do: `.env` is shared, and a bypass you
   * cannot exercise a role against is a bypass that hides role bugs until
   * production, which is the exact failure the bypass exists to prevent.
   *
   * The rule is now: **the bypass stands in for not having signed in.** No
   * cookie, or a cookie that does not verify, falls through to it; a cookie
   * that verifies decides — including deciding that the holder is signed *out*,
   * because a switched-off temporary admin must not silently become the owner.
   *
   * None of the three safety conditions moved, and the edge gate in `proxy.ts`
   * still agrees with this one: it redirects only when there is no cookie *and*
   * no bypass, so a request carrying a cookie is passed through to here either
   * way.
   */
  if (!claims) return devBypassSession();
  if (!claims.tempAdminId) return claims;

  const live = await readLiveTempAdmin(claims.tempAdminId);
  if (!live || live.state !== "active") return null;

  return {
    id: live.id,
    email: live.email,
    name: live.name,
    // From the row, never from the token — this is what makes a demotion take
    // effect on the very next request.
    mode: live.mode,
    tempAdminId: live.id,
  };
});

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

/* ------------------------------------------------------------------ */
/*  The guards — one write rule for the whole admin                    */
/* ------------------------------------------------------------------ */

/**
 * The admin screen a server action was fired from.
 *
 * Next sets `next-url` on a server action request to the path of the page that
 * invoked it, which is the most useful thing to record: "Products" tells the
 * owner where to go and look. `referer` is the fallback for a route handler.
 * Wrapped, because `headers()` throws outside a request scope and a log line is
 * never worth failing a write for.
 */
async function currentScreen(): Promise<string | null> {
  try {
    const h = await headers();
    const next = h.get("next-url");
    if (next) return next.split("?")[0];
    const ref = h.get("referer");
    if (ref) return new URL(ref).pathname;
  } catch {
    /* no request scope — nothing to record */
  }
  return null;
}

/**
 * Identity only: the session, or a thrown `Unauthorized`.
 *
 * This is what `requireAdmin()` used to be, and it is what an action that only
 * *reads* should call — a view-only holder is allowed to look at everything, so
 * gating a read on the write rule would turn "sees every screen" into a lie.
 */
export async function requireAdminSession(): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session) throw new Error("Unauthorized");
  return session;
}

/**
 * Identity **and permission**, plus the log line. The one gate every admin
 * write goes through.
 *
 * ## Why it is here and not in the UI
 *
 * A server action is a public endpoint addressable by its id — the browser
 * POSTs a `Next-Action` header to the page's own URL. Hiding a button removes
 * the convenient way to call it and none of the others. So this is the
 * permission, and the disabled button is the courtesy that saves a view-only
 * holder from discovering it by being refused.
 *
 * ## Why the log write is here too
 *
 * The brief asked for the log to go "in the one place actions already funnel
 * through so a new action cannot forget to log", and this is that place: every
 * admin write in `admin.ts`, `returns.ts`, `portfolio.ts`, `automation.ts` and
 * the Settings actions reaches the database through it. An action added
 * tomorrow that calls `requireAdmin()` is logged without its author doing
 * anything, and one that does not call it is not authenticated at all.
 *
 * Only **temporary** admins are logged. The owner has nobody to be accountable
 * to, and a trail of their own routine work is the noise that stops the useful
 * lines being read.
 *
 * @param what   The action's own name, e.g. `"deleteProduct"`. Rendered as a
 *               sentence by `humaniseAction`, so no table has to be maintained.
 * @param opts.quiet  Refuse without logging. For a write fired by *rendering* a
 *               screen rather than by a person — `autoSyncOrderAction` runs on
 *               every order row that has an AWB — where a log line per refusal
 *               would bury the ones that mean something.
 */
export async function requireAdminWrite(
  what?: string,
  opts?: { quiet?: boolean }
): Promise<AdminSession> {
  const session = await requireAdminSession();

  const label = what ? humaniseAction(what) : "Changed something";

  if (!canWrite(session)) {
    if (session.tempAdminId && !opts?.quiet) {
      await logAdminActivity({
        tempAdminId: session.tempAdminId,
        action: "blocked",
        path: await currentScreen(),
        detail: `Refused — view-only access. Attempted: ${label}`,
      });
    }
    throw new AdminReadOnlyError();
  }

  if (session.tempAdminId) {
    await logAdminActivity({
      tempAdminId: session.tempAdminId,
      action: what ? verbFor(what) : "update",
      path: await currentScreen(),
      detail: label,
    });
  }

  return session;
}

/**
 * `requireAdminWrite` for a **route handler**, which cannot throw its way to a
 * useful HTTP status.
 *
 * A server action can throw `AdminReadOnlyError` and let the client surface it.
 * A `Response`-returning handler has to choose a status code, and the two cases
 * are genuinely different: **401 means sign in, 403 means you are signed in and
 * still may not do this.** Collapsing them would bounce a view-only holder to a
 * login screen that cannot help them.
 *
 * Refusals are logged by `requireAdminWrite` exactly as they are for an action,
 * so a blocked upload lands in the same activity list as a blocked button.
 *
 * The session comes back on success because some handlers need it — the chat
 * reply rate-limits on `admin.id` — which saves them a second lookup.
 */
export async function guardAdminWriteRoute(
  what: string
): Promise<
  | { ok: true; session: AdminSession }
  | { ok: false; response: Response }
> {
  try {
    return { ok: true, session: await requireAdminWrite(what) };
  } catch (err) {
    if (err instanceof AdminReadOnlyError) {
      return {
        ok: false,
        response: Response.json({ error: READ_ONLY_MESSAGE }, { status: 403 }),
      };
    }
    return {
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
}
