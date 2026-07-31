/**
 * One-off migration: put every existing product on free shipping and give it a
 * realistic parcel spec (weight + L/B/H) based on its garment type.
 *
 * Safe to re-run — it only writes shipping fields and leaves everything else
 * (prices, images, reviews, settings) untouched. Unlike `db:seed`, this does
 * not delete and recreate products.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TEE = { weightGrams: 300, lengthCm: 30, breadthCm: 24, heightCm: 3 };
const HOODIE = { weightGrams: 750, lengthCm: 33, breadthCm: 26, heightCm: 6 };

function parcelFor(category: string) {
  return /hoodie/i.test(category) ? HOODIE : TEE;
}

/** Courier billable weight = max(dead, volumetric); volumetric kg = LxBxH/5000. */
function billableGrams(p: typeof TEE) {
  const volumetric = (p.lengthCm * p.breadthCm * p.heightCm) / 5000;
  return Math.max(p.weightGrams, Math.round(volumetric * 1000));
}

async function main() {
  const products = await prisma.product.findMany({
    select: { id: true, name: true, category: true },
  });

  let updated = 0;
  for (const p of products) {
    const parcel = parcelFor(p.category);
    await prisma.product.update({
      where: { id: p.id },
      data: {
        shippingType: "free",
        shippingFee: 0,
        shippingMarkup: 0,
        ...parcel,
      },
    });
    updated++;
  }

  console.log(`✓ ${updated} product(s) set to free shipping`);
  console.log(
    `  Tee    → ${TEE.weightGrams}g, ${TEE.lengthCm}x${TEE.breadthCm}x${TEE.heightCm}cm ` +
      `(billable ~${billableGrams(TEE)}g)`
  );
  console.log(
    `  Hoodie → ${HOODIE.weightGrams}g, ${HOODIE.lengthCm}x${HOODIE.breadthCm}x${HOODIE.heightCm}cm ` +
      `(billable ~${billableGrams(HOODIE)}g)`
  );

  const byType = await prisma.product.groupBy({
    by: ["shippingType"],
    _count: { _all: true },
  });
  console.log(
    "  shippingType spread:",
    byType.map((r) => `${r.shippingType}=${r._count._all}`).join(", ")
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
