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
