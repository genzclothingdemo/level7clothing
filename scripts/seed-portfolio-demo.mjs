/**
 * Seed a demonstration portfolio that exercises every rendering path.
 *
 *   node scripts/seed-portfolio-demo.mjs          # add / update
 *   node scripts/seed-portfolio-demo.mjs --clean  # remove them again
 *
 * Every row carries the internal tag `set:demo`, so `--clean` can take exactly
 * these back out and nothing else. Safe to re-run: rows are matched on title,
 * and any demo row whose title is no longer in this file is removed, so
 * renaming a row here does not strand the old one in the database.
 *
 * ── What it is demonstrating now ─────────────────────────────────────────────
 *
 * /portfolio stopped being "products vs everything else" and became a brand
 * page: who we are · milestones · reels & films · happy customers ·
 * collaborations · bulk & custom work. So this set covers **all six shelves**
 * and all four card shapes (`media`, `stat`, `quote`, `note`), because each
 * shape has its own way of falling over.
 *
 * Since a portfolio row can now also **be a page**, the set also covers the
 * four columns that make one — `bodyHtml`, `images`, `ctaLabel`, `ctaUrl` —
 * in two shapes that fail differently: a bulk-order write-up with a gallery
 * and a button (row 10), and a milestone with a body and a button and no
 * photos at all (row 10b).
 *
 * And row 3 carries `sourceProductId`, which is what the harvester writes and
 * what makes `lib/portfolio.ts` report `source: "product-video"`. `main()`
 * puts the matching link on that product so the row is genuinely harvested
 * rather than merely labelled — see the note on `HARVEST_SOURCE`.
 *
 * ── The bodies are written straight through Prisma, and that is the point ────
 *
 * Nothing here goes through `actions/portfolio.ts`, so no sanitiser runs on
 * the way in — exactly like every row written before the sanitiser existed.
 * `lib/portfolio.ts` sanitises again on the way **out**, which is the only
 * reason the storefront may render a body with `dangerouslySetInnerHTML`.
 * Row 10's body carries a `<section class="lede">` that must not survive to
 * the page; if it ever does, that second pass has been removed.
 *
 * Placement is by tag, not by column — `section:<id>` is explicit, and a row
 * without one is placed from its plain tags (see `sectionOf` in
 * `lib/portfolio.ts`). A tag containing a colon is internal and never rendered,
 * which is why `set:demo` does not show up as a chip on the storefront.
 *
 * ── The Instagram and YouTube rows are real ──────────────────────────────────
 *
 * Permalinks, captions, authorship and posters come from `resolveSocialPost`,
 * read live with no access token: Instagram via its Open Graph tags, YouTube
 * via its public oEmbed endpoint. The embeds are the real players, so the tiles
 * mirror the actual current post and play on the page.
 *
 * What is deliberately NOT stored is Instagram's own thumbnail address.
 * `scontent.cdninstagram.com` URLs carry a signed `oe=` expiry — four days when
 * measured — so a portfolio built by pasting them is a wall of broken images
 * the following week. The admin's "Fetch from Instagram" button copies those
 * bytes into Vercel Blob; this script has no blob token, so it uses local
 * product photos as posters instead. YouTube is different and the difference is
 * used here: `i.ytimg.com` posters do not expire and that host is already in
 * `next.config.ts`, so the resolved address is stored as-is and goes through
 * the image optimiser.
 */

import { PrismaClient } from "@prisma/client";
import { resolveSocialPost } from "../src/lib/instagram-resolve.ts";

const prisma = new PrismaClient();

/** Internal (colon) so it never renders as a chip. */
const DEMO_TAG = "set:demo";
/** What the previous version of this script used. `--clean` still takes it. */
const LEGACY_TAG = "demo-set";

const IG = {
  post: "https://www.instagram.com/p/DT0n6EDCHlR/",
  creatorReel: "https://www.instagram.com/reel/DF0B5nty74N/",
  teaser: "https://www.instagram.com/reel/DBvh3MeyZ7x/",
};

const YT = {
  film: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
};

const PRODUCT = {
  field: "cms8qcqa60002iydg6gb4acc9",
  reserve: "cms8qcqbw0003iydg7qfp0lhw",
  planet: "cms8qcqdi0005iydglkxk0m0k",
  /** Nothing has this id. The dangling-link case — see row 8. */
  retired: "cthisproductdoesnotexist000",
};

const PHOTO = {
  field: "/products/level7/BottleGreenFront2.png",
  reserve: "/products/level7/Level7_Wine_Basic_Front_2.png",
  planet: "/products/level7/Level7_Planet_Front.png",
  walk: "/products/level7/Level7_Core_Walk.png",
  location: "/products/level7/05.10.2024-182.jpg",
  portrait: "/products/level7/05.10.2024-011.jpg",
};

const igEmbed = (shortcode) =>
  `<iframe src="https://www.instagram.com/p/${shortcode}/embed" width="400" height="480" frameborder="0" scrolling="no" allowtransparency="true"></iframe>`;

const ytEmbed = (url) =>
  `<iframe src="${url}" width="560" height="315" frameborder="0" scrolling="no" allowtransparency="true"></iframe>`;

async function build() {
  const [post, creator, teaser, film] = await Promise.all([
    resolveSocialPost(IG.post),
    resolveSocialPost(IG.creatorReel),
    resolveSocialPost(IG.teaser),
    resolveSocialPost(YT.film),
  ]);

  for (const [name, r] of [
    ["ig post", post],
    ["ig creator reel", creator],
    ["ig teaser", teaser],
    ["yt film", film],
  ]) {
    console.log(
      `resolved ${name}: ${
        r
          ? `[${r.provider}] "${r.title}" by ${r.author ?? "?"}${
              r.thumbnailExpires ? " (poster expires — not stored)" : ""
            }`
          : "FAILED — falling back to a plain link"
      }`
    );
  }

  return [
    /* ---------------------------------------------------------------- */
    /*  REELS & FILMS — the `media` shape: posters that become players   */
    /* ---------------------------------------------------------------- */

    /* 1. Our own Instagram post, with a garment mentioned. The product is a
          footnote on the card now ("Wearing …"), not the reason it is here. */
    {
      title: post?.title ?? "Not every day calls for graphics.",
      description:
        "The Field tee shot plain, because the fabric is the point when there is no print to look at.",
      kind: "instagram",
      url: post?.url ?? IG.post,
      imageUrl: PHOTO.field,
      embedHtml: igEmbed("DT0n6EDCHlR"),
      productId: PRODUCT.field,
      tags: [DEMO_TAG, "section:reels", "shoot"],
      sortOrder: 10,
      isFeatured: true,
      isActive: true,
    },

    /* 2. A creator's reel featuring us — the credit case. `og:url` says
          @therishithakor, not level7clothing, so the title names them.
          Tagged `collaboration` *and* `section:reels`: the explicit section
          tag wins, so it plays in the reels grid while the word still shows
          as a chip. That precedence is the thing being demonstrated. */
    {
      title: creator?.author
        ? `Wardrobe level up — @${creator.author}`
        : "Wardrobe level up — creator feature",
      description:
        "Posted by the creator, not by us. Kept here with the credit in the title.",
      kind: "instagram",
      url: creator?.url ?? IG.creatorReel,
      imageUrl: PHOTO.walk,
      embedHtml: igEmbed("DF0B5nty74N"),
      productId: null,
      tags: [DEMO_TAG, "section:reels", "collaboration", "creator"],
      sortOrder: 20,
      isFeatured: true,
      isActive: true,
    },

    /* 3. Our own reel, no explicit section tag and no section keyword in its
          tags — it lands on Reels & films purely because it is playable,
          which is the fallback rule in `sectionOf`.

          **This is also the harvested row.** `sourceProductId` is what
          `lib/portfolio-harvest.ts` writes when it pulls a reel out of a
          product's `videos`, and it is what makes `lib/portfolio.ts` report
          `source: "product-video"` — the marker the storefront's catalogue
          shelf matches on. `main()` below puts the matching link on that
          product, so this is a *coherent* harvested row rather than a
          decorative one: run the harvest panel against this data and it says
          "already in the portfolio" instead of offering a duplicate, and the
          orphan list stays empty. `--clean` takes the link off again. */
    {
      title: teaser?.title ?? "#level7coming",
      description: "The drop teaser.",
      kind: "instagram",
      url: teaser?.url ?? IG.teaser,
      imageUrl: PHOTO.planet,
      embedHtml: igEmbed("DBvh3MeyZ7x"),
      productId: PRODUCT.planet,
      sourceProductId: PRODUCT.planet,
      tags: [DEMO_TAG, "teaser"],
      sortOrder: 30,
      isFeatured: false,
      isActive: true,
    },

    /* 4. YouTube, resolved through the same no-token path. Its poster stays on
          `i.ytimg.com` — the one non-blob host `next.config.ts` allows — so
          this is also the proof that the optimiser path works. */
    {
      title: film?.title ?? "Behind the print run",
      description: "How a Level7 graphic goes from file to fabric.",
      kind: "video",
      url: film?.url ?? YT.film,
      imageUrl: film?.thumbnailUrl ?? `https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg`,
      embedHtml: ytEmbed(
        film?.embedUrl ??
          "https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?rel=0&modestbranding=1"
      ),
      productId: null,
      tags: [DEMO_TAG, "film", "behind the scenes"],
      sortOrder: 40,
      isFeatured: false,
      isActive: true,
    },

    /* ---------------------------------------------------------------- */
    /*  MILESTONES — the `stat` shape                                    */
    /* ---------------------------------------------------------------- */

    /* 5. A title that starts with a figure, so `splitStat` sets the number
          large and the words under it. */
    {
      title: "12,000+ tees printed since 2023",
      description:
        "Every one of them on the same 240 GSM cotton we started with. The fabric has not been quietly downgraded.",
      kind: "link",
      url: null,
      imageUrl: null,
      embedHtml: null,
      productId: null,
      tags: [DEMO_TAG, "milestone"],
      sortOrder: 50,
      isFeatured: true,
      isActive: true,
    },

    /* 6. A milestone with NO image and no leading number — the card must fall
          back to printing the title plainly rather than rendering an empty
          figure. It has a link, so it also proves the "See it" affordance. */
    {
      title: "Stocked at two campus pop-ups in Ahmedabad",
      description: "Two days, one rail, and a queue we did not expect.",
      kind: "link",
      url: "https://clothingdemoshop.vercel.app/about",
      imageUrl: null,
      embedHtml: null,
      productId: null,
      tags: [DEMO_TAG, "achievement"],
      sortOrder: 60,
      isFeatured: false,
      isActive: true,
    },

    /* ---------------------------------------------------------------- */
    /*  HAPPY CUSTOMERS — the `quote` shape                              */
    /* ---------------------------------------------------------------- */

    /* 7. Title is who said it, description is what they said. With a photo,
          so the avatar path is exercised. */
    {
      title: "Ridhi M., Ahmedabad",
      description:
        "Third wash and it still hangs the way it did on day one. I have paid twice this for tees that went shapeless in a month.",
      kind: "image",
      url: null,
      imageUrl: PHOTO.portrait,
      embedHtml: null,
      productId: PRODUCT.reserve,
      tags: [DEMO_TAG, "testimonial"],
      sortOrder: 70,
      isFeatured: true,
      isActive: true,
    },

    /* 8. A testimonial whose product has been retired — `productId` points at
          nothing. The storefront must simply not offer the link, and the admin
          list must say "linked product is gone or hidden". Also has no photo,
          so the initial-letter avatar path is exercised. */
    {
      title: "Karan S., Surat",
      description:
        "Ordered for my whole hostel floor. They got the sizes right without me chasing anyone.",
      kind: "image",
      url: null,
      imageUrl: null,
      embedHtml: null,
      productId: PRODUCT.retired,
      tags: [DEMO_TAG, "testimonial"],
      sortOrder: 80,
      isFeatured: false,
      isActive: true,
    },

    /* ---------------------------------------------------------------- */
    /*  COLLABORATIONS & BULK — the `note` shape                         */
    /* ---------------------------------------------------------------- */

    /* 9. An editorial note with a photo — the horizontal article card. */
    {
      title: "Capsule with an illustrator we have followed for years",
      description:
        "Six panels, hand-drawn, screen-printed in two passes. It sold through in eleven days and we still get asked about it.",
      kind: "image",
      url: null,
      imageUrl: PHOTO.location,
      embedHtml: null,
      productId: null,
      tags: [DEMO_TAG, "collab", "artist"],
      sortOrder: 90,
      isFeatured: false,
      isActive: true,
    },

    /* 10. Bulk work, and the **full admin-authored page**: a body, extra
           photos and a call to action on top of the tile's own fields. This is
           the row that exercises `bodyHtml` + `images` + `ctaLabel`/`ctaUrl`
           together, which is what an achievement or bulk-order write-up
           actually needs.

           Also a layout stress at 320px — a long title and seven tags: the
           title must wrap rather than push the page sideways, and only the
           first two chips are shown.

           **Note the `<section class="lede">` in the body.** It is there on
           purpose. This script writes through Prisma and never touches
           `actions/portfolio.ts`, so nothing sanitises this markup on the way
           in — exactly like every row written before the sanitiser existed.
           `lib/portfolio.ts` runs `sanitisePortfolioBody` again on the way
           **out**, so what reaches the page is the paragraph with the wrapper
           and its class removed. That second pass is the only reason the
           storefront may render this with `dangerouslySetInnerHTML`, and this
           row is here to keep proving it. */
    {
      title:
        "Bulk order — 250 pieces for a college fest, printed, packed and delivered inside eleven days",
      description:
        "Campus and corporate orders run on the same fabric as retail. This one went out in eleven days including two rounds of proofing.",
      kind: "link",
      url: "https://clothingdemoshop.vercel.app/contact",
      imageUrl: PHOTO.reserve,
      embedHtml: null,
      productId: PRODUCT.reserve,
      bodyHtml: [
        "<h2>What a 250-piece run actually looks like</h2>",
        '<section class="lede"><p>The brief arrived on a Tuesday with a logo, a',
        "deadline and no size breakdown. We quoted the same 240 GSM cotton we",
        "put on the shelf, because a fest tee that goes shapeless is a fest tee",
        "nobody wears twice.</p></section>",
        "<ul><li>Two rounds of digital proofing, both inside 24 hours</li>",
        "<li>Screen print, two passes, cured and checked by hand</li>",
        "<li>Packed in size-sorted bundles so nobody sorted them at 2am</li></ul>",
        "<p>Eleven days, start to finish. We keep a rail of every run we have",
        "done — this one is still on it.</p>",
      ].join(" "),
      images: [PHOTO.location, PHOTO.walk, PHOTO.field],
      ctaLabel: "Get a quote",
      ctaUrl: "/contact",
      tags: [DEMO_TAG, "bulk order", "corporate", "campus", "printing", "wholesale", "b2b"],
      sortOrder: 100,
      isFeatured: true,
      isActive: true,
    },

    /* 10b. A milestone that is **also a page**, with a button but no extra
            photos — so the page layout is exercised without a gallery, and the
            `stat` card shape is exercised with `hasBody` true. Proves the two
            are independent: a shelf's card shape comes from its section, not
            from whether the piece has a body. */
    {
      title: "3 years of the same 240 GSM cotton",
      description:
        "The fabric has not been quietly downgraded, and here is what that has cost and bought us.",
      kind: "link",
      url: null,
      imageUrl: PHOTO.portrait,
      embedHtml: null,
      productId: null,
      bodyHtml: [
        "<h2>Why we never switched mills</h2>",
        "<p>Every year a cheaper roll turns up. It is always 20&ndash;30 GSM",
        "lighter and always described as &ldquo;the same hand&rdquo;. It is not",
        "the same hand after three washes, which is the only test that counts.</p>",
        "<blockquote>The tee you keep is cheaper than the two you replace.</blockquote>",
        "<p>So the margin is thinner and the tee outlives the season. That is",
        "the whole trade, and we would make it again.</p>",
      ].join(" "),
      images: [],
      ctaLabel: "See what we make it into",
      ctaUrl: "/shop",
      tags: [DEMO_TAG, "milestone"],
      sortOrder: 105,
      isFeatured: false,
      isActive: true,
    },

    /* ---------------------------------------------------------------- */
    /*  WHO WE ARE, and the two degenerate rows                          */
    /* ---------------------------------------------------------------- */

    /* 11. A pure image with no link at all — nothing to open, so the card must
           not pretend to be clickable. Lands on "Who we are" from its tag. */
    {
      title: "Lookbook — on location",
      description: null,
      kind: "image",
      url: null,
      imageUrl: PHOTO.walk,
      embedHtml: null,
      productId: null,
      tags: [DEMO_TAG, "lookbook"],
      sortOrder: 110,
      isFeatured: false,
      isActive: true,
    },

    /* 12. Hidden. Must appear in the admin list and NOT on /portfolio. */
    {
      title: "Draft — winter capsule (not published)",
      description: "Staged for the next drop. Should be invisible on the site.",
      kind: "image",
      url: null,
      imageUrl: PHOTO.planet,
      embedHtml: null,
      productId: null,
      tags: [DEMO_TAG, "draft"],
      sortOrder: 120,
      isFeatured: false,
      isActive: false,
    },

    /* 13. Title only — no image, no link, no product, no tags beyond the
           internal one. The emptiest row there is. It must land somewhere
           (the fallback shelf, "Who we are") and render as a readable card
           rather than breaking the page. Seeded straight through Prisma: the
           admin form refuses this on purpose, and that refusal is the thing
           this row is here to render *around*. */
    {
      title: "Coming soon",
      description: null,
      kind: "link",
      url: null,
      imageUrl: null,
      embedHtml: null,
      productId: null,
      tags: [DEMO_TAG],
      sortOrder: 130,
      isFeatured: false,
      isActive: true,
    },
  ];
}

/** Every row this script has ever owned, old tag included. */
const demoWhere = {
  OR: [{ tags: { has: DEMO_TAG } }, { tags: { has: LEGACY_TAG } }],
};

/**
 * Every column this script writes, at its "not set" value.
 *
 * Spread under each row before it is written, so a field a row does not
 * mention is written as empty rather than left alone. Without this, a re-run
 * after a row *stopped* carrying a body would silently keep the old body —
 * Prisma reads an absent key in an `update` as "leave this column alone", and
 * the demo would stop converging on what this file says. Same discipline as
 * `toRow()` in `actions/portfolio.ts`: one column list, no second place to
 * forget a field.
 */
const BLANK = {
  description: null,
  url: null,
  imageUrl: null,
  embedHtml: null,
  productId: null,
  bodyHtml: null,
  images: [],
  ctaLabel: null,
  ctaUrl: null,
  sourceProductId: null,
  isFeatured: false,
  isActive: true,
};

/**
 * The demo's one harvested row needs the link to actually be on the product,
 * or the harvest panel reports it as an orphan ("the link was removed from
 * …") and the demo contradicts itself. So the seeder owns both halves.
 *
 * This is the only place this script touches a product, it writes one column,
 * and `--clean` empties it again.
 */
const HARVEST_SOURCE = {
  productId: PRODUCT.planet,
  videos: [{ title: "Instagram", url: IG.teaser }],
};

async function setProductVideos(videos) {
  try {
    await prisma.product.update({
      where: { id: HARVEST_SOURCE.productId },
      data: { videos },
    });
    console.log(
      videos.length
        ? `linked the teaser reel on the demo's source product`
        : `cleared the demo's video link from its source product`
    );
  } catch {
    // A missing product must not fail the seed — the portfolio rows are the
    // point and a dangling `sourceProductId` degrades to "a product that has
    // since gone", which is itself one of the cases worth demonstrating.
    console.log("(source product not found — skipping the video link)");
  }
}

async function main() {
  if (process.argv.includes("--clean")) {
    const { count } = await prisma.portfolioItem.deleteMany({ where: demoWhere });
    await setProductVideos([]);
    console.log(`removed ${count} demo portfolio rows`);
    return;
  }

  const rows = (await build()).map((r) => ({ ...BLANK, ...r }));
  const titles = new Set(rows.map((r) => r.title));

  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const existing = await prisma.portfolioItem.findFirst({
      where: { title: row.title, ...demoWhere },
      select: { id: true },
    });
    if (existing) {
      await prisma.portfolioItem.update({ where: { id: existing.id }, data: row });
      updated += 1;
    } else {
      await prisma.portfolioItem.create({ data: row });
      created += 1;
    }
  }

  // Rows this script used to own and no longer does. Without this, every
  // rename in the list above leaves an orphan behind that only `--clean` can
  // find — and by then nobody remembers it was ours.
  const stale = await prisma.portfolioItem.findMany({
    where: demoWhere,
    select: { id: true, title: true },
  });
  const orphans = stale.filter((r) => !titles.has(r.title));
  if (orphans.length) {
    await prisma.portfolioItem.deleteMany({
      where: { id: { in: orphans.map((o) => o.id) } },
    });
    for (const o of orphans) console.log(`removed stale demo row: "${o.title}"`);
  }

  await setProductVideos(HARVEST_SOURCE.videos);

  const total = await prisma.portfolioItem.count();
  console.log(
    `\n${created} created, ${updated} updated, ${orphans.length} removed · ${total} portfolio rows in total`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
