/**
 * portfolio — the admin-managed body of work shown at /portfolio.
 *
 * ## What this page is for, and what it stopped being
 *
 * It used to split into "From our products" and "Everything else", which made
 * it a second shop: the first shelf was a product grid with a Shop button on
 * every tile, and it was fed automatically from `Product.videos`, so adding a
 * link to a product silently published a portfolio tile about that product.
 *
 * The owner's ask was the opposite of that — *"product waha pe nahi chahiye"*.
 * A portfolio answers **who we are**, not **what is in stock**. So the page is
 * now organised by what a piece of work *says about the brand*:
 *
 *   who we are · milestones · reels & films · happy customers ·
 *   collaborations · bulk & custom work
 *
 * A piece may still *mention* a garment — `productId` is unchanged and the
 * tile still links to it — but the garment is a footnote on the tile, never
 * the organising idea, and there is no shelf whose subject is the catalogue.
 *
 * **`productVideoEntries()` is deliberately gone.** It read every active
 * product's `videos` array and published each one as a portfolio tile. That is
 * exactly the "second shop" behaviour, and because it was a derived read there
 * was no way for the owner to take one of those tiles down. Work that belongs
 * in the portfolio is now always a row somebody wrote.
 *
 * ## Four decisions worth keeping
 *
 * 1. **One seam for "is this live?".** `fetchInstagramMedia()` below is the
 *    only function that knows whether a real Graph API token exists. Every
 *    caller goes through `getPortfolio()` and gets the same shape either way.
 *
 * 2. **Nothing here fabricates a feed.** With no token the page shows stored
 *    `PortfolioItem` rows and says, on screen, that they are curated.
 *
 * 3. **`productId` is a plain column, not a relation** (see schema.prisma). A
 *    portfolio entry outlives the product it was about, so the id is resolved
 *    here and the link is simply dropped when the product is gone or
 *    deactivated. A dangling id never breaks the page.
 *
 * 4. **The section is derived from tags, not from a new column.** The schema
 *    is not ours to migrate, and a section is a curation decision the owner
 *    already expresses in words. See `SECTION` below for the exact rule.
 */

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { resolveVideo } from "@/lib/videos";

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
 * The shelves on /portfolio, in the order they are read down the page.
 *
 * This order is the argument the page makes: here is who we are, here is what
 * we have done, here is us moving, here is somebody else saying it, here is
 * who we work with, here is how to hire us. Reordering this array reorders the
 * page, and nothing else has to change.
 */
export const PORTFOLIO_SECTIONS = [
  "story",
  "milestones",
  "reels",
  "customers",
  "collabs",
  "bulk",
] as const;

export type PortfolioSection = (typeof PORTFOLIO_SECTIONS)[number];

/**
 * How each shelf introduces itself, and — `layout` — the card shape its
 * entries get.
 *
 * `layout` is the one thing the storefront branches on, so a new section is a
 * row in this table plus an entry in `PORTFOLIO_SECTIONS`, never a new
 * component:
 *
 * | layout | reads as | needs |
 * |---|---|---|
 * | `media` | poster that becomes a player | a thumbnail or an embed |
 * | `quote` | a testimonial, name underneath | a description |
 * | `stat` | a big figure and a line of context | a title |
 * | `note` | an editorial card, photo optional | anything |
 */
export const PORTFOLIO_SECTION_META: Record<
  PortfolioSection,
  { label: string; blurb: string; layout: "media" | "quote" | "stat" | "note" }
> = {
  story: {
    label: "Who we are",
    blurb: "The shoots, the notes and the thinking behind the label.",
    layout: "note",
  },
  milestones: {
    label: "Milestones",
    blurb: "What the label has done so far, in numbers we can stand behind.",
    layout: "stat",
  },
  reels: {
    label: "Reels & films",
    blurb: "Plays here — you don't have to leave for Instagram or YouTube.",
    layout: "media",
  },
  customers: {
    label: "Happy customers",
    blurb: "In their words, not ours.",
    layout: "quote",
  },
  collabs: {
    label: "Collaborations",
    blurb: "Creators, artists and the people we have made things with.",
    layout: "note",
  },
  bulk: {
    label: "Bulk & custom work",
    blurb: "Campus, corporate and made-to-order runs.",
    layout: "note",
  },
};

export function isPortfolioSection(value: string): value is PortfolioSection {
  return (PORTFOLIO_SECTIONS as readonly string[]).includes(value);
}

/**
 * Read `?section=` off the URL. `null` means "show the whole page", which is
 * the default and the canonical address — a single shelf is a narrowing, not a
 * tab, so there is exactly one URL for the full page rather than two.
 *
 * A legacy `?view=products` / `?view=other` lands here as an unknown value and
 * degrades to `null`. Those URLs still return 200 with the whole page, which
 * is the right answer for a shelf that no longer exists.
 */
export function asPortfolioSection(
  raw: string | string[] | undefined
): PortfolioSection | null {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (!first) return null;
  const v = first.trim().toLowerCase();
  return isPortfolioSection(v) ? v : null;
}

/* ---- the tag convention ------------------------------------------- */

/**
 * **A tag containing a colon is internal.** It steers this module and is never
 * rendered on the storefront, which is what lets a row carry bookkeeping
 * (`set:demo`, so the demo seeder can find its own rows again) without that
 * bookkeeping showing up as a chip under the tile.
 *
 * `section:<id>` is the explicit, unambiguous placement. Everything else is a
 * best guess the owner never has to learn:
 *
 * 1. an explicit `section:<id>` tag wins;
 * 2. else the first plain tag that reads like a section name wins;
 * 3. else anything playable is a reel and anything else is part of the story.
 *
 * Rule 3 is what guarantees no row can ever fall off the page — a piece with
 * no tags at all still lands somewhere a visitor will see it.
 */
const INTERNAL_TAG = /:/;
const SECTION_TAG = /^section:(.+)$/i;

/** Plain words the owner already writes, mapped to a shelf. */
const SECTION_KEYWORD: Record<string, PortfolioSection> = {
  milestone: "milestones",
  milestones: "milestones",
  achievement: "milestones",
  achievements: "milestones",
  award: "milestones",
  press: "milestones",
  featured_in: "milestones",

  testimonial: "customers",
  review: "customers",
  customer: "customers",
  "happy customer": "customers",
  ugc: "customers",

  collab: "collabs",
  collabs: "collabs",
  collaboration: "collabs",
  creator: "collabs",
  influencer: "collabs",
  partner: "collabs",

  bulk: "bulk",
  "bulk order": "bulk",
  wholesale: "bulk",
  corporate: "bulk",
  campus: "bulk",
  b2b: "bulk",
  custom: "bulk",
  printing: "bulk",

  reel: "reels",
  reels: "reels",
  film: "reels",
  video: "reels",
  shoot: "reels",
  short: "reels",
  shorts: "reels",

  story: "story",
  about: "story",
  lookbook: "story",
  journal: "story",
  blog: "story",
  "behind the scenes": "story",
};

/** Tags a visitor actually sees — internal ones stripped, order preserved. */
export function publicTags(tags: string[]): string[] {
  return tags.filter((t) => t && !INTERNAL_TAG.test(t));
}

/** Which shelf a row belongs on. See the block comment above. */
export function sectionOf(tags: string[], playable: boolean): PortfolioSection {
  for (const tag of tags) {
    const explicit = SECTION_TAG.exec(tag.trim())?.[1]?.trim().toLowerCase();
    if (explicit && isPortfolioSection(explicit)) return explicit;
  }
  for (const tag of tags) {
    const hit = SECTION_KEYWORD[tag.trim().toLowerCase()];
    if (hit) return hit;
  }
  return playable ? "reels" : "story";
}

/**
 * Split a milestone title into the figure and the rest.
 *
 * `"250+ pieces in eleven days"` renders the `250+` large and the words under
 * it. Purely presentational and entirely optional: a title that does not start
 * with a number comes back with `figure: null` and the card prints it plainly,
 * so nothing has to be written in a special way for this to be safe.
 */
export function splitStat(title: string): { figure: string | null; rest: string } {
  const m = /^\s*([₹$]?\s?[\d][\d,.]*\s?[+kKmM%]?)\s+(.*)$/.exec(title);
  if (!m || !m[2]?.trim()) return { figure: null, rest: title };
  return { figure: m[1].replace(/\s+/g, ""), rest: m[2].trim() };
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
  /** Pulled live from the Instagram Graph API. Only possible with a token. */
  | "instagram-api";

/**
 * Which player a tile mounts, decided on the server.
 *
 * The grid is a client component and this module imports Prisma, so it cannot
 * call `resolveVideo` itself — resolving the provider here keeps that boundary
 * clean and makes the client branch a plain string compare.
 */
export type PortfolioProvider = "instagram" | "youtube" | "facebook" | "other";

/** One tile. Everything the grid needs, already resolved — no lookups in render. */
export type PortfolioEntry = {
  id: string;
  kind: PortfolioKind;
  section: PortfolioSection;
  title: string;
  description: string | null;
  /** Where "open" goes when there is nothing to embed. */
  url: string | null;
  /** Poster for the grid. Never an embed — the iframe is mounted on click. */
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
  provider: PortfolioProvider;
  /** Portrait framing for reels/shorts, landscape otherwise. */
  vertical: boolean;
  /** Internal tags already stripped — safe to render as-is. */
  tags: string[];
  isFeatured: boolean;
  product: PortfolioProductRef | null;
  source: PortfolioSource;
};

/** One shelf, with its copy already resolved. */
export type PortfolioSectionGroup = {
  id: PortfolioSection;
  label: string;
  blurb: string;
  layout: (typeof PORTFOLIO_SECTION_META)[PortfolioSection]["layout"];
  entries: PortfolioEntry[];
};

export type PortfolioData = {
  /** Non-empty shelves only, in `PORTFOLIO_SECTIONS` order. */
  sections: PortfolioSectionGroup[];
  /** Every entry across every shelf. */
  total: number;
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

/** Which player an embed src belongs to. Drives autoplay and framing. */
function providerOf(embedUrl: string | null, url: string | null): PortfolioProvider {
  const probe = embedUrl ?? url;
  if (!probe) return "other";
  try {
    const host = new URL(probe).hostname.replace(/^www\./, "").toLowerCase();
    if (host.endsWith("youtube.com") || host.endsWith("youtu.be")) return "youtube";
    if (host.endsWith("youtube-nocookie.com")) return "youtube";
    if (host.endsWith("instagram.com")) return "instagram";
    if (host.endsWith("facebook.com") || host.endsWith("fb.watch")) return "facebook";
    return "other";
  } catch {
    return "other";
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
 * THE ONE FUNCTION that decides whether this page is a live mirror of the
 * whole Instagram account.
 *
 * Today it returns `null` on every deployment, because no token is configured
 * — and `getPortfolio()` then serves the stored rows. Note that per-post
 * mirroring does **not** depend on this: `lib/instagram-resolve.ts` reads one
 * public permalink with no credentials at all, and the admin's import button
 * copies the poster into our own blob store. This function is only about
 * pulling the *whole feed* automatically.
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
      // A caption is a paragraph, not a title. First line, clipped.
      const firstLine = (m.caption ?? "").split("\n")[0]?.trim() ?? "";
      return {
        id: `ig-${m.id}`,
        kind: "instagram" as const,
        // A live post is, by definition, a reel or a photo from the feed.
        section: "reels" as const,
        title: firstLine.slice(0, 80) || "Instagram post",
        description: (m.caption ?? "").trim() || null,
        url: m.permalink ?? null,
        // VIDEO items give `thumbnail_url`; images only give `media_url`.
        // Both are Instagram CDN hosts, which are deliberately not in
        // `next.config.ts` — `thumbOf` marks them unoptimisable so they are
        // served through a plain <img> and no config change is ever needed.
        ...thumbOf(m.thumbnail_url, m.media_url),
        embedUrl: m.permalink ? `${m.permalink.replace(/\/+$/, "")}/embed` : null,
        provider: "instagram" as const,
        // Portrait, like every other Instagram embed — see the note in
        // `rowToEntry`. Instagram's own `/embed` card is portrait whatever the
        // media inside it is, so framing it 16:9 only adds letterboxing.
        vertical: true,
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
  const url = row.url && isSafeHref(row.url) ? row.url : null;
  const provider = providerOf(embedUrl, url);

  return {
    id: row.id,
    kind,
    section: sectionOf(row.tags, Boolean(embedUrl)),
    title: row.title,
    description: row.description,
    url,
    ...thumbOf(row.imageUrl, resolved?.thumbnailUrl, product?.image),
    embedUrl,
    provider,
    /*
     * **Instagram is always framed portrait**, and that is a fix rather than a
     * preference. `resolveInstagramPost` canonicalises every permalink to
     * `/p/<code>/` — reels included, because Instagram resolves the shortcode
     * either way — and `resolveVideo` then reads that `/p/` and reports
     * `vertical: false`. So an imported reel came back as 16:9 and played
     * letterboxed inside a landscape box.
     *
     * `?? ` could not catch it either: `false` is not `undefined`, so the old
     * `resolved?.vertical ?? kind === "instagram"` fallback never fired once a
     * URL had been resolved. Keying off the provider is what makes it correct
     * for a row saved before or after the importer existed.
     *
     * Everything else trusts the resolver, which is right: a YouTube short is
     * portrait and a normal YouTube video is not.
     */
    vertical: provider === "instagram" ? true : resolved?.vertical ?? false,
    tags: publicTags(row.tags),
    isFeatured: row.isFeatured,
    product,
    source: "portfolio",
  };
}

/**
 * Everything the /portfolio page renders, in one call.
 *
 * Ordering rule: shelves in `PORTFOLIO_SECTIONS` order; inside a shelf,
 * featured first and then the admin's `sortOrder`. Empty shelves are dropped
 * rather than rendered as a heading over nothing — a brand page with four
 * "nothing here yet" panels reads as a site under construction.
 *
 * Wrapped in React `cache()` for per-request dedup — the same reason
 * `getProductBySlug` and `getSettings` are (CLAUDE.md). `generateMetadata` has
 * to know what is on the page to emit a correct canonical, and without this
 * that alone would double every query on the route.
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

  const all = [...curated, ...freshLive];

  const byFeatured = (a: PortfolioEntry, b: PortfolioEntry) =>
    Number(b.isFeatured) - Number(a.isFeatured);

  const sections: PortfolioSectionGroup[] = PORTFOLIO_SECTIONS.map((id) => {
    const meta = PORTFOLIO_SECTION_META[id];
    return {
      id,
      label: meta.label,
      blurb: meta.blurb,
      layout: meta.layout,
      // `sort` on a fresh array — `filter` already copied, so the source order
      // from the query (sortOrder, then createdAt) survives underneath.
      entries: all.filter((e) => e.section === id).sort(byFeatured),
    };
  }).filter((s) => s.entries.length > 0);

  return {
    sections,
    total: all.length,
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
