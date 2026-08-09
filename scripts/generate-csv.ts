import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import { allCombinations, comboKey } from "../src/lib/options";
import type { Attribute, Variant, VariantPrice, SellableVariant } from "../src/lib/types";

const prisma = new PrismaClient();

const PAYMENT_MODE_LABELS: Record<string, string> = {
  prepaid: "Prepaid — Pay Online (full amount)",
  cod: "Cash on Delivery",
  partial: "Advance Payment (advance online + COD)",
  direct: "Customised Order (pay to owner, non-refundable)",
};

function escapeCsv(val: any): string {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  // Replace double quotes with escaped double quotes
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

async function main() {
  const products = await prisma.product.findMany({
    orderBy: { createdAt: "desc" },
  });

  console.log(`Fetched ${products.length} products from database.`);

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
    const optionsRaw = (p.options as unknown as any[]) || [];
    const attributesRaw = (p.attributes as unknown as Attribute[]) || [];
    const sellableVariantsRaw = (p.sellableVariants as unknown as SellableVariant[]) || [];
    const variantsRaw = (p.variants as unknown as Variant[]) || [];
    const variantPricesRaw = (p.variantPrices as unknown as VariantPrice[]) || [];

    // 1. Tags
    const tagsStr = (p.tags || []).join(", ");

    // 2. Options summary string (support new attributes or old options)
    let optionsStr = "";
    if (attributesRaw.length > 0) {
      optionsStr = attributesRaw
        .map((attr) => `${attr.name}: ${attr.values.join(", ")}`)
        .join(" | ");
    } else if (optionsRaw.length > 0) {
      optionsStr = optionsRaw
        .map((opt: any) => `${opt.name}: ${(opt.choices || []).map((c: any) => c.label).join(", ")}`)
        .join(" | ");
    } else {
      optionsStr = "None";
    }

    // 3. Variants matrix string
    let variantsDetailsStr = "";
    const allAttrs = attributesRaw.length > 0 ? attributesRaw : optionsRaw.map((o: any) => ({ name: o.name, values: (o.choices || []).map((c: any) => c.label) }));
    const generatedCombos = allCombinations(allAttrs);

    if (generatedCombos.length > 0) {
      const details: string[] = [];

      for (const combo of generatedCombos) {
        const comboName = Object.entries(combo)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ");

        // Check if product has explicit variants array (Flipkart style)
        if (variantsRaw.length > 0) {
          const match = variantsRaw.find((v) => {
            const key1 = comboKey(v.combo);
            const key2 = comboKey(combo);
            return key1 === key2;
          });

          if (match) {
            const availText = match.available ? "Available" : "Out of Stock";
            const imgCount = match.images?.length || 0;
            const imgText = imgCount > 0 ? `${imgCount} photo(s)` : "No photo";
            details.push(
              `[${comboName}] -> Price: ₹${match.price} | ${availText} | ${imgText} (EXISTING)`
            );
          } else {
            details.push(`[${comboName}] -> DOES NOT EXIST (Disabled Combination)`);
          }
        } else {
          // Legacy or default calculated variants
          const vpMatch = variantPricesRaw.find(
            (vp) => comboKey(vp.combo) === comboKey(combo)
          );
          let price = vpMatch ? vpMatch.price : p.price;
          if (!vpMatch) {
            for (const [gName, choiceVal] of Object.entries(combo)) {
              const grp = optionsRaw.find((o: any) => o.name === gName);
              const ch = grp?.choices?.find((c: any) => c.label === choiceVal);
              if (ch) price += ch.priceDelta || 0;
            }
          }
          details.push(
            `[${comboName}] -> Price: ₹${price} | Available | ${p.images.length} main photo(s) (EXISTING)`
          );
        }
      }
      variantsDetailsStr = details.join("\n");
    } else {
      variantsDetailsStr = `No options variant matrix (Base Product Only) | Price: ₹${p.price} | Stock: ${p.stock} | Photos: ${p.images.length}`;
    }

    // 4. Checkout modes string
    const modes = (p.paymentModes || []).map(
      (m) => PAYMENT_MODE_LABELS[m] || m
    );
    const checkoutModesStr = modes.join("; ");

    // 5. Featured string
    const featuredStr = p.isFeatured ? "Yes" : "No";

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
      featuredStr,
      checkoutModesStr,
      p.weightGrams !== null && p.weightGrams !== undefined ? String(p.weightGrams) : "",
      p.lengthCm !== null && p.lengthCm !== undefined ? String(p.lengthCm) : "",
      p.breadthCm !== null && p.breadthCm !== undefined ? String(p.breadthCm) : "",
      p.heightCm !== null && p.heightCm !== undefined ? String(p.heightCm) : "",
    ]);
  }

  const csvContent = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");

  const outputPath = path.join(process.cwd(), "public", "products_export.csv");
  fs.writeFileSync(outputPath, csvContent, "utf-8");
  console.log(`CSV export generated successfully at ${outputPath}`);

  const rootOutputPath = path.join(process.cwd(), "products_export.csv");
  fs.writeFileSync(rootOutputPath, csvContent, "utf-8");
  console.log(`CSV export copied to root ${rootOutputPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
