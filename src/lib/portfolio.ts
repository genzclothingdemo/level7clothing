/**
 * portfolio — the admin-managed body of work shown at /portfolio.
 *
 * This replaces the hardcoded `CURATED_POSTS` grid. The page is deliberately
 * **not** Instagram-only: a reel, a blog post, a bulk-order job and a
 * collaboration are all the same kind of thing to the owner, and only one of
 * them happens to live on Instagram.
 *
 * Three decisions worth keeping:
 *
 * 1. **One seam for "is this live?".** `fetchInstagramMedia()` below is the
 *    only function that knows whether a real Graph API token exists. Every
 *    caller goes through `getPortfolio()` and gets the same shape either way,
 *    so wiring a token in later changes nothing downstream. See the block
 *    comment on that function for the exact steps.
 *
 * 2. **Nothing here fabricates a feed.** With no token the page shows stored
 *    `PortfolioItem` rows and says, on screen, that they are curated. An
 *    invented "live" feed would be worse than an honest curated one.
 *
 * 3. **`productId` is a plain column, not a relation** (see schema.prisma). A
 *    portfolio entry outlives the product it was about, so the id is resolved
 *    here and the link is simply dropped when the product is gone or
 *    deactivated. A dangling id never breaks the page.
 */

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { resolveVideo } from "@/lib/videos";
import type { ProductVideo } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Shape                                                              */
/* ------------------------------------------------------------------ */

export const PORTFOLIO_KINDS = ["instagram", "link", "image", "video"] as const;
export type PortfolioKind = (typeof PORTFOLIO_KINDS)[number];

/** Anything unrecognised reads as a plain link — the least surprising default. */
export function asPortfolioKind(value: string): PortfolioKind {
  return (PORTFOLIO_KINDS as readonly string[]).includes(value)
    ? (value as PortfolioKind)
    : "link";
}

/**
 * The two shelves on the storefront.
 *
 * "products" is everything that points at something buyable; "other" is the
 * rest of the work. Two tabs rather than a filter dropdown because there are
 * exactly two questions a visitor arrives with: "show me the clothes" and
 * "show me what else you do".
 */
export const PORTFOLIO_VIEWS = ["products", "other"] as const;
export type PortfolioView = (typeof PORTFOLIO_VIEWS)[number];

export function asPortfolioView(raw: string | string[] | undefined): PortfolioView {
  const first = Array.isArray(raw) ? raw[0] : raw;
  return first === "other" ? "other" : "products";
}

/** The product a portfolio entry points at, once the id has been resolved. */
export type PortfolioProductRef = {
  id: string;
  slug: string;
  name: string;
  image: string | null;
};

/**
 * Where one entry came from. Kept on the entry because the storefront says so
 * out loud — a visitor should be able to tell a curated row from a live one.
 */
export type PortfolioSource =
  /** A `PortfolioItem` row the admin wrote. */
  | "portfolio"
  /** Derived from `Product.videos` — the links already on the product page. */
  | "product-video"
  /** Pulled live from the Instagram Graph API. Only possible with a token. */
  | "instagram-api";

/** One tile. Everything the grid needs, already resolved — no lookups in render. */
export type PortfolioEntry = {
  id: string;
  kind: PortfolioKind;
  title: string;
  description: string | null;
  /** Where "open" goes when there is nothing to embed. */
  url: string | null;
  /** Poster for the grid. Never an embed — see requirement 3. */
  thumbnail: string | null;
  /**
   * Whether `thumbnail` may go through `next/image`, decided here rather than
   * in the grid. The grid is a client component and this module imports
   * Prisma, so a runtime import across that boundary would drag the database
   * client into the browser bundle. Resolving it onto the entry keeps the
   * boundary clean and the render branch a plain boolean.
   */
  thumbnailOptimisable: boolean;
  /** An iframe src, when one could be worked out safely. */
  embedUrl: string | null;
  /** Portrait framing for reels/shorts, landscape otherwise. */
  vertical: boolean;
  tags: string[];
  isFeatured: boolean;
  product: PortfolioProductRef | null;
  source: PortfolioSource;
};

export type PortfolioData = {
  /** Entries that point at a product. */
  products: PortfolioEntry[];
  /** Everything else — blog links, collaborations, bulk work. */
  other: PortfolioEntry[];
  /** True only when a token is set AND the fetch actually returned media. */
  live: boolean;
  /** True when `INSTAGRAM_ACCESS_TOKEN` is set, whether or not it worked. */
  tokenConfigured: boolean;
  /** Set when a token exists but the call failed — the admin needs to know. */
  liveError: string | null;
};

/* ------------------------------------------------------------------ */
/*  Safety helpers                                                     */
/* ------------------------------------------------------------------ */

/**
 * A destination the store is willing to put in an `href`.
 *
 * Same rule as the promotions editor: site-relative paths and http(s) only.
 * `//evil.example` is rejected explicitly because it *looks* relative and is
 * not — the browser reads it as protocol-relative and leaves the site.
 * Everything else (`javascript:`, `data:`) fails the protocol check.
 */
export function isSafeHref(value: string): boolean {
  if (value.startsWith("//")) return false;
  if (value.startsWith("/")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Can `next/image` serve this URL?
 *
 * `next.config.ts` allows exactly two remote hosts (Vercel Blob and YouTube
 * poster frames). An unlisted host does not degrade — the optimiser returns
 * **400 and the tile renders broken**, which is the kind of failure that only
 * shows up once a real Instagram CDN URL is in the database. So anything else
 * is served through a plain `<img>` instead of being optimised.
 *
 * This is also why live Instagram thumbnails work without a config change:
 * `scontent.cdninstagram.com` is not allow-listed and never needs to be.
 */
export function isOptimisableImage(url: string): boolean {
  if (url.startsWith("//")) return false;
  if (url.startsWith("/")) return true;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    if (u.hostname.endsWith(".public.blob.vercel-storage.com")) return true;
    if (u.hostname === "i.ytimg.com" && u.pathname.startsWith("/vi/")) return true;
    return false;
  } catch {
    return false;
  }
}

/** Hosts we are willing to mount in an iframe. */
const EMBED_HOSTS = [
  "www.youtube.com",
  "youtube.com",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
  "player.vimeo.com",
  "www.instagram.com",
  "instagram.com",
  "www.facebook.com",
];

/**
 * Pull a usable iframe `src` out of admin-pasted oEmbed HTML.
 *
 * **We never render `embedHtml` with `dangerouslySetInnerHTML`.** Two reasons,
 * and the second is the one that actually decides it:
 *
 * 1. It is a stored-XSS hole one compromised admin session wide, on a page
 *    every shopper loads.
 * 2. It would not even work. Instagram's own oEmbed payload is a
 *    `<blockquote>` plus a `<script>` tag, and React does not execute injected
 *    scripts — so the "embed" would render as an unstyled quote block.
 *
 * Extracting the `src` and mounting our own sandboxed iframe gives the real
 * feature with none of that. Anything we cannot parse falls back to a link-out,
 * which is always safe.
 */
export function embedSrcFromHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const match = /<iframe[^>]*\ssrc=["']([^"']+)["']/i.exec(html);
  if (!match) return null;
  const src = match[1].trim();
  try {
    const u = new URL(src, "https://example.invalid");
    if (u.protocol !== "https:") return null;
    return EMBED_HOSTS.includes(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Picks the first usable poster and decides how it has to be served. */
function thumbOf(
  ...candidates: (string | null | undefined)[]
): { thumbnail: string | null; thumbnailOptimisable: boolean } {
  const found = candidates.find((c) => typeof c === "string" && c.trim()) ?? null;
  const thumbnail = found ? found.trim() : null;
  return {
    thumbnail,
    thumbnailOptimisable: thumbnail ? isOptimisableImage(thumbnail) : false,
  };
}

/** Lower-cased, fragment-free URL used only for de-duplication. */
function dedupeKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    u.hash = "";
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase() || null;
  }
}

/* ------------------------------------------------------------------ */
/*  The live-mirror seam                                               */
/* ------------------------------------------------------------------ */

/**
 * THE ONE FUNCTION that decides whether this page is a live mirror.
 *
 * Today it returns `null` on every deployment, because no token is configured
 * — and `getPortfolio()` then serves the stored rows. Nothing else in the
 * codebase needs to change when that stops being true.
 *
 * ## Exactly what to do to make it live
 *
 * 1. The account must be an Instagram **Business or Creator** account linked
 *    to a Facebook Page. A personal account cannot be read by this API at all;
 *    no token will help.
 * 2. Create a Meta app, add the "Instagram Graph API" product, and generate a
 *    **long-lived user access token** with `instagram_basic`.
 * 3. Put it in Vercel as `INSTAGRAM_ACCESS_TOKEN` (mark it Sensitive) and in
 *    `.env` locally. Nothing else here changes — the presence of the variable
 *    is the switch.
 * 4. **The token expires every 60 days.** Refresh it via
 *    `GET /refresh_access_token?grant_type=ig_refresh_token`. When it lapses
 *    this function logs, returns `null`, and the page silently falls back to
 *    the stored rows rather than going blank — that fallback is the whole
 *    reason the rows are kept.
 *
 * The response is cached for 15 minutes: the rate limit is low and this runs
 * on every page load.
 */
async function fetchInstagramMedia(): Promise<
  { entries: PortfolioEntry[] } | { error: string } | null
> {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN?.trim();
  if (!token) return null;

  const fields =
    "id,caption,media_type,media_url,permalink,thumbnail_url,timestamp";
  const url =
    `https://graph.instagram.com/me/media?fields=${fields}` +
    `&limit=50&access_token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch(url, { next: { revalidate: 900 } });
    if (!res.ok) {
      // The token is the usual cause, and it is worth naming: a silent empty
      // grid on the storefront looks identical to "we posted nothing".
      const detail = res.status === 400 ? "token rejected or expired" : `HTTP ${res.status}`;
      console.error(`[portfolio] Instagram fetch failed: ${detail}`);
      return { error: detail };
    }

    const json = (await res.json()) as {
      data?: {
        id: string;
        caption?: string;
        media_type?: string;
        media_url?: string;
        permalink?: string;
        thumbnail_url?: string;
      }[];
    };

    const entries: PortfolioEntry[] = (json.data ?? []).map((m) => {
      const isVideo = m.media_type === "VIDEO";
      // A caption is a paragraph, not a title. First line, clipped.
      const firstLine = (m.caption ?? "").split("\n")[0]?.trim() ?? "";
      return {
        id: `ig-${m.id}`,
        kind: "instagram" as const,
        title: firstLine.slice(0, 80) || "Instagram post",
        description: (m.caption ?? "").trim() || null,
        url: m.permalink ?? null,
        // VIDEO items give `thumbnail_url`; images only give `media_url`.
        // Both are Instagram CDN hosts, which are deliberately not in
        // `next.config.ts` — `thumbOf` marks them unoptimisable so they are
        // served through a plain <img> and no config change is ever needed.
        ...thumbOf(m.thumbnail_url, m.media_url),
        embedUrl: m.permalink ? `${m.permalink.replace(/\/+$/, "")}/embed` : null,
        vertical: isVideo,
        tags: [],
        isFeatured: false,
        product: null,
        source: "instagram-api" as const,
      };
    });

    return { entries };
  } catch (error) {
    console.error("[portfolio] Instagram fetch threw:", error);
    return { error: "network error" };
  }
}

/* ------------------------------------------------------------------ */
/*  Reads                                                              */
/* ------------------------------------------------------------------ */

/** Resolve stored `productId`s to the fields a tile needs. Missing ids vanish. */
async function resolveProducts(
  ids: string[]
): Promise<Map<string, PortfolioProductRef>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const rows = await prisma.product
    .findMany({
      where: { id: { in: unique }, isActive: true },
      select: { id: true, slug: true, name: true, images: true },
    })
    .catch(() => []);

  return new Map(
    rows.map((p) => [
      p.id,
      {
        id: p.id,
        slug: p.slug,
        name: p.name,
        image: p.images[0] ?? null,
      },
    ])
  );
}

/**
 * Turn `Product.videos` into portfolio entries.
 *
 * These are the Instagram reels and YouTube clips the owner already pasted
 * into each product, so the portfolio surfaces work that is otherwise buried
 * one click below the fold of a single product page. Nothing is copied into
 * the database — this is a read, so a link edited on the product updates here
 * with no sync step to forget.
 */
async function productVideoEntries(): Promise<PortfolioEntry[]> {
  const rows = await prisma.product
    .findMany({
      where: { isActive: true },
      select: { id: true, slug: true, name: true, images: true, videos: true },
      orderBy: { createdAt: "desc" },
    })
    .catch(() => []);

  const out: PortfolioEntry[] = [];

  for (const p of rows) {
    const list = Array.isArray(p.videos) ? (p.videos as unknown as ProductVideo[]) : [];
    list.forEach((raw, i) => {
      if (!raw || typeof raw.url !== "string" || !raw.url.trim()) return;
      const v = resolveVideo(raw);
      if (!isSafeHref(v.url)) return;

      out.push({
        id: `pv-${p.id}-${i}`,
        kind: v.provider === "instagram" ? "instagram" : "video",
        title: v.title && v.title !== "Watch" ? v.title : p.name,
        description: null,
        url: v.url,
        ...thumbOf(v.thumbnailUrl, p.images[0]),
        embedUrl: v.embedUrl,
        vertical: v.vertical,
        tags: [],
        isFeatured: false,
        product: {
          id: p.id,
          slug: p.slug,
          name: p.name,
          image: p.images[0] ?? null,
        },
        source: "product-video",
      });
    });
  }

  return out;
}

/** A stored row → a tile, with the product already looked up. */
function rowToEntry(
  row: {
    id: string;
    kind: string;
    title: string;
    description: string | null;
    url: string | null;
    imageUrl: string | null;
    embedHtml: string | null;
    productId: string | null;
    tags: string[];
    isFeatured: boolean;
  },
  products: Map<string, PortfolioProductRef>
): PortfolioEntry {
  const kind = asPortfolioKind(row.kind);
  const product = row.productId ? products.get(row.productId) ?? null : null;

  // The admin's own oEmbed wins; otherwise we work the embed out from the URL
  // with the same resolver the product page uses, so a reel pasted here
  // behaves exactly as it does there.
  const resolved =
    row.url && isSafeHref(row.url)
      ? resolveVideo({ title: row.title, url: row.url })
      : null;

  const embedUrl = embedSrcFromHtml(row.embedHtml) ?? resolved?.embedUrl ?? null;

  return {
    id: row.id,
    kind,
    title: row.title,
    description: row.description,
    url: row.url && isSafeHref(row.url) ? row.url : null,
    ...thumbOf(row.imageUrl, resolved?.thumbnailUrl, product?.image),
    embedUrl,
    // Instagram is reels-first, so an entry the admin marked Instagram is
    // framed portrait unless the resolver knows better.
    vertical: resolved?.vertical ?? kind === "instagram",
    tags: row.tags,
    isFeatured: row.isFeatured,
    product,
    source: "portfolio",
  };
}

/**
 * Everything the /portfolio page renders, in one call.
 *
 * Ordering rule: featured first, then the admin's `sortOrder`. Product videos
 * come after the curated rows in the products shelf, because a row someone
 * deliberately wrote should outrank one that was inferred.
 *
 * Wrapped in React `cache()` for per-request dedup — the same reason
 * `getProductBySlug` and `getSettings` are (CLAUDE.md). `generateMetadata` has
 * to know the real page count to emit a correct canonical for an out-of-range
 * `?page=`, and without this that alone would double every query on the route.
 */
export const getPortfolio = cache(async function getPortfolio(): Promise<PortfolioData> {
  const [rows, live] = await Promise.all([
    prisma.portfolioItem
      .findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      })
      .catch((error: unknown) => {
        // A dead database must not take the page down with a 500 here — unlike
        // a product, a missing portfolio is not a deleted URL. But never fail
        // silently: an empty grid and a broken query look identical.
        console.error("[portfolio] could not load items:", error);
        return [];
      }),
    fetchInstagramMedia(),
  ]);

  const products = await resolveProducts(
    rows.map((r) => r.productId).filter((v): v is string => Boolean(v))
  );

  const curated = rows.map((r) => rowToEntry(r, products));

  // ---- merge the live feed, if there is one ----
  const liveEntries = live && "entries" in live ? live.entries : [];
  const liveError = live && "error" in live ? live.error : null;

  const curatedKeys = new Set(
    curated.map((e) => dedupeKey(e.url)).filter((v): v is string => Boolean(v))
  );
  // Curation wins on anything already written up: the stored row carries the
  // description, the product link and the chosen position. The live feed only
  // adds what nobody has curated yet.
  const freshLive = liveEntries.filter((e) => {
    const key = dedupeKey(e.url);
    return key === null || !curatedKeys.has(key);
  });

  // ---- product videos, minus anything already curated ----
  const videos = await productVideoEntries();
  const seen = new Set([
    ...curatedKeys,
    ...freshLive.map((e) => dedupeKey(e.url)).filter((v): v is string => Boolean(v)),
  ]);
  const freshVideos = videos.filter((e) => {
    const key = dedupeKey(e.url);
    if (key === null) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const byFeatured = (a: PortfolioEntry, b: PortfolioEntry) =>
    Number(b.isFeatured) - Number(a.isFeatured);

  const withProduct = [...curated.filter((e) => e.product)].sort(byFeatured);
  const withoutProduct = [...curated.filter((e) => !e.product), ...freshLive].sort(
    byFeatured
  );

  return {
    products: [...withProduct, ...freshVideos],
    other: withoutProduct,
    live: freshLive.length > 0 || liveEntries.length > 0,
    tokenConfigured: Boolean(process.env.INSTAGRAM_ACCESS_TOKEN?.trim()),
    liveError,
  };
});

/**
 * The homepage strip: a handful of tiles, featured first.
 *
 * Falls back to nothing rather than throwing — the homepage must render even
 * when this table is empty or unreachable, and the section hides itself.
 */
export async function getPortfolioHighlights(limit = 6): Promise<PortfolioEntry[]> {
  const rows = await prisma.portfolioItem
    .findMany({
      where: { isActive: true },
      orderBy: [{ isFeatured: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
      take: limit,
    })
    .catch((error: unknown) => {
      console.error("[portfolio] could not load highlights:", error);
      return [];
    });

  const products = await resolveProducts(
    rows.map((r) => r.productId).filter((v): v is string => Boolean(v))
  );

  return rows.map((r) => rowToEntry(r, products));
}

/* ------------------------------------------------------------------ */
/*  Admin reads                                                        */
/* ------------------------------------------------------------------ */

/** Products offered in the "about one product" picker. Active only. */
export async function listLinkableProducts(): Promise<
  { id: string; name: string }[]
> {
  return prisma.product
    .findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    })
    .catch(() => []);
}

/**
 * Re-exported so a page that already imports from here needs one import, not
 * two. The definition stays in `lib/instagram.ts` because that module is
 * Prisma-free and therefore safe to import from a client component — this one
 * is not.
 */
export { instagramHandle } from "@/lib/instagram";
