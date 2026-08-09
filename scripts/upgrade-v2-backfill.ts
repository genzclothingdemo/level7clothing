// Backfill for the Artvelle-V2 architecture upgrade.
//
//   npx tsx scripts/upgrade-v2-backfill.ts
//
// Safe, idempotent, non-destructive — modelled on scripts/set-free-shipping.ts.
// Re-running it changes nothing. It never deletes a product, never touches
// Product.images, and never rewrites an image URL.
//
// Three jobs:
//   1. Derive Product.attributes from Product.options (the storefront read model).
//   2. Ingest every photo into the Media library.
//   3. Create the ProductImage rows that become the real gallery.
//
// Deliberately NOT done here:
//   • sellableVariants stays [] — it mirrors Product.variants, which is [] on every
//     row today. That is the correct derivation: with no variant matrix, the
//     storefront falls back to the base price and every size stays orderable,
//     exactly as it behaves now. Turning on per-combination pricing/stock is an
//     admin action (the "Variant pricing & stock" toggle), not a migration.
//   • propertyModules stays {} — visualAttributeName() already falls back to
//     attributes[0]. Pinning "Size" as the image controller would be misleading,
//     since sizes don't have their own photos. When a Color axis is added, the
//     admin picks it explicitly in the Image Controller dropdown.

import { PrismaClient } from "@prisma/client";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const prisma = new PrismaClient();

const PRODUCT_DIR = join(process.cwd(), "public", "products");
const IMAGE_EXT = /\.(jpe?g|png|webp|avif|gif|svg)$/i;

type OptionChoice = { label?: unknown };
type ProductOption = { name?: unknown; choices?: unknown };
type Attribute = { name: string; values: string[] };

/** Mirror of deriveVariantModel's attribute half (src/lib/variants.ts). */
function attributesFromOptions(raw: unknown): Attribute[] {
  if (!Array.isArray(raw)) return [];
  return (raw as ProductOption[])
    .map((o) => ({
      name: typeof o?.name === "string" ? o.name.trim() : "",
      values: Array.isArray(o?.choices)
        ? (o.choices as OptionChoice[])
            .map((c) => (typeof c?.label === "string" ? c.label.trim() : ""))
            .filter(Boolean)
        : [],
    }))
    .filter((a) => a.name && a.values.length > 0);
}

/** Every image file committed under public/products, recursively. */
async function walk(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (IMAGE_EXT.test(entry.name)) out.push(full);
  }
  return out;
}

/** Absolute path -> the exact URL form stored on products. */
function toUrl(absPath: string): string {
  const rel = absPath.slice(PRODUCT_DIR.length).split(/[\\/]/).filter(Boolean);
  return encodeURI(`/products/${rel.join("/")}`);
}

async function main() {
  let attributesWritten = 0;
  let mediaCreated = 0;
  let galleriesBuilt = 0;
  let rowsCreated = 0;

  // ---- 1. Derive attributes ------------------------------------------------
  const products = await prisma.product.findMany({
    select: { id: true, name: true, options: true, attributes: true, images: true },
    orderBy: { createdAt: "asc" },
  });

  for (const p of products) {
    const derived = attributesFromOptions(p.options);
    const current = JSON.stringify(p.attributes ?? []);
    if (JSON.stringify(derived) === current) continue;
    await prisma.product.update({ where: { id: p.id }, data: { attributes: derived } });
    attributesWritten++;
  }
  console.log(`attributes  : ${attributesWritten} product(s) updated, ${products.length} checked`);

  // ---- 2. Ingest photos into Media ----------------------------------------
  // Union of what is on disk and what products actually reference, so a pasted
  // or blob URL still gets a Media row and nothing on disk is missed.
  const onDisk = await walk(PRODUCT_DIR);
  const diskUrls = new Map<string, string>(); // url -> absolute path
  for (const abs of onDisk) diskUrls.set(toUrl(abs), abs);

  const referenced = new Set<string>();
  for (const p of products) for (const u of p.images) if (u) referenced.add(u);

  const allUrls = new Set<string>([...diskUrls.keys(), ...referenced]);

  for (const url of allUrls) {
    const abs = diskUrls.get(url);
    const isRepo = Boolean(abs);
    const file = decodeURIComponent(url.split("/").pop() ?? url).split("?")[0];
    let size: number | undefined;
    if (abs) {
      try {
        size = (await stat(abs)).size;
      } catch {
        /* unreadable — size is optional */
      }
    }
    const existing = await prisma.media.findUnique({ where: { url }, select: { id: true } });
    if (existing) continue;
    await prisma.media.create({
      data: {
        url,
        file,
        source: isRepo ? "repo" : url.startsWith("http") ? "external" : "repo",
        ...(size !== undefined ? { size } : {}),
      },
    });
    mediaCreated++;
  }
  console.log(
    `media       : ${mediaCreated} created (${diskUrls.size} on disk, ${referenced.size} referenced, ${allUrls.size} unique)`,
  );

  // Warn about anything a product points at that has no file behind it.
  const missing = [...referenced].filter((u) => !diskUrls.has(u) && !u.startsWith("http"));
  if (missing.length) {
    console.warn(`\n  WARNING: ${missing.length} referenced image(s) have no file on disk:`);
    for (const m of missing.slice(0, 10)) console.warn(`    ${m}`);
  }

  // ---- 3. Build the ProductImage gallery -----------------------------------
  const mediaRows = await prisma.media.findMany({ select: { id: true, url: true } });
  const idByUrl = new Map(mediaRows.map((m) => [m.url, m.id]));

  for (const p of products) {
    const already = await prisma.productImage.count({ where: { productId: p.id } });
    if (already > 0) continue; // idempotent: this product's gallery is built

    let sortOrder = 0;
    for (const url of p.images) {
      const mediaId = idByUrl.get(url);
      if (!mediaId) continue;
      try {
        await prisma.productImage.create({
          data: {
            productId: p.id,
            mediaId,
            variantValue: null, // common — shown for every variant
            slot: "common",
            sortOrder: sortOrder++,
          },
        });
        rowsCreated++;
      } catch {
        // unique [productId, mediaId, variantValue] — a duplicate url in the
        // array is expected and simply skipped.
      }
    }
    if (sortOrder > 0) galleriesBuilt++;
  }
  console.log(`gallery     : ${rowsCreated} ProductImage row(s) across ${galleriesBuilt} product(s)`);

  console.log("\nDone. Product.images was not modified.");
}

main()
  .catch((err) => {
    console.error("\nBackfill FAILED:\n", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
