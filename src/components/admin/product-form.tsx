"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, X, Star, Plus, Trash2, GripVertical, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createProduct, updateProduct } from "@/app/actions/admin";
import { VariantMediaTab, type VisualGalleryState } from "@/components/admin/variant-media-tab";
import { allCombinations, comboKey } from "@/lib/options";
import { formatINR } from "@/lib/utils";
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
  /** Store-wide returnable default, so "Use store default" can say which it is. */
  returnDefault?: boolean;
};

/** Which top-level tab of the editor is showing. */
type EditorTab = "optvar" | "pricing" | "media";

/**
 * ProductForm — the admin product editor.
 *
 * A persistent section (Basic Info, Organisation, Checkout modes, Shipping) sits
 * above three top-level tabs: "Options & Variants" (the option builder +
 * combination generation), "Price & Stock" (base price / discount / stock plus
 * the per-combination pricing table) and "Media" (the gallery manager). Pricing
 * uses a "Discount %" model (compareAtPrice is derived from it) and, when
 * variants exist, the product price is the minimum available variant price.
 *
 * Photos are managed ONLY in the Media tab. The details form used to carry its
 * own "Images" picker writing to `Product.images`, which meant two systems
 * feeding one gallery and no way to tell which one won. `Product.images` is now
 * derived on save (union of every gallery) and kept purely as the flat list that
 * OG tags / JSON-LD / listing cards read.
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
  // Which checkout modes this product allows.
  const ALL_MODES = ["prepaid", "cod", "partial", "direct"] as const;
  type Mode = (typeof ALL_MODES)[number];
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
  // Which option's values drive the per-variant image galleries (Media tab).
  // Persisted as Product.propertyModules.images = [name]; defaults to first option.
  const [imageOption, setImageOption] = useState<string>(
    product?.propertyModules?.images?.[0] ?? ""
  );

  // ---- Variants (Flipkart-style: price / stock / availability per combo) ----
  type VariantEntry = { available: boolean; price: string; stock: string };
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
            // "Use Product Price" toggle round-trips.
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

  // Per-option filter for the variant table (option name → value, "" = all).
  const [variantFilter, setVariantFilter] = useState<Record<string, string>>({});
  // Bulk-update inputs applied to every currently-filtered row.
  const [bulk, setBulk] = useState<{ price: string; stock: string; available: string }>({
    price: "",
    stock: "",
    available: "",
  });

  // ---- Visual Gallery state (Media tab) ----
  // Initialise from existing variants so editing an existing product keeps its images.
  const [visualGallery, setVisualGallery] = useState<VisualGalleryState>(() => {
    const galleries: Record<string, string[]> = {};
    const previews: Record<string, string> = {};
    const commonSet = new Set<string>();
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

  // Cleaned option matrix — the shape both `combos` and the filter dropdowns need.
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

  // The effective image-driving option: the admin's choice if it still exists,
  // else the first option. Empty string when the product has no options.
  const imageDrivingOption = useMemo(() => {
    const names = optionMatrix.map((o) => o.name);
    return imageOption && names.includes(imageOption) ? imageOption : names[0] ?? "";
  }, [imageOption, optionMatrix]);

  // All combinations of the current options (recomputed as options change).
  const combos = useMemo(() => allCombinations(optionMatrix), [optionMatrix]);

  // Combos currently visible in the table after the per-option filter.
  const filteredCombos = useMemo(
    () =>
      combos.filter((c) =>
        Object.entries(variantFilter).every(([name, val]) => !val || c[name] === val)
      ),
    [combos, variantFilter]
  );

  const base = Number(form.price || 0);

  // Product price = MIN of the available variant prices when variants exist,
  // else the entered base price. Blank variant price inherits the base.
  const variantMinPrice = useMemo(() => {
    if (!useVariants || combos.length === 0) return base;
    const prices = combos
      .map((c) => variantMap[comboKey(c)] ?? { available: true, price: "", stock: "" })
      .filter((v) => v.available)
      .map((v) => (v.price === "" ? base : Number(v.price) || 0));
    return prices.length ? Math.min(...prices) : base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  function variantOf(key: string): VariantEntry {
    return variantMap[key] ?? { available: true, price: "", stock: "" };
  }
  function setVariantField(key: string, patch: Partial<VariantEntry>) {
    setVariantMap((prev) => ({
      ...prev,
      [key]: { ...variantOf(key), ...patch },
    }));
  }

  // Apply the bulk-update inputs to every currently-filtered combo.
  function applyBulk() {
    const patch: Partial<VariantEntry> = {};
    if (bulk.price !== "") patch.price = bulk.price;
    if (bulk.stock !== "") patch.stock = bulk.stock;
    if (bulk.available === "yes") patch.available = true;
    if (bulk.available === "no") patch.available = false;
    if (Object.keys(patch).length === 0) {
      toast.error("Enter a price, stock or availability to apply.");
      return;
    }
    setVariantMap((prev) => {
      const next = { ...prev };
      for (const c of filteredCombos) {
        const key = comboKey(c);
        next[key] = { ...(next[key] ?? { available: true, price: "", stock: "" }), ...patch };
      }
      return next;
    });
    toast.success(`Updated ${filteredCombos.length} combination${filteredCombos.length !== 1 ? "s" : ""}.`);
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
    // Product.propertyModules.images = [optionName]). Preserve any other modules.
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

  const TABS: { id: EditorTab; label: string }[] = [
    { id: "optvar", label: "Options & Variants" },
    { id: "pricing", label: "Price & Stock" },
    { id: "media", label: "Media" },
  ];

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* ── Persistent section — Basic Info, Organisation, Images, Checkout
          modes and Shipping stay visible above the tab bar. ── */}
      <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Product details">
            <label className="block">
              <span className="label">Name *</span>
              <input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                className="input"
                placeholder="LEVEL7 Core Unisex Oversized T-Shirt"
              />
            </label>
            <label className="block">
              <span className="label">Description *</span>
              <textarea
                rows={5}
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                className="input resize-none"
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                Shown as <b>Product Details</b> on the product page — unique to
                this piece. The other info sections come from Settings &gt;
                Product defaults unless you override them below.
              </span>
            </label>
            <label className="block">
              <span className="label">Tags (comma separated)</span>
              <input
                value={form.tags}
                onChange={(e) => set("tags", e.target.value)}
                className="input"
                placeholder="ocean, blue, gift"
              />
            </label>
          </Card>

          <div className="lg:col-span-2">
            <Card title="Product information">
              <p className="text-xs text-muted-foreground">
                The info sections below the Buy button. Every product uses the
                store-wide copy from <b>Settings &gt; Product defaults</b> — only
                switch a block to custom when this piece genuinely differs (a
                preservation order that ships in 20 days, a non-returnable
                customised piece). One point per line.
              </p>
              <label className="block max-w-sm">
                <span className="label">Can this be returned?</span>
                <select
                  value={returnable === null ? "inherit" : returnable ? "yes" : "no"}
                  onChange={(e) =>
                    setReturnable(
                      e.target.value === "inherit"
                        ? null
                        : e.target.value === "yes"
                    )
                  }
                  className="input"
                >
                  <option value="inherit">
                    Use store default
                    {returnDefault === undefined
                      ? ""
                      : ` — currently ${returnDefault ? "returnable" : "not returnable"}`}
                  </option>
                  <option value="yes">Yes — returnable</option>
                  <option value="no">No — made to order, not returnable</option>
                </select>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Set in <b>Returns</b> for the whole store. A &quot;No&quot; here
                  hides the return request form for this piece only.
                </span>
              </label>

              <div className="grid gap-4 md:grid-cols-3">
                <InfoOverride
                  label="Materials & Care"
                  value={info.materialsCare}
                  fallback={infoDefaults?.materialsCare ?? ""}
                  onChange={(v) => setInfoField("materialsCare", v)}
                />
                <InfoOverride
                  label="Shipping & Delivery"
                  value={info.shippingInfo}
                  fallback={infoDefaults?.shippingInfo ?? ""}
                  onChange={(v) => setInfoField("shippingInfo", v)}
                />
                <InfoOverride
                  label="Returns & Refunds"
                  value={info.returnsInfo}
                  fallback={infoDefaults?.returnsInfo ?? ""}
                  onChange={(v) => setInfoField("returnsInfo", v)}
                />
              </div>

              {/* ── Video links ── */}
              <div className="border-t border-border pt-4">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Video className="h-4 w-4" /> Video links
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Customer reviews, the making process, packaging — paste the link
                  straight from YouTube or Instagram and give it a title. They show
                  as a scrollable <b>Video previews</b> row under the info sections
                  on the product page. Shorts and Reels are framed portrait
                  automatically.
                </p>

                {videos.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {videos.map((v, i) => (
                      <div key={i} className="flex flex-wrap items-start gap-2">
                        <input
                          value={v.title}
                          onChange={(e) => setVideoField(i, "title", e.target.value)}
                          className="input h-9 w-full sm:w-[13rem]"
                          placeholder="Title (e.g. Packaging walkthrough)"
                        />
                        <input
                          value={v.url}
                          onChange={(e) => setVideoField(i, "url", e.target.value)}
                          className="input h-9 flex-1"
                          placeholder="https://youtube.com/… or https://instagram.com/reel/…"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setVideos((prev) => prev.filter((_, idx) => idx !== i))
                          }
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-danger/10 hover:text-danger"
                          title="Remove this video"
                          aria-label="Remove video"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setVideos((prev) => [...prev, { title: "", url: "" }])}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  <Plus className="h-3.5 w-3.5" /> Add video link
                </button>
                {videos.length === 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    No videos — the Video previews row is hidden on this product.
                  </p>
                )}
              </div>
            </Card>
          </div>

          <Card title="Organisation">
            <label className="block">
              <span className="label">Category *</span>
              <select
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
            </label>

            <label className="block">
              <span className="label">Subcategory (optional)</span>
              <select
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
              <span className="mt-1 block text-xs text-muted-foreground">
                Group this product under e.g. <b>Oversized Tees</b>. Leave as
                None for a one-off that should show on the category page directly.
              </span>
            </label>

            <label className="block">
              <span className="label">Secondary category (optional)</span>
              <select
                value={form.secondaryCategory}
                onChange={(e) => set("secondaryCategory", e.target.value)}
                className="input"
              >
                <option value="">None</option>
                {categories.filter((c) => c !== form.category).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-muted-foreground">
                Also list this piece under a second category (e.g. a gift item).
              </span>
            </label>

            <Toggle
              label="Featured on homepage"
              icon={<Star className="h-4 w-4" />}
              checked={form.isFeatured}
              onChange={(v) => set("isFeatured", v)}
            />
            <Toggle
              label="Active (visible in shop)"
              checked={form.isActive}
              onChange={(v) => set("isActive", v)}
            />
          </Card>


          <Card title="Checkout modes">
            <p className="text-xs text-muted-foreground">
              Choose which payment options this product offers at checkout.
              At least one must be selected.
            </p>
            {([
              { mode: "prepaid" as Mode, label: "Prepaid — Pay Online (full amount)" },
              { mode: "cod" as Mode, label: "Cash on Delivery" },
              { mode: "partial" as Mode, label: "Advance Payment (advance online + COD)" },
              { mode: "direct" as Mode, label: "Customised Order (pay to owner, non-refundable)" },
            ] as { mode: Mode; label: string }[]).map(({ mode, label }) => (
              <label key={mode} className="flex items-center gap-3 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={paymentModes.includes(mode)}
                  onChange={() => toggleMode(mode)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                {label}
              </label>
            ))}
            {paymentModes.includes("partial") && (
              <label className="block">
                <span className="label">Advance % (for partial mode)</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={advancePercent}
                  onChange={(e) => setAdvancePercent(e.target.value)}
                  className="input"
                  placeholder="e.g. 30  (30% online, 70% on delivery)"
                />
              </label>
            )}
          </Card>

          <div className="lg:col-span-2">
            <Card title="Shipping settings & Parcel size">
              <p className="text-xs text-muted-foreground">
                Configure how shipping is charged for this product.
                Used when creating a NimbusPost shipment or calculating fees at checkout.
              </p>

              <label className="block mb-4">
                <span className="label">Shipping Type</span>
                <select
                  value={shipping.shippingType}
                  onChange={(e) => setShippingField("shippingType", e.target.value)}
                  className="input bg-card"
                >
                  <option value="free">Free Shipping (Always ₹0)</option>
                  <option value="fixed">Fixed Shipping (Flat rate per qty)</option>
                  <option value="nimbus">NimbusAPI + Markup (Dynamic calculation)</option>
                </select>
              </label>

              {shipping.shippingType === "fixed" && (
                <label className="block mb-4">
                  <span className="label">Fixed Shipping Fee (₹ per qty)</span>
                  <input
                    type="number"
                    min={0}
                    value={shipping.shippingFee}
                    onChange={(e) => setShippingField("shippingFee", e.target.value)}
                    className="input"
                  />
                </label>
              )}

              {shipping.shippingType === "nimbus" && (
                <label className="block mb-4">
                  <span className="label">Shipping Markup (₹ added to API rate per qty)</span>
                  <input
                    type="number"
                    min={0}
                    value={shipping.shippingMarkup}
                    onChange={(e) => setShippingField("shippingMarkup", e.target.value)}
                    className="input"
                  />
                </label>
              )}

              <p className="text-xs text-muted-foreground mb-2 mt-4">
                Dimensions and weight. Weight is per unit (multiplied by quantity).
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="label">Weight (grams)</span>
                  <input
                    type="number"
                    min={1}
                    value={parcel.weightGrams}
                    onChange={(e) => setParcelField("weightGrams", e.target.value)}
                    className="input"
                    placeholder="e.g. 500"
                  />
                </label>
                <label className="block">
                  <span className="label">Length (cm)</span>
                  <input
                    type="number"
                    min={1}
                    value={parcel.lengthCm}
                    onChange={(e) => setParcelField("lengthCm", e.target.value)}
                    className="input"
                    placeholder="e.g. 15"
                  />
                </label>
                <label className="block">
                  <span className="label">Breadth (cm)</span>
                  <input
                    type="number"
                    min={1}
                    value={parcel.breadthCm}
                    onChange={(e) => setParcelField("breadthCm", e.target.value)}
                    className="input"
                    placeholder="e.g. 15"
                  />
                </label>
                <label className="block">
                  <span className="label">Height (cm)</span>
                  <input
                    type="number"
                    min={1}
                    value={parcel.heightCm}
                    onChange={(e) => setParcelField("heightCm", e.target.value)}
                    className="input"
                    placeholder="e.g. 10"
                  />
                </label>
              </div>
            </Card>
          </div>
        </div>

      {/* ── Tab bar ── */}
      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px rounded-t-lg border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-accent text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Price & Stock ── */}
      {tab === "pricing" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Pricing & stock">
            <label className="block">
              <span className="label">Price (₹) *</span>
              <input
                type="number"
                min={0}
                value={form.price}
                onChange={(e) => set("price", e.target.value)}
                className="input"
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                {hasVariants
                  ? "Base price — inherited by any variant set to \"Use Product Price\"."
                  : "The product's selling price."}
              </span>
            </label>

            {hasVariants && (
              <div className="rounded-xl border border-border bg-muted/40 px-4 py-3">
                <span className="label">Product price (from variants)</span>
                <p className="text-lg font-semibold">{formatINR(effectivePrice)}</p>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Lowest price across available combinations — shown to shoppers as
                  the &ldquo;from&rdquo; price.
                </span>
              </div>
            )}

            <label className="block">
              <span className="label">Discount %</span>
              <div className="relative">
                <input
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
              <span className="mt-1 block text-xs text-muted-foreground">
                Shows a &ldquo;Save X%&rdquo; badge. We store the implied original
                price ({formatINR(effectivePrice)} at{" "}
                {Math.min(99, Math.max(0, Number(form.discount) || 0))}% off ={" "}
                {(() => {
                  const p = Math.max(0, Math.round(effectivePrice));
                  const d = Math.min(99, Math.max(0, Number(form.discount) || 0));
                  return formatINR(d > 0 ? Math.round(p / (1 - d / 100)) : p);
                })()}
                ). Leave 0 for no discount.
              </span>
            </label>

            <label className="block">
              <span className="label">Stock *</span>
              <input
                type="number"
                min={0}
                value={form.stock}
                onChange={(e) => set("stock", e.target.value)}
                className="input"
              />
              {hasVariants && (
                <span className="mt-1 block text-xs text-muted-foreground">
                  Default stock — variants with a blank stock inherit this number.
                </span>
              )}
            </label>
          </Card>
        </div>
      )}

      {/* ── Options & Variants ── */}
      {tab === "optvar" && (
        <Card title="Options">
          <p className="-mt-1 text-xs text-muted-foreground">
            Let customers choose e.g. <b>Size</b> or <b>Vatki</b>.{" "}
            {useVariants ? (
              <>
                Prices and stock come from the <b>Price &amp; Stock</b> tab; photos
                from the <b>Media</b> tab.
              </>
            ) : (
              <>Each choice can add to the price (leave 0 for no change).</>
            )}
          </p>

          {options.map((group, gi) => (
            <div key={gi} className="rounded-xl border border-border p-3.5">
              <div className="flex items-center gap-2">
                <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  value={group.name}
                  onChange={(e) => setGroupName(gi, e.target.value)}
                  className="input h-9"
                  placeholder="Option name (e.g. Size, Type, Shape)"
                />
                <button
                  type="button"
                  onClick={() => removeOptionGroup(gi)}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-danger/10 hover:text-danger"
                  title="Remove this option"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-3 space-y-2 pl-6">
                {group.choices.map((choice, ci) => (
                  <div key={ci} className="flex flex-wrap items-center gap-2">
                    <input
                      value={choice.label}
                      onChange={(e) => setChoice(gi, ci, { label: e.target.value })}
                      className="input h-9 min-w-[8rem] flex-1"
                      placeholder="Choice (e.g. 4 inch)"
                    />
                    {!useVariants && (
                      <div className="relative w-28 shrink-0">
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
                          className="input h-9 pl-8"
                          placeholder="0"
                          title="Extra price for this choice"
                        />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeChoice(gi, ci)}
                      disabled={group.choices.length <= 1}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-30"
                      title="Remove choice"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addChoice(gi)}
                  className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
                >
                  <Plus className="h-3.5 w-3.5" /> Add choice
                </button>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addOptionGroup}
            className="inline-flex items-center gap-2 rounded-full border border-dashed border-border px-4 py-2.5 text-sm hover:bg-muted"
          >
            <Plus className="h-4 w-4" /> Add an option (Size, Type…)
          </button>

          {combos.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {combos.length} combination{combos.length !== 1 ? "s" : ""} generated
              from these options. Set each one&apos;s price, stock and availability
              in the <b>Price &amp; Stock</b> tab.
            </p>
          )}
        </Card>
      )}

      {/* ── Price & Stock: the per-combination table (renders in the same tab
          as the base pricing card above). ── */}
      {tab === "pricing" && (
            <Card title="Variant pricing & stock">
              {optionMatrix.length === 0 ? (
                <p className="rounded-lg bg-muted/60 px-4 py-3 text-xs text-muted-foreground">
                  Add at least one option (with choices) in the <b>Options</b> tab to
                  create variants.
                </p>
              ) : (
                <>
                  <div className="-mt-1 flex flex-wrap items-start justify-between gap-3">
                    <p className="max-w-md text-xs text-muted-foreground">
                      Give every combination (e.g. <b>4 inch</b> + <b>1 vatki</b>) its
                      own price and stock, and mark which ones you actually make.
                      Unavailable combos are greyed out for customers.
                    </p>
                    <Toggle
                      label={useVariants ? "On" : "Off"}
                      checked={useVariants}
                      onChange={setUseVariants}
                    />
                  </div>

                  {useVariants && (
                    <div className="space-y-4">
                      {/* Filter */}
                      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-muted/30 p-3">
                        <span className="w-full text-xs font-medium text-muted-foreground">
                          Filter combinations
                        </span>
                        {optionMatrix.map((g) => (
                          <label key={g.name} className="block">
                            <span className="mb-0.5 block text-[11px] text-muted-foreground">
                              {g.name}
                            </span>
                            <select
                              value={variantFilter[g.name] ?? ""}
                              onChange={(e) =>
                                setVariantFilter((prev) => ({
                                  ...prev,
                                  [g.name]: e.target.value,
                                }))
                              }
                              className="input h-9"
                            >
                              <option value="">All</option>
                              {g.values.map((val) => (
                                <option key={val} value={val}>
                                  {val}
                                </option>
                              ))}
                            </select>
                          </label>
                        ))}
                        {Object.values(variantFilter).some(Boolean) && (
                          <button
                            type="button"
                            onClick={() => setVariantFilter({})}
                            className="h-9 rounded-lg px-3 text-xs text-muted-foreground underline hover:text-foreground"
                          >
                            Clear filters
                          </button>
                        )}
                      </div>

                      {/* Bulk update */}
                      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-muted/30 p-3">
                        <span className="w-full text-xs font-medium text-muted-foreground">
                          Bulk update the {filteredCombos.length} shown combination
                          {filteredCombos.length !== 1 ? "s" : ""}
                        </span>
                        <label className="block">
                          <span className="mb-0.5 block text-[11px] text-muted-foreground">Price (₹)</span>
                          <input
                            type="number"
                            min={0}
                            value={bulk.price}
                            onChange={(e) => setBulk((b) => ({ ...b, price: e.target.value }))}
                            className="input h-9 w-28"
                            placeholder="—"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-0.5 block text-[11px] text-muted-foreground">Stock</span>
                          <input
                            type="number"
                            min={0}
                            value={bulk.stock}
                            onChange={(e) => setBulk((b) => ({ ...b, stock: e.target.value }))}
                            className="input h-9 w-24"
                            placeholder="—"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-0.5 block text-[11px] text-muted-foreground">Availability</span>
                          <select
                            value={bulk.available}
                            onChange={(e) => setBulk((b) => ({ ...b, available: e.target.value }))}
                            className="input h-9"
                          >
                            <option value="">No change</option>
                            <option value="yes">Available</option>
                            <option value="no">Unavailable</option>
                          </select>
                        </label>
                        <Button type="button" variant="outline" size="sm" onClick={applyBulk}>
                          Apply
                        </Button>
                      </div>

                      {/* Table */}
                      <div className="overflow-x-auto rounded-xl border border-border">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                              <th className="px-3 py-2.5 font-medium">Combination</th>
                              <th className="w-20 px-3 py-2.5 text-center font-medium">
                                Available
                              </th>
                              <th className="w-28 px-3 py-2.5 text-center font-medium">
                                Use base price
                              </th>
                              <th className="w-32 px-3 py-2.5 font-medium">Price (₹)</th>
                              <th className="w-28 px-3 py-2.5 font-medium">Stock</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {filteredCombos.map((combo) => {
                              const key = comboKey(combo);
                              const v = variantOf(key);
                              const useBase = v.price === "";
                              return (
                                <tr key={key} className={v.available ? "" : "opacity-50"}>
                                  <td className="px-3 py-2 align-top">
                                    <div className="flex flex-wrap items-center gap-1.5 pt-1.5">
                                      {Object.entries(combo).map(([name, value]) => (
                                        <span
                                          key={name}
                                          className="rounded-full bg-muted px-2.5 py-0.5 text-xs"
                                          title={name}
                                        >
                                          {value}
                                        </span>
                                      ))}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-center align-top">
                                    <input
                                      type="checkbox"
                                      checked={v.available}
                                      onChange={(e) =>
                                        setVariantField(key, {
                                          available: e.target.checked,
                                        })
                                      }
                                      className="mt-2 h-4 w-4 accent-[var(--accent)]"
                                      title="Do you make this combination?"
                                    />
                                  </td>
                                  <td className="px-3 py-2 text-center align-top">
                                    <input
                                      type="checkbox"
                                      checked={useBase}
                                      onChange={(e) =>
                                        setVariantField(key, {
                                          price: e.target.checked ? "" : String(base || 0),
                                        })
                                      }
                                      disabled={!v.available}
                                      className="mt-2 h-4 w-4 accent-[var(--accent)]"
                                      title="Inherit the product base price"
                                    />
                                  </td>
                                  <td className="px-3 py-2 align-top">
                                    <div className="relative">
                                      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                        ₹
                                      </span>
                                      <input
                                        type="number"
                                        min={0}
                                        value={v.price}
                                        onChange={(e) =>
                                          setVariantField(key, { price: e.target.value })
                                        }
                                        className="input h-9 pl-6"
                                        placeholder={form.price || "0"}
                                        disabled={!v.available || useBase}
                                      />
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 align-top">
                                    <input
                                      type="number"
                                      min={0}
                                      value={v.stock}
                                      onChange={(e) =>
                                        setVariantField(key, { stock: e.target.value })
                                      }
                                      className="input h-9"
                                      placeholder={form.stock || "0"}
                                      disabled={!v.available}
                                      title="Blank inherits the product stock"
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Showing {filteredCombos.length} of {combos.length}. Blank price →
                        base price ({formatINR(base)}); blank stock → product stock.
                      </p>
                    </div>
                  )}
                </>
              )}
            </Card>
          )}

      {/* ── Media ── */}
      {tab === "media" && (
        <Card title="Media">
          <p className="-mt-1 mb-4 text-xs text-muted-foreground">
            The only place this product&apos;s photos live. Galleries are filed by
            one option&apos;s values (the <b>Image Controller</b>) rather than by
            every combination, so you assign photos once per value — every
            combination sharing that value reuses them.
          </p>
          <VariantMediaTab
            options={options}
            visualOptionName={imageDrivingOption}
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
      <div className="flex gap-3">
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

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h2 className="mb-4 font-serif text-lg">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

/**
 * One product-page info block: inherit the store default (null) or override it
 * with this product's own copy. Switching to custom seeds the textarea with the
 * default so the admin edits from it rather than starting on a blank box;
 * switching back to default discards the custom text (that's the point — there's
 * no half state where both exist and you can't tell which is live).
 */
function InfoOverride({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  /** null = inherit the store default. */
  value: string | null;
  /** The store default, shown read-only while inheriting. */
  fallback: string;
  onChange: (next: string | null) => void;
}) {
  const custom = value !== null;
  const shown = custom ? value : fallback;
  const points = shown.split("\n").filter((l) => l.trim()).length;

  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <button
          type="button"
          onClick={() => onChange(custom ? null : fallback)}
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
            custom
              ? "bg-accent/10 text-accent hover:bg-accent/20"
              : "bg-muted text-muted-foreground hover:bg-muted/70"
          }`}
        >
          {custom ? "Using custom — revert" : "Store default"}
        </button>
      </div>

      <textarea
        rows={5}
        value={shown}
        readOnly={!custom}
        onChange={(e) => onChange(e.target.value)}
        placeholder="One point per line"
        className={`input mt-2 resize-y font-mono text-xs leading-relaxed ${
          custom ? "" : "cursor-not-allowed opacity-60"
        }`}
      />

      <p className="mt-1 text-[11px] text-muted-foreground">
        {points === 0
          ? "Empty — this section is hidden on the product page."
          : `${points} bullet${points === 1 ? "" : "s"}`}
        {!custom && " · edit under Settings > Product defaults"}
      </p>
    </div>
  );
}

function Toggle({
  label,
  icon,
  checked,
  onChange,
}: {
  label: string;
  icon?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between rounded-xl border border-border px-4 py-3 text-sm"
    >
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      <span
        className={`relative h-6 w-11 rounded-full transition-colors ${
          checked ? "bg-accent" : "bg-muted-foreground/30"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            checked ? "left-0.5 translate-x-5" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
