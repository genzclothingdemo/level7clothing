import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  await prisma.category.deleteMany({
    where: { slug: { in: ["t-shirts", "hoodies"] } },
  });

  await prisma.category.upsert({
    where: { slug: "minimalistic-oversized-t-shirts" },
    update: {},
    create: {
      name: "Minimalistic Oversized T-shirts",
      slug: "minimalistic-oversized-t-shirts",
      imageUrl: "/products/level7/BottleGreenFront.png",
    },
  });
  await prisma.category.upsert({
    where: { slug: "premium-oversized-t-shirts" },
    update: {},
    create: {
      name: "Premium Oversized T-shirts",
      slug: "premium-oversized-t-shirts",
      imageUrl: "/products/level7/05.10.2024-175.jpg",
    },
  });
  await prisma.category.upsert({
    where: { slug: "oversized-drop-shoulder-hoodies" },
    update: {},
    create: {
      name: "Oversized Drop-Shoulder Hoodies",
      slug: "oversized-drop-shoulder-hoodies",
      imageUrl: "/products/level7/Level7_Core_Front.png",
    },
  });
  console.log("categories ready");
}
main().finally(() => prisma.$disconnect());
