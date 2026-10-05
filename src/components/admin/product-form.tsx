"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowUpRight,
  Loader2,
  ShieldCheck,
  ShieldOff,
  X,
  Star,
  Plus,
  Trash2,
  GripVertical,
  Video,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { createProduct, updateProduct } from "@/app/actions/admin";
import { VariantMediaTab, type VisualGalleryState } from "@/components/admin/variant-media-tab";
import {
  EMPTY_VARIANT_ENTRY,
  SkuInput,
  VariantTable,
  entryNumber,
  type VariantEntry,
  type VariantFieldError,
  type VariantRowDTO,
  type VariantRowFacts,
  type VariantView,
} from "@/components/admin/variant-table";
import {
  Card,
  Check,
  CountBadge,
  Field,
  MiniButton,
  SwitchRow,
} from "@/components/admin/form-kit";
import {
  StoreDefaultChoice,
  StoreDefaultText,
} from "@/components/admin/store-default-field";
import { RETURN_POLICY_HREF } from "@/components/admin/return-policy-summary";
import { InfoTip } from "@/components/store/info-tip";
import { allCombinations, comboKey } from "@/lib/options";
import { explainReturnPolicy } from "@/lib/returns";
import { SKU_PATTERN, generateSku, normaliseSku, skuPrefixFor } from "@/lib/sku";
import { IMAGE_CONTROLLER_NONE, settleVariantPrices } from "@/lib/variants";
import { formatINR, cn } from "@/lib/utils";
import type { ProductDTO, ProductOption, ProductVideo } from "@/lib/types";

type SubcategoryOption = { id: string; name: string; categoryName: string };

/* ------------------------------------------------------------------ */
/*  Video link labels                                                  */
/* ------------------------------------------------------------------ */

/**
 * The two presets offered for a video link's label.
 *
 * These are the *stored* strings, not display copy — `resolveVideo` uses the
 * title as the card's caption, so what is picked here is what a shopper reads.
 */
const VIDEO_LABELS = ["Instagram", "YouTube"] as const;

/**
 * Which option the select is showing.
 *
 * An empty title reads as **Custom**, deliberately: with one `title` column
 * there is nothing to distinguish "not chosen yet" from "chosen Custom and
 * not typed yet", and inventing a third state would mean the select could
 * show one thing while the row stored another. Custom with an empty box is
 * also exactly what this control used to be, so nothing regresses.
 */
function videoTitleMode(title: string): string {
  const hit = VIDEO_LABELS.find((l) => l === title.trim());
  return hit ?? "custom";
}

/**
 * What the URL looks like, for the placeholder only.
 *
 * Read from the address rather than the label, which is the rule everywhere
 * this data is used: `resolveVideo` and `lib/portfolio-harvest.ts` both
 * resolve the provider themselves, so a mislabelled row still plays and
 * harvests correctly. This is a hint to the person typing, nothing more.
 */
function detectedVideoLabel(url: string): string | null {
  const raw = (url ?? "").trim();
  if (!raw) return null;
  let host: string;
  try {
    host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return null;
  }
  if (host.endsWith("instagram.com")) return "Instagram";
  if (host.endsWith("youtube.com") || host.endsWith("youtu.be")) return "YouTube";
  return null;
}

type Props = {
  product?: ProductDTO;
  categories: string[];
  subcategories?: SubcategoryOption[];
  /** Preselected when arriving from "Add product" inside a subcategory. */
  initialCategory?: string;
  initialSubcategoryId?: string;
  /**
   * Store-wide product-page copy (Settings > Product defaults), shown read-only
   * so the admin can see exactly what this product inherits before deciding to
   * override it.
   */
  infoDefaults?: {
    materialsCare: string;
    shippingInfo: string;
    returnsInfo: string;
  };
  /**
   * The store's returns rules, whole.
   *
   * This used to be one boolean — `returnsEnabled && defaultReturnable` — which
   * merged the master switch into the catalogue default and so could not say
   * which of the two was answering. Worse, it let the admin switch a product to
   * "Returnable" while returns were paused store-wide and be told that was the
   * outcome. Passed intact now and resolved with `explainReturnPolicy`, the
   * same rule the product page runs.
   */
  returnDefaults?: {
    returnsEnabled: boolean;
    defaultReturnable: boolean;
    returnWindowDays: number;
  };
  /**
   * The product's `ProductVariant` rows — SKU, barcode, cost, low-stock alert
   * and, for a tracked product, the live stock read-out. A duplicate passes the
   * source's rows with every identifier and counter stripped: the copy gets new
   * SKUs and starts with no stock.
   */
  variantRows?: VariantRowDTO[];
  /**
   * Whether this product's stock is kept by the inventory ledger, and the
   * store-wide low-stock default. `href` is the Inventory screen for it.
   */
  inventory?: { tracked: boolean; lowStockThreshold: number; href: string };
  /** Store name, for previewing the SKUs new combinations will be given. */
  brandName?: string;
};

/** Which top-level tab of the editor is showing. */
type EditorTab = "optvar" | "pricing" | "media";

type Mode = "prepaid" | "cod" | "partial" | "direct";

/**
 * The four checkout modes in plain English. The label is what the admin picks
 * from; the tip carries the consequence, which is the part that actually needs
 * explaining and used to sit in a paragraph nobody read.
 */
const MODE_COPY: { mode: Mode; label: string; tip: string }[] = [
  {
    mode: "prepaid",
    label: "Pay full amount online",
    tip: "The whole amount is taken at checkout by UPI, card or net banking. Nothing is owed on delivery, and the parcel goes out as soon as you pack it.",
  },
  {
    mode: "cod",
    label: "Cash on delivery",
    tip: "The customer pays the courier at the door — nothing is taken online. Available on serviceable pin codes only, and it carries the usual risk of a refused parcel.",
  },
  {
    mode: "partial",
    label: "Pay part now, rest on delivery",
    tip: "A percentage is taken online to confirm the order and the balance is collected by the courier. Set that percentage below. It keeps COD convenience while filtering out unserious orders.",
  },
  {
    mode: "direct",
    label: "No online payment — arrange directly",
    tip: "Checkout records the order without taking any money; you settle it with the customer yourself (UPI, bank transfer, in person). Used for made-to-order work where the amount is agreed after a conversation. Nothing is refundable through the site.",
  },
];

const EMPTY_ENTRY: VariantEntry = EMPTY_VARIANT_ENTRY;

const numString = (n: number | null | undefined) => (n == null ? "" : String(n));

/**
 * ProductForm — the admin product editor.
 *
 * A persistent section (Product details, Organisation, Made to order, Checkout,
 * Shipping, Product page info) sits above three tabs: "Options & Variants" (the
 * option builder), "Price & Stock" (base price / discount / stock plus the
 * per-combination table) and "Media" (the gallery manager). Pricing uses a
 * "Discount %" model (compareAtPrice is derived from it) and, when variants
 * exist, the product price is the minimum available variant price.
 *
 * Photos are managed ONLY in the Media tab. The details form used to carry its
 * own "Images" picker writing to `Product.images`, which meant two systems
 * feeding one gallery and no way to tell which one won. `Product.images` is now
 * derived on save (union of every gallery) and kept purely as the flat list that
 * OG tags / JSON-LD / listing cards read.
 *
 * ── UX rules this file is expected to keep ──
 *
 * 1. **Explanation goes in an `InfoTip`, never a paragraph.** The editor is a
 *    form, not a manual; a wall of helper text under every field is why nothing
 *    was read. The tip is the storefront's — portalled, tap-driven, Escape-
 *    closing. Do not write a second one.
 * 2. **Nullable "inherit from the store" columns get an explicit two-position
 *    control** (see store-default-field.tsx). Returning to "Store default" must
 *    write `null`, not `""` — they are different rows in the database.
 * 3. **Nothing may overflow 320px.** Tables scroll inside their own box, the tab
 *    bar scrolls horizontally, controls stack. Fields keep `.input`, which is
 *    raised to 16px on touch so iOS does not zoom the page on focus.
 */
export function ProductForm({
  product,
  categories,
  subcategories = [],
  initialCategory,
  initialSubcategoryId,
  infoDefaults,
  returnDefaults,
  variantRows = [],
  inventory,
  brandName = "",
}: Props) {
  const router = useRouter();
  // A duplicate arrives as a fully populated product with a blank id — that is
  // still a create, not an edit.
  const editing = !!product?.id;
  // A copy is a new product, and a new product is never tracked: tracking
  // starts from a real count in Admin → Inventory.
  const tracked = editing && !!inventory?.tracked;
  const lowStockDefault = inventory?.lowStockThreshold ?? 5;
  const inventoryHref = inventory?.href ?? "/admin/inventory";
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Set once the "some values have no photos" warning has been shown, so a
  // second click on Save goes through (existing products only — see onSubmit).
  const [mediaWarningAck, setMediaWarningAck] = useState(false);

  // Which top-level tab is visible.
  const [tab, setTab] = useState<EditorTab>("optvar");

  // `isCustomisable` / `customisationNote` are real Product columns, and both
  // the edit and the duplicate page hand the whole row through. Read through a
  // widening cast rather than straight off ProductDTO: the editor is the only
  // writer of these two, and it should not stop compiling over the shape of a
  // read model it does not own.
  const extras = product as
    | (ProductDTO & {
        isCustomisable?: boolean | null;
        customisationNote?: string | null;
        costPrice?: number | null;
      })
    | undefined;

  // What one unit cost, when every size cost the same. Blank = not recorded.
  const [costPrice, setCostPrice] = useState<string>(numString(extras?.costPrice));

  // Derive the "Discount %" field from an existing compare-at price:
  // discount = compareAtPrice > price ? round((cap - price) / cap * 100) : 0.
  const initialDiscount = (() => {
    const cap = product?.compareAtPrice ?? 0;
    const p = product?.price ?? 0;
    return cap > p && cap > 0 ? Math.round(((cap - p) / cap) * 100) : 0;
  })();

  const [form, setForm] = useState({
    name: product?.name ?? "",
    category: initialCategory ?? product?.category ?? categories[0] ?? "",
    secondaryCategory: product?.secondaryCategory ?? "",
    subcategoryId: initialSubcategoryId ?? product?.subcategoryId ?? "",
    price: product?.price?.toString() ?? "",
    // Percentage off the (implied) original price; replaces the raw compare-at field.
    discount: initialDiscount ? String(initialDiscount) : "",
    stock: product?.stock?.toString() ?? "0",
    description: product?.description ?? "",
    tags: product?.tags?.join(", ") ?? "",
    isFeatured: product?.isFeatured ?? false,
    isActive: product?.isActive ?? true,
  });

  // Made-to-order / personalised piece, and what the buyer has to supply.
  const [isCustomisable, setIsCustomisable] = useState<boolean>(
    extras?.isCustomisable ?? false
  );
  const [customisationNote, setCustomisationNote] = useState<string>(
    extras?.customisationNote ?? ""
  );

  // Which checkout modes this product allows.
  const [paymentModes, setPaymentModes] = useState<Mode[]>(
    (product?.paymentModes as Mode[]) ?? ["prepaid", "cod"]
  );
  const [advancePercent, setAdvancePercent] = useState(
    product?.advancePercent?.toString() ?? ""
  );
  const [parcel, setParcel] = useState({
    weightGrams: product?.weightGrams?.toString() ?? "",
    lengthCm: product?.lengthCm?.toString() ?? "",
    breadthCm: product?.breadthCm?.toString() ?? "",
    heightCm: product?.heightCm?.toString() ?? "",
  });
  const [shipping, setShipping] = useState({
    shippingType: product?.shippingType ?? "free",
    shippingFee: product?.shippingFee?.toString() ?? "0",
    shippingMarkup: product?.shippingMarkup?.toString() ?? "0",
  });
  const setShippingField = (k: keyof typeof shipping, v: string) =>
    setShipping((p) => ({ ...p, [k]: v }));
  const setParcelField = (k: keyof typeof parcel, v: string) =>
    setParcel((p) => ({ ...p, [k]: v }));
  function toggleMode(m: Mode) {
    setPaymentModes((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]
    );
  }

  // Product-page info blocks. null = inherit the store default; a string (even
  // an empty one) is this product's own copy.
  const [info, setInfo] = useState({
    materialsCare: product?.materialsCare ?? null,
    shippingInfo: product?.shippingInfo ?? null,
    returnsInfo: product?.returnsInfo ?? null,
  });
  // Tri-state: null inherits the store default, true/false is this product's
  // own answer. Personalised work is the usual reason to say no.
  const [returnable, setReturnable] = useState<boolean | null>(
    product?.returnable ?? null
  );
  // Social/video links shown as the "Video previews" rail on the product page.
  const [videos, setVideos] = useState<ProductVideo[]>(
    Array.isArray(product?.videos) ? product.videos : []
  );
  function setVideoField(i: number, key: keyof ProductVideo, value: string) {
    setVideos((prev) => prev.map((v, idx) => (idx === i ? { ...v, [key]: value } : v)));
  }
  type InfoKey = keyof typeof info;
  function setInfoField(key: InfoKey, value: string | null) {
    setInfo((prev) => ({ ...prev, [key]: value }));
  }

  const [options, setOptions] = useState<ProductOption[]>(
    product?.options ?? []
  );
  /**
   * Which option's values drive the per-variant image galleries (Media tab).
   *
   * Three states, because "nobody has chosen yet" and "the admin chose None"
   * are different answers and only one of them may be overwritten by a default:
   *
   *   ""                      → unset; the first option drives images
   *   IMAGE_CONTROLLER_NONE   → explicitly none; photos don't vary by option
   *   "Colour"                → that option drives images
   *
   * Persisted as `Product.propertyModules.images`: `[name]` or, for None, `[]`.
   * A saved `[]` is what rehydrates the sentinel here — see visualAttributeName.
   */
  const [imageOption, setImageOption] = useState<string>(() => {
    const declared = product?.propertyModules?.images;
    if (!Array.isArray(declared)) return ""; // saved before this contract existed
    return declared[0] ?? IMAGE_CONTROLLER_NONE;
  });

  // ---- Variants (price / stock / availability / identity per combo) ----
  //
  // Two sources, one entry per combination. The `variants` JSON draft carries
  // availability and the legacy per-combination stock; the `ProductVariant`
  // rows carry identity and cost, **and are the authority for price** — the
  // server writes the draft, the rows and the mirror checkout charges from out
  // of one settled answer, so after any save they agree and the row is simply
  // the most direct reading of it.
  const [useVariants, setUseVariants] = useState<boolean>(
    (product?.variants?.length ?? 0) > 0 ||
      (product?.variantPrices?.length ?? 0) > 0 ||
      // A row with its own price must never be hidden behind the switch —
      // turning it off is what clears one, so it has to be visible to do that.
      variantRows.some((r) => r.price != null || r.compareAtPrice != null)
  );
  // Variant data keyed by combo signature.
  const [variantMap, setVariantMap] = useState<Record<string, VariantEntry>>(
    () => {
      const map: Record<string, VariantEntry> = {};
      if (product?.variants?.length) {
        for (const v of product.variants) {
          // Stored values may be blank ("" = inherit) despite the number type.
          const rawPrice = (v as { price?: unknown }).price;
          const rawStock = (v as { stock?: unknown }).stock;
          map[comboKey(v.combo)] = {
            ...EMPTY_ENTRY,
            available: v.available,
            // Preserve an "inherit base" (blank) price so a blank row stays
            // blank rather than freezing today's base into it.
            price: rawPrice === "" || rawPrice == null ? "" : String(rawPrice),
            stock: rawStock === "" || rawStock == null ? "" : String(rawStock),
          };
        }
      } else if (product?.variantPrices?.length) {
        // Migrate the older price-only matrix.
        for (const v of product.variantPrices) {
          map[comboKey(v.combo)] = {
            ...EMPTY_ENTRY,
            price: String(v.price),
          };
        }
      }
      for (const r of variantRows) {
        const prev = map[r.key] ?? EMPTY_ENTRY;
        map[r.key] = {
          ...prev,
          // The row is the authority for price where it exists (null = inherit).
          // A duplicate's rows have no id and defer to the copied draft.
          price: r.price != null ? String(r.price) : r.id ? "" : prev.price,
          sku: r.sku,
          barcode: r.barcode ?? "",
          compareAtPrice: numString(r.compareAtPrice),
          costPrice: numString(r.costPrice),
          lowStockAt: numString(r.lowStockAt),
        };
      }
      return map;
    }
  );

  // Rows that exist in the database for this product, by combination. A
  // duplicate's rows carry no id — nothing of the source's is "existing" here.
  const facts = useMemo(
    () =>
      new Map<string, VariantRowFacts>(
        variantRows.filter((r) => r.id).map((r) => [r.key, r])
      ),
    [variantRows]
  );
  // Shown and edited as a grid; a failed save pins its message to one cell.
  const [gridView, setGridView] = useState<VariantView>("price");
  const [gridError, setGridError] = useState<VariantFieldError | null>(null);

  // ---- Visual Gallery state (Media tab) ----
  // Initialise from existing variants so editing an existing product keeps its images.
  const [visualGallery, setVisualGallery] = useState<VisualGalleryState>(() => {
    const galleries: Record<string, string[]> = {};
    const previews: Record<string, string> = {};
    const commonSet = new Set<string>();

    // Preferred path: the persisted ProductImage rows. `slot` + `variantValue`
    // + `sortOrder` are exactly what syncProductImages() writes, so reading
    // them back round-trips losslessly.
    //
    // The legacy path below reconstructs from the `Product.variants` JSON
    // mirror instead, where each variant's `images` already has the common
    // photos appended. That put the common shots under every variant value,
    // left Common empty, and the next save deleted the slot="common" rows —
    // and it dropped a hand-picked preview, because it always took images[0].
    const rows = product?.media ?? [];
    if (rows.length > 0) {
      const ordered = [...rows].sort(
        (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
      );
      for (const r of ordered) {
        if (r.slot === "common") {
          commonSet.add(r.url);
          continue;
        }
        const val = r.variantValue;
        if (!val) continue;
        if (r.slot === "preview") {
          if (!previews[val]) previews[val] = r.url;
          // The preview is its own field AND, when `sortOrder >= 0`, a member
          // of that value's gallery at exactly that index — see
          // syncProductImages, which writes -1 for a preview that sits outside
          // the gallery. `ordered` is ascending, so appending here reproduces
          // the authored order. Without this the photo the admin pressed "Set
          // preview" on came back missing from its own gallery.
          if ((r.sortOrder ?? -1) >= 0) {
            galleries[val] = galleries[val] ?? [];
            if (!galleries[val].includes(r.url)) galleries[val].push(r.url);
          }
        } else if (r.slot === "gallery") {
          galleries[val] = galleries[val] ?? [];
          if (!galleries[val].includes(r.url)) galleries[val].push(r.url);
        }
      }
      return { galleries, previews, common: [...commonSet] };
    }
    // Galleries are keyed by the image-driving option's value. Use the stored
    // choice (propertyModules.images) when present, else the first option.
    const imgOpt =
      product?.propertyModules?.images?.[0] ?? product?.options?.[0]?.name ?? "";
    if (product?.variants?.length) {
      for (const v of product.variants) {
        const visualVal = imgOpt
          ? v.combo?.[imgOpt]
          : Object.values(v.combo ?? {})[0];
        if (visualVal && v.images?.length) {
          galleries[visualVal] = galleries[visualVal] ?? [];
          for (const img of v.images) {
            if (!galleries[visualVal].includes(img)) galleries[visualVal].push(img);
          }
          if (!previews[visualVal]) previews[visualVal] = v.images[0];
        }
      }
    }
    for (const img of product?.images ?? []) {
      const inVariant = Object.values(galleries).some((g) => g.includes(img));
      if (!inVariant) commonSet.add(img);
    }
    return { galleries, previews, common: [...commonSet] };
  });

  // Cleaned option matrix — the shape both `combos` and the variant table need.
  const optionMatrix = useMemo(
    () =>
      options
        .map((g) => ({
          name: g.name.trim(),
          values: g.choices.map((c) => c.label.trim()).filter(Boolean),
        }))
        .filter((g) => g.name && g.values.length > 0),
    [options]
  );

  /**
   * The effective image-driving option: the admin's choice if it still exists,
   * else the first option. Empty string means *no* option drives the gallery —
   * either because the admin answered None, or because the product has no
   * options at all. Both persist as `propertyModules.images: []` and both show
   * only the common photos, so they need no further distinction downstream.
   */
  const imageDrivingOption = useMemo(() => {
    if (imageOption === IMAGE_CONTROLLER_NONE) return "";
    const names = optionMatrix.map((o) => o.name);
    return imageOption && names.includes(imageOption) ? imageOption : names[0] ?? "";
  }, [imageOption, optionMatrix]);

  // All combinations of the current options (recomputed as options change).
  const combos = useMemo(() => allCombinations(optionMatrix), [optionMatrix]);

  const base = Math.max(0, Math.round(Number(form.price || 0)));
  const hasVariants = useVariants && combos.length > 0;

  /**
   * What every combination sells for, and what the product is stored at —
   * from `settleVariantPrices`, the function the server writes the rows and
   * the checkout mirror with. The editor used to compute its own minimum,
   * reading a blank row as the typed base while the server charged it the
   * saved minimum; one function means one answer.
   */
  const settled = useMemo(
    () =>
      settleVariantPrices({
        basePrice: base,
        combos: hasVariants
          ? combos.map((c) => {
              const key = comboKey(c);
              const v = variantMap[key] ?? EMPTY_ENTRY;
              return { key, override: v.price, available: v.available };
            })
          : [],
      }),
    [base, hasVariants, combos, variantMap]
  );
  const effectivePrice = settled.productPrice;
  const sellsAt = (key: string) => (hasVariants ? settled.effective[key] ?? base : base);
  // Blank rows that will be pinned at the base because a cheaper size moved
  // the product's price below it — worth saying before the save, not after.
  const pinnedBlank =
    hasVariants &&
    effectivePrice !== base &&
    combos.some((c) => (variantMap[comboKey(c)]?.price ?? "") === "");

  // The compare-at ("was") price this save will store. Discount % round-trips
  // through it — but **untouched means untouched**: the percentage is rounded
  // for display, so recomputing from it moved a ₹2,277 "was" price to ₹2,272
  // on a save where nobody touched pricing. When neither the discount nor the
  // price changed, the stored compare-at goes back exactly.
  const discountNum = Math.min(99, Math.max(0, Number(form.discount) || 0));
  const discountUntouched =
    !!product &&
    form.discount === (initialDiscount ? String(initialDiscount) : "") &&
    effectivePrice === product.price;
  const compareAtToSave: number | null = discountUntouched
    ? (product!.compareAtPrice ?? null)
    : discountNum > 0
      ? Math.round(effectivePrice / (1 - discountNum / 100))
      : null;

  const productCost = entryNumber(costPrice);
  // Rows kept for their stock history after their combination was removed.
  const liveKeys = useMemo(
    () => new Set(combos.length ? combos.map(comboKey) : [""]),
    [combos]
  );
  const retired = useMemo(
    () => [...facts.values()].filter((f) => !liveKeys.has(f.key) && f.movements > 0),
    [facts, liveKeys]
  );
  // A tracked product's live position, summed the way the inventory mirror is.
  const stockTotals = useMemo(() => {
    let available = 0, onHand = 0, reserved = 0;
    for (const f of facts.values()) {
      if (!liveKeys.has(f.key) || !f.isActive) continue;
      available += Math.max(0, f.available);
      onHand += f.onHand;
      reserved += f.reserved;
    }
    return { available, onHand, reserved };
  }, [facts, liveKeys]);

  /**
   * The SKU a new combination will get if nothing is typed — the server's own
   * generator, run against this product's SKUs. The server checks the whole
   * store, so a clash elsewhere can still add a `-2`; that is why it is shown
   * as a placeholder marked "auto", never as a value.
   */
  const skuPreview = useMemo(() => {
    const prefix = skuPrefixFor(brandName);
    const own = new Set<string>([
      ...[...facts.values()].map((f) => f.sku),
      ...Object.values(variantMap)
        .map((v) => normaliseSku(v.sku))
        .filter(Boolean),
    ]);
    const axisOrder = optionMatrix.map((o) => o.name);
    return (combo: Record<string, string>) =>
      generateSku({
        prefix,
        category: form.category,
        productName: form.name,
        combo,
        axisOrder,
        taken: new Set(own),
      });
  }, [brandName, facts, variantMap, optionMatrix, form.category, form.name]);

  // Values of the image-driving option — the keys every gallery is filed under.
  const visualValues = useMemo(
    () => optionMatrix.find((o) => o.name === imageDrivingOption)?.values ?? [],
    [optionMatrix, imageDrivingOption]
  );
  // Values that still have at least one available combo. A value the admin has
  // switched off everywhere never reaches the storefront, so it's exempt from the
  // "needs its own photos" requirement.
  const activeVisualValues = useMemo(() => {
    if (!hasVariants) return visualValues;
    return visualValues.filter((val) =>
      combos.some(
        (c) =>
          c[imageDrivingOption] === val &&
          (variantMap[comboKey(c)]?.available ?? true)
      )
    );
  }, [visualValues, combos, imageDrivingOption, variantMap, hasVariants]);

  // Total photo count, shown on the Media tab so an empty gallery is visible
  // without opening the tab.
  const photoCount = useMemo(() => {
    const all = new Set(visualGallery.common);
    for (const imgs of Object.values(visualGallery.galleries)) {
      for (const img of imgs) all.add(img);
    }
    return all.size;
  }, [visualGallery]);

  function variantOf(key: string): VariantEntry {
    return variantMap[key] ?? EMPTY_ENTRY;
  }

  /**
   * One patch across any number of rows, in a single state update — the bulk
   * editor would otherwise queue N updates and re-render the table N times.
   */
  function patchVariants(keys: string[], patch: Partial<VariantEntry>) {
    if (keys.length === 0) return;
    setVariantMap((prev) => {
      const next = { ...prev };
      for (const key of keys) {
        next[key] = { ...(next[key] ?? EMPTY_ENTRY), ...patch };
      }
      return next;
    });
  }

  // ---- Options CRUD ----
  function addOptionGroup() {
    setOptions((prev) => [
      ...prev,
      { name: "", choices: [{ label: "", priceDelta: 0 }] },
    ]);
  }
  function removeOptionGroup(gi: number) {
    setOptions((prev) => prev.filter((_, i) => i !== gi));
  }
  function setGroupName(gi: number, name: string) {
    setOptions((prev) =>
      prev.map((g, i) => (i === gi ? { ...g, name } : g))
    );
  }
  function addChoice(gi: number) {
    setOptions((prev) =>
      prev.map((g, i) =>
        i === gi
          ? { ...g, choices: [...g.choices, { label: "", priceDelta: 0 }] }
          : g
      )
    );
  }
  function removeChoice(gi: number, ci: number) {
    setOptions((prev) =>
      prev.map((g, i) =>
        i === gi
          ? { ...g, choices: g.choices.filter((_, j) => j !== ci) }
          : g
      )
    );
  }
  function setChoice(
    gi: number,
    ci: number,
    patch: Partial<{ label: string; priceDelta: number; image: string | null }>
  ) {
    setOptions((prev) =>
      prev.map((g, i) =>
        i === gi
          ? {
              ...g,
              choices: g.choices.map((c, j) =>
                j === ci ? { ...c, ...patch } : c
              ),
            }
          : g
      )
    );
  }

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Only the groups belonging to the currently selected primary category.
  const categorySubs = useMemo(
    () => subcategories.filter((s) => s.categoryName === form.category),
    [subcategories, form.category]
  );

  // Switching category must drop a group that belongs to the old one,
  // otherwise the product would sit in a group its shoppers never reach.
  function onCategoryChange(category: string) {
    setForm((f) => {
      const stillValid = subcategories.some(
        (s) => s.id === f.subcategoryId && s.categoryName === category
      );
      return {
        ...f,
        category,
        subcategoryId: stillValid ? f.subcategoryId : "",
      };
    });
  }

  /**
   * Uploads files and resolves with their public urls. Handed to the Media tab so
   * each section can upload straight into itself — a file dropped under "Pink"
   * lands in Pink's gallery, not in a shared pile the admin then has to sort.
   */
  async function uploadFiles(files: File[]): Promise<string[]> {
    setUploading(true);
    const urls: string[] = [];
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const data = await res.json();
        if (res.ok && data.url) urls.push(data.url);
        else toast.error(data.error || `Upload failed: ${file.name}`);
      }
    } finally {
      setUploading(false);
    }
    return urls;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    // Required fields live on different tabs, so validate here and jump the
    // admin to the offending tab (HTML5 required can't fire on unmounted tabs).
    if (!form.name.trim()) {
      toast.error("Name is required");
      setSaving(false);
      return;
    }
    if (!form.description.trim()) {
      toast.error("Description is required");
      setSaving(false);
      return;
    }
    if (form.price === "") {
      setTab("pricing");
      toast.error("Price is required");
      setSaving(false);
      return;
    }
    // A tracked product's stock is a read-out, not an input — nothing to check.
    if (!tracked && form.stock === "") {
      setTab("pricing");
      toast.error("Stock is required");
      setSaving(false);
      return;
    }

    // ── Variant identity ──
    // The server checks all of this again (and store-wide uniqueness, which
    // only it can); catching the typing mistakes here saves a round trip and
    // lands the admin on the cell.
    const rowKeys = combos.length ? combos.map(comboKey) : [""];
    const retiredSkus = new Set(retired.map((r) => r.sku));
    const seenSku = new Map<string, string>();
    for (const key of rowKeys) {
      const v = variantOf(key);
      const typed = normaliseSku(v.sku);
      const current = facts.get(key)?.sku ?? null;
      const label = key ? key.replace(/=/g, " ").replace(/\|/g, " · ") : "this product";
      const fail = (message: string, field: string) => {
        setTab("pricing");
        setGridView(field === "sku" || field === "barcode" ? "sku" : "price");
        setGridError({ key, field, message });
        toast.error(message);
        setSaving(false);
      };
      if (typed && typed !== current && !SKU_PATTERN.test(typed)) {
        fail(`SKU “${v.sku.trim()}” for ${label} isn't valid — use 3–40 capital letters, digits and hyphens.`, "sku");
        return;
      }
      const final = typed || current;
      if (final) {
        if (seenSku.has(final) || retiredSkus.has(final)) {
          fail(`Two combinations can't share the SKU “${final}”.`, "sku");
          return;
        }
        seenSku.set(final, key);
      }
    }
    setGridError(null);

    // ── Media validation ──
    // The Media tab is now the only source of photos, so nothing can reach the
    // storefront with an empty gallery. A value with no gallery of its own falls
    // back to a common photo, which makes two values look identical on the
    // picker — that's a broken product page, not a cosmetic issue.
    if (visualValues.length === 0) {
      if (visualGallery.common.length === 0) {
        setTab("media");
        toast.error("Add at least one photo in the Media tab");
        setSaving(false);
        return;
      }
    } else {
      const missing = activeVisualValues.filter(
        (val) => (visualGallery.galleries[val]?.length ?? 0) === 0
      );
      // New products are held to the rule outright. Existing ones only warn the
      // first time, then let the save through: most of the catalogue predates
      // per-value galleries, and refusing to save a price fix until someone
      // shoots five more designs is worse than the duplicate picker card.
      if (missing.length > 0 && (!editing || !mediaWarningAck)) {
        setTab("media");
        setMediaWarningAck(true);
        toast.error(
          editing
            ? `No photos for ${missing.join(", ")} — these fall back to a common photo. Save again to keep it that way.`
            : `No photos for ${missing.join(", ")} — add them in the Media tab`
        );
        setSaving(false);
        return;
      }
    }

    // Drop empty option groups / choices before saving.
    const cleanOptions = options
      .map((g) => ({
        name: g.name.trim(),
        choices: g.choices
          .filter((c) => c.label.trim())
          .map((c) => ({
            label: c.label.trim(),
            priceDelta: Number(c.priceDelta) || 0,
          })),
      }))
      .filter((g) => g.name && g.choices.length > 0);

    // ── Live galleries vs kept ones ──
    //
    // `liveGalleries` are the values the Image Controller currently drives —
    // the only ones any storefront surface reads. Everything else is a gallery
    // filed under a value the controller no longer points at, because the admin
    // switched which option drives images or answered **None**.
    //
    // Those are **kept, not deleted.** Dropping them made switching the
    // controller (and picking None in particular) a silently destructive act:
    // the photos vanished from ProductImage, and switching back found empty
    // galleries with no way to recover the assignment. They are persisted with
    // their own `variantValue`, which no reader looks up while another option
    // (or none) is driving images, so they are stored and invisible — and they
    // rehydrate the moment that option is chosen again. The Media tab says so
    // before the save; see the "kept" notice in variant-media-tab.tsx.
    const imageValues = new Set(
      optionMatrix.find((o) => o.name === imageDrivingOption)?.values ?? []
    );
    const liveGalleries: Record<string, string[]> = {};
    const keptGalleries: Record<string, string[]> = {};
    for (const [val, imgs] of Object.entries(visualGallery.galleries)) {
      if (!imgs.length) continue;
      if (imageValues.has(val)) liveGalleries[val] = imgs;
      else keptGalleries[val] = imgs;
    }
    // Preview thumbnail: the admin's manual pick wins; when none is chosen,
    // fall back to the 1st image of that value's gallery (then 1st common).
    const cleanPreviews: Record<string, string> = {};
    for (const val of imageValues) {
      const manual = visualGallery.previews[val];
      const preview =
        manual || liveGalleries[val]?.[0] || visualGallery.common[0] || null;
      if (preview) cleanPreviews[val] = preview;
    }
    // A kept value keeps only the preview the admin actually chose — never the
    // "first gallery photo / first common photo" fallback above, which is a
    // storefront convenience and would be noise on a gallery nothing shows.
    for (const val of Object.keys(keptGalleries)) {
      const manual = visualGallery.previews[val];
      if (manual) cleanPreviews[val] = manual;
    }
    const cleanMedia: VisualGalleryState = {
      galleries: { ...keptGalleries, ...liveGalleries },
      previews: cleanPreviews,
      common: visualGallery.common,
    };

    // Build the variant matrix. Images per combo are derived from the visual
    // gallery: all combos sharing the same image-driving value (e.g. "Pink") get
    // that value's gallery + the common gallery. Blank price/stock is sent
    // through as "" so deriveVariantModel inherits the product's values.
    const variants = hasVariants
      ? combos.map((combo) => {
          const v = variantOf(comboKey(combo));
          // The visual value is this combo's choice for the image-driving option.
          const visualVal = (imageDrivingOption ? combo[imageDrivingOption] : null) ?? null;
          const designImages = visualVal ? (liveGalleries[visualVal] ?? []) : [];
          const comboImages = [...designImages, ...visualGallery.common];
          return {
            combo,
            price: v.price === "" ? "" : Number(v.price) || 0,
            stock: v.stock === "" ? "" : Number(v.stock) || 0,
            available: v.available,
            images: comboImages,
            previewImage: visualVal ? (cleanPreviews[visualVal] ?? null) : null,
          };
        })
      : [];

    // Product.images is derived, never authored: the union of every gallery, in a
    // stable order (variant galleries in option order, then common). It backs the
    // listing card, OG image and JSON-LD — the storefront gallery itself reads the
    // relational ProductImage rows written by syncProductImages.
    //
    // **Live galleries only.** It used to sweep up every leftover gallery too,
    // which was harmless while those rows were being deleted anyway. Now that
    // they are kept, including them here would leak them back onto the
    // storefront: `product.images` is the card fallback (`ownStills`), the OG
    // image and the JSON-LD, so a product set to None with fewer than four
    // common photos would start swiping through the hidden ones. Kept means
    // kept in the database, not shown.
    const allVariantImages = new Set<string>();
    for (const val of visualValues) {
      for (const img of liveGalleries[val] ?? []) allVariantImages.add(img);
    }
    for (const img of visualGallery.common) allVariantImages.add(img);
    const derivedImages = [...allVariantImages];

    // Persist which option drives the image galleries (storefront reader contract:
    // Product.propertyModules.images = [optionName]). An EMPTY array is the
    // explicit "None" answer — distinct from the key being absent, which is what
    // rows saved before this contract carry and what still falls back to the
    // first option. Preserve any other modules.
    const propertyModules = {
      ...(product?.propertyModules ?? {}),
      images: imageDrivingOption ? [imageDrivingOption] : [],
    };

    const compareAtPrice = compareAtToSave;

    // One entry per combination (or the single `""` row of a product with no
    // options): identity and cost only. Price travels in `variants` above, and
    // stock is not the editor's to send for a tracked product.
    const variantRowsPayload = rowKeys.map((key) => {
      const v = variantOf(key);
      return {
        key,
        sku: normaliseSku(v.sku) || null,
        barcode: v.barcode.trim() || null,
        compareAtPrice: entryNumber(v.compareAtPrice),
        costPrice: entryNumber(v.costPrice),
        lowStockAt: entryNumber(v.lowStockAt),
      };
    });

    const payload = {
      name: form.name,
      category: form.category,
      secondaryCategory: form.secondaryCategory || null,
      subcategoryId: form.subcategoryId || null,
      options: cleanOptions,
      // Which option controls the image galleries (storefront reader contract).
      propertyModules,
      variantPrices: [], // superseded by `variants`
      variants,
      // The base as typed. The server settles it against the combinations —
      // the product is stored at the cheapest available one, and blank rows
      // are pinned where that would otherwise move them.
      price: base,
      compareAtPrice,
      costPrice: productCost,
      variantRows: variantRowsPayload,
      // Ignored by the server for a tracked product; sent so the schema holds.
      stock: tracked ? (product?.stock ?? 0) : Number(form.stock || 0),
      description: form.description,
      tags: form.tags
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
      images: derivedImages,
      // Clean preview/gallery/common split so the server can persist ProductImage rows.
      media: cleanMedia,
      isFeatured: form.isFeatured,
      isActive: form.isActive,
      isCustomisable,
      // The note only means anything for a made-to-order piece; a leftover note
      // on a switched-off product would show on the storefront as an instruction
      // for details nobody is being asked for.
      customisationNote: isCustomisable ? customisationNote.trim() || null : null,
      paymentModes: (paymentModes.length ? paymentModes : ["prepaid", "cod"]) as (
        | "prepaid"
        | "cod"
        | "partial"
        | "direct"
      )[],
      advancePercent: paymentModes.includes("partial") && advancePercent
        ? Number(advancePercent)
        : null,
      weightGrams: parcel.weightGrams ? Number(parcel.weightGrams) : null,
      lengthCm: parcel.lengthCm ? Number(parcel.lengthCm) : null,
      breadthCm: parcel.breadthCm ? Number(parcel.breadthCm) : null,
      heightCm: parcel.heightCm ? Number(parcel.heightCm) : null,
      shippingType: shipping.shippingType,
      shippingFee: Number(shipping.shippingFee || 0),
      shippingMarkup: Number(shipping.shippingMarkup || 0),
      materialsCare: info.materialsCare,
      shippingInfo: info.shippingInfo,
      returnsInfo: info.returnsInfo,
      returnable,
      videos: videos
        .map((v) => ({ title: v.title.trim(), url: v.url.trim() }))
        .filter((v) => v.url),
    };

    const res = editing
      ? await updateProduct(product!.id, payload)
      : await createProduct(payload);

    setSaving(false);
    if (res.ok) {
      const notices = res.notices ?? [];
      toast.success(editing ? "Product updated" : "Product created", {
        description: notices.length ? notices.join(" ") : undefined,
      });
      // Land back on the group that was just added to, so the next piece in
      // the set is one click away.
      router.push(
        form.subcategoryId
          ? `/admin/products?subcategoryId=${form.subcategoryId}`
          : "/admin/products"
      );
      router.refresh();
    } else {
      // A refusal about one combination points at its cell.
      if ("variantKey" in res && (res.variantKey !== undefined || res.variantField)) {
        const field = res.variantField ?? "";
        setTab("pricing");
        setGridView(
          field === "sku" || field === "barcode" ? "sku" : field === "lowStockAt" ? "stock" : "price"
        );
        setGridError({ key: res.variantKey, field, message: res.error });
      }
      toast.error(res.error || "Could not save");
    }
  }

  const TABS: { id: EditorTab; label: string; count?: number }[] = [
    { id: "optvar", label: "Options & Variants", count: combos.length || undefined },
    { id: "pricing", label: "Price & Stock" },
    { id: "media", label: "Media", count: photoCount || undefined },
  ];

  return (
    <form onSubmit={onSubmit} className="space-y-4 sm:space-y-6">
      {/* ── Persistent section — stays visible above the tab bar. ── */}
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        <Card title="Product details">
          <Field label="Name" required>
            {(id) => (
              <input
                id={id}
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                className="input"
                placeholder="LEVEL7 Core Unisex Oversized T-Shirt"
              />
            )}
          </Field>

          <Field
            label="Description"
            required
            tip={
              <>
                Shown as <b>Product Details</b> on the product page and unique to
                this piece. Materials, shipping and returns are separate blocks
                further down — don&apos;t repeat them here.
              </>
            }
          >
            {(id) => (
              <textarea
                id={id}
                rows={5}
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                className="input resize-y"
              />
            )}
          </Field>

          <Field
            label="Tags"
            tip="Comma separated. Tags feed search and the 'you may also like' rail — colours, occasions and materials work better than repeating the product name."
          >
            {(id) => (
              <input
                id={id}
                value={form.tags}
                onChange={(e) => set("tags", e.target.value)}
                className="input"
                placeholder="oversized, black, streetwear"
              />
            )}
          </Field>
        </Card>

        <Card title="Organisation">
          <Field label="Category" required>
            {(id) => (
              <select
                id={id}
                value={form.category}
                onChange={(e) => onCategoryChange(e.target.value)}
                className="input"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field
            label="Subcategory"
            tip={
              <>
                Groups this piece under something like <b>Oversized Tees</b>.
                Leave it as None for a one-off that should appear on the category
                page directly.
              </>
            }
          >
            {(id) => (
              <select
                id={id}
                value={form.subcategoryId}
                onChange={(e) => set("subcategoryId", e.target.value)}
                className="input"
                disabled={categorySubs.length === 0}
              >
                <option value="">
                  {categorySubs.length === 0
                    ? "No subcategories in this category yet"
                    : "None — show on the category page"}
                </option>
                {categorySubs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field
            label="Secondary category"
            tip="Lists this piece under a second category as well — useful for something that is both a tee and a gift item. It still belongs to its primary category for breadcrumbs and SEO."
          >
            {(id) => (
              <select
                id={id}
                value={form.secondaryCategory}
                onChange={(e) => set("secondaryCategory", e.target.value)}
                className="input"
              >
                <option value="">None</option>
                {categories
                  .filter((c) => c !== form.category)
                  .map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
              </select>
            )}
          </Field>

          <div className="space-y-2 pt-1">
            <SwitchRow
              label="Featured on homepage"
              icon={<Star className="h-4 w-4 shrink-0 text-muted-foreground" />}
              tip="Featured pieces fill the homepage rail. Six or so is the sweet spot — everything featured is nothing featured."
              checked={form.isFeatured}
              onChange={(v) => set("isFeatured", v)}
            />
            <SwitchRow
              label="Visible in shop"
              tip="Off hides the product everywhere on the storefront — shop grid, search, sitemap — without deleting it. Existing orders and reviews are untouched."
              checked={form.isActive}
              onChange={(v) => set("isActive", v)}
            />
          </div>
        </Card>

        {/* ── Made to order ── */}
        <Card title="Made to order">
          <SwitchRow
            label="This is a made-to-order / customised product"
            icon={<Wand2 className="h-4 w-4 shrink-0 text-muted-foreground" />}
            tip={
              <>
                Turn this on for a piece produced after the order is placed —
                personalised names, numbers, made-to-measure. The product page
                says so, the order is flagged for you with the customer&apos;s
                details, and you will usually want to set Returns below to
                &ldquo;Not returnable&rdquo; and offer the &ldquo;arrange
                directly&rdquo; checkout mode.
              </>
            }
            checked={isCustomisable}
            onChange={setIsCustomisable}
          />

          {isCustomisable && (
            <Field
              label="What should the customer tell you?"
              tip={
                <>
                  Shown next to a required note box on the product page and
                  copied onto the order. Be specific and ask for everything at
                  once — every missing detail is a message you have to chase.
                  One request per line.
                </>
              }
              hint={
                customisationNote.trim()
                  ? undefined
                  : "Leave empty for a free-form note box with no prompt."
              }
            >
              {(id) => (
                <textarea
                  id={id}
                  rows={3}
                  value={customisationNote}
                  onChange={(e) => setCustomisationNote(e.target.value)}
                  className="input resize-y"
                  placeholder={"Name to print (max 12 characters)\nJersey number\nChest measurement in inches"}
                />
              )}
            </Field>
          )}
        </Card>

        {/* ── Checkout ── */}
        <Card
          title="Checkout"
          tip="Which ways a customer may pay for this piece. At least one must be on, and the store-wide switches in Settings still apply on top of these — a mode turned off there never appears, however it is set here."
        >
          <div className="space-y-2">
            {MODE_COPY.map(({ mode, label, tip }) => (
              <ModeRow
                key={mode}
                label={label}
                tip={tip}
                checked={paymentModes.includes(mode)}
                onChange={() => toggleMode(mode)}
              />
            ))}
          </div>

          {paymentModes.length === 0 && (
            <p className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
              Nothing is selected — checkout will fall back to online + cash on
              delivery.
            </p>
          )}

          {paymentModes.includes("partial") && (
            <Field
              label="Advance taken online"
              tip="The share collected at checkout; the courier collects the rest. 20–30% is the usual range — enough to confirm intent without being a second full checkout."
            >
              {(id) => (
                <div className="relative max-w-[10rem]">
                  <input
                    id={id}
                    type="number"
                    min={1}
                    max={99}
                    value={advancePercent}
                    onChange={(e) => setAdvancePercent(e.target.value)}
                    className="input pr-8"
                    placeholder="30"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    %
                  </span>
                </div>
              )}
            </Field>
          )}
        </Card>

        {/* ── Shipping ── */}
        <div className="min-w-0 lg:col-span-2">
          <Card
            title="Shipping"
            tip="How postage is charged for this piece, and the parcel it ships in. Free shipping skips the courier rate call entirely, so a courier outage cannot block checkout."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Shipping charge">
                {(id) => (
                  <select
                    id={id}
                    value={shipping.shippingType}
                    onChange={(e) => setShippingField("shippingType", e.target.value)}
                    className="input"
                  >
                    <option value="free">Free — customer pays ₹0</option>
                    <option value="fixed">Flat rate per item</option>
                    <option value="nimbus">Live courier rate + markup</option>
                  </select>
                )}
              </Field>

              {shipping.shippingType === "fixed" && (
                <Field
                  label="Flat rate (₹ per item)"
                  tip="Charged once per unit, so two of this piece is twice the fee."
                >
                  {(id) => (
                    <input
                      id={id}
                      type="number"
                      min={0}
                      value={shipping.shippingFee}
                      onChange={(e) => setShippingField("shippingFee", e.target.value)}
                      className="input"
                    />
                  )}
                </Field>
              )}

              {shipping.shippingType === "nimbus" && (
                <Field
                  label="Markup (₹ per item)"
                  tip="Added on top of whatever NimbusPost quotes for the destination pin code, per unit. Covers packaging and the handling you don't want to itemise."
                >
                  {(id) => (
                    <input
                      id={id}
                      type="number"
                      min={0}
                      value={shipping.shippingMarkup}
                      onChange={(e) => setShippingField("shippingMarkup", e.target.value)}
                      className="input"
                    />
                  )}
                </Field>
              )}
            </div>

            <div className="border-t border-border pt-4">
              <div className="mb-3 flex items-center gap-1">
                <h3 className="text-sm font-medium">Parcel size</h3>
                <InfoTip term="Parcel size">
                  Per unit, and sent to the courier for the AWB. Couriers bill the
                  greater of the real weight and length × breadth × height ÷ 5000,
                  so a light but bulky parcel is charged as a heavy one. A tee is
                  about 300 g at 30×24×3 cm; a hoodie 750 g at 33×26×6 cm.
                </InfoTip>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Weight (g)">
                  {(id) => (
                    <input
                      id={id}
                      type="number"
                      min={1}
                      value={parcel.weightGrams}
                      onChange={(e) => setParcelField("weightGrams", e.target.value)}
                      className="input"
                      placeholder="300"
                    />
                  )}
                </Field>
                <Field label="Length (cm)">
                  {(id) => (
                    <input
                      id={id}
                      type="number"
                      min={1}
                      value={parcel.lengthCm}
                      onChange={(e) => setParcelField("lengthCm", e.target.value)}
                      className="input"
                      placeholder="30"
                    />
                  )}
                </Field>
                <Field label="Breadth (cm)">
                  {(id) => (
                    <input
                      id={id}
                      type="number"
                      min={1}
                      value={parcel.breadthCm}
                      onChange={(e) => setParcelField("breadthCm", e.target.value)}
                      className="input"
                      placeholder="24"
                    />
                  )}
                </Field>
                <Field label="Height (cm)">
                  {(id) => (
                    <input
                      id={id}
                      type="number"
                      min={1}
                      value={parcel.heightCm}
                      onChange={(e) => setParcelField("heightCm", e.target.value)}
                      className="input"
                      placeholder="3"
                    />
                  )}
                </Field>
              </div>
            </div>
          </Card>
        </div>

        {/* ── Product page info ── */}
        <div className="min-w-0 lg:col-span-2">
          <Card
            title="Product page info"
            tip={
              <>
                The blocks under the Buy button. Each one either inherits the
                store-wide copy from <b>Settings &gt; Product defaults</b> or
                carries its own. Inheriting is the right answer for almost every
                piece — switch to Custom only where this one genuinely differs.
              </>
            }
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {/* The switch states this product's answer; the strip under it
                  states the answer the customer actually gets, which is not the
                  same question once the master switch or made-to-order is in
                  play. See ReturnsOutcome. */}
              <div className="flex min-w-0 flex-col gap-2">
                <StoreDefaultChoice
                  label="Returns"
                  tip={
                    <>
                      Whether this piece can be returned at all — the rule, not
                      the wording. <b>Store default</b> follows Settings &gt;
                      Returns, so changing the policy once changes every product
                      that inherits it. <b>Custom</b> pins this one product and
                      stops it following the store: the usual reason is
                      personalised work that cannot be resold. Saying
                      &ldquo;Not returnable&rdquo; hides the return request form
                      for this product and removes its Returns &amp; Refunds
                      block from the product page.
                    </>
                  }
                  value={returnable}
                  fallback={returnDefaults?.defaultReturnable}
                  fallbackLabel={
                    returnDefaults === undefined
                      ? "the store setting"
                      : returnDefaults.defaultReturnable
                        ? "returnable"
                        : "not returnable"
                  }
                  onChange={setReturnable}
                  options={{ yes: "Returnable", no: "Not returnable" }}
                />
                <ReturnsOutcome
                  product={{ returnable, isCustomisable }}
                  settings={returnDefaults}
                />
              </div>
              <StoreDefaultText
                label="Materials & Care"
                tip="Fabric, GSM, fit and washing instructions. One point per line; each line becomes a bullet on the product page."
                value={info.materialsCare}
                fallback={infoDefaults?.materialsCare ?? ""}
                onChange={(v) => setInfoField("materialsCare", v)}
              />
              <StoreDefaultText
                label="Shipping & Delivery"
                tip="Dispatch and delivery expectations. Override it for anything slower than usual — a made-to-order piece that takes three weeks belongs here, not in a surprise email."
                value={info.shippingInfo}
                fallback={infoDefaults?.shippingInfo ?? ""}
                onChange={(v) => setInfoField("shippingInfo", v)}
              />
              <StoreDefaultText
                label="Returns & Refunds"
                tip="The wording shoppers read before buying. This is copy only — whether a return can actually be raised is the Returns switch to the left."
                value={info.returnsInfo}
                fallback={infoDefaults?.returnsInfo ?? ""}
                onChange={(v) => setInfoField("returnsInfo", v)}
              />
            </div>

            {/* ── Video links ── */}
            <div className="border-t border-border pt-4">
              <div className="mb-3 flex flex-wrap items-center gap-1">
                <Video className="h-4 w-4 shrink-0 text-muted-foreground" />
                <h3 className="text-sm font-medium">Video links</h3>
                <InfoTip term="Video links">
                  Paste a YouTube or Instagram link and give it a title — reviews,
                  the making process, packaging. They render as a scrollable
                  &ldquo;Video previews&rdquo; row under the info blocks. Shorts
                  and Reels are framed portrait automatically. Leave it empty and
                  the row is hidden.
                </InfoTip>
                {videos.length > 0 && <CountBadge>{videos.length}</CountBadge>}
              </div>

              {videos.length > 0 && (
                <div className="mb-3 space-y-2">
                  {videos.map((v, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      {/* The label is a choice, not free text.
                          Two reasons, and the second is the real one:
                          "Instagram" typed nine different ways made this rail
                          read as nine different things, and the portfolio
                          harvests these links (`lib/portfolio-harvest.ts`) —
                          a readable, consistent label is what lets the owner
                          see at a glance what is about to be pulled across.
                          **Nothing downstream trusts it.** Harvesting and
                          `resolveVideo` both read the provider out of the URL,
                          so a row labelled Instagram pointing at YouTube still
                          plays as YouTube. The label is for the human. */}
                      <select
                        value={videoTitleMode(v.title)}
                        onChange={(e) =>
                          // Picking a preset writes that exact label; picking
                          // Custom clears it so the box beside opens empty.
                          // `videoTitleMode` reads "" back as Custom, so there
                          // is no third "unset" state to get out of step with
                          // what is on screen.
                          setVideoField(
                            i,
                            "title",
                            e.target.value === "custom" ? "" : e.target.value
                          )
                        }
                        aria-label={`Video ${i + 1} label`}
                        className="input h-11 w-full min-w-0 sm:h-10 sm:w-[10rem]"
                      >
                        {VIDEO_LABELS.map((label) => (
                          <option key={label} value={label}>
                            {label}
                          </option>
                        ))}
                        <option value="custom">Custom…</option>
                      </select>
                      {videoTitleMode(v.title) === "custom" && (
                        <input
                          value={v.title}
                          onChange={(e) => setVideoField(i, "title", e.target.value)}
                          className="input h-11 w-full min-w-0 sm:h-10 sm:w-[10rem]"
                          aria-label={`Video ${i + 1} custom label`}
                          placeholder={
                            detectedVideoLabel(v.url)
                              ? `e.g. ${detectedVideoLabel(v.url)} — the making of`
                              : "Your own label"
                          }
                        />
                      )}
                      <input
                        value={v.url}
                        onChange={(e) => setVideoField(i, "url", e.target.value)}
                        className="input h-11 min-w-0 flex-1 sm:h-10"
                        aria-label={`Video ${i + 1} link`}
                        placeholder="https://youtube.com/… or https://instagram.com/reel/…"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setVideos((prev) => prev.filter((_, idx) => idx !== i))
                        }
                        className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
                        aria-label={`Remove video ${i + 1}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <MiniButton
                onClick={() => setVideos((prev) => [...prev, { title: "", url: "" }])}
              >
                <Plus className="h-3.5 w-3.5" /> Add video link
              </MiniButton>
            </div>
          </Card>
        </div>
      </div>

      {/* ── Tab bar — scrolls sideways rather than wrapping into two rows. ── */}
      <div className="overflow-x-auto overscroll-x-contain border-b border-border">
        <div className="flex w-max min-w-full gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-t-lg border-b-2 px-4 text-sm font-medium transition-colors",
                tab === t.id
                  ? "border-accent text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
              {t.count !== undefined && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] tabular-nums",
                    tab === t.id
                      ? "bg-accent/15 text-accent"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Options & Variants ── */}
      {tab === "optvar" && (
        <Card
          title="Options"
          tip={
            <>
              An option is a choice the customer makes — Size, Colour, Fit. Every
              combination of every option becomes a variant with its own SKU,
              which you can price, stock and photograph. Prices, SKUs and stock
              live on the <b>Price &amp; Stock</b> tab, photos on <b>Media</b>.
              Removing a choice deletes its variant — or retires it, SKU and
              history kept, if it has ever held stock.
            </>
          }
          aside={
            combos.length > 0 ? (
              <span className="text-xs text-muted-foreground">
                {combos.length} combination{combos.length !== 1 ? "s" : ""}
              </span>
            ) : undefined
          }
        >
          {options.length === 0 && (
            <p className="rounded-lg bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
              No options — this piece is sold as a single item.
            </p>
          )}

          {options.map((group, gi) => (
            <div key={gi} className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <GripVertical className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
                <input
                  value={group.name}
                  onChange={(e) => setGroupName(gi, e.target.value)}
                  className="input h-11 min-w-0 sm:h-10"
                  aria-label={`Option ${gi + 1} name`}
                  placeholder="Option name (Size, Colour, Fit…)"
                />
                <button
                  type="button"
                  onClick={() => removeOptionGroup(gi)}
                  className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
                  aria-label={`Remove option ${group.name || gi + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-3 space-y-2 sm:pl-6">
                {group.choices.map((choice, ci) => (
                  <div key={ci} className="flex items-center gap-2">
                    <input
                      value={choice.label}
                      onChange={(e) => setChoice(gi, ci, { label: e.target.value })}
                      className="input h-11 min-w-0 flex-1 sm:h-10"
                      aria-label={`Choice ${ci + 1}`}
                      placeholder="Choice (S, M, L…)"
                    />
                    {/* No "+₹ per choice" box. `priceDelta` was authored here
                        and read by nothing — not the storefront, not checkout —
                        so a choice marked +₹200 sold at the base price. A
                        control that changes nothing is worse than none; a
                        choice that costs more gets its own price in the
                        Variants grid, which checkout does charge. The stored
                        value (0 on every product) still round-trips. */}
                    <button
                      type="button"
                      onClick={() => removeChoice(gi, ci)}
                      disabled={group.choices.length <= 1}
                      className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30"
                      aria-label={`Remove choice ${ci + 1}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <MiniButton onClick={() => addChoice(gi)} className="border-dashed">
                  <Plus className="h-3.5 w-3.5" /> Add choice
                </MiniButton>
              </div>
            </div>
          ))}

          <MiniButton onClick={addOptionGroup} className="border-dashed">
            <Plus className="h-3.5 w-3.5" /> Add an option
          </MiniButton>
        </Card>
      )}

      {/* ── Price & Stock ── */}
      {tab === "pricing" && (
        <div className="space-y-4 sm:space-y-6">
          <Card title="Price, cost & stock">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field
                label={hasVariants ? "Base price (₹)" : "Price (₹)"}
                required
                tip={
                  hasVariants
                    ? "What every combination with a blank price sells at. The price shoppers see first — on cards and in search — is the cheapest available combination."
                    : "What the customer pays, before any discount badge."
                }
                hint={
                  pinnedBlank ? (
                    <>
                      Saved as {formatINR(effectivePrice)}, the cheapest available
                      combination. Blank rows stay at {formatINR(base)}.
                    </>
                  ) : undefined
                }
              >
                {(id) => (
                  <input
                    id={id}
                    type="number"
                    min={0}
                    value={form.price}
                    onChange={(e) => set("price", e.target.value)}
                    className="input"
                  />
                )}
              </Field>

              <Field
                label="Discount %"
                tip={
                  <>
                    Shows a &ldquo;Save X%&rdquo; badge. We store the implied
                    original price rather than the percentage, so the badge and
                    the struck-through price always agree. Leave it at 0 for no
                    discount.
                  </>
                }
                hint={
                  // The number that will be stored, not a fresh recompute — they
                  // differ by a few rupees when the discount is untouched.
                  compareAtToSave != null && compareAtToSave > effectivePrice ? (
                    <>
                      Shown as {formatINR(compareAtToSave)} struck through,{" "}
                      {formatINR(effectivePrice)} paid.
                    </>
                  ) : undefined
                }
              >
                {(id) => (
                  <div className="relative">
                    <input
                      id={id}
                      type="number"
                      min={0}
                      max={99}
                      value={form.discount}
                      onChange={(e) => set("discount", e.target.value)}
                      className="input pr-8"
                      placeholder="0"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      %
                    </span>
                  </div>
                )}
              </Field>

              <Field
                label="Cost price (₹)"
                tip="What one unit cost you — blank, print, making. Never shown to customers; margin is worked out from it. A size that cost more gets its own cost in the Variants grid."
                hint={
                  productCost != null && base > 0 ? (
                    <MarginLine price={base} cost={productCost} />
                  ) : undefined
                }
              >
                {(id) => (
                  <input
                    id={id}
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={costPrice}
                    onChange={(e) => setCostPrice(e.target.value)}
                    className="input"
                    placeholder="Not recorded"
                  />
                )}
              </Field>

              {tracked ? (
                // A read-out, not an input: `Product.stock` is the inventory
                // engine's mirror of the ledger, and a second writer here would
                // put a number on the storefront that no movement explains.
                <Field
                  label="Stock"
                  tip="Tracked in Inventory, where every unit in or out is a ledger entry — so it is not typed here. Receive stock, write off damage or recount there."
                >
                  <div className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-muted/40 px-3 py-2">
                    <span className="text-lg font-semibold tabular-nums">
                      {stockTotals.available}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      available · {stockTotals.onHand} on hand
                      {stockTotals.reserved ? ` · ${stockTotals.reserved} reserved` : ""}
                    </span>
                    <Link
                      href={inventoryHref}
                      className="ml-auto inline-flex items-center gap-0.5 text-xs font-medium underline underline-offset-2 hover:text-accent"
                    >
                      Inventory <ArrowUpRight className="h-3 w-3" />
                    </Link>
                  </div>
                </Field>
              ) : (
                <Field
                  label="Stock"
                  required
                  tip={
                    hasVariants
                      ? "The fallback count. A combination with a blank stock box uses this number."
                      : "Units on hand. At 0 the product shows as sold out but stays listed."
                  }
                >
                  {(id) => (
                    <input
                      id={id}
                      type="number"
                      min={0}
                      value={form.stock}
                      onChange={(e) => set("stock", e.target.value)}
                      className="input"
                    />
                  )}
                </Field>
              )}
            </div>

            {/* A product with no options is one variant: its SKU lives here,
                not in a one-row grid. */}
            {combos.length === 0 && (
              <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-3">
                <Field
                  label="SKU"
                  tip="Printed on labels and typed into courier forms, so it never changes by itself — renaming the product leaves it as it is. Leave it blank on a new product to have one generated. Unique across the store."
                >
                  {(id) => (
                    <SkuInput
                      id={id}
                      name={form.name || "this product"}
                      value={variantOf("").sku}
                      existing={facts.get("")?.sku ?? null}
                      preview={facts.get("") ? null : skuPreview({})}
                      duplicate={retired.some((r) => r.sku === normaliseSku(variantOf("").sku))}
                      serverError={gridError?.key === "" && gridError.field === "sku" ? gridError.message : null}
                      onChange={(val) => patchVariants([""], { sku: val })}
                    />
                  )}
                </Field>
                <Field label="Barcode" tip="EAN, UPC or your own barcode label. Optional, and unique across the store.">
                  {(id) => (
                    <input
                      id={id}
                      value={variantOf("").barcode}
                      onChange={(e) => patchVariants([""], { barcode: e.target.value })}
                      className={cn(
                        "input font-mono",
                        gridError?.key === "" && gridError.field === "barcode" && "border-danger"
                      )}
                      placeholder="EAN / UPC"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  )}
                </Field>
                <Field
                  label="Low-stock at"
                  tip={`Flagged as low stock at or below this many${tracked ? "" : " — once this product is tracked in Inventory"}. Blank uses the store default (${lowStockDefault}).`}
                >
                  {(id) => (
                    <input
                      id={id}
                      type="number"
                      min={0}
                      value={variantOf("").lowStockAt}
                      onChange={(e) => patchVariants([""], { lowStockAt: e.target.value })}
                      className="input"
                      placeholder={`Store · ${lowStockDefault}`}
                    />
                  )}
                </Field>
                {gridError?.key === "" && gridError.message && (
                  <p role="alert" className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger sm:col-span-3">
                    {gridError.message}
                  </p>
                )}
              </div>
            )}

            {hasVariants && (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                <span className="text-xs text-muted-foreground">
                  Shoppers see
                </span>
                <span className="text-lg font-semibold">
                  {formatINR(effectivePrice)}
                </span>
                <span className="text-xs text-muted-foreground">
                  — the cheapest available combination
                </span>
              </div>
            )}
          </Card>

          {combos.length > 0 && (
            <Card
              title="Variants"
              tip={
                <>
                  One row per combination, each with its own SKU and cost.
                  Switch on <b>Separate prices</b> to give combinations their own
                  price, compare-at price, availability and stock; with it off,
                  every combination sells at the base price. A combination
                  switched off is greyed out on the storefront instead of
                  disappearing, so a shopper can see it exists.
                </>
              }
              aside={
                <SwitchRow
                  tone="bare"
                  label="Separate prices"
                  checked={useVariants}
                  onChange={setUseVariants}
                  className="w-auto"
                />
              }
            >
              <VariantTable
                optionMatrix={optionMatrix}
                combos={combos}
                entryOf={variantOf}
                onPatch={(keys, patch) => {
                  if (gridError) setGridError(null);
                  patchVariants(keys, patch);
                }}
                view={gridView}
                onViewChange={setGridView}
                perCombination={hasVariants}
                basePrice={base}
                sellsAt={sellsAt}
                productCost={productCost}
                productCompareAt={compareAtToSave}
                baseStock={form.stock}
                tracked={tracked}
                facts={facts}
                retired={retired}
                lowStockDefault={lowStockDefault}
                skuPreview={skuPreview}
                error={gridError}
                inventoryHref={inventoryHref}
              />
            </Card>
          )}
        </div>
      )}

      {/* ── Media ── */}
      {tab === "media" && (
        <Card
          title="Media"
          tip="Every photo this product has. Galleries are filed by one option's values (the Image Controller) rather than by every combination, so you assign photos once per value and every combination sharing that value reuses them."
        >
          <VariantMediaTab
            options={options}
            /* The sentinel has to survive the trip: `imageDrivingOption` is ""
               for both "None" and "no options", and the tab needs to tell them
               apart to know whether to offer the controller at all. */
            visualOptionName={
              imageOption === IMAGE_CONTROLLER_NONE
                ? IMAGE_CONTROLLER_NONE
                : imageDrivingOption
            }
            onVisualOptionChange={setImageOption}
            state={visualGallery}
            onChange={setVisualGallery}
            productCategory={form.category}
            productSubcategory={
              subcategories.find((s) => s.id === form.subcategoryId)?.name
            }
            activeValues={activeVisualValues}
            onUploadFiles={uploadFiles}
          />
        </Card>
      )}

      {/* ── Actions (save / cancel — always visible) ── */}
      <div className="flex flex-wrap gap-3">
        {/* Blocked while an upload is in flight — saving mid-upload would persist
            galleries missing the photos still being written. */}
        <Button
          type="submit"
          disabled={saving || uploading}
          className="flex-1 sm:flex-none"
          size="lg"
        >
          {uploading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Uploading…
            </>
          ) : saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Saving…
            </>
          ) : editing ? (
            "Save changes"
          ) : (
            "Create product"
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={() => router.push("/admin/products")}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** "Margin ₹530 · 36% at ₹1,477" — the reason to record a cost at all. */
function MarginLine({ price, cost }: { price: number; cost: number }) {
  const profit = price - cost;
  const pct = price > 0 ? Math.round((profit / price) * 100) : 0;
  return (
    <span className={cn("tabular-nums", profit < 0 && "text-danger")}>
      Margin {formatINR(profit)} · {pct}% at {formatINR(price)}
    </span>
  );
}

/**
 * One checkout mode. The `(i)` sits OUTSIDE the `<label>` on purpose: a button
 * inside a label folds its own accessible name ("What Cash on delivery means")
 * into the checkbox's, so the checkbox ends up announced as two sentences.
 */
function ModeRow({
  label,
  tip,
  checked,
  onChange,
}: {
  label: string;
  tip: React.ReactNode;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div
      className={cn(
        "flex min-h-11 items-center gap-1 rounded-lg border pr-2 transition-colors",
        checked ? "border-accent/40 bg-accent/5" : "border-border"
      )}
    >
      <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-1">
        <Check checked={checked} onChange={onChange} label={label} />
        <span className="py-2 text-sm">{label}</span>
      </label>
      <InfoTip term={label}>{tip}</InfoTip>
    </div>
  );
}

/**
 * **What the customer actually gets**, under the Returns switch.
 *
 * The switch above answers one question — "does this product state its own
 * answer, and which?" — and the owner kept reading it as the whole policy. It
 * is not. Two things outrank it, and neither was visible anywhere in this
 * editor:
 *
 *   - `SiteSettings.returnsEnabled` off ⇒ nothing is returnable, and picking
 *     "Custom → Returnable" changes precisely nothing;
 *   - a made-to-order piece inheriting the default is NOT returnable, however
 *     "returnable" the store default reads.
 *
 * So the resolved answer is stated here in the sentence the storefront would
 * give, computed by `explainReturnPolicy` — which is `resolveReturnPolicy` with
 * its reasoning kept — so the editor cannot claim one thing while the product
 * page does another. The store-wide half is a **link**, never a second control:
 * two editable copies of one settings column is the lost-update bug this repo
 * has already paid for once.
 */
function ReturnsOutcome({
  product,
  settings,
}: {
  product: { returnable: boolean | null; isCustomisable: boolean };
  settings?: {
    returnsEnabled: boolean;
    defaultReturnable: boolean;
    returnWindowDays: number;
  };
}) {
  // Nothing to resolve against (the caller didn't pass the store rules) — say
  // nothing rather than guess at an outcome.
  if (!settings) return null;

  const outcome = explainReturnPolicy(
    { returnable: product.returnable, isCustomisable: product.isCustomisable },
    { ...settings, defaultReturnsInfo: "" }
  );
  const overridden = !outcome.inherited;

  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border px-3 py-2.5 text-xs leading-relaxed",
        outcome.returnable
          ? "border-success/30 bg-success/5"
          : "border-danger/40 bg-danger/5"
      )}
    >
      <p className="flex items-start gap-1.5 font-medium text-foreground">
        {outcome.returnable ? (
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
        ) : (
          <ShieldOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
        )}
        <span className="min-w-0">{outcome.headline}</span>
      </p>
      <p className="mt-1 text-muted-foreground">{outcome.because}</p>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest",
            overridden
              ? "bg-accent/15 text-accent"
              : "bg-muted text-muted-foreground"
          )}
        >
          {overridden ? "Overridden here" : "Following the store"}
        </span>
        <Link
          href={RETURN_POLICY_HREF}
          className="inline-flex items-center gap-0.5 font-medium underline underline-offset-2 hover:text-accent"
        >
          Settings &gt; Returns <ArrowUpRight className="h-3 w-3" />
        </Link>
        <InfoTip term="Store default for all products">
          <>
            <b>Settings &gt; Returns</b> holds the store-wide rules: the master
            switch, the catalogue default, the window in days, the reasons
            offered and the policy wording. Every product follows them until it
            answers for itself with <b>Custom</b> — so change the policy there
            once, and it moves for the whole catalogue. Overriding is a
            per-product exception and nothing else: it cannot re-open returns
            while the master switch is off, and it does not change the wording,
            which is the <b>Returns &amp; Refunds</b> block on the right.
          </>
        </InfoTip>
      </div>
    </div>
  );
}
