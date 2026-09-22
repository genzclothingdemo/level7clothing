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

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
