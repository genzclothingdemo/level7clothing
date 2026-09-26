/*
 * Level7 Clothing service worker.
 *
 * Scope is deliberately narrow. This is a storefront with live prices, stock
 * and a logged-in account area, so the worker exists to make the site
 * installable and survive a dropped connection — NOT to aggressively cache
 * pages. Anything that could show one shopper another shopper's data, or a
 * stale price, is excluded outright.
 *
 * Bump CACHE_VERSION when the caching strategy itself changes. Day-to-day
 * deploys do not need a bump: navigations are network-first, and the in-app
 * update watcher clears these caches when it sees a new deployment.
 */
const CACHE_VERSION = "v1";
const STATIC_CACHE = `l7-static-${CACHE_VERSION}`;
const PAGE_CACHE = `l7-pages-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline.html";

/**
 * Never touched by the worker: request-specific, private, or money.
 * Matched against the pathname.
 */
const NEVER_CACHE = [
  /^\/api\//,
  /^\/admin(\/|$)/,
  /^\/account(\/|$)/,
  /^\/checkout(\/|$)/,
  /^\/cart(\/|$)/,
  /^\/order(\/|$)/,
  /^\/wishlist(\/|$)/,
];

const isNeverCached = (pathname) => NEVER_CACHE.some((re) => re.test(pathname));

/** Build output is content-hashed and immutable, so it is safe to serve from cache first. */
const isImmutableAsset = (pathname) =>
  pathname.startsWith("/_next/static/") ||
  pathname.startsWith("/icons/") ||
  pathname === "/favicon.ico";

const isImage = (request) =>
  request.destination === "image" ||
  /\.(?:png|jpe?g|gif|webp|avif|svg)$/i.test(new URL(request.url).pathname);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // `reload` bypasses the HTTP cache so a stale offline page can't be
      // baked in at install time.
      await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
      // Take over as soon as possible; the update watcher relies on a new
      // worker actually becoming active rather than waiting for every tab.
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, PAGE_CACHE]);
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith("l7-") && !keep.has(n)).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  const type = event.data?.type;
  if (type === "SKIP_WAITING") {
    void self.skipWaiting();
    return;
  }
  // Used by the update watcher to make a reload genuinely "hard" — otherwise
  // the new deployment can still be served yesterday's cached shell.
  if (type === "CLEAR_CACHES") {
    event.waitUntil(
      (async () => {
        const names = await caches.keys();
        await Promise.all(names.filter((n) => n.startsWith("l7-")).map((n) => caches.delete(n)));
        event.ports?.[0]?.postMessage({ ok: true });
      })()
    );
  }
});

/* ------------------------------------------------------------------ */
/*  Web push                                                           */
/*                                                                     */
/*  Entirely separate from the caching above — these handlers never     */
/*  touch a cache and the fetch handler below is unchanged. The one     */
/*  request made here goes to /api/push/subscribe, which the            */
/*  NEVER_CACHE list already excludes.                                  */
/* ------------------------------------------------------------------ */

/**
 * Fallbacks for a push that arrives with no usable payload.
 *
 * Deliberately brand-neutral: the worker is a static file and cannot read
 * `SiteSettings`, and a hardcoded brand name here would be the one string in
 * the app that survives a rename in Admin → Settings. Every push we actually
 * send carries its own title; this is the "something went wrong upstream"
 * path, and the OS already labels the notification with the installed app.
 */
const PUSH_FALLBACK = {
  title: "New notification",
  body: "Open the app for the latest.",
  url: "/",
};
const NOTIFICATION_ICON = "/icons/icon-192.png";
const NOTIFICATION_BADGE = "/icons/icon-maskable-192.png";

/**
 * Buzz pattern: a short double tap, not a long single one.
 *
 * Android and desktop Chrome honour this; iOS, macOS and Firefox ignore it
 * silently. It is `[ms on, ms off, ms on]`.
 */
const NOTIFICATION_VIBRATE = [90, 60, 90];

/**
 * Read a push payload without ever throwing.
 *
 * A push can legitimately carry no data at all, and an encryption or encoding
 * mismatch produces a body that is not JSON. Neither may be allowed to reject
 * the handler: with `userVisibleOnly: true` a push that shows no notification
 * makes the browser display its own "this site was updated in the background"
 * message, and repeat offences cost the site its permission outright.
 */
function readPushData(event) {
  let raw = null;
  try {
    raw = event.data ? event.data.json() : null;
  } catch {
    // Not JSON. A plain string is still worth showing as the body.
    try {
      const text = event.data ? event.data.text() : "";
      raw = text ? { body: text } : null;
    } catch {
      raw = null;
    }
  }

  const data = raw && typeof raw === "object" ? raw : {};
  const str = (value, max) =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, max) : "";

  // Only same-origin paths are followed. An absolute URL in a payload would
  // turn the notification tray into an open redirect.
  const path = str(data.url, 512);
  const url = path.startsWith("/") && !path.startsWith("//") ? path : PUSH_FALLBACK.url;

  return {
    title: str(data.title, 120) || PUSH_FALLBACK.title,
    body: str(data.body, 300) || PUSH_FALLBACK.body,
    url,
    tag: str(data.tag, 64) || undefined,
  };
}

/**
 * Build the `showNotification` options.
 *
 * ## `renotify` is the fix for "the second one never arrives"
 *
 * A `tag` is a collapse key: a new notification carrying a tag **replaces** the
 * one already on screen instead of stacking. Without `renotify`, the platform
 * does that replacement *quietly* — no banner, no sound, no buzz. The row in
 * Notification Centre updates and nothing tells anyone.
 *
 * That is exactly what "Send a test" looked like. The first test appeared; the
 * second, third and fourth all carried `tag: "l7-test"`, so they silently
 * overwrote it and the store looked broken while the push service was
 * returning 201 every time.
 *
 * `renotify: true` says "replace it, but alert me again". It is only legal
 * **with** a tag — Chrome throws `TypeError: renotify without tag` otherwise —
 * which is why it is set inside the `tag` branch and nowhere else.
 *
 * `silent` is pinned `false` rather than left to default, because that is the
 * one flag that would mute the OS sound, and a payload must never be able to
 * reach it.
 */
function notificationOptions(data) {
  const options = {
    body: data.body,
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_BADGE,
    vibrate: NOTIFICATION_VIBRATE,
    silent: false,
    timestamp: Date.now(),
    // The click target rides on the notification itself, so
    // `notificationclick` needs no state of its own.
    data: { url: data.url },
  };

  if (data.tag) {
    options.tag = data.tag;
    options.renotify = true;
  }

  return options;
}

self.addEventListener("push", (event) => {
  const data = readPushData(event);

  event.waitUntil(
    (async () => {
      // Tell any open, visible tab so it can play the in-app chime. The OS
      // sound is the OS's business and cannot be chosen from here, but a
      // notification that lands while someone is already looking at the store
      // is the one case where the platform often plays nothing at all.
      await chimeOpenClients(data);

      try {
        await self.registration.showNotification(data.title, notificationOptions(data));
        return;
      } catch {
        /* an option was rejected — retry with only what every platform takes */
      }

      try {
        // Keep the body and the click target: a notification that says the
        // right thing and opens the right page is still the whole point.
        await self.registration.showNotification(data.title, {
          body: data.body,
          data: { url: data.url },
        });
        return;
      } catch {
        /* still refused — fall through to the bare minimum */
      }

      try {
        await self.registration.showNotification(PUSH_FALLBACK.title, {
          body: PUSH_FALLBACK.body,
        });
      } catch {
        // Every attempt failed, which means the platform is refusing to show
        // anything at all. Swallow it: a rejected `waitUntil` adds an
        // unhandled rejection on top of a notification that was never going
        // to appear, and changes nothing the shopper can see.
      }
    })()
  );
});

/**
 * Nudge open tabs to play the in-app chime.
 *
 * A service worker has no document and no audio, so it cannot make a sound
 * itself — it can only ask a page to. Only **visible** clients are asked:
 * a backgrounded tab would double up with the OS notification sound, and two
 * sounds for one event is worse than one.
 *
 * Failure here must never stop the notification being shown, so every step is
 * guarded and the caller does not depend on the result.
 */
async function chimeOpenClients(data) {
  try {
    const clients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    for (const client of clients) {
      if (client.visibilityState !== "visible") continue;
      client.postMessage({
        type: "L7_PUSH",
        title: data.title,
        body: data.body,
        url: data.url,
      });
    }
  } catch {
    /* no clients, or postMessage refused — the notification still shows */
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target = new URL(
    (event.notification.data && event.notification.data.url) || PUSH_FALLBACK.url,
    self.location.origin
  );

  event.waitUntil(
    (async () => {
      // `includeUncontrolled` matters: a tab opened before this worker took
      // control is still the shopper's open window, and stealing focus back to
      // it is far better than opening a second copy of the store.
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of windows) {
        if (new URL(client.url).origin !== target.origin) continue;
        try {
          // Older WebKit has focus() but not navigate(); focusing the existing
          // tab is the important half, so a failed navigate is not fatal.
          if ("navigate" in client && client.url !== target.href) {
            await client.navigate(target.href).catch(() => {});
          }
          return await client.focus();
        } catch {
          /* client went away between matchAll and focus — fall through */
        }
      }

      return self.clients.openWindow(target.href);
    })()
  );
});

/**
 * Browsers rotate push subscriptions on their own schedule. When that happens
 * there is no page running to notice, so the worker has to re-register the new
 * endpoint itself — otherwise the device goes quiet and neither the shopper
 * nor the store ever finds out.
 *
 * This is also the reason `/api/push/subscribe` exists as a route handler: a
 * service worker cannot call a Next.js server action.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        // Some browsers hand us the replacement; the rest expect us to make
        // one, reusing the application server key from the old subscription.
        let fresh = event.newSubscription || null;
        if (!fresh) {
          const key = event.oldSubscription?.options?.applicationServerKey;
          if (!key) return;
          fresh = await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: key,
          });
        }
        if (!fresh) return;

        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Carries the session cookie, so a subscription that belonged to a
          // signed-in customer stays attached to their account.
          credentials: "include",
          body: JSON.stringify({ subscription: fresh.toJSON() }),
        });
      } catch {
        /* offline or permission revoked — the next page load re-syncs */
      }
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only ever interfere with same-origin GETs. Touching POSTs would break
  // checkout and every server action on the site.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isNeverCached(url.pathname)) return;

  // Next.js data/RSC payloads vary by more than the URL; letting the worker
  // answer them from cache desynchronises the router.
  if (url.searchParams.has("_rsc") || request.headers.get("RSC") === "1") return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (isImmutableAsset(url.pathname)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (isImage(request)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
  }
});

/**
 * Network-first. Prices, stock and the announcement bar must be current, so the
 * network always wins when it is available; the cache is a fallback for a
 * dropped connection only.
 */
async function handleNavigation(request) {
  try {
    const fresh = await fetch(request);
    if (fresh.ok && fresh.type === "basic") {
      const cache = await caches.open(PAGE_CACHE);
      await cache.put(request, fresh.clone());
    }
    return fresh;
  } catch {
    const cached = await caches.match(request, { ignoreSearch: false });
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const fresh = await fetch(request);
    if (fresh.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(request, fresh.clone());
    }
    return fresh;
  } catch {
    return new Response("", { status: 504, statusText: "Offline" });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cached = await caches.match(request);
  const network = fetch(request)
    .then(async (fresh) => {
      if (fresh.ok) {
        const cache = await caches.open(cacheName);
        await cache.put(request, fresh.clone());
      }
      return fresh;
    })
    .catch(() => null);

  if (cached) return cached;
  const fresh = await network;
  return fresh ?? new Response("", { status: 504, statusText: "Offline" });
}
