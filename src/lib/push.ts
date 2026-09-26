import "server-only";
import webpush, { WebPushError } from "web-push";
import { prisma } from "./prisma";

/**
 * Web push — the server half.
 *
 * Everything that talks to a push service lives here so there is exactly one
 * place that knows the VAPID keys, one place that validates an endpoint, and
 * one place that decides a subscription is dead. The server actions and the
 * route handlers are thin wrappers over this file.
 *
 * Three things are load-bearing:
 *
 * 1. **VAPID is configured lazily.** `webpush.setVapidDetails` throws on a
 *    malformed or missing key. Calling it at module scope would turn "push is
 *    not set up yet" into a 500 on any page that happens to import this file
 *    transitively. Instead `ensureVapid()` runs on first send and returns a
 *    boolean, so an unconfigured store degrades to "push unavailable".
 * 2. **Endpoints from the browser are untrusted input.** A `PushSubscription`
 *    reaches us as plain JSON the page could have fabricated, so the endpoint
 *    URL and both keys are validated for shape before anything is stored, and
 *    the endpoint is never used as a fetch target by us directly — `web-push`
 *    does that, but only after these checks.
 * 3. **404/410 means the subscription is gone forever.** The push service is
 *    telling us the browser uninstalled, cleared site data or expired the
 *    endpoint. Those rows are deleted on the spot; left in place they turn
 *    every future broadcast into N pointless HTTPS round trips.
 */

/* ------------------------------------------------------------------ */
/*  Configuration                                                      */
/* ------------------------------------------------------------------ */

/**
 * The public key is deliberately read from the `NEXT_PUBLIC_` variable — the
 * browser subscribes with that exact value, and a server signing with a
 * *different* key pair produces a 403 from the push service that is very hard
 * to read. One variable, one source of truth.
 */
const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "";
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY?.trim() ?? "";
/** VAPID requires a contact the push service can reach if we misbehave. */
const SUBJECT = process.env.VAPID_SUBJECT?.trim() || "mailto:hello@level7clothing.shop";

let vapidState: "unset" | "ready" | "failed" = "unset";

function ensureVapid(): boolean {
  if (vapidState !== "unset") return vapidState === "ready";
  if (!PUBLIC_KEY || !PRIVATE_KEY) {
    vapidState = "failed";
    return false;
  }
  try {
    webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
    vapidState = "ready";
  } catch {
    // Malformed keys — almost always a truncated paste into Vercel.
    vapidState = "failed";
  }
  return vapidState === "ready";
}

/** True when both VAPID keys are present and well formed. */
export function pushConfigured(): boolean {
  return ensureVapid();
}

/* ------------------------------------------------------------------ */
/*  Payload                                                            */
/* ------------------------------------------------------------------ */

/**
 * A push message is capped at 4096 bytes *after* encryption, and the aes128gcm
 * overhead eats ~103 of those. Staying well under the limit is cheaper than
 * discovering the ceiling in production, so each field is truncated and the
 * whole JSON is checked again before it goes out.
 */
export const PUSH_LIMITS = {
  title: 80,
  body: 180,
  url: 512,
  /** Hard ceiling on the serialised payload, comfortably inside 3993 bytes. */
  bytes: 2800,
} as const;

export type PushPayload = {
  title: string;
  body: string;
  /** Where a click should land. Same-origin path, e.g. `/order/L7-1042`. */
  url?: string;
  /**
   * Collapse key. Two notifications sharing a tag replace each other rather
   * than stacking — right for "your order moved", wrong for a broadcast.
   */
  tag?: string;
};

const clip = (value: string, max: number) => {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
};

/**
 * Only same-origin paths are allowed through. An absolute URL in the payload
 * would let anything that can reach the send path turn a notification into an
 * open redirect straight out of the customer's notification tray.
 */
function safePath(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const value = url.trim();
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;
  return value.slice(0, PUSH_LIMITS.url);
}

/** Serialise a payload, clipped to fit. Returns `null` if it still won't. */
export function encodePayload(payload: PushPayload): string | null {
  const title = clip(payload.title, PUSH_LIMITS.title);
  const body = clip(payload.body, PUSH_LIMITS.body);
  if (!title) return null;

  const json = JSON.stringify({
    title,
    body,
    url: safePath(payload.url),
    tag: payload.tag ? clip(payload.tag, 48) : undefined,
  });

  return Buffer.byteLength(json, "utf8") > PUSH_LIMITS.bytes ? null : json;
}

/* ------------------------------------------------------------------ */
/*  Validating what the browser sent                                   */
/* ------------------------------------------------------------------ */

export type ClientSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

/** Longest endpoint any current push service issues is well under this. */
const MAX_ENDPOINT = 2048;
const BASE64URL = /^[A-Za-z0-9_-]+=*$/;

function base64UrlBytes(value: string): number | null {
  if (!value || value.length > 256 || !BASE64URL.test(value)) return null;
  try {
    return Buffer.from(value, "base64url").length;
  } catch {
    return null;
  }
}

/**
 * Validate the endpoint URL's *shape*. We never allow a client to name an
 * arbitrary host: the endpoint has to be a public HTTPS origin with no
 * embedded credentials, which rules out using this table as an SSRF primitive
 * pointed at the deployment's own network.
 *
 * The host allow-list is deliberately not hard-coded to today's four push
 * services — Chrome, Firefox, Edge and Safari have all changed theirs, and a
 * stale list silently breaks a whole browser. The structural checks below are
 * what actually matter.
 */
export function isValidEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string") return false;
  if (endpoint.length < 20 || endpoint.length > MAX_ENDPOINT) return false;

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;

  const host = url.hostname.toLowerCase();
  // A bare hostname, an IP literal or anything loopback/private is never a
  // real push service and is exactly what an SSRF attempt looks like.
  if (!host.includes(".")) return false;
  if (host.endsWith(".localhost") || host === "localhost") return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (host.endsWith(".internal") || host.endsWith(".local")) return false;

  return true;
}

/**
 * Coerce the JSON form of a browser `PushSubscription` into something we are
 * willing to store. Returns `null` on anything unexpected rather than
 * throwing — the caller turns that into a 400.
 */
export function parseSubscription(input: unknown): ClientSubscription | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as { endpoint?: unknown; keys?: unknown };

  if (!isValidEndpoint(raw.endpoint)) return null;
  if (!raw.keys || typeof raw.keys !== "object") return null;

  const keys = raw.keys as { p256dh?: unknown; auth?: unknown };
  if (typeof keys.p256dh !== "string" || typeof keys.auth !== "string") return null;

  // An uncompressed P-256 point is exactly 65 bytes and the auth secret is
  // exactly 16. `web-push` throws on anything else, so rejecting here turns a
  // stack trace into a clean validation failure.
  if (base64UrlBytes(keys.p256dh) !== 65) return null;
  const authBytes = base64UrlBytes(keys.auth);
  if (authBytes === null || authBytes < 16 || authBytes > 24) return null;

  return {
    endpoint: raw.endpoint,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
  };
}

/* ------------------------------------------------------------------ */
/*  Storage                                                            */
/* ------------------------------------------------------------------ */

/**
 * Store (or refresh) one subscription.
 *
 * Upserted on `endpoint`, which is the browser's own identity for the
 * subscription: re-running the opt-in, or signing in on a device that had
 * subscribed anonymously, updates the existing row instead of duplicating it.
 * That second case is the reason `userId` is written on update too — it is how
 * an anonymous subscription gets claimed onto an account.
 */
export async function saveSubscription(
  sub: ClientSubscription,
  meta: { userId?: string | null; userAgent?: string | null }
): Promise<void> {
  const userAgent = meta.userAgent ? meta.userAgent.slice(0, 255) : null;
  const data = {
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
    userAgent,
    lastSeenAt: new Date(),
  };

  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    // `userId` is only ever *set*, never cleared: signing out should not
    // orphan a subscription the customer deliberately kept.
    update: meta.userId ? { ...data, userId: meta.userId } : data,
    create: { endpoint: sub.endpoint, userId: meta.userId ?? null, ...data },
  });
}

/** Drop one endpoint. Safe to call for a row that is already gone. */
export async function deleteSubscription(endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { endpoint } }).catch(() => null);
}

/**
 * Who owns an endpoint, so a caller can be checked against it.
 *
 * `null` userId means the subscription was made anonymously; possession of the
 * endpoint string is then the only credential there is, and it can only have
 * come from that browser's own `PushManager`.
 */
export async function subscriptionOwner(
  endpoint: string
): Promise<{ exists: boolean; userId: string | null }> {
  const row = await prisma.pushSubscription
    .findUnique({ where: { endpoint }, select: { userId: true } })
    .catch(() => null);
  return row ? { exists: true, userId: row.userId } : { exists: false, userId: null };
}

/* ------------------------------------------------------------------ */
/*  Sending                                                            */
/* ------------------------------------------------------------------ */

export type SendResult = {
  sent: number;
  failed: number;
  /** Endpoints the push service declared dead; these rows were deleted. */
  pruned: number;
};

/**
 * One device, in the shape `sendToTargets` needs.
 *
 * Exported because `lib/push-dispatch.ts` assembles a list of these for the
 * person an automation rule names, rather than for "everybody" — but the
 * sending, the chunking and the pruning stay here, so there is still exactly
 * one place that talks to a push service.
 */
export type PushTarget = { endpoint: string; p256dh: string; auth: string };

type Target = PushTarget;

/** How many pushes are in flight at once. Enough to be quick, not a flood. */
const CONCURRENCY = 20;

/**
 * Deliver one encrypted message.
 *
 * The only outcome that is *not* an error is a 2xx. A 404 or 410 means the
 * subscription no longer exists at the push service, which is the single case
 * where we delete our copy — a 429 or a 500 is the service having a bad day
 * and must not cost the customer their subscription.
 */
async function sendOne(target: Target, payload: string): Promise<"sent" | "pruned" | "failed"> {
  try {
    await webpush.sendNotification(
      {
        endpoint: target.endpoint,
        keys: { p256dh: target.p256dh, auth: target.auth },
      },
      payload,
      { TTL: 60 * 60 * 24, urgency: "normal" }
    );
    return "sent";
  } catch (err) {
    const status = err instanceof WebPushError ? err.statusCode : 0;
    if (status === 404 || status === 410) {
      await deleteSubscription(target.endpoint);
      return "pruned";
    }
    return "failed";
  }
}

/** Fan out to many subscriptions, pruning the dead ones as it goes. */
export async function sendToTargets(
  targets: Target[],
  payload: PushPayload
): Promise<SendResult & { ok: boolean; error?: string }> {
  const result: SendResult = { sent: 0, failed: 0, pruned: 0 };

  if (!ensureVapid()) {
    return { ...result, ok: false, error: "Push is not configured on the server." };
  }
  const body = encodePayload(payload);
  if (!body) {
    return { ...result, ok: false, error: "Notification is too long." };
  }
  if (targets.length === 0) return { ...result, ok: true };

  // Chunked rather than one big Promise.all: a broadcast to a few thousand
  // devices would otherwise open a few thousand sockets at once and get the
  // function killed for memory long before the push service rate-limits it.
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const outcomes = await Promise.all(
      targets.slice(i, i + CONCURRENCY).map((t) => sendOne(t, body))
    );
    for (const outcome of outcomes) result[outcome === "sent" ? "sent" : outcome] += 1;
  }

  return { ...result, ok: true };
}

/** Send to exactly one endpoint — the "send a test" path. */
export async function sendToEndpoint(endpoint: string, payload: PushPayload) {
  const row = await prisma.pushSubscription
    .findUnique({
      where: { endpoint },
      select: { endpoint: true, p256dh: true, auth: true },
    })
    .catch(() => null);

  if (!row) {
    return { ok: false as const, sent: 0, failed: 0, pruned: 0, error: "Subscription not found." };
  }
  return sendToTargets([row], payload);
}

/**
 * Send to every stored subscription, or to one customer's devices.
 *
 * Reads in pages so a large list never materialises in one query — `iad1` is a
 * long way from `ap-south-1` (see the TTFB note in CLAUDE.md) and a single
 * huge row set is the kind of thing that times the function out.
 */
export async function broadcast(
  payload: PushPayload,
  opts: { userId?: string } = {}
): Promise<SendResult & { ok: boolean; error?: string }> {
  const total: SendResult = { sent: 0, failed: 0, pruned: 0 };
  const where = opts.userId ? { userId: opts.userId } : {};
  const PAGE = 500;

  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.pushSubscription.findMany({
      where,
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    if (rows.length === 0) break;

    const page = await sendToTargets(rows, payload);
    if (!page.ok) return { ...total, ok: false, error: page.error };

    total.sent += page.sent;
    total.failed += page.failed;
    total.pruned += page.pruned;

    if (rows.length < PAGE) break;
    cursor = rows[rows.length - 1].id;
  }

  return { ...total, ok: true };
}

/**
 * Every device belonging to these accounts.
 *
 * The unit is an **account**, not an address, because that is the only link
 * this schema has between a person and a device — `PushSubscription.userId` is
 * the whole of it. Turning "the customer on this order" into a set of account
 * ids is `lib/push-dispatch.ts`'s job; turning account ids into devices is
 * this one's.
 *
 * `take` is a bound, not a policy: nobody legitimately has more devices than
 * this, and an unbounded read here would hand a single automation job an
 * arbitrarily large fan-out.
 */
export async function targetsForUsers(
  userIds: string[],
  limit = 20
): Promise<PushTarget[]> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return [];
  return prisma.pushSubscription
    .findMany({
      where: { userId: { in: ids } },
      orderBy: { lastSeenAt: "desc" },
      take: limit,
      select: { endpoint: true, p256dh: true, auth: true },
    })
    .catch(() => []);
}

/** How many devices these accounts have between them. */
export async function countTargetsForUsers(userIds: string[]): Promise<number> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  return prisma.pushSubscription
    .count({ where: { userId: { in: ids } } })
    .catch(() => 0);
}

/** Count of live subscriptions, for the admin screen. */
export async function countSubscriptions(): Promise<{ total: number; signedIn: number }> {
  const [total, signedIn] = await Promise.all([
    prisma.pushSubscription.count().catch(() => 0),
    prisma.pushSubscription.count({ where: { NOT: { userId: null } } }).catch(() => 0),
  ]);
  return { total, signedIn };
}
