import { NextResponse } from "next/server";
import { getUserSession } from "@/lib/user-auth";
import { rateLimit } from "@/lib/chat";
import {
  deleteSubscription,
  isValidEndpoint,
  parseSubscription,
  pushConfigured,
  saveSubscription,
  subscriptionOwner,
} from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Plain HTTP twin of the `subscribeToPush` / `unsubscribeFromPush` server
 * actions.
 *
 * This exists for one reason: a **service worker cannot call a server
 * action**. When a browser rotates a subscription it fires
 * `pushsubscriptionchange` in the worker with no page attached, and if nothing
 * re-registers the new endpoint there and then, that device silently stops
 * receiving notifications — and the customer has no way to notice.
 *
 * `/api/push/*` is inside the worker's NEVER_CACHE list (it starts `/api/`),
 * so none of this is ever served from a cache.
 *
 * The validation and ownership rules are the ones in `@/lib/push`; this
 * handler only adapts them to a request/response.
 */

/** Matches the server action's budget — same work, same ceiling. */
const LIMIT = { limit: 12, windowMs: 60_000 };

function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  return ip.slice(0, 64);
}

/** Refuse anything that isn't JSON before reading a byte of the body. */
async function readJson(req: Request): Promise<unknown | null> {
  if (!req.headers.get("content-type")?.includes("application/json")) return null;
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** Register or refresh a subscription. */
export async function POST(req: Request) {
  if (!pushConfigured()) {
    return NextResponse.json({ error: "Push is not configured." }, { status: 503 });
  }
  if (!rateLimit(`push:sub:${clientKey(req)}`, LIMIT.limit, LIMIT.windowMs)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const raw = await readJson(req);
  const parsed = parseSubscription(
    raw && typeof raw === "object" && "subscription" in raw
      ? (raw as { subscription: unknown }).subscription
      : raw
  );
  if (!parsed) {
    return NextResponse.json({ error: "Invalid subscription." }, { status: 400 });
  }

  const session = await getUserSession();

  try {
    await saveSubscription(parsed, {
      userId: session?.id ?? null,
      userAgent: req.headers.get("user-agent"),
    });
  } catch {
    return NextResponse.json({ error: "Could not store subscription." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * Forget a subscription. The body carries the endpoint, because a `DELETE`
 * with the endpoint in the query string would write a push URL into access
 * logs on every proxy between here and the browser.
 */
export async function DELETE(req: Request) {
  if (!rateLimit(`push:sub:${clientKey(req)}`, LIMIT.limit, LIMIT.windowMs)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const raw = await readJson(req);
  const endpoint = (raw as { endpoint?: unknown } | null)?.endpoint;
  if (!isValidEndpoint(endpoint)) {
    return NextResponse.json({ error: "Invalid endpoint." }, { status: 400 });
  }

  const owner = await subscriptionOwner(endpoint);
  // Already gone is the desired end state, so report it as one.
  if (!owner.exists) return NextResponse.json({ ok: true });

  if (owner.userId) {
    const session = await getUserSession();
    if (session?.id !== owner.userId) {
      // Deliberately the same shape as "not found": confirming that an
      // endpoint exists but belongs to someone else leaks membership.
      return NextResponse.json({ error: "Invalid endpoint." }, { status: 400 });
    }
  }

  await deleteSubscription(endpoint);
  return NextResponse.json({ ok: true });
}
