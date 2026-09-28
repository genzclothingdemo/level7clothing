/**
 * **What the notification bell polls.**
 * `GET /api/notifications`
 *
 * One route serves both bells, because there is only ever one viewer per
 * request and the session already says which they are. An admin session gets
 * the owner's feed, a customer session gets their own, and anybody else gets
 * `audience: "none"` — which the client treats as "stop polling", so an
 * anonymous visitor browsing the shop costs exactly one request and then
 * nothing at all.
 *
 * **The admin check runs first, and deliberately.** The owner is also a
 * customer account on this store (that is how `recipient: "admin"` finds their
 * phone for push), so the two sessions can both be present in one browser. If
 * the customer branch won, the owner would open their own admin and see a
 * shopper's feed.
 *
 * Nothing here is cached: `force-dynamic` and `no-store`, because a feed is
 * per-viewer and a cached one would hand a stranger somebody else's
 * notifications. That is the whole risk this route carries and it is worth
 * being blunt about — the filter in `listNotifications` is the only thing
 * standing between two customers' feeds.
 */

import { NextResponse } from "next/server";
import { listNotifications, type FeedItem } from "@/lib/automation";
import { getAdminSession } from "@/lib/auth";
import { getUserSession } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

export type FeedResponse = {
  audience: "admin" | "customer" | "none";
  items: FeedItem[];
};

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
} as const;

export async function GET() {
  const [admin, user] = await Promise.all([getAdminSession(), getUserSession()]);

  if (admin) {
    return NextResponse.json(
      { audience: "admin", items: await listNotifications({ audience: "admin" }) } satisfies FeedResponse,
      { headers: NO_STORE }
    );
  }

  if (user) {
    return NextResponse.json(
      {
        audience: "customer",
        items: await listNotifications({
          audience: "customer",
          userId: user.id,
          email: user.email,
        }),
      } satisfies FeedResponse,
      { headers: NO_STORE }
    );
  }

  // A guest has no feed — there is no account to attach one to, and their
  // order updates reach them by email. Saying so explicitly is what lets the
  // client stop polling rather than retry every thirty seconds forever.
  return NextResponse.json({ audience: "none", items: [] } satisfies FeedResponse, {
    headers: NO_STORE,
  });
}
