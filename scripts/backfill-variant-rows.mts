/**
 * Give every product one ProductVariant row — with a SKU — per sellable
 * combination of its options.
 *
 *     npx tsx scripts/backfill-variant-rows.mts            # dry run, prints the plan
 *     npx tsx scripts/backfill-variant-rows.mts --apply    # writes it
 *
 * **Safe to run on the live database, and safe to run again.**
 *
 * - It only ever *creates* rows. An existing row (same product + combination)
 *   is left exactly as it is — including its SKU, because a SKU is printed on
 *   labels and must never change underneath the owner.
 * - Every row starts at `onHand 0, reserved 0, available 0` with **no ledger
 *   entries**, and `Product.trackInventory` is not touched. So nothing the
 *   storefront sells changes: an untracked product still sells from its old
 *   `stock` counter. Tracking starts per product, from a real count, in
 *   Admin → Inventory.
 * - A variant's `price` is set only where the storefront already charges
 *   something different from the product's own price (read from
 *   `sellableVariants`), so the price a shopper pays is unchanged too.
 *
 * Why not split the old `stock` across sizes? Because it is one number for
 * every size and the true split is unknown. Guessing would put invented
 * numbers at the top of a ledger, and every later figure would inherit them.
 */
import { PrismaClient } from "@prisma/client";
import { generateSku, skuPrefixFor } from "../src/lib/sku";
import { allCombinations, comboKey } from "../src/lib/options";

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();

type Attr = { name: string; values: string[] };
type Sellable = { id?: string; combo?: Record<string, string>; price?: number };

const settings = await prisma.siteSettings.findFirst({ select: { brandName: true } });
const prefix = skuPrefixFor(settings?.brandName || "Level7 Clothing");

const products = await prisma.product.findMany({
  select: {
    id: true,
    name: true,
    category: true,
    price: true,
    attributes: true,
    sellableVariants: true,
    variantRows: { select: { comboKey: true, sku: true } },
  },
  orderBy: { name: "asc" },
});

// Every SKU already in the table, so new ones cannot collide with old ones.
const taken = new Set((await prisma.productVariant.findMany({ select: { sku: true } })).map((v) => v.sku));

const plan: {
  productId: string;
  comboKey: string;
  combo: Record<string, string>;
  sku: string;
  price: number | null;
  sortOrder: number;
}[] = [];
let kept = 0;

for (const p of products) {
  const attrs = ((p.attributes as unknown as Attr[]) ?? []).filter((a) => a?.name && a.values?.length);
  const combos = attrs.length ? allCombinations(attrs) : [{}];
  const existing = new Set(p.variantRows.map((r) => r.comboKey));
  const sellable = new Map(
    ((p.sellableVariants as unknown as Sellable[]) ?? [])
      .filter((s) => s?.combo)
      .map((s) => [comboKey(s.combo!), s])
  );

  combos.forEach((combo, i) => {
    const key = comboKey(combo);
    if (existing.has(key)) {
      kept++;
      return;
    }
    const charged = sellable.get(key)?.price;
    plan.push({
      productId: p.id,
      comboKey: key,
      combo,
      sku: generateSku({
        prefix,
        category: p.category,
        productName: p.name,
        combo,
        axisOrder: attrs.map((a) => a.name),
        taken,
      }),
      price: typeof charged === "number" && charged !== p.price ? charged : null,
      sortOrder: i,
    });
  });
}

console.log(`prefix ${prefix} · ${products.length} products · ${plan.length} to create · ${kept} already exist`);
const priced = plan.filter((r) => r.price != null);
if (priced.length) {
  console.log(`\n${priced.length} rows keep a price different from their product's (what the storefront charges today):`);
  for (const r of priced) console.log(`  ${r.sku.padEnd(28)} ₹${r.price}`);
}

if (!APPLY) {
  console.log("\nDry run — nothing written. Re-run with --apply.");
  await prisma.$disconnect();
  process.exit(0);
}

// One row at a time rather than createMany, so a unique clash names the row
// that caused it instead of failing the whole batch anonymously.
let created = 0;
for (const r of plan) {
  await prisma.productVariant.create({
    data: {
      productId: r.productId,
      comboKey: r.comboKey,
      combo: r.combo,
      sku: r.sku,
      price: r.price,
      sortOrder: r.sortOrder,
    },
  });
  created++;
}
console.log(`\nCreated ${created} variant rows.`);
await prisma.$disconnect();
