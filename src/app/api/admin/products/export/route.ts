import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth";
import { allCombinations, comboKey } from "@/lib/options";
import type { Attribute, Variant, VariantPrice, SellableVariant } from "@/lib/types";

const PAYMENT_MODE_LABELS: Record<string, string> = {
  prepaid: "Prepaid — Pay Online (full amount)",
  cod: "Cash on Delivery",
  partial: "Advance Payment (advance online + COD)",
  direct: "Customised Order (pay to owner, non-refundable)",
};

function escapeCsv(val: any): string {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const products = await prisma.product.findMany({
    orderBy: { createdAt: "desc" },
  });

  const headers = [
    "ID",
    "Name",
    "Description",
    "Tags (comma separated)",
    "Options & variants (ex..size,type , color )",
    "Variants (price · availability · photos)",
    "Compare-at price (₹)",
    "Price (₹)",
    "Secondary category (optional)",
    "Category",
    "featured in homepage ?",
    "checkout modes",
    "Weight (grams)",
    "Length (cm)",
    "Breadth (cm)",
    "Height (cm)",
  ];

  const rows: string[][] = [headers];

  for (const p of products) {
    // Support both old options and new attributes
    const optionsRaw = (p.options as unknown as any[]) || [];
    const attributesRaw = (p.attributes as unknown as Attribute[]) || [];
    const sellableVariantsRaw = (p.sellableVariants as unknown as SellableVariant[]) || [];
    const variantsRaw = (p.variants as unknown as Variant[]) || [];
    const variantPricesRaw = (p.variantPrices as unknown as VariantPrice[]) || [];

    const tagsStr = (p.tags || []).join(", ");

    // Build options string from new attributes or old options
    let optionsStr = "None";
    if (attributesRaw.length > 0) {
      optionsStr = attributesRaw
        .map((attr) => `${attr.name}: ${attr.values.join(", ")}`)
        .join(" | ");
    } else if (optionsRaw.length > 0) {
      optionsStr = optionsRaw
        .map((opt: any) => `${opt.name}: ${(opt.choices || []).map((c: any) => c.label).join(", ")}`)
        .join(" | ");
    }

    let variantsDetailsStr = "";
    
    // Use new sellable variants if available
    if (sellableVariantsRaw.length > 0) {
      const details = sellableVariantsRaw.map(v => {
        const comboName = Object.entries(v.combo).map(([k, val]) => `${k}: ${val}`).join(", ");
        const availText = v.available ? "Available" : "Out of Stock";
        const imgCount = v.images?.length || 0;
        const imgText = imgCount > 0 ? `${imgCount} photo(s)` : "No photo";
        return `[${comboName}] -> Price: ₹${v.price} | ${availText} | ${imgText}`;
      });
      variantsDetailsStr = details.join("\n");
    } else {
      // Fall back to old variants matrix
      const allAttrs = attributesRaw.length > 0 ? attributesRaw : optionsRaw.map((o: any) => ({ name: o.name, values: (o.choices || []).map((c: any) => c.label) }));
      const generatedCombos = allCombinations(allAttrs);

      if (generatedCombos.length > 0) {
        const details: string[] = [];
        for (const combo of generatedCombos) {
          const comboName = Object.entries(combo).map(([k, v]) => `${k}: ${v}`).join(", ");
          if (variantsRaw.length > 0) {
            const match = variantsRaw.find((v) => comboKey(v.combo) === comboKey(combo));
            if (match) {
              const availText = match.available ? "Available" : "Out of Stock";
              const imgCount = match.images?.length || 0;
              const imgText = imgCount > 0 ? `${imgCount} photo(s)` : "No photo";
              details.push(`[${comboName}] -> Price: ₹${match.price} | ${availText} | ${imgText} (EXISTING)`);
            } else {
              details.push(`[${comboName}] -> DOES NOT EXIST (Disabled Combination)`);
            }
          } else {
            const vpMatch = variantPricesRaw.find((vp) => comboKey(vp.combo) === comboKey(combo));
            const price = vpMatch ? vpMatch.price : p.price;
            details.push(`[${comboName}] -> Price: ₹${price} | Available | ${p.images.length} main photo(s) (EXISTING)`);
          }
        }
        variantsDetailsStr = details.join("\n");
      } else {
        variantsDetailsStr = `No options variant matrix (Base Product Only) | Price: ₹${p.price} | Stock: ${p.stock} | Photos: ${p.images.length}`;
      }
    }

    const modes = (p.paymentModes || []).map(
      (m) => PAYMENT_MODE_LABELS[m] || m
    );
    const checkoutModesStr = modes.join("; ");

    rows.push([
      p.id,
      p.name,
      p.description,
      tagsStr,
      optionsStr,
      variantsDetailsStr,
      p.compareAtPrice !== null && p.compareAtPrice !== undefined ? String(p.compareAtPrice) : "",
      String(p.price),
      p.secondaryCategory || "",
      p.category,
      p.isFeatured ? "Yes" : "No",
      checkoutModesStr,
      p.weightGrams !== null && p.weightGrams !== undefined ? String(p.weightGrams) : "",
      p.lengthCm !== null && p.lengthCm !== undefined ? String(p.lengthCm) : "",
      p.breadthCm !== null && p.breadthCm !== undefined ? String(p.breadthCm) : "",
      p.heightCm !== null && p.heightCm !== undefined ? String(p.heightCm) : "",
    ]);
  }

  const csvContent = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="products_export_${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}
