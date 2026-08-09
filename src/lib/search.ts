import Fuse from "fuse.js";
import type { ProductDTO } from "./types";

// Typo-tolerant fuzzy search over the product catalogue.
// Fuse ranks by relevance and forgives misspellings ("hoodei" → Hoodie),
// partial words and word order — which a plain regex/ILIKE cannot do.
const FUSE_OPTIONS: import("fuse.js").IFuseOptions<ProductDTO> = {
  includeScore: true,
  ignoreLocation: true, // match anywhere in the string
  threshold: 0.36, // higher = more forgiving of typos (0 = exact, 1 = match all)
  minMatchCharLength: 2,
  keys: [
    { name: "name", weight: 0.6 },
    { name: "tags", weight: 0.2 },
    { name: "category", weight: 0.13 },
    { name: "secondaryCategory", weight: 0.07 },
  ],
};

export function searchProducts(
  products: ProductDTO[],
  query: string,
  limit?: number
): ProductDTO[] {
  const q = query.trim();
  if (!q) return limit ? products.slice(0, limit) : products;
  const fuse = new Fuse(products, FUSE_OPTIONS);
  const results = fuse.search(q).map((r) => r.item);
  return limit ? results.slice(0, limit) : results;
}
