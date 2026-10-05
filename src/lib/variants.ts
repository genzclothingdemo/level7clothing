import type { Attribute, MediaDTO, PropertyDependencies, SellableVariant } from "./types";
import { comboKey } from "./options";

export type Selection = Record<string, string>;

/** Default selection = the first available choice of every attribute. */
export function defaultSelection(attributes: Attribute[]): Selection {
  const result: Selection = {};
  for (const attr of attributes) {
    if (attr.values.length > 0) {
      result[attr.name] = attr.values[0];
    }
  }
  return result;
}

/**
 * Bridge the admin authoring model (`options` + `variants`) to the storefront/
 * checkout read model (`attributes` + `sellableVariants`). Single source of truth,
 * used both when saving a product (server action) and as a read-time fallback for
 * products saved before the two halves were connected. Pure — no DB/server deps.
 */
export function deriveVariantModel(input: {
  options?: unknown;
  variants?: unknown;
  price: number;
  stock: number;
}): { attributes: Attribute[]; sellableVariants: SellableVariant[] } {
  const options = Array.isArray(input.options) ? (input.options as any[]) : [];
  const attributes: Attribute[] = options
    .map((o) => ({
      name: String(o?.name ?? "").trim(),
      values: Array.isArray(o?.choices)
        ? (o.choices as any[]).map((c) => String(c?.label ?? "").trim()).filter(Boolean)
        : [],
    }))
    .filter((a) => a.name && a.values.length > 0);

  const variants = Array.isArray(input.variants) ? (input.variants as any[]) : [];
  const basePrice = Number(input.price) || 0;
  const baseStock = Number(input.stock) || 0;
  const sellableVariants: SellableVariant[] = variants
    .filter((v) => v && typeof v.combo === "object" && v.combo)
    .map((v) => {
      const combo = v.combo as Record<string, string>;
      // The one rule — see resolveVariantPrice. Not re-derived here, so the
      // mirror checkout charges from can never drift from what the editor and
      // the ProductVariant rows say.
      const price = resolveVariantPrice(v.price, basePrice);
      const images = Array.isArray(v.images) ? (v.images as any[]).filter(Boolean) : [];
      const stockRaw = v.stock;
      const stock =
        stockRaw === "" || stockRaw == null || !Number.isFinite(Number(stockRaw))
          ? baseStock // no per-variant stock set → inherit the product's stock
          : Number(stockRaw);
      return {
        id: comboKey(combo),
        combo,
        price,
        images,
        stock,
        weight: 0,
        available: v.available !== false,
      };
    });

  return { attributes, sellableVariants };
}

/* ------------------------------------------------------------------ */
/*  The price resolver                                                 */
/* ------------------------------------------------------------------ */
//
// **What a combination sells for is decided here and nowhere else.**
//
// There used to be four overlapping price mechanisms and no agreement between
// them:
//
//   options[].choices[].priceDelta   authored in the editor, read by nothing
//   variantPrices                    legacy matrix, used by no product
//   variants[].price                 the editor's draft ("" = inherit)
//   sellableVariants[].price         the derived copy — what checkout charges
//
// and the editor inherited blank rows from the price the admin *typed*, while
// the server inherited them from the price it *saved* (the cheapest available
// combination). Typing base ₹150 with one size at ₹100 showed the blank sizes
// at ₹150 and charged them ₹100.
//
// Now: `ProductVariant.price` is the override (null = inherit), the product
// save writes it and the `sellableVariants` mirror **in one transaction from
// this function**, and every reader of the mirror — checkout
// (`actions/orders.ts`), the coupon quote (`lib/coupons.ts`) and the product
// page (`priceForSelection`) — already reads `sellable.price ?? product.price`.
// The editor previews with the same function, so all four agree by
// construction. Pure — no directive, no server imports (CLAUDE.md, RSC traps).

/**
 * What a typed per-combination price means: whole rupees above zero, or
 * `null` — "inherit the product's price".
 *
 * Blank, zero, negative and non-numeric all read as inherit. Zero in
 * particular: `deriveVariantModel` has always sold a `0` override at the base
 * price, so treating it as ₹0 here would make the row and the mirror disagree
 * about the one combination nobody meant to give away.
 */
export function normalisePriceOverride(raw: unknown): number | null {
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** What one combination sells for: its override, else the product's price. */
export function resolveVariantPrice(override: unknown, productPrice: number): number {
  return normalisePriceOverride(override) ?? (Number(productPrice) || 0);
}

export type SettledPrices = {
  /**
   * `Product.price`: the cheapest *available* combination, or the base when
   * there are none. It is what listing cards, sorting and JSON-LD show, which
   * is why it stays the "from" price rather than becoming the typed base.
   */
  productPrice: number;
  /** Per combination key, what to store as its override (null = inherit). */
  overrides: Record<string, number | null>;
  /** Per combination key, what it sells for — the number checkout charges. */
  effective: Record<string, number>;
};

/**
 * Turn what the admin typed — a base price and, per combination, an optional
 * override — into what is stored, such that **no combination's price moves
 * when `Product.price` does**.
 *
 * Blank rows inherit `Product.price`, and `Product.price` is the cheapest
 * available combination. Those two rules only agree while the base *is* the
 * cheapest. When a row is overridden below the base, the product price drops
 * to that row, and a blank row would silently follow it down — the bug this
 * replaced. So in exactly that case the blank rows are **pinned at the base**
 * they were showing. Explicit overrides are kept as typed, never folded back
 * to blank, so a price the admin chose never starts following another one.
 *
 * With no combinations (or none available) the product sells at the base.
 */
export function settleVariantPrices(input: {
  basePrice: unknown;
  combos: { key: string; override: unknown; available?: boolean }[];
}): SettledPrices {
  const base = Math.max(0, Math.round(Number(input.basePrice) || 0));
  const effective: Record<string, number> = {};
  const typed: Record<string, number | null> = {};
  for (const c of input.combos) {
    typed[c.key] = normalisePriceOverride(c.override);
    effective[c.key] = typed[c.key] ?? base;
  }
  const offered = input.combos.filter((c) => c.available !== false);
  const productPrice = offered.length
    ? Math.min(...offered.map((c) => effective[c.key]))
    : base;

  const overrides: Record<string, number | null> = {};
  for (const c of input.combos) {
    overrides[c.key] = typed[c.key] ?? (base === productPrice ? null : base);
  }
  return { productPrice, overrides, effective };
}

/**
 * A sellable variant as the product save writes it. `compareAtPrice` is only
 * present when that combination has its own — the key is omitted otherwise, so
 * a product with none keeps a byte-identical mirror.
 */
export type SellableVariantMirror = SellableVariant & { compareAtPrice?: number };

/**
 * The struck-through "was" price for a selection: the combination's own
 * compare-at price where it has one, else the product's.
 *
 * Exists so the product page can show a per-size compare-at with a one-line
 * change (`product.compareAtPrice` → `compareAtForSelection(product, selection)`
 * in `product-price.tsx`). Until a reader uses it, the product's Discount % is
 * what shoppers see.
 */
export function compareAtForSelection(
  product: { compareAtPrice: number | null; sellableVariants?: any },
  selected: Selection
): number | null {
  const variants = (product.sellableVariants || []) as SellableVariantMirror[];
  const match = variants.find((v) => v.id === comboKey(selected));
  return match?.compareAtPrice ?? product.compareAtPrice;
}

/**
 * The selection to show on first load: the combo of the first *available* sellable
 * variant (so the customer lands on something orderable), falling back to the first
 * choice of each attribute. Empty for products with no options.
 */
export function firstAvailableSelection(product: {
  attributes?: Attribute[];
  sellableVariants?: SellableVariant[];
}): Selection {
  const attributes = product.attributes ?? [];
  if (attributes.length === 0) return {};
  const variants = product.sellableVariants ?? [];
  const firstAvailable = variants.find((v) => v.available);
  if (firstAvailable) return { ...firstAvailable.combo };
  const anyVariant = variants[0];
  if (anyVariant) return { ...anyVariant.combo };
  return defaultSelection(attributes);
}

/** 
 * Returns the effective price for a selection.
 */
export function priceForSelection(
  product: { price: number; sellableVariants?: any },
  selected: Selection
): number {
  const variants = (product.sellableVariants || []) as SellableVariant[];
  const key = comboKey(selected);
  const match = variants.find(v => v.id === key);
  return match?.price ?? product.price;
}

export function imagesForSelection(
  product: { images: string[]; sellableVariants?: any },
  selected: Selection
): string[] {
  const variants = (product.sellableVariants || []) as SellableVariant[];
  const key = comboKey(selected);
  const match = variants.find(v => v.id === key);
  
  if (match && match.images && match.images.length > 0) {
    return match.images;
  }

  return product.images || [];
}

/**
 * The value the admin's Image Controller select carries for the explicit
 * "None" choice. It exists only in the editor's local form state — what is
 * *persisted* for None is an empty `propertyModules.images`, never this string.
 * Lives here rather than in a `"use client"` module so both halves can import
 * it (see the RSC note in CLAUDE.md).
 */
export const IMAGE_CONTROLLER_NONE = "__none__";

/**
 * The name of the "visual" attribute — the one whose value swaps the gallery.
 * Authored in admin as the image-driving option and persisted as
 * `propertyModules.images`. Nothing about the storefront hardcodes "Design" —
 * the label the customer sees is whatever this returns.
 *
 * Three states, and the difference between the last two is the whole point:
 *
 * | `propertyModules.images` | means                     | result                  |
 * |--------------------------|---------------------------|-------------------------|
 * | absent / not an array    | never declared (legacy)   | first attribute         |
 * | `[]`                     | **explicitly None**       | `null` — common only    |
 * | `["Colour"]`             | Colour drives the gallery | `"Colour"`              |
 *
 * `[]` reads literally under the `PropertyDependencies` model — "images depend
 * on no option" — so no magic string reaches the database, and it is already
 * what the editor writes for a product with no options at all. Unset stays
 * distinguishable because the key is simply absent on rows saved before this
 * contract existed (`propertyModules` was `{}`), which is why the fallback to
 * `attributes[0]` is reachable only from that branch.
 *
 * With None the storefront shows the common photos and nothing else: the
 * gallery stops filtering by value (`galleryForSelection`), listing cards fall
 * through to the product's own stills (`variantPreviewImages`) and the option
 * renders as pills rather than image cards, because there are no per-value
 * previews to put on them.
 */
export function visualAttributeName(product: {
  attributes?: Attribute[];
  propertyModules?: PropertyDependencies;
}): string | null {
  const pmImages = product.propertyModules?.images;
  const attributes = product.attributes ?? [];

  if (Array.isArray(pmImages)) {
    const declared = pmImages[0];
    // Declared, and empty — the admin's explicit "photos don't vary" answer.
    if (!declared) return null;
    if (attributes.some((a) => a.name === declared)) return declared;
    // Declared a name that is no longer an attribute (the option was renamed
    // or deleted since). Fall through rather than silently becoming None.
  }

  return attributes[0]?.name ?? null;
}

/**
 * The single thumbnail that represents one value of the visual attribute (e.g.
 * the olive tee shot for Colour = "Olive"), used by the visual variant picker.
 * Priority: the admin's manual pick (ProductImage slot="preview"), then that
 * value's first gallery photo, then the first common photo, then the product's
 * flat image list. Videos are skipped — a picker card needs a still.
 *
 * **With no visual attribute (None) the per-value media is skipped entirely.**
 * Switching the Image Controller to None does not delete the galleries already
 * filed under the old values — they are kept so the choice can be undone — so a
 * per-value lookup here would still find them and put a hidden photo on screen.
 * Today no caller reaches this under None (`product-purchase` renders pills
 * instead of a picker when `visualAttributeName` is null), which is exactly why
 * the guard belongs in the function rather than in the one call site that
 * currently happens to be safe.
 */
export function previewImageForValue(
  product: {
    images: string[];
    media?: MediaDTO[];
    attributes?: Attribute[];
    propertyModules?: PropertyDependencies;
  },
  value: string
): string | null {
  if (visualAttributeName(product) !== null) {
    const own = ownPreviewForValue(product.media ?? [], value);
    if (own) return own;
  }
  // Unlike a listing card, a picker card must render something for every value.
  return coverStill(product);
}

/** Is this url a still image (the gallery treats videos by extension)? */
function isStill(url: string | undefined | null): url is string {
  return !!url && !/\.(mp4|webm|mov)$/i.test(url);
}

const bySortOrder = (a: MediaDTO, b: MediaDTO) =>
  (a.sortOrder ?? 0) - (b.sortOrder ?? 0);

/**
 * The ONE photo that stands for a value, using only that value's own media —
 * no common-photo fallback. Distinct from `previewImageForValue`, which does
 * fall back: a picker card on the product page must render something for every
 * value, whereas a listing card must not claim a packaging shot is a design.
 */
function ownPreviewForValue(
  media: MediaDTO[],
  value: string
): string | null {
  const rows = media.filter((m) => m.variantValue === value).sort(bySortOrder);
  const manual = rows.find((m) => m.slot === "preview" && isStill(m.url));
  if (manual) return manual.url;
  return rows.find((m) => isStill(m.url))?.url ?? null;
}

/** A single representative still: first common photo, else the flat list. */
function coverStill(product: { images: string[]; media?: MediaDTO[] }): string | null {
  const common = (product.media ?? [])
    .filter((m) => m.variantValue == null)
    .sort(bySortOrder)
    .find((m) => isStill(m.url));
  if (common) return common.url;
  return (product.images ?? []).find(isStill) ?? null;
}

/**
 * The product's own photos, in order, for a piece with no per-value imagery.
 *
 * Common media first (that's the curated order the admin set), then anything
 * left in the flat `images` list, de-duplicated. Used as the card fallback so a
 * product without variants still has something to swipe through instead of one
 * frozen cover shot.
 */
function ownStills(
  product: { images: string[]; media?: MediaDTO[] },
  limit: number
): string[] {
  const out: string[] = [];
  const push = (url: string) => {
    if (isStill(url) && !out.includes(url)) out.push(url);
  };

  for (const m of (product.media ?? []).filter((m) => m.variantValue == null).sort(bySortOrder)) {
    push(m.url);
    if (out.length >= limit) return out;
  }
  for (const url of product.images ?? []) {
    push(url);
    if (out.length >= limit) return out;
  }
  return out;
}

/**
 * The gallery a *listing card* swipes through: exactly one preview per value of
 * the visual attribute — the same thumbnails the product page's picker shows.
 *
 * Deliberately NOT `product.images`, which is the union of every gallery and so
 * made a 2-design product swipe through 20 photos. Common photos (packaging,
 * dimensions, care card) and the rest of each value's gallery are excluded: a
 * card answers "which designs exist", not "show me everything".
 *
 * Values with no photos of their own are skipped rather than falling back to a
 * common shot — otherwise four untagged designs render as four identical
 * packaging photos. Products with no options (or no per-value photos at all)
 * fall back to a single cover still. Pure — no DB/server deps.
 */
export function variantPreviewImages(
  product: {
    images: string[];
    media?: MediaDTO[];
    attributes?: Attribute[];
    propertyModules?: PropertyDependencies;
  },
  limit = 6
): string[] {
  const media = product.media ?? [];
  const visualName = visualAttributeName(product);
  const values =
    (visualName
      ? product.attributes?.find((a) => a.name === visualName)?.values
      : undefined) ?? [];

  const out: string[] = [];
  for (const val of values) {
    const url = ownPreviewForValue(media, val);
    // De-dupe: the admin may legitimately point two values at the same photo.
    if (url && !out.includes(url)) out.push(url);
    if (out.length >= limit) break;
  }
  if (out.length > 0) return out;

  // No visual attribute, or no value has its own photo. Rather than freezing
  // on a single cover shot, let the card swipe through the product's own
  // gallery — capped at 4, which is enough to show the piece from a few angles
  // without turning a listing card into the full product gallery.
  const own = ownStills(product, Math.min(4, limit));
  if (own.length > 0) return own;

  const cover = coverStill(product);
  return cover ? [cover] : [];
}

/**
 * Resolves the storefront gallery for a selection from the relational
 * ProductImage rows (`product.media`) — the intended source of truth.
 *
 * The "visual variant" attribute is dynamic — see `visualAttributeName`, which
 * also decides when there is deliberately none. Its selected value scopes the
 * gallery, and the order is the contract the admin edits against: that value's
 * media (in its own sortOrder) and THEN the common media (in theirs), never
 * interleaved. A value's photos are only ever its own — common photos belong
 * to the product, not to the value, which is why the two lists are sorted
 * separately and concatenated rather than merged. With no visual attribute
 * (None, or a product with no options) the result is the common media alone.
 * De-duplicated by url. Falls back to `imagesForSelection` (the
 * legacy sellableVariants JSON → `product.images`) when there are no media rows
 * or the computed list is empty. Videos are returned like images (the gallery
 * detects them by extension). Pure — no DB/server deps.
 */
export function galleryForSelection(
  product: {
    images: string[];
    media?: MediaDTO[];
    attributes?: Attribute[];
    propertyModules?: PropertyDependencies;
    sellableVariants?: any;
  },
  selected: Selection
): string[] {
  const media = product.media ?? [];
  if (media.length > 0) {
    // Visual attribute is dynamic — see visualAttributeName().
    const visualName = visualAttributeName(product);
    const visualVal = visualName ? selected[visualName] : undefined;

    // Defensive: the query already orders by sortOrder, but never trust the
    // input array's order here.
    const bySort = (a: MediaDTO, b: MediaDTO) =>
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0);

    const variantRows =
      visualVal != null
        ? media.filter((m) => m.variantValue === visualVal).sort(bySort)
        : [];
    const commonRows = media
      .filter((m) => m.variantValue == null)
      .sort(bySort);

    const urls = [...variantRows, ...commonRows]
      .map((m) => m.url)
      .filter(Boolean);
    const deduped = Array.from(new Set(urls));
    if (deduped.length > 0) return deduped;
  }

  return imagesForSelection(product, selected);
}

/** 
 * Returns the min and max possible price for a product.
 */
export function priceRange(product: { price: number; sellableVariants?: any }): { min: number; max: number } {
  const variants = (product.sellableVariants || []) as SellableVariant[];
  if (variants.length === 0) return { min: product.price, max: product.price };
  
  const prices = variants.filter(v => v.available).map(v => v.price);
  if (prices.length === 0) return { min: product.price, max: product.price };
  
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

/**
 * Is the given choice currently in stock/available?
 * (Simplest check: does a sellable variant exist with this choice that is available?)
 */
export function isChoiceEnabled(
  groupName: string,
  choiceLabel: string,
  product: { sellableVariants?: any }
): boolean {
  const variants = (product.sellableVariants || []) as SellableVariant[];
  if (variants.length === 0) return true; // If no variants generated, assume enabled
  
  // Find any variant that has this choice and is available
  return variants.some(v => v.combo[groupName] === choiceLabel && v.available);
}

/**
 * Ensures a partial or outdated selection is still valid, filling in missing choices.
 */
export function repairSelection(
  attributes: Attribute[],
  selected: Selection
): Selection {
  const current = { ...selected };
  let modified = false;

  for (const attr of attributes) {
    if (attr.values.length === 0) continue;
    const val = current[attr.name];
    if (!val || !attr.values.includes(val)) {
      current[attr.name] = attr.values[0];
      modified = true;
    }
  }

  // Remove keys that aren't attributes anymore
  const names = new Set(attributes.map(g => g.name));
  for (const k of Object.keys(current)) {
    if (!names.has(k)) {
      delete current[k];
      modified = true;
    }
  }

  return current;
}
