import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getFeatured, getProductsBySlugs } from "@/lib/products";
import type { ProductDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Recommends products to pair with what's already in the cart: same categories
 * first, topped up with featured pieces so the row is never half-empty.
 */
export async function POST(req: Request) {
  let slugs: unknown;
  let limit: unknown;
  try {
    ({ slugs, limit } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const inCart = (Array.isArray(slugs) ? slugs : [])
    .filter((s): s is string => typeof s === "string")
    .slice(0, 100);
  const take = typeof limit === "number" && limit > 0 && limit <= 12 ? limit : 4;

  const cartProducts = await getProductsBySlugs(inCart);
  const categories = [...new Set(cartProducts.map((p) => p.category))];

  const picked: ProductDTO[] = [];
  const seen = new Set(inCart);

  function add(list: ProductDTO[]) {
    for (const p of list) {
      if (picked.length >= take) return;
      if (seen.has(p.slug)) continue;
      seen.add(p.slug);
      picked.push(p);
    }
  }

  if (categories.length > 0) {
    try {
      const sameCategory = await prisma.product.findMany({
        where: {
          isActive: true,
          category: { in: categories },
          slug: { notIn: inCart.length ? inCart : ["__none__"] },
        },
        orderBy: [{ isFeatured: "desc" }, { createdAt: "desc" }],
        take: take * 2,
      });
      add(await getProductsBySlugs(sameCategory.map((p) => p.slug)));
    } catch {
      // fall through to featured
    }
  }

  if (picked.length < take) {
    add(await getFeatured(take * 3));
  }

  return NextResponse.json({ products: picked });
}
