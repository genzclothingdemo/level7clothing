"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2,
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
import { VariantTable, type VariantEntry } from "@/components/admin/variant-table";
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
import { InfoTip } from "@/components/store/info-tip";
import { allCombinations, comboKey } from "@/lib/options";
import { IMAGE_CONTROLLER_NONE } from "@/lib/variants";
import { formatINR, cn } from "@/lib/utils";
import type { ProductDTO, ProductOption, ProductVideo } from "@/lib/types";

type SubcategoryOption = { id: string; name: string; categoryName: string };

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
  /** Store-wide returnable default, so "Store default" can say which it is. */
  returnDefault?: boolean;
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

const EMPTY_ENTRY: VariantEntry = { available: true, price: "", stock: "" };

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
  returnDefault,
}: Props) {
  const router = useRouter();
  // A duplicate arrives as a fully populated product with a blank id — that is
  // still a create, not an edit.
  const editing = !!product?.id;
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
    | (ProductDTO & { isCustomisable?: boolean | null; customisationNote?: string | null })
    | undefined;

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

  // ---- Variants (price / stock / availability per combo) ----
  const [useVariants, setUseVariants] = useState<boolean>(
    (product?.variants?.length ?? 0) > 0 ||
      (product?.variantPrices?.length ?? 0) > 0
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
            available: v.available,
            // Preserve an "inherit base" (blank) price so the per-row
            // "Base price" toggle round-trips.
            price: rawPrice === "" || rawPrice == null ? "" : String(rawPrice),
            stock: rawStock === "" || rawStock == null ? "" : String(rawStock),
          };
        }
      } else if (product?.variantPrices?.length) {
        // Migrate the older price-only matrix.
        for (const v of product.variantPrices) {
          map[comboKey(v.combo)] = {
            available: true,
            price: String(v.price),
            stock: "",
          };
        }
      }
      return map;
    }
  );

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
          // Kept out of `galleries` on purpose: the editor treats the preview
          // as its own field, and folding it in would silently add it to the
          // gallery on the next save.
          if (!previews[val]) previews[val] = r.url;
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

  const base = Number(form.price || 0);

  // Product price = MIN of the available variant prices when variants exist,
  // else the entered base price. Blank variant price inherits the base.
  const variantMinPrice = useMemo(() => {
    if (!useVariants || combos.length === 0) return base;
    const prices = combos
      .map((c) => variantMap[comboKey(c)] ?? EMPTY_ENTRY)
      .filter((v) => v.available)
      .map((v) => (v.price === "" ? base : Number(v.price) || 0));
    return prices.length ? Math.min(...prices) : base;
  }, [useVariants, combos, variantMap, base]);

  const hasVariants = useVariants && combos.length > 0;
  const effectivePrice = hasVariants ? variantMinPrice : base;

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
    if (form.stock === "") {
      setTab("pricing");
      toast.error("Stock is required");
      setSaving(false);
      return;
    }

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

    // Keep only the galleries/previews for the image-driving option's values, so
    // orphaned keys (left over from switching which option controls images) are
    // never persisted. syncProductImages keys ProductImage.variantValue on these.
    const imageValues = new Set(
      optionMatrix.find((o) => o.name === imageDrivingOption)?.values ?? []
    );
    const cleanGalleries: Record<string, string[]> = {};
    for (const [val, imgs] of Object.entries(visualGallery.galleries)) {
      if (imageValues.has(val) && imgs.length) cleanGalleries[val] = imgs;
    }
    // Preview thumbnail: the admin's manual pick wins; when none is chosen,
    // fall back to the 1st image of that value's gallery (then 1st common).
    const cleanPreviews: Record<string, string> = {};
    for (const val of imageValues) {
      const manual = visualGallery.previews[val];
      const preview =
        manual || cleanGalleries[val]?.[0] || visualGallery.common[0] || null;
      if (preview) cleanPreviews[val] = preview;
    }
    const cleanMedia: VisualGalleryState = {
      galleries: cleanGalleries,
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
          const designImages = visualVal ? (cleanGalleries[visualVal] ?? []) : [];
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
    const allVariantImages = new Set<string>();
    for (const val of visualValues) {
      for (const img of cleanGalleries[val] ?? []) allVariantImages.add(img);
    }
    // Any gallery left over from a value that is no longer in the matrix.
    for (const gal of Object.values(cleanGalleries)) {
      for (const img of gal) allVariantImages.add(img);
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

    // Product price is the min available variant price when variants exist,
    // otherwise the entered base. Discount % round-trips through compareAtPrice.
    const price = Math.max(0, Math.round(effectivePrice));
    const discountNum = Math.min(99, Math.max(0, Number(form.discount) || 0));
    const compareAtPrice =
      discountNum > 0 ? Math.round(price / (1 - discountNum / 100)) : null;

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
      price,
      compareAtPrice,
      stock: Number(form.stock || 0),
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
      toast.success(editing ? "Product updated" : "Product created");
      // Land back on the group that was just added to, so the next piece in
      // the set is one click away.
      router.push(
        form.subcategoryId
          ? `/admin/products?subcategoryId=${form.subcategoryId}`
          : "/admin/products"
      );
      router.refresh();
    } else {
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
              <StoreDefaultChoice
                label="Returns"
                tip="Whether this piece can be returned at all. A 'Not returnable' answer hides the return request form for this product only — the usual reason is personalised work that cannot be resold."
                value={returnable}
                fallback={returnDefault}
                fallbackLabel={
                  returnDefault === undefined
                    ? "the store setting"
                    : returnDefault
                      ? "returnable"
                      : "not returnable"
                }
                onChange={setReturnable}
                options={{ yes: "Returnable", no: "Not returnable" }}
              />
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
                      <input
                        value={v.title}
                        onChange={(e) => setVideoField(i, "title", e.target.value)}
                        className="input h-11 w-full min-w-0 sm:h-10 sm:w-[13rem]"
                        aria-label={`Video ${i + 1} title`}
                        placeholder="Title"
                      />
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
              combination of every option becomes a variant you can price,
              stock and photograph. Prices and stock live on the{" "}
              <b>Price &amp; Stock</b> tab, photos on <b>Media</b>.
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
                    {!useVariants && (
                      <div className="relative w-24 shrink-0 sm:w-28">
                        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                          +₹
                        </span>
                        <input
                          type="number"
                          min={0}
                          value={choice.priceDelta || ""}
                          onChange={(e) =>
                            setChoice(gi, ci, {
                              priceDelta: Number(e.target.value) || 0,
                            })
                          }
                          className="input h-11 pl-8 sm:h-10"
                          placeholder="0"
                          aria-label={`Extra price for choice ${ci + 1}`}
                        />
                      </div>
                    )}
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
          <Card title="Base price & stock">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="Price (₹)"
                required
                tip={
                  hasVariants
                    ? "The fallback price. Any combination set to \"Base price\" below is sold at this number, and the price shoppers see is the cheapest available combination."
                    : "What the customer pays, before any discount badge."
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
                  Number(form.discount) > 0 ? (
                    <>
                      Shown as {formatINR(strikeThrough(effectivePrice, form.discount))}{" "}
                      struck through, {formatINR(Math.max(0, Math.round(effectivePrice)))}{" "}
                      paid.
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
            </div>

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

          <Card
            title="Per-combination pricing"
            tip="Give each combination its own price, stock and availability. Anything switched off here is greyed out on the storefront instead of disappearing, so a shopper can see it exists and is simply not made."
            aside={
              optionMatrix.length > 0 ? (
                <SwitchRow
                  tone="bare"
                  label="Separate prices"
                  checked={useVariants}
                  onChange={setUseVariants}
                  className="w-auto"
                />
              ) : undefined
            }
          >
            {optionMatrix.length === 0 ? (
              <p className="rounded-lg bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
                Add an option with at least one choice on the{" "}
                <b>Options &amp; Variants</b> tab to create combinations.
              </p>
            ) : !useVariants ? (
              <p className="rounded-lg bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
                Every combination is sold at the base price above. Switch this on
                to price them separately.
              </p>
            ) : (
              <VariantTable
                optionMatrix={optionMatrix}
                combos={combos}
                entryOf={variantOf}
                onPatch={patchVariants}
                basePrice={form.price}
                baseStock={form.stock}
              />
            )}
          </Card>
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

/** The implied original price a discount percentage is taken off. */
function strikeThrough(price: number, discount: string) {
  const p = Math.max(0, Math.round(price));
  const d = Math.min(99, Math.max(0, Number(discount) || 0));
  return d > 0 ? Math.round(p / (1 - d / 100)) : p;
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
