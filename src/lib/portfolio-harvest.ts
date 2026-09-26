/**
 * Harvesting: the reels and films that are already in the catalogue.
 *
 * `Product.videos` is `[{ title, url }]` and the owner routinely puts an
 * Instagram reel or a YouTube film in it — the making of a print, a styling
 * clip, a review. Those are portfolio work by any reading, and re-typing each
 * one into `/admin/portfolio` is the kind of chore that simply does not get
 * done.
 *
 * ## Why this is not a derived read
 *
 * It was one, once. `lib/portfolio.ts` records that `productVideoEntries()`
 * read every active product's `videos` and published each as a tile, and why
 * it was deleted: **a derived tile cannot be taken down.** The owner could not
 * hide one, could not retitle one, could not say "that clip is for the product
 * page, not the brand page". The read also made the portfolio a second shop.
 *
 * So harvesting **creates real rows**. Once created, a row is an ordinary
 * portfolio piece: editable, hideable, deletable, reorderable, and it survives
 * the product being retired. `sourceProductId` records where it came from, so
 * the storefront can say "from our catalogue" and this module can recognise
 * its own work on the next sweep.
 *
 * ## The identity rule — the whole design in four lines
 *
 * A link's identity is **the provider's own id**, not the URL string:
 * `instagram:<shortcode>` or `youtube:<videoId>`. That is what makes
 * `instagram.com/reel/ABC/?igsh=…`, `instagram.com/p/ABC/` and
 * `www.instagram.com/level7clothing/reel/ABC/` one thing rather than three.
 *
 * 1. **The harvester only ever creates.** No sweep writes to a row that
 *    already exists — not its title, not its poster, not `updatedAt`.
 * 2. **A key that any row already carries is covered**, whether that row was
 *    harvested or typed by hand. So a reel the owner already wrote up, with
 *    their own title and description, is never duplicated underneath itself.
 * 3. **A harvested row whose link has left the product is never deleted.** It
 *    is reported as an orphan and the owner decides — by then it may carry a
 *    description nobody else has.
 * 4. **Refreshing is a separate, per-row, deliberate press** (`refreshHarvested`
 *    in `actions/portfolio.ts`), because a refresh overwrites the title and the
 *    poster, and a sweep that did that would quietly undo the owner's editing.
 *
 * Rules 1 and 2 together are what "re-harvestable without touching anything
 * the owner typed" actually means in code: there is no update path in the
 * sweep at all, so there is nothing to get wrong.
 *
 * The provider is always read **from the URL**, never from `videos[].title`.
 * The product editor now offers Instagram / YouTube / Custom as that title,
 * which makes the catalogue readable for a human — but a label is a label, and
 * a mislabelled link would harvest to the wrong player.
 */

import { put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import {
  instagramShortcode,
  resolveSocialPost,
  youtubeId,
} from "@/lib/instagram-resolve";
import type { ProductVideo } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Identity                                                           */
/* ------------------------------------------------------------------ */

/** `instagram:<shortcode>` · `youtube:<videoId>`. */
export type HarvestKey = string;

export type HarvestProvider = "instagram" | "youtube";

/**
 * The stable identity of a link, or `null` when it is not something we can
 * recognise and therefore not something we will harvest.
 *
 * Deliberately narrower than `socialProviderOf`, which also answers `"link"`
 * for any fetchable page. A product's video row pointing at a blog post is not
 * a reel and has no business being auto-published as one; the owner can add it
 * by hand if they want it.
 */
export function harvestKeyOf(rawUrl: string | null | undefined): HarvestKey | null {
  const url = (rawUrl ?? "").trim();
  if (!url) return null;
  const ig = instagramShortcode(url);
  if (ig) return `instagram:${ig}`;
  const yt = youtubeId(url);
  if (yt) return `youtube:${yt}`;
  return null;
}

export function providerOfKey(key: HarvestKey): HarvestProvider {
  return key.startsWith("youtube:") ? "youtube" : "instagram";
}

/** `instagram` → the `instagram` kind; `youtube` → the existing `video` kind. */
function kindForProvider(provider: HarvestProvider): string {
  return provider === "youtube" ? "video" : "instagram";
}

/* ------------------------------------------------------------------ */
/*  The plan                                                           */
/* ------------------------------------------------------------------ */

/** One catalogue link that has no portfolio row yet. */
export type HarvestCandidate = {
  key: HarvestKey;
  provider: HarvestProvider;
  /** As typed on the product — not canonicalised until it is resolved. */
  url: string;
  /** The label on the product's video row ("Instagram", "YouTube", or theirs). */
  label: string;
  productId: string;
  productName: string;
  productSlug: string;
  /** Other products carrying the same link, so one row is obviously enough. */
  alsoOn: string[];
};

/** A link that is already in the portfolio, and how it got there. */
export type HarvestCovered = {
  key: HarvestKey;
  provider: HarvestProvider;
  itemId: string;
  itemTitle: string;
  /** False when the owner wrote this row by hand and it happens to match. */
  harvested: boolean;
  isActive: boolean;
  productName: string;
};

/**
 * A harvested row whose link is no longer on its product — the product's
 * videos changed, or the product was retired or deleted.
 *
 * Never acted on automatically. See rule 3.
 */
export type HarvestOrphan = {
  itemId: string;
  itemTitle: string;
  isActive: boolean;
  /** Null when the product itself is gone. */
  productName: string | null;
  reason: "link-removed" | "product-inactive" | "product-gone";
};

export type HarvestPlan = {
  candidates: HarvestCandidate[];
  covered: HarvestCovered[];
  orphans: HarvestOrphan[];
  /** Links on products that are not Instagram or YouTube — reported, not taken. */
  unrecognised: { url: string; label: string; productName: string }[];
  /**
   * Every key the portfolio already carries, whatever product (or none) it
   * came from. `runHarvest` carries this forward as it writes, so a single
   * sweep cannot create two rows for one reel even when two products link it.
   */
  existingKeys: HarvestKey[];
};

function videosOf(value: unknown): ProductVideo[] {
  return Array.isArray(value)
    ? (value as ProductVideo[]).filter(
        (v) => v && typeof v.url === "string" && v.url.trim()
      )
    : [];
}

/**
 * What a sweep *would* do, without doing any of it.
 *
 * Read-only and cheap — two queries, no network. The admin screen renders this
 * and the owner presses Add, which is the same draft-first shape the dispatch
 * panel uses: nothing that costs something (here, blob writes and public rows)
 * happens on a screen load.
 */
export async function planHarvest(): Promise<HarvestPlan> {
  const [products, rows] = await Promise.all([
    prisma.product
      .findMany({
        where: { isActive: true },
        select: { id: true, name: true, slug: true, videos: true },
        orderBy: { name: "asc" },
      })
      .catch(() => []),
    prisma.portfolioItem
      .findMany({
        select: {
          id: true,
          title: true,
          url: true,
          isActive: true,
          sourceProductId: true,
        },
      })
      .catch(() => []),
  ]);

  /** Every key any portfolio row already carries — harvested or hand-written. */
  const byKey = new Map<HarvestKey, (typeof rows)[number]>();
  for (const row of rows) {
    const key = harvestKeyOf(row.url);
    // First wins: if two rows point at one reel, the older one is "the" row
    // and the duplicate is the owner's business, not ours to resolve.
    if (key && !byKey.has(key)) byKey.set(key, row);
  }

  const candidates = new Map<HarvestKey, HarvestCandidate>();
  const covered: HarvestCovered[] = [];
  const unrecognised: HarvestPlan["unrecognised"] = [];
  /** Keys still present in the catalogue — used to find orphans below. */
  const liveKeys = new Set<HarvestKey>();
  const productNames = new Map<string, string>();

  for (const product of products) {
    productNames.set(product.id, product.name);
    for (const video of videosOf(product.videos)) {
      const key = harvestKeyOf(video.url);
      if (!key) {
        unrecognised.push({
          url: video.url.trim(),
          label: video.title?.trim() || "Untitled",
          productName: product.name,
        });
        continue;
      }
      liveKeys.add(key);

      const existing = byKey.get(key);
      if (existing) {
        covered.push({
          key,
          provider: providerOfKey(key),
          itemId: existing.id,
          itemTitle: existing.title,
          harvested: Boolean(existing.sourceProductId),
          isActive: existing.isActive,
          productName: product.name,
        });
        continue;
      }

      const already = candidates.get(key);
      if (already) {
        // Two products, one reel. One row, and the plan says which others
        // carry it so the owner is not left wondering where it went.
        if (!already.alsoOn.includes(product.name)) already.alsoOn.push(product.name);
        continue;
      }
      candidates.set(key, {
        key,
        provider: providerOfKey(key),
        url: video.url.trim(),
        label: video.title?.trim() || "",
        productId: product.id,
        productName: product.name,
        productSlug: product.slug,
        alsoOn: [],
      });
    }
  }

  /* ---- orphans: our own rows whose link has left the catalogue ---- */

  const harvested = rows.filter((r) => r.sourceProductId);
  const sourceIds = [...new Set(harvested.map((r) => r.sourceProductId!))];
  const sourceProducts = sourceIds.length
    ? await prisma.product
        .findMany({
          where: { id: { in: sourceIds } },
          select: { id: true, name: true, isActive: true },
        })
        .catch(() => [])
    : [];
  const sourceById = new Map(sourceProducts.map((p) => [p.id, p]));

  const orphans: HarvestOrphan[] = [];
  for (const row of harvested) {
    const key = harvestKeyOf(row.url);
    const product = sourceById.get(row.sourceProductId!);
    if (!product) {
      orphans.push({
        itemId: row.id,
        itemTitle: row.title,
        isActive: row.isActive,
        productName: null,
        reason: "product-gone",
      });
      continue;
    }
    if (!product.isActive) {
      orphans.push({
        itemId: row.id,
        itemTitle: row.title,
        isActive: row.isActive,
        productName: product.name,
        reason: "product-inactive",
      });
      continue;
    }
    if (!key || !liveKeys.has(key)) {
      orphans.push({
        itemId: row.id,
        itemTitle: row.title,
        isActive: row.isActive,
        productName: product.name,
        reason: "link-removed",
      });
    }
  }

  return {
    candidates: [...candidates.values()],
    covered,
    orphans,
    unrecognised,
    existingKeys: [...byKey.keys()],
  };
}

/* ------------------------------------------------------------------ */
/*  Thumbnails                                                         */
/* ------------------------------------------------------------------ */

/**
 * Fetch a remote image and store it in Vercel Blob.
 *
 * **The one copy of this in the codebase.** `actions/portfolio.ts` had its own
 * private version for the admin's Fetch button; harvesting needs exactly the
 * same behaviour and exactly the same bounds, and two copies of a size cap is
 * how one of them ends up without it.
 *
 * Bounded on purpose: an admin pasting a link should not be able to pull an
 * arbitrary 200 MB file into the blob store, and a non-image content type
 * means we misread a page rather than found a photo.
 */
export async function copySocialThumbnail(
  sourceUrl: string,
  keyBase: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return {
      ok: false,
      error:
        "Image storage isn't configured (BLOB_READ_WRITE_TOKEN), so the preview image wasn't saved. Pick one from the media library instead.",
    };
  }

  try {
    const res = await fetch(sourceUrl, { cache: "no-store" });
    if (!res.ok) {
      return { ok: false, error: `The preview image came back as ${res.status}.` };
    }

    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) {
      return { ok: false, error: "That preview address didn't return an image." };
    }

    const buf = await res.arrayBuffer();
    const MAX = 8 * 1024 * 1024;
    if (buf.byteLength > MAX) {
      return { ok: false, error: "The preview image is larger than 8 MB." };
    }

    const ext = type.includes("webp") ? "webp" : type.includes("png") ? "png" : "jpg";
    const blob = await put(`${keyBase}-${Date.now()}.${ext}`, Buffer.from(buf), {
      access: "public",
      addRandomSuffix: true,
      contentType: type,
    });
    return { ok: true, url: blob.url };
  } catch {
    return { ok: false, error: "Couldn't download the preview image." };
  }
}

/**
 * Resolve a link and settle on a poster we are willing to store.
 *
 * The two providers differ and the difference is handled rather than
 * flattened. `scontent.cdninstagram.com` addresses carry a signed `oe=` expiry
 * — four days, measured — so one is copied or it is not stored at all; storing
 * it would give a portfolio that looks right today and is broken images next
 * week with nothing in any log. `i.ytimg.com` posters do not expire and that
 * host is already in `next.config.ts`, so there the address is a real
 * fallback.
 */
export async function resolveForPortfolio(rawUrl: string): Promise<
  | {
      ok: true;
      provider: "instagram" | "youtube" | "link";
      url: string;
      title: string | null;
      author: string | null;
      imageUrl: string | null;
      embedHtml: string;
      warning?: string;
    }
  | { ok: false; error: string }
> {
  const post = await resolveSocialPost(rawUrl);
  if (!post) {
    return {
      ok: false,
      error:
        "Couldn't read that link. It needs to be a public Instagram post or reel, or a YouTube video or short — private, deleted and age-restricted ones can't be read, and Instagram sometimes rate-limits. You can still save it as a plain link.",
    };
  }

  // `<iframe src>` is what `embedSrcFromHtml` parses back out; we store the
  // same shape the oEmbed API would have returned so there is one reader.
  const size =
    post.provider === "youtube"
      ? 'width="560" height="315"'
      : 'width="400" height="480"';
  const embedHtml = post.embedUrl
    ? `<iframe src="${post.embedUrl}" ${size} frameborder="0" scrolling="no" allowtransparency="true"></iframe>`
    : "";

  let imageUrl: string | null = null;
  let warning: string | undefined;

  if (post.thumbnailUrl) {
    const copied = await copySocialThumbnail(
      post.thumbnailUrl,
      `${post.provider}/${post.shortcode || "link"}`
    );
    if (copied.ok) {
      imageUrl = copied.url;
    } else if (post.thumbnailExpires) {
      warning = copied.error;
    } else {
      imageUrl = post.thumbnailUrl;
    }
  } else {
    warning = "That post didn't return a preview image.";
  }

  return {
    ok: true,
    provider: post.provider,
    url: post.url,
    title: post.title,
    author: post.author,
    imageUrl,
    embedHtml,
    ...(warning ? { warning } : {}),
  };
}

/* ------------------------------------------------------------------ */
/*  The sweep                                                          */
/* ------------------------------------------------------------------ */

export type HarvestOutcome = {
  created: {
    itemId: string;
    title: string;
    productName: string;
    /**
     * Set when the row was created **without a stored cover photo**.
     *
     * Almost always Instagram with no `BLOB_READ_WRITE_TOKEN` configured:
     * `scontent.cdninstagram.com` addresses carry a signed ~4-day expiry, so
     * one is copied into our own storage or it is not stored at all. Storing
     * it would give a grid that looks right today and is broken images next
     * week with nothing in any log — strictly worse than no cover.
     *
     * Not an error, and deliberately not fatal: the row still has a working
     * permalink and player, and `rowToEntry` falls back to the linked
     * product's photo, so the tile has a poster either way. It is reported so
     * the owner can pick a better one rather than wondering why every
     * Instagram tile wears a garment shot.
     */
    warning?: string;
  }[];
  /** Links asked for that turned out to be covered by the time we looked. */
  skipped: { url: string; reason: string }[];
  failed: { url: string; error: string }[];
};

/**
 * One network fetch per candidate, plus a blob write for Instagram. Twelve is
 * a portfolio's worth of reels in one press and keeps the action inside a
 * serverless function's budget; the banner simply reappears with the rest.
 */
const MAX_PER_RUN = 12;

/**
 * Create portfolio rows for catalogue links that have none.
 *
 * **The plan is recomputed here, server-side**, and the caller's `keys` only
 * *narrow* it. That is what makes a double-click, a stale tab or a replayed
 * request harmless: whatever the client believed, this re-reads the database
 * and a key that now has a row is skipped rather than created a second time.
 * There is no update branch in this function at all — see rules 1 and 2 in the
 * header.
 */
export async function runHarvest(keys?: string[]): Promise<HarvestOutcome> {
  const plan = await planHarvest();
  const wanted = keys?.length ? new Set(keys) : null;
  const take = plan.candidates
    .filter((c) => !wanted || wanted.has(c.key))
    .slice(0, MAX_PER_RUN);

  const outcome: HarvestOutcome = { created: [], skipped: [], failed: [] };
  if (take.length === 0) return outcome;

  /** Keys that must not be created again — grown as this loop writes. */
  const taken = new Set<HarvestKey>(plan.existingKeys);

  // Where new rows land: after everything the owner has already arranged.
  const last = await prisma.portfolioItem
    .findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } })
    .catch(() => null);
  let nextOrder = (last?.sortOrder ?? 0) + 1;

  for (const candidate of take) {
    if (taken.has(candidate.key)) {
      outcome.skipped.push({
        url: candidate.url,
        reason: "already in the portfolio",
      });
      continue;
    }

    const resolved = await resolveForPortfolio(candidate.url);

    if (!resolved.ok) {
      outcome.failed.push({ url: candidate.url, error: resolved.error });
      continue;
    }

    // Last check before writing. The plan was read at the top of this
    // function, but resolving is a network round trip per link and a second
    // admin may have been working the whole time. `resolved.url` is the
    // provider's canonical permalink, so two harvests of one reel produce the
    // identical string — an exact match, not a guess at one.
    const clash = await prisma.portfolioItem
      .findFirst({ where: { url: resolved.url }, select: { id: true } })
      .catch(() => null);
    if (clash) {
      taken.add(candidate.key);
      outcome.skipped.push({
        url: candidate.url,
        reason: "already in the portfolio",
      });
      continue;
    }

    try {
      const row = await prisma.portfolioItem.create({
        data: {
          title:
            resolved.title ||
            // The product's own label is the next best thing the owner wrote.
            (candidate.label && !/^(instagram|youtube)$/i.test(candidate.label)
              ? candidate.label
              : "") ||
            `${candidate.productName} — ${
              candidate.provider === "youtube" ? "film" : "reel"
            }`,
          description: null,
          kind: kindForProvider(candidate.provider),
          url: resolved.url,
          imageUrl: resolved.imageUrl,
          embedHtml: resolved.embedHtml || null,
          // The garment is a footnote on the tile ("Wearing …"), which is what
          // `productId` has meant since the portfolio stopped being a second
          // shop. `sourceProductId` is the separate fact that we made this row.
          productId: candidate.productId,
          sourceProductId: candidate.productId,
          // Something that plays belongs on Reels & films, and saying so
          // explicitly beats leaving it to the keyword guess.
          tags: ["section:reels"],
          sortOrder: nextOrder++,
          isFeatured: false,
          isActive: true,
        },
        select: { id: true, title: true },
      });
      taken.add(candidate.key);
      outcome.created.push({
        itemId: row.id,
        title: row.title,
        productName: candidate.productName,
        // Only when there is genuinely no cover stored. A warning about
        // something that still produced an image is noise.
        ...(resolved.imageUrl ? {} : { warning: resolved.warning }),
      });
    } catch (error) {
      console.error("[portfolio-harvest] create failed:", error);
      outcome.failed.push({
        url: candidate.url,
        error: "Couldn't save this one. Try again.",
      });
    }
  }

  return outcome;
}
