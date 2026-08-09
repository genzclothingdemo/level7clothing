import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/taxonomy
 *
 * Feeds the Media Library's classification dropdowns so tagging stays
 * consistent with live store data. Returns:
 *   - categories: store categories (ordered) each with their subcategories
 *   - variantAttributes: attrName → sorted unique values, auto-collected from
 *     ALL products by merging their `attributes` and `options` JSON.
 *   - products: each product with its category, subcategory name and its own
 *     variantAttributes (attrName → sorted values), so the Media Library can
 *     cascade Category → Subcategory → Product → Attribute → Value.
 *
 * Admin-guarded with the same session check as the other admin/media routes.
 */
export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // --- Categories + their subcategories (store-defined, ordered) ---
    const categoryRows = await prisma.category.findMany({
      include: { subcategories: { orderBy: { sortOrder: "asc" } } },
      orderBy: { sortOrder: "asc" },
    });

    const categories = categoryRows.map((c) => ({
      name: c.name,
      slug: c.slug,
      subcategories: c.subcategories.map((s) => ({ name: s.name, slug: s.slug })),
    }));

    // subcategoryId → name, so each product can carry its group name without
    // a per-row join. Reuses the categories query above (which includes the
    // full subcategory rows, `id` among them).
    const subcatName = new Map<string, string>();
    for (const c of categoryRows) {
      for (const s of c.subcategories) subcatName.set(s.id, s.name);
    }

    // --- Variant attributes, merged from every product ---
    // `attributes` shape: [{ name, values: [] }]
    // `options`    shape: [{ name, choices: [{ label }] }]
    // Both are free-form JSON, so every access is defensive.
    const productRows = await prisma.product.findMany({
      select: {
        id: true,
        name: true,
        category: true,
        subcategoryId: true,
        attributes: true,
        options: true,
      },
    });

    // Collect a product's { attribute → values } into `into`. Used both
    // per-product and for the global merge below.
    const collectVariants = (
      p: { attributes: unknown; options: unknown },
      into: Record<string, Set<string>>
    ) => {
      const add = (name: unknown, value: unknown) => {
        const n = String(name ?? "").trim();
        const v = String(value ?? "").trim();
        if (!n || !v) return;
        (into[n] ??= new Set<string>()).add(v);
      };
      // attributes → { name, values: [] }
      const attrs = Array.isArray(p.attributes) ? (p.attributes as any[]) : [];
      for (const a of attrs) {
        const values = Array.isArray(a?.values) ? (a.values as any[]) : [];
        for (const v of values) add(a?.name, v);
      }
      // options → { name, choices: [{ label }] }
      const opts = Array.isArray(p.options) ? (p.options as any[]) : [];
      for (const o of opts) {
        const choices = Array.isArray(o?.choices) ? (o.choices as any[]) : [];
        for (const c of choices) add(o?.name, c?.label);
      }
    };

    // Turn a collected map into attrName → sorted unique values.
    const sortCollected = (collected: Record<string, Set<string>>) => {
      const out: Record<string, string[]> = {};
      for (const [name, set] of Object.entries(collected)) {
        out[name] = Array.from(set).sort((x, y) => x.localeCompare(y));
      }
      return out;
    };

    // Per-product variant data + the global merge in a single pass.
    const globalCollected: Record<string, Set<string>> = {};
    const products = productRows.map((p) => {
      collectVariants(p, globalCollected);
      const perCollected: Record<string, Set<string>> = {};
      collectVariants(p, perCollected);
      return {
        id: p.id,
        name: p.name,
        category: p.category,
        subcategoryName: p.subcategoryId ? subcatName.get(p.subcategoryId) ?? null : null,
        variantAttributes: sortCollected(perCollected),
      };
    });

    const variantAttributes = sortCollected(globalCollected);

    return NextResponse.json({ categories, variantAttributes, products });
  } catch (err) {
    console.error("[api/admin/taxonomy] failed:", err);
    return NextResponse.json({ error: "Could not load taxonomy" }, { status: 500 });
  }
}
