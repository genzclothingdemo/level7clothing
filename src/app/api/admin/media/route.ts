import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const category       = searchParams.get("category") ?? undefined;
  const subcategoryName= searchParams.get("subcategoryName") ?? undefined;
  const variantValue   = searchParams.get("variantValue") ?? undefined;
  const q              = searchParams.get("q") ?? undefined;
  const page           = Math.max(1, Number(searchParams.get("page") ?? 1));
  const limit          = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? 100)));
  const skip           = (page - 1) * limit;

  try {
    // Build WHERE clause — only filter on fields that were passed
    const where: Record<string, unknown> = {};

    if (q) {
      where.OR = [
        { file:            { contains: q, mode: "insensitive" } },
        { alt:             { contains: q, mode: "insensitive" } },
        { variantValue:    { contains: q, mode: "insensitive" } },
        { subcategoryName: { contains: q, mode: "insensitive" } },
      ];
    }

    // category filter — derived from the URL path stored in `url`
    if (category) {
      where.url = { contains: encodeURIComponent(category), mode: "insensitive" };
    }

    if (subcategoryName) {
      where.subcategoryName = subcategoryName;
    }

    // variantValue = "__common__" is a sentinel meaning "no variant tag"
    if (variantValue !== undefined) {
      where.variantValue = variantValue === "__common__" ? null : variantValue;
    }

    const [media, total] = await Promise.all([
      prisma.media.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.media.count({ where }),
    ]);

    const photos = media.map((m) => {
      let cat = "Uploaded";
      let group = "";
      if (m.source === "repo") {
        const parts = decodeURIComponent(m.url)
          .replace("/products/gallery/", "")
          .split("/");
        if (parts.length >= 2) cat = parts[0];
        if (parts.length >= 3) group = parts.slice(1, -1).join(" / ");
      } else if (m.source === "external") {
        cat = "Pasted links";
      }

      return {
        id:              m.id,
        url:             m.url,
        file:            m.file,
        // "Image Name" in the admin UI — a human-editable display name,
        // independent of the on-disk filename.
        alt:             m.alt,
        category:        cat,
        group,
        variantAttribute: m.variantAttribute,
        variantValue:    m.variantValue,
        subcategoryName: m.subcategoryName,
        tags:            m.tags,
        roles:           m.roles,
        size:            m.size,
        width:           m.width,
        height:          m.height,
        source:          m.source as "repo" | "blob" | "external",
        createdAt:       m.createdAt,
      };
    });

    // Build usage map only for the current page (bounded)
    const urls = photos.map((p) => p.url);
    const usage: Record<string, { kind: string; id: string; name: string; slot?: string }[]> = {};

    const add = (url: string, row: { kind: string; id: string; name: string; slot?: string }) => {
      if (!usage[url]) usage[url] = [];
      usage[url].push(row);
    };

    /**
     * Everything that can own a photo — not just products.
     *
     * This used to query `ProductImage` alone, with a comment saying products
     * were the only owner. That stopped being true: the portfolio, category
     * and subcategory covers and the site logo all reference a media URL, and
     * none of them is a join table. The cost of the gap is specific, because
     * the media library's bulk delete splits the selection on
     * `usage[url].length` — a photo used only by a portfolio piece read as
     * "used by nothing", was deleted without a second prompt, and left a
     * broken tile on a public page.
     *
     * All five run together: they are independent, and the usage map is only
     * built for the URLs on the current page, so each is a small bounded read.
     *
     * `Product.images` is queried as well as `ProductImage` because the string
     * array is the legacy mirror (CLAUDE.md, "ProductImage rows are the
     * contract") and rows saved before that table existed live only there.
     * Duplicates across the two are collapsed below.
     */
    const [productImages, legacyProducts, portfolio, subcategories, categories, settings] =
      await Promise.all([
        prisma.productImage.findMany({
          where: { media: { url: { in: urls } } },
          include: {
            product: { select: { id: true, name: true } },
            media: { select: { url: true } },
          },
        }),
        prisma.product.findMany({
          where: { images: { hasSome: urls } },
          select: { id: true, name: true, images: true },
        }),
        prisma.portfolioItem.findMany({
          where: { imageUrl: { in: urls } },
          select: { id: true, title: true, imageUrl: true },
        }),
        prisma.subcategory.findMany({
          where: { images: { hasSome: urls } },
          select: { id: true, name: true, images: true },
        }),
        prisma.category.findMany({
          where: { imageUrl: { in: urls } },
          select: { id: true, name: true, imageUrl: true },
        }),
        prisma.siteSettings.findFirst({ select: { id: true, logoUrl: true } }),
      ]);

    const onPage = new Set(urls);

    for (const pi of productImages) {
      add(pi.media.url, {
        kind: "product",
        id: pi.product.id,
        name: pi.product.name,
        slot: pi.slot,
      });
    }

    // Only where there is no ProductImage row saying the same thing, so a
    // product does not appear twice against one photo.
    for (const p of legacyProducts) {
      for (const url of p.images) {
        if (!onPage.has(url)) continue;
        if (usage[url]?.some((u) => u.kind === "product" && u.id === p.id)) continue;
        add(url, { kind: "product", id: p.id, name: p.name, slot: "legacy" });
      }
    }

    for (const item of portfolio) {
      if (item.imageUrl) add(item.imageUrl, { kind: "portfolio", id: item.id, name: item.title });
    }

    for (const s of subcategories) {
      for (const url of s.images) {
        if (onPage.has(url)) add(url, { kind: "subcategory", id: s.id, name: s.name, slot: "cover" });
      }
    }

    for (const c of categories) {
      if (c.imageUrl) add(c.imageUrl, { kind: "category", id: c.id, name: c.name, slot: "cover" });
    }

    if (settings?.logoUrl && onPage.has(settings.logoUrl)) {
      add(settings.logoUrl, { kind: "settings", id: settings.id, name: "Store logo" });
    }

    return NextResponse.json({ photos, usage, total, page, limit });
  } catch (err) {
    console.error("[api/admin/media] failed:", err);
    return NextResponse.json({ error: "Could not read the photo library" }, { status: 500 });
  }
}
