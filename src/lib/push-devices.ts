import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * The subscriber list behind Admin → Notifications.
 *
 * ## Why this exists
 *
 * The screen used to say "2 devices opted in · 1 linked to an account" and
 * nothing else. When the owner asks "are notifications working?", what they
 * actually want to know is "**is my phone on that list, and when did it last
 * check in?**" — and a bare count cannot answer it. Diagnosing this feature
 * meant querying the database by hand to find out that the one subscription was
 * an iPhone on iOS 18.7 talking to Apple's push service. Anything that has to
 * be learned from a SQL prompt belongs on the screen instead.
 *
 * ## What is deliberately NOT returned
 *
 * **The endpoint.** A push endpoint is a capability URL: anyone holding it can
 * be handed to `web-push` and, with the private VAPID key, send to that device.
 * It is also stable and unique per install, so it is a device identifier. It
 * has no business being rendered into HTML, copied into a screenshot, or sat in
 * a browser's view-source. Only the push *service* host is derived from it,
 * which is what names the platform.
 */

export type PushDevice = {
  id: string;
  /** "iPhone / iOS 18.7", "Android", "Windows" — best effort, never a claim. */
  platform: string;
  /** "Safari", "Chrome", "Firefox", or "Unknown browser". */
  browser: string;
  /** "Apple", "Google", "Mozilla", "Microsoft" — whose push service holds it. */
  service: string;
  /** True when the subscription is attached to a customer account. */
  signedIn: boolean;
  lastSeenAt: Date;
  createdAt: Date;
};

/**
 * Which push service an endpoint belongs to.
 *
 * Matched on a suffix, never on the whole host: Google alone has used
 * `android.googleapis.com`, `fcm.googleapis.com` and regional variants, and a
 * list of exact hosts goes stale the first time one of them changes.
 */
function serviceOf(endpoint: string): string {
  let host = "";
  try {
    host = new URL(endpoint).hostname.toLowerCase();
  } catch {
    return "Unknown";
  }
  if (host.endsWith("push.apple.com")) return "Apple";
  if (host.endsWith("googleapis.com")) return "Google";
  if (host.endsWith("mozilla.com") || host.endsWith("mozaws.net")) return "Mozilla";
  if (host.endsWith("notify.windows.com") || host.endsWith("push.services.mozilla.com")) {
    return host.endsWith("notify.windows.com") ? "Microsoft" : "Mozilla";
  }
  return "Other";
}

/**
 * Read the platform out of a user agent string.
 *
 * User agents lie by design and this is a diagnostic label, not a decision —
 * nothing branches on the result. The iOS version is worth pulling out because
 * it is the one number that decides whether web push can work at all on an
 * iPhone (16.4 and up), so an old one on this list explains a silent device.
 */
function platformOf(ua: string | null): string {
  if (!ua) return "Unknown device";

  const ios = ua.match(/(?:iPhone|CPU) OS (\d+)[_.](\d+)/);
  if (/iPhone/.test(ua)) return ios ? `iPhone · iOS ${ios[1]}.${ios[2]}` : "iPhone";
  if (/iPad/.test(ua)) return ios ? `iPad · iPadOS ${ios[1]}.${ios[2]}` : "iPad";

  const android = ua.match(/Android (\d+)/);
  if (android) return `Android ${android[1]}`;

  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows NT/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return "Unknown device";
}

/** Order matters: Edge and Chrome both claim "Chrome", Safari claims neither. */
function browserOf(ua: string | null): string {
  if (!ua) return "Unknown browser";
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "Unknown browser";
}

/**
 * The most recently seen subscriptions.
 *
 * Capped rather than paginated: this screen answers "is my phone on here", and
 * a store with more devices than this has a different question. Failures return
 * an empty list — the count above it comes from its own query, and a device
 * table that 500s the whole page would be a worse outcome than a missing table.
 */
export async function listPushDevices(limit = 25): Promise<PushDevice[]> {
  const rows = await prisma.pushSubscription
    .findMany({
      take: limit,
      orderBy: { lastSeenAt: "desc" },
      select: {
        id: true,
        endpoint: true,
        userAgent: true,
        userId: true,
        lastSeenAt: true,
        createdAt: true,
      },
    })
    .catch(() => []);

  return rows.map((row) => ({
    id: row.id,
    platform: platformOf(row.userAgent),
    browser: browserOf(row.userAgent),
    service: serviceOf(row.endpoint),
    signedIn: row.userId !== null,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
  }));
}
