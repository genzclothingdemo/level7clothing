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

    // Products are the only thing that can own a photo here. Subcategory covers
    // are plain URLs on `Subcategory.images`, not a join table.
    const productImages = await prisma.productImage.findMany({
      where: { media: { url: { in: urls } } },
      include: {
        product: { select: { id: true, name: true } },
        media:   { select: { url: true } },
      },
    });

    for (const pi of productImages) {
      const url = pi.media.url;
      if (!usage[url]) usage[url] = [];
      usage[url].push({ kind: "product", id: pi.product.id, name: pi.product.name, slot: pi.slot });
    }

    return NextResponse.json({ photos, usage, total, page, limit });
  } catch (err) {
    console.error("[api/admin/media] failed:", err);
    return NextResponse.json({ error: "Could not read the photo library" }, { status: 500 });
  }
}
