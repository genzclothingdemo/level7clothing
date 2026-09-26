import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_COOKIE } from "@/lib/auth-cookie";

// Lightweight admin gate: redirect to login if the admin cookie is missing.
// Full JWT verification happens in the admin layout (Node runtime).
//
// The cookie name is imported rather than re-declared. When it was duplicated
// here, this file and lib/auth.ts drifted apart and admin login silently looped
// forever — the login route set one cookie and this gate looked for another.
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    // Local-only dev bypass — must match `devBypassSession()` in lib/auth.ts
    // exactly, or this gate and the layout's gate disagree and admin loops
    // forever (which is the failure the cookie-name note above describes).
    //
    // All three conditions must hold: not a production build, not on Vercel
    // (set on every deployment including previews), and explicitly opted in.
    const devBypass =
      process.env.NODE_ENV !== "production" &&
      !process.env.VERCEL &&
      process.env.ADMIN_DEV_BYPASS === "1";

    const hasCookie = req.cookies.has(ADMIN_COOKIE);
    if (!hasCookie && !devBypass) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  if (isAdminApiWrite(req, pathname) && looksReadOnly(req)) {
    return NextResponse.json(
      {
        error:
          "View-only access: this account can read every screen but cannot change anything.",
      },
      { status: 403 }
    );
  }

  return NextResponse.next();
}

/* ------------------------------------------------------------------ */
/*  View-only: an optimistic net over the admin's fetch endpoints      */
/* ------------------------------------------------------------------ */

/**
 * The admin's two write-capable `fetch` endpoints.
 *
 * Server **actions** are deliberately not covered here. They POST to the page's
 * own URL, which means a blanket "no mutating POST under /admin" would also
 * refuse `logout()` — a view-only admin unable to sign out. Their permission is
 * enforced properly in `requireAdminWrite`, one layer in, where the request has
 * a database and can tell the difference. These two are `fetch` calls that
 * never reach that guard:
 *
 *   PATCH/DELETE /api/admin/media/[id]   — rename or delete a photo
 *   POST         /api/upload             — push a file into Vercel Blob
 *
 * `/api/chat/upload` is excluded on purpose: **customers** post to it too, and
 * the admin check there is optional.
 */
function isAdminApiWrite(req: NextRequest, pathname: string): boolean {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return false;
  }
  return pathname.startsWith("/api/admin/") || pathname === "/api/upload";
}

/**
 * Does the session cookie *claim* view-only access?
 *
 * **Read only to refuse, never to permit**, and that is what makes an unverified
 * read sound here. The payload is decoded without checking the signature —
 * `jsonwebtoken` needs Node crypto and this runs on the edge — so a forged
 * token is entirely possible. A forged `readonly` only locks its own holder
 * out; a forged `full` gets past *this* line and straight into the route
 * handler's `getAdminSession()`, which verifies the signature properly and
 * rejects it. There is no grant to steal.
 *
 * ## What this does not catch
 *
 * The claim is a snapshot from sign-in. If the owner demotes someone who is
 * already signed in, their token still says `full` until it is reissued, and
 * these two endpoints would let them through — their **server actions** would
 * not, because `getAdminSession` re-reads the row on every request. Closing it
 * here is impossible (the edge has no database); closing it properly is one
 * `requireAdminWrite` call inside each of those two route handlers.
 */
function looksReadOnly(req: NextRequest): boolean {
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  if (!token) return false;

  const payload = token.split(".")[1];
  if (!payload) return false;

  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return (JSON.parse(json) as { mode?: unknown }).mode === "readonly";
  } catch {
    // Unparseable is not "read-only" — let it through to the real check rather
    // than inventing a refusal from a cookie we could not read.
    return false;
  }
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*", "/api/upload"],
};
