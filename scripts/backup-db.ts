// Full read-only snapshot of the live database, written to scripts/tmp/.
//
// Run this BEFORE any `prisma db push` that changes an existing table. It is the
// only safety net in this repo — there are no Prisma migration files, so a bad
// push cannot be rolled back by Prisma itself.
//
//   npx tsx scripts/backup-db.ts
//
// Writes scripts/tmp/backup-<timestamp>.json plus a short counts summary on
// stdout. Purely SELECTs; nothing is written to the database.

import { PrismaClient } from "@prisma/client";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const prisma = new PrismaClient();

async function main() {
  const startedAt = new Date();

  // Ordered so the summary reads catalogue-first, then commerce, then the rest.
  const [
    products,
    categories,
    orders,
    reviews,
    returnRequests,
    coupons,
    users,
    addresses,
    newsletterSubscribers,
    leads,
    messages,
    siteSettings,
    adminUsers,
  ] = await Promise.all([
    prisma.product.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.category.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.order.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.review.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.returnRequest.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.coupon.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.address.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.newsletterSubscriber.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.lead.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.message.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.siteSettings.findMany(),
    prisma.adminUser.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

  const data = {
    products,
    categories,
    orders,
    reviews,
    returnRequests,
    coupons,
    users,
    addresses,
    newsletterSubscribers,
    leads,
    messages,
    siteSettings,
    adminUsers,
  };

  const counts = Object.fromEntries(
    Object.entries(data).map(([table, rows]) => [table, rows.length]),
  );

  const dir = join(process.cwd(), "scripts", "tmp");
  await mkdir(dir, { recursive: true });
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
  const file = join(dir, `backup-${stamp}.json`);

  await writeFile(
    file,
    JSON.stringify({ takenAt: startedAt.toISOString(), counts, data }, null, 2),
    "utf8",
  );

  console.log("\n=== Row counts ===");
  for (const [table, n] of Object.entries(counts)) {
    console.log(`${String(n).padStart(6)}  ${table}`);
  }

  // The two numbers that decide how the ReturnRequest migration has to be done.
  console.log("\n=== Migration-critical ===");
  console.log(`ReturnRequest rows : ${counts.returnRequests}`);
  console.log(`Products (active)  : ${products.filter((p) => p.isActive).length} of ${products.length}`);

  console.log(`\nBackup written to scripts/tmp/backup-${stamp}.json`);
}

main()
  .catch((err) => {
    console.error("\nBackup FAILED — do not proceed with any schema change.\n", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
