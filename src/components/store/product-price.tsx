"use client";

import { useProductView } from "@/context/product-view";
import { priceForSelection } from "@/lib/variants";
import { formatINR } from "@/lib/utils";
import type { ProductDTO } from "@/lib/types";

/**
 * The headline price on the product page. Lives on the client so it tracks the
 * customer's variant selection (the previous server-rendered price was locked to
 * the min–max range and never updated after a variant was chosen). Because the
 * page seeds a full default selection, this shows one concrete price, not a range.
 */
export function ProductPrice({ product }: { product: ProductDTO }) {
  const { selection } = useProductView();
  const price = priceForSelection(product, selection);
  const compare = product.compareAtPrice;
  const discount =
    compare && compare > price
      ? Math.round(((compare - price) / compare) * 100)
      : 0;

  return (
    <div className="mt-3 flex items-baseline gap-3">
      <span className="text-2xl font-semibold md:text-3xl">
        {formatINR(price)}
      </span>
      {discount > 0 && (
        <>
          <span className="text-lg text-muted-foreground line-through">
            {formatINR(compare!)}
          </span>
          <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
            Save {discount}%
          </span>
        </>
      )}
    </div>
  );
}
