/**
 * Seed a demonstration portfolio that exercises every rendering path.
 *
 *   node scripts/seed-portfolio-demo.mjs          # add / update
 *   node scripts/seed-portfolio-demo.mjs --clean  # remove them again
 *
 * Every row is tagged `demo-set` so `--clean` can take exactly these back out
 * and nothing else. Safe to re-run: rows are matched on title.
 *
 * ── The three Instagram rows are real ────────────────────────────────────────
 *
 * Permalinks, captions and authorship come from `resolveInstagramPost`, read
 * live from Instagram's Open Graph tags. The embed is the real `/embed` iframe,
 * so the tiles show the actual current post.
 *
 * What is deliberately NOT stored is Instagram's own thumbnail address.
 * `scontent.cdninstagram.com` URLs carry a signed `oe=` expiry — four days when
 * measured — so a portfolio built by pasting them is a wall of broken images
 * the following week. The admin's "Fetch from Instagram" button copies those
 * bytes into Vercel Blob; this script has no blob token, so it uses local
 * product photos as posters instead. Both are permanent; neither expires.
 */

import { PrismaClient } from "@prisma/client";
import { resolveInstagramPost } from "../src/lib/instagram-resolve.ts";

const prisma = new PrismaClient();
const DEMO_TAG = "demo-set";

const IG = {
  post: "https://www.instagram.com/p/DT0n6EDCHlR/",
  creatorReel: "https://www.instagram.com/reel/DF0B5nty74N/",
  teaser: "https://www.instagram.com/reel/DBvh3MeyZ7x/",
};

const PRODUCT = {
  field: "cms8qcqa60002iydg6gb4acc9",
  reserve: "cms8qcqbw0003iydg7qfp0lhw",
  planet: "cms8qcqdi0005iydglkxk0m0k",
};

const PHOTO = {
  field: "/products/level7/BottleGreenFront2.png",
  reserve: "/products/level7/Level7_Wine_Basic_Front_2.png",
  planet: "/products/level7/Level7_Planet_Front.png",
  walk: "/products/level7/Level7_Core_Walk.png",
  location: "/products/level7/05.10.2024-182.jpg",
};

const embed = (shortcode) =>
  `<iframe src="https://www.instagram.com/p/${shortcode}/embed" width="400" height="480" frameborder="0" scrolling="no" allowtransparency="true"></iframe>`;

async function build() {
  const [post, creator, teaser] = await Promise.all([
    resolveInstagramPost(IG.post),
    resolveInstagramPost(IG.creatorReel),
    resolveInstagramPost(IG.teaser),
  ]);

  for (const [name, r] of [["post", post], ["creatorReel", creator], ["teaser", teaser]]) {
    console.log(
      `resolved ${name}: ${r ? `"${r.title}" by @${r.author ?? "?"}` : "FAILED — falling back to a plain link"}`
    );
  }

  return [
    /* 1. Instagram post, our own account, attached to a product.
          Lands on the "From our products" tab with a Shop this piece button. */
    {
      title: post?.title ?? "Not every day calls for graphics.",
      description:
        "The Field tee shot plain, because the fabric is the point when there is no print to look at.",
      kind: "instagram",
      url: post?.url ?? IG.post,
      imageUrl: PHOTO.field,
      embedHtml: embed("DT0n6EDCHlR"),
      productId: PRODUCT.field,
      tags: [DEMO_TAG, "instagram", "product"],
      sortOrder: 10,
      isFeatured: true,
      isActive: true,
    },

    /* 2. A creator's reel featuring us — the credit case. `og:url` says
          @therishithakor, not level7clothing, so the title names them. No
          product attached: it belongs under "Everything else". */
    {
      title: creator?.author
        ? `Wardrobe level up — @${creator.author}`
        : "Wardrobe level up — creator feature",
      description:
        "Posted by the creator, not by us. Kept here as a collaboration, with the credit in the title.",
      kind: "instagram",
      url: creator?.url ?? IG.creatorReel,
      imageUrl: PHOTO.walk,
      embedHtml: embed("DF0B5nty74N"),
      productId: null,
      tags: [DEMO_TAG, "collaboration", "creator", "reel"],
      sortOrder: 20,
      isFeatured: true,
      isActive: true,
    },

    /* 3. Our own reel, featured, no product — a teaser. */
    {
      title: teaser?.title ?? "#level7coming",
      description: "The drop teaser.",
      kind: "instagram",
      url: teaser?.url ?? IG.teaser,
      imageUrl: PHOTO.planet,
      embedHtml: embed("DBvh3MeyZ7x"),
      productId: PRODUCT.planet,
      tags: [DEMO_TAG, "reel", "teaser"],
      sortOrder: 30,
      isFeatured: false,
      isActive: true,
    },

    /* 4. A video kind with a YouTube poster — the one non-blob host
          `next.config.ts` allows, so this proves the optimiser path. */
    {
      title: "Behind the print run",
      description: "How a Level7 graphic goes from file to fabric.",
      kind: "video",
      url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
      imageUrl: "https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg",
      embedHtml:
        '<iframe src="https://www.youtube.com/embed/aqz-KE-bpKQ" width="560" height="315" frameborder="0"></iframe>',
      productId: null,
      tags: [DEMO_TAG, "video", "behind the scenes"],
      sortOrder: 40,
      isFeatured: false,
      isActive: true,
    },

    /* 5. A plain outbound link with NO image — the grid must still render a
          readable tile rather than a broken frame. */
    {
      title: "Why we moved to heavier cotton",
      description:
        "A long-form note on grammage, shrinkage and why the second wash is the one that tells you the truth.",
      kind: "link",
      url: "https://clothingdemoshop.vercel.app/about",
      imageUrl: null,
      embedHtml: null,
      productId: null,
      tags: [DEMO_TAG, "blog"],
      sortOrder: 50,
      isFeatured: false,
      isActive: true,
    },

    /* 6. A pure image with no link at all — nothing to open, so the tile must
          not pretend to be clickable. */
    {
      title: "Lookbook — on location",
      description: null,
      kind: "image",
      url: null,
      imageUrl: PHOTO.location,
      embedHtml: null,
      productId: null,
      tags: [DEMO_TAG, "lookbook"],
      sortOrder: 60,
      isFeatured: false,
      isActive: true,
    },

    /* 7. Bulk-order enquiry work — a link with a product, long title and a
          lot of tags. Layout stress at 320px. */
    {
      title:
        "Bulk order — 250 pieces for a college fest, printed, packed and delivered inside eleven days",
      description:
        "Corporate and campus orders run on the same fabric as retail. This one went out in eleven days including two rounds of proofing.",
      kind: "link",
      url: "https://clothingdemoshop.vercel.app/contact",
      imageUrl: PHOTO.reserve,
      embedHtml: null,
      productId: PRODUCT.reserve,
      tags: [DEMO_TAG, "bulk order", "corporate", "campus", "printing", "wholesale", "b2b"],
      sortOrder: 70,
      isFeatured: false,
      isActive: true,
    },

    /* 8. Hidden. Must appear in the admin list and NOT on /portfolio. */
    {
      title: "Draft — winter capsule (not published)",
      description: "Staged for the next drop. Should be invisible on the site.",
      kind: "image",
      url: null,
      imageUrl: PHOTO.walk,
      embedHtml: null,
      productId: null,
      tags: [DEMO_TAG, "draft"],
      sortOrder: 80,
      isFeatured: false,
      isActive: false,
    },

    /* 9. Points at a product id that does not exist — the admin list has a
          "linked product is gone or hidden" badge for exactly this, and the
          storefront must simply not offer a dead Shop button. */
    {
      title: "Archive piece — product retired",
      description: "The linked product has been deleted. Nothing should 404.",
      kind: "image",
      url: null,
      imageUrl: PHOTO.planet,
      embedHtml: null,
      productId: "cthisproductdoesnotexist000",
      tags: [DEMO_TAG, "archive"],
      sortOrder: 90,
      isFeatured: false,
      isActive: true,
    },

    /* 10. Title only — no image, no link, no product. The emptiest row the
           form will accept, to prove the grid degrades instead of breaking. */
    {
      title: "Coming soon",
      description: null,
      kind: "link",
      url: null,
      imageUrl: null,
      embedHtml: null,
      productId: null,
      tags: [DEMO_TAG],
      sortOrder: 100,
      isFeatured: false,
      isActive: true,
    },
  ];
}

async function main() {
  const clean = process.argv.includes("--clean");

  if (clean) {
    const { count } = await prisma.portfolioItem.deleteMany({
      where: { tags: { has: DEMO_TAG } },
    });
    console.log(`removed ${count} demo portfolio rows`);
    return;
  }

  const rows = await build();
  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const existing = await prisma.portfolioItem.findFirst({
      where: { title: row.title, tags: { has: DEMO_TAG } },
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

  const total = await prisma.portfolioItem.count();
  console.log(`\n${created} created, ${updated} updated · ${total} portfolio rows in total`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
