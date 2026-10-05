/**
 * SKU generation. Pure — no directive, no server imports — so the product
 * editor (a client component) and the server can both call it. See CLAUDE.md,
 * "RSC boundary traps".
 *
 * Shape: `<PREFIX>-<TYPE>-<CODE>[-<VALUE>…]`
 *
 *     L7-PT-SAMURAI-M          Samurai, Premium Oversized T-shirts, size M
 *     L7-PT-VOYAGER-RED-S      Voyager Space, colour red, size S
 *     L7-DSH-GROUNDED-XL       Grounded, Oversized Drop-Shoulder Hoodies, XL
 *
 * **A SKU is generated once and then stored.** It is printed on labels, typed
 * into couriers and spreadsheets, and matched by the owner's eye in a stockroom,
 * so it must never change underneath them — renaming a product or a category
 * later leaves every existing SKU exactly as it was. That is also why none of
 * this needs to be clever: it only has to produce a good *first* SKU, and the
 * admin can overwrite any of them.
 */

/** Words that say nothing about which garment this is. */
const NAME_STOPWORDS = new Set([
  "level7", "unisex", "premium", "oversized", "minimalistic", "drop",
  "shoulder", "t", "shirt", "shirts", "tshirt", "tshirts", "tee", "tees",
  "hoodie", "hoodies", "the", "a", "an", "of", "and", "is", "are", "it",
]);

/** Words that say nothing about which kind of garment a category holds. */
const CATEGORY_FILLER = new Set(["oversized", "unisex", "the", "and", "of", "for", "a"]);

const alnum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * `"Level7 Clothing"` → `"L7"`, `"Artvelle"` → `"AR"`.
 *
 * First letter of the brand's first word, plus that word's digits if it has
 * any, otherwise its first two letters. Taken from the store name rather than
 * hardcoded, because CLAUDE.md is explicit that brand strings come from
 * settings.
 */
export function skuPrefixFor(brandName: string): string {
  const first = (brandName || "").trim().split(/\s+/)[0] ?? "";
  const letters = first.replace(/[^A-Za-z]/g, "");
  const digits = first.replace(/[^0-9]/g, "");
  if (!letters) return "SKU";
  return digits ? alnum(letters[0] + digits) : alnum(letters.slice(0, 2));
}

/**
 * `"Premium Oversized T-shirts"` → `"PT"`,
 * `"Oversized Drop-Shoulder Hoodies"` → `"DSH"`.
 *
 * Initials of the words that actually describe the kind, with "T-shirt" read
 * as one word — otherwise every tee category would start with a stray `T` from
 * the hyphen.
 */
export function skuTypeFor(category: string): string {
  const words = (category || "")
    .toLowerCase()
    .replace(/\bt-?shirts?\b|\btees?\b/g, "tee")
    .replace(/\bhoodies?\b/g, "hoodie")
    .split(/[\s-]+/)
    .filter((w) => w && !CATEGORY_FILLER.has(w));
  const code = words.map((w) => w[0]).join("").toUpperCase().slice(0, 3);
  return code || "GEN";
}

/**
 * `"Samurai Unisex Premium Oversized"` → `"SAMURAI"`,
 * `"Make it 7 Unisex Premium Oversized T-shirt"` → `"MAKE7"`,
 * `"You are Loved Unisex Minimalistic Oversized T-shirt"` → `"YOULOVED"`.
 *
 * The design's own name, with brand and garment words removed, taken word by
 * word until it is long enough to recognise at a glance (5+ characters) and
 * capped so it never dominates the SKU.
 */
export function skuCodeFor(productName: string): string {
  const words = (productName || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w && !NAME_STOPWORDS.has(w));

  let code = "";
  for (const w of words) {
    code += alnum(w);
    if (code.length >= 5) break;
  }
  return (code || "ITEM").slice(0, 14);
}

const isSizeAxis = (name: string) => /^size$/i.test(name.trim());

/**
 * The option segments, **size last**. Apparel convention: colour before size,
 * so `…-RED-S` sorts every size of one colour together on a stock sheet.
 */
export function skuValuesFor(combo: Record<string, string>, axisOrder: string[] = []): string[] {
  const names = Object.keys(combo);
  const ordered = [
    ...axisOrder.filter((n) => names.includes(n)),
    ...names.filter((n) => !axisOrder.includes(n)),
  ];
  const nonSize = ordered.filter((n) => !isSizeAxis(n));
  const size = ordered.filter(isSizeAxis);
  return [...nonSize, ...size].map((n) => alnum(combo[n] ?? "")).filter(Boolean);
}

/**
 * A SKU for one combination, unique against `taken`.
 *
 * `taken` is mutated — the new SKU is added — so generating every variant of a
 * product in a loop, or every product in a backfill, cannot collide with
 * itself. On a clash the SKU gets `-2`, `-3`, …: ugly on purpose, because a
 * clash means two garments look alike and the owner should probably rename one.
 */
export function generateSku(input: {
  prefix: string;
  category: string;
  productName: string;
  combo: Record<string, string>;
  axisOrder?: string[];
  taken: Set<string>;
}): string {
  const base = [
    alnum(input.prefix) || "SKU",
    skuTypeFor(input.category),
    skuCodeFor(input.productName),
    ...skuValuesFor(input.combo, input.axisOrder),
  ].join("-");

  let sku = base;
  for (let n = 2; input.taken.has(sku); n++) sku = `${base}-${n}`;
  input.taken.add(sku);
  return sku;
}

/**
 * What an admin-typed SKU must look like. Uppercase letters, digits and
 * hyphens, 3–40 characters. Deliberately strict: a SKU with spaces or
 * lowercase is the one someone mistypes into a courier form at 11pm.
 */
export const SKU_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,38}[A-Z0-9]$/;

/** Tidy what an admin typed into something that can pass `SKU_PATTERN`. */
export function normaliseSku(raw: string): string {
  return (raw || "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
