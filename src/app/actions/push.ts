"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { getAdminSession } from "@/lib/auth";
import { getUserSession } from "@/lib/user-auth";
import { getSettings } from "@/lib/settings";
import { rateLimit } from "@/lib/chat";
import {
  broadcast,
  countSubscriptions,
  deleteSubscription,
  isValidEndpoint,
  parseSubscription,
  pushConfigured,
  PUSH_LIMITS,
  saveSubscription,
  sendToEndpoint,
  subscriptionOwner,
} from "@/lib/push";

/**
 * Server actions for web push.
 *
 * The trust model, because it is the whole point of this file:
 *
 * - A **customer** may only ever touch the subscription whose endpoint their
 *   own browser minted. Possession of that endpoint string is the credential
 *   for an anonymous subscription; once a row carries a `userId` it belongs to
 *   that account and nobody else can unsubscribe it or aim a test at it.
 * - Only a signed-in **admin** may send to anyone other than themselves.
 * - Everything is rate limited, because "send a test" is an action that makes
 *   the server do outbound HTTPS work on request.
 *
 * `/api/push/subscribe` mirrors `subscribe`/`unsubscribe` as plain HTTP for
 * the service worker, which cannot call a server action.
 */

/** Opt-in and opt-out are cheap but should not be scriptable in a loop. */
const SUBSCRIBE_LIMIT = { limit: 12, windowMs: 60_000 };
/** A test push costs an outbound request, so it gets a much tighter budget. */
const TEST_LIMIT = { limit: 5, windowMs: 5 * 60_000 };
/** A broadcast fans out to every device. Admin-only and still throttled. */
const BROADCAST_LIMIT = { limit: 10, windowMs: 60 * 60_000 };

/** Best-effort caller identity for rate-limit buckets. */
async function callerKey(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return ip.slice(0, 64);
}

async function userAgent(): Promise<string | null> {
  const h = await headers();
  return h.get("user-agent");
}

/* ------------------------------------------------------------------ */
/*  Customer                                                           */
/* ------------------------------------------------------------------ */

export type PushActionResult = { ok: boolean; error?: string };

/**
 * Persist a subscription the browser just created.
 *
 * `sub` arrives as the JSON form of a `PushSubscription`. It is treated as
 * hostile input: `parseSubscription` checks the endpoint is a public HTTPS URL
 * and that both keys decode to the exact byte lengths the Web Push spec
 * requires, before a single character of it reaches the database.
 */
export async function subscribeToPush(sub: unknown): Promise<PushActionResult> {
  if (!pushConfigured()) {
    return { ok: false, error: "Notifications aren't set up on this store yet." };
  }
  if (!rateLimit(`push:sub:${await callerKey()}`, SUBSCRIBE_LIMIT.limit, SUBSCRIBE_LIMIT.windowMs)) {
    return { ok: false, error: "Too many attempts. Try again in a minute." };
  }

  const parsed = parseSubscription(sub);
  if (!parsed) return { ok: false, error: "That subscription wasn't valid." };

  const session = await getUserSession();

  try {
    await saveSubscription(parsed, {
      userId: session?.id ?? null,
      userAgent: await userAgent(),
    });
  } catch {
    return { ok: false, error: "Couldn't save your preference. Please try again." };
  }

  return { ok: true };
}

/**
 * Forget a subscription.
 *
 * Deleting a row that belongs to a *different* account is refused. Deleting
 * one that is already gone is a success — the browser has often already
 * unsubscribed locally by the time this runs, and reporting that as an error
 * would leave the UI stuck showing "on".
 */
export async function unsubscribeFromPush(endpoint: unknown): Promise<PushActionResult> {
  if (!isValidEndpoint(endpoint)) return { ok: false, error: "Unknown subscription." };
  if (!rateLimit(`push:sub:${await callerKey()}`, SUBSCRIBE_LIMIT.limit, SUBSCRIBE_LIMIT.windowMs)) {
    return { ok: false, error: "Too many attempts. Try again in a minute." };
  }

  const owner = await subscriptionOwner(endpoint);
  if (!owner.exists) return { ok: true };

  if (owner.userId) {
    const session = await getUserSession();
    if (session?.id !== owner.userId) return { ok: false, error: "Unknown subscription." };
  }

  await deleteSubscription(endpoint);
  return { ok: true };
}

/**
 * Prove the round trip: server → push service → service worker → tray.
 *
 * This is the only customer-facing send, and it can only ever target the
 * caller's own endpoint. It exists because "you're subscribed" is a claim, and
 * a notification that actually appears is proof.
 */
export async function sendTestPush(endpoint: unknown): Promise<PushActionResult> {
  if (!isValidEndpoint(endpoint)) return { ok: false, error: "Unknown subscription." };
  if (!rateLimit(`push:test:${await callerKey()}`, TEST_LIMIT.limit, TEST_LIMIT.windowMs)) {
    return { ok: false, error: "You've sent a few of those. Try again shortly." };
  }

  const owner = await subscriptionOwner(endpoint);
  if (!owner.exists) return { ok: false, error: "Turn notifications on first." };
  if (owner.userId) {
    const session = await getUserSession();
    if (session?.id !== owner.userId) return { ok: false, error: "Unknown subscription." };
  }

  // Brand name from settings, never hardcoded — renaming the store in
  // Admin → Settings has to rename it here too. `getSettings` is request
  // cached and falls back to defaults if the database is unreachable.
  const { brandName } = await getSettings();

  const result = await sendToEndpoint(endpoint, {
    title: "Notifications are on",
    body: `This is what an update from ${brandName} will look like.`,
    url: "/",
    tag: "l7-test",
  });

  if (!result.ok) return { ok: false, error: result.error ?? "Couldn't send the test." };
  if (result.sent === 0) {
    return {
      ok: false,
      error:
        result.pruned > 0
          ? "That subscription had expired. Turn notifications off and on again."
          : "The push service didn't accept it. Try again in a moment.",
    };
  }

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/*  Admin                                                              */
/* ------------------------------------------------------------------ */

const broadcastSchema = z.object({
  title: z.string().trim().min(1, "A title is required").max(PUSH_LIMITS.title),
  body: z.string().trim().max(PUSH_LIMITS.body),
  // Same-origin path only. `lib/push` re-checks this before it is encoded, so
  // an absolute URL can never reach a customer's notification tray.
  url: z
    .string()
    .trim()
    .max(PUSH_LIMITS.url)
    .refine((v) => v === "" || (v.startsWith("/") && !v.startsWith("//")), {
      message: "Link must be a path on this site, like /shop",
    }),
});

export type BroadcastResult = {
  ok: boolean;
  error?: string;
  sent?: number;
  failed?: number;
  pruned?: number;
};

/** Live subscription counts for the admin screen. Admin-only. */
export async function getPushStats(): Promise<{
  ok: boolean;
  configured: boolean;
  total: number;
  signedIn: number;
}> {
  const admin = await getAdminSession();
  if (!admin) return { ok: false, configured: false, total: 0, signedIn: 0 };
  const counts = await countSubscriptions();
  return { ok: true, configured: pushConfigured(), ...counts };
}

/**
 * Send to every subscribed device.
 *
 * Gated on a real admin session read from the signed cookie — not on being
 * reachable at an `/admin` URL. A server action is callable from anywhere once
 * its id is known, so route-level protection is not protection.
 */
export async function broadcastPush(input: {
  title: string;
  body: string;
  url: string;
}): Promise<BroadcastResult> {
  const admin = await getAdminSession();
  if (!admin) return { ok: false, error: "Not signed in as an admin." };

  if (!pushConfigured()) {
    return { ok: false, error: "VAPID keys are not set on this deployment." };
  }
  if (!rateLimit(`push:cast:${admin.id}`, BROADCAST_LIMIT.limit, BROADCAST_LIMIT.windowMs)) {
    return { ok: false, error: "Too many broadcasts in the last hour." };
  }

  const parsed = broadcastSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const { title, body, url } = parsed.data;
  const result = await broadcast({ title, body, url: url || "/" });

  if (!result.ok) return { ok: false, error: result.error ?? "Send failed." };
  return { ok: true, sent: result.sent, failed: result.failed, pruned: result.pruned };
}
