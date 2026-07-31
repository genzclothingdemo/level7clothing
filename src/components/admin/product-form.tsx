"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { toast } from "sonner";
import { Loader2, Upload, X, LinkIcon, Star, Plus, Trash2, GripVertical, ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createProduct, updateProduct } from "@/app/actions/admin";
import { allCombinations, comboKey } from "@/lib/options";
import { formatINR } from "@/lib/utils";
import type { ProductDTO, ProductOption } from "@/lib/types";

type Props = { product?: ProductDTO; categories: string[] };

export function ProductForm({ product, categories }: Props) {
  const router = useRouter();
  const editing = !!product;
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [form, setForm] = useState({
    name: product?.name ?? "",
    category: product?.category ?? categories[0] ?? "",
    secondaryCategory: product?.secondaryCategory ?? "",
    price: product?.price?.toString() ?? "",
    compareAtPrice: product?.compareAtPrice?.toString() ?? "",
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
  const [images, setImages] = useState<string[]>(product?.images ?? []);
  const [urlInput, setUrlInput] = useState("");
  // Index of the image currently being dragged (for reordering).
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [options, setOptions] = useState<ProductOption[]>(
    product?.options ?? []
  );

  // ---- Variants (Flipkart-style: price / availability / photos per combo) ----
  type VariantEntry = { available: boolean; price: string; images: string[] };
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
          map[comboKey(v.combo)] = {
            available: v.available,
            price: String(v.price),
            images: v.images ?? [],
          };
        }
      } else if (product?.variantPrices?.length) {
        // Migrate the older price-only matrix.
        for (const v of product.variantPrices) {
          map[comboKey(v.combo)] = {
            available: true,
            price: String(v.price),
            images: [],
          };
        }
      }
      return map;
    }
  );

  // All combinations of the current options (recomputed as options change).
  // Trim to match how options are cleaned on save, so combo keys line up.
  const combos = useMemo(
    () =>
      allCombinations(
        options
          .map((g) => ({
            name: g.name.trim(),
            choices: g.choices
              .filter((c) => c.label.trim())
              .map((c) => ({ ...c, label: c.label.trim() })),
          }))
          .filter((g) => g.name && g.choices.length > 0)
      ),
    [options]
  );

  function variantOf(key: string): VariantEntry {
    return variantMap[key] ?? { available: true, price: "", images: [] };
  }
  function setVariantField(key: string, patch: Partial<VariantEntry>) {
    setVariantMap((prev) => ({
      ...prev,
      [key]: { ...variantOf(key), ...patch },
    }));
  }
  function toggleVariantImage(key: string, url: string) {
    const cur = variantOf(key);
    const has = cur.images.includes(url);
    // Keep images in the product's image order for consistency.
    const next = has
      ? cur.images.filter((u) => u !== url)
      : images.filter((u) => cur.images.includes(u) || u === url);
    setVariantField(key, { images: next });
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

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const data = await res.json();
        if (res.ok && data.url) {
          setImages((prev) => [...prev, data.url]);
        } else {
          toast.error(data.error || "Upload failed");
        }
      }
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  function addUrl() {
    const url = urlInput.trim();
    if (!url) return;
    setImages((prev) => [...prev, url]);
    setUrlInput("");
  }

  function removeImage(i: number) {
    setImages((prev) => prev.filter((_, idx) => idx !== i));
  }

  // Move an image from one position to another (used by drag-drop and arrows).
  function moveImage(from: number, to: number) {
    setImages((prev) => {
      if (to < 0 || to >= prev.length || from === to) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function onImageDrop(target: number) {
    if (dragIndex !== null) moveImage(dragIndex, target);
    setDragIndex(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

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

    // Build the variant matrix (only when the toggle is on). Each combination
    // gets a price, availability and its own photos. Blank price → base price.
    const base = Number(form.price || 0);
    const variants =
      useVariants && combos.length > 0
        ? combos.map((combo) => {
            const v = variantOf(comboKey(combo));
            const price = v.price === "" ? base : Number(v.price) || 0;
            return {
              combo,
              price,
              available: v.available,
              images: v.images,
            };
          })
        : [];

    const payload = {
      name: form.name,
      category: form.category,
      secondaryCategory: form.secondaryCategory || null,
      options: cleanOptions,
      variantPrices: [], // superseded by `variants`
      variants,
      price: Number(form.price || 0),
      compareAtPrice: form.compareAtPrice ? Number(form.compareAtPrice) : null,
      stock: Number(form.stock || 0),
      description: form.description,
      tags: form.tags
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
      images,
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
    };

    const res = editing
      ? await updateProduct(product!.id, payload)
      : await createProduct(payload);

    setSaving(false);
    if (res.ok) {
      toast.success(editing ? "Product updated" : "Product created");
      router.push("/admin/products");
      router.refresh();
    } else {
      toast.error(res.error || "Could not save");
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-8 lg:grid-cols-[1fr_340px]">
      {/* Main */}
      <div className="space-y-6">
        <Card title="Product details">
          <label className="block">
            <span className="label">Name *</span>
            <input
              required
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              className="input"
              placeholder="LEVEL7 Core Unisex Oversized Hoodie"
            />
          </label>
          <label className="block">
            <span className="label">Description *</span>
            <textarea
              required
              rows={5}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              className="input resize-none"
            />
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

        <Card title="Images">
          {images.length > 0 && (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {images.map((img, i) => (
                <div
                  key={`${img}-${i}`}
                  draggable
                  onDragStart={() => setDragIndex(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onImageDrop(i)}
                  onDragEnd={() => setDragIndex(null)}
                  className={`group relative aspect-square cursor-move overflow-hidden rounded-xl border bg-muted transition-all ${
                    dragIndex === i
                      ? "border-accent opacity-40 ring-2 ring-accent"
                      : "border-border"
                  }`}
                >
                  <Image
                    src={img}
                    alt={`Image ${i + 1}`}
                    fill
                    sizes="120px"
                    className="pointer-events-none object-cover"
                  />
                  {i === 0 && (
                    <span className="absolute left-1 top-1 rounded-full bg-accent px-1.5 py-0.5 text-[10px] text-accent-foreground">
                      Cover
                    </span>
                  )}

                  {/* Drag handle hint */}
                  <span className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100">
                    <GripVertical className="h-3.5 w-3.5" />
                  </span>

                  {/* Reorder + remove controls (touch-friendly fallback for drag) */}
                  <div className="absolute inset-x-1 bottom-1 flex items-center justify-between opacity-0 transition-opacity group-hover:opacity-100">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => moveImage(i, i - 1)}
                        disabled={i === 0}
                        className="grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white disabled:opacity-30"
                        aria-label="Move left"
                        title="Move left"
                      >
                        <ArrowLeft className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveImage(i, i + 1)}
                        disabled={i === images.length - 1}
                        className="grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white disabled:opacity-30"
                        aria-label="Move right"
                        title="Move right"
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      className="grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white hover:bg-danger"
                      aria-label="Remove"
                      title="Remove"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm hover:bg-muted">
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Upload
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={onUpload}
                className="hidden"
                disabled={uploading}
              />
            </label>
            <div className="flex flex-1 items-center gap-2">
              <div className="relative flex-1">
                <LinkIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addUrl();
                    }
                  }}
                  className="input pl-9"
                  placeholder="…or paste an image URL"
                />
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addUrl}>
                Add
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Drag photos to reorder them (or use the arrows on hover). The first
            image is used as the cover. Upload needs Vercel Blob configured;
            pasting an image URL always works.
          </p>
        </Card>

        <Card title="Options & variants">
          <p className="-mt-1 text-xs text-muted-foreground">
            Let customers choose e.g. <b>Size</b> or <b>Vatki</b>.{" "}
            {useVariants ? (
              <>
                Prices, availability and photos come from the{" "}
                <b>Variants</b> table below.
              </>
            ) : (
              <>Each choice can add to the price (leave 0 for no change).</>
            )}
          </p>

          {options.map((group, gi) => (
            <div
              key={gi}
              className="rounded-xl border border-border p-3.5"
            >
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
        </Card>

        {combos.length > 1 && (
          <Card title="Variants (price · availability · photos)">
            <div className="-mt-1 flex flex-wrap items-start justify-between gap-3">
              <p className="max-w-md text-xs text-muted-foreground">
                Give every combination (e.g. <b>4 inch</b> + <b>1 vatki</b>) its
                own price, mark which ones you actually make, and pick the
                photos that show for it. Unavailable combos are greyed out for
                customers. Turn off for simple add-on pricing.
              </p>
              <Toggle
                label={useVariants ? "On" : "Off"}
                checked={useVariants}
                onChange={setUseVariants}
              />
            </div>

            {useVariants && (
              <div className="space-y-3">
                {images.length === 0 && (
                  <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                    Upload photos above first — then you can assign them to each
                    variant here.
                  </p>
                )}
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                        <th className="px-3 py-2.5 font-medium">Combination</th>
                        <th className="w-20 px-3 py-2.5 text-center font-medium">
                          Available
                        </th>
                        <th className="w-32 px-3 py-2.5 font-medium">Price (₹)</th>
                        <th className="px-3 py-2.5 font-medium">Photos</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {combos.map((combo) => {
                        const key = comboKey(combo);
                        const v = variantOf(key);
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
                                  disabled={!v.available}
                                />
                              </div>
                            </td>
                            <td className="px-3 py-2 align-top">
                              {images.length === 0 ? (
                                <span className="text-xs text-muted-foreground">
                                  —
                                </span>
                              ) : (
                                <div className="flex flex-wrap gap-1.5 py-0.5">
                                  {images.map((img, idx) => {
                                    const on = v.images.includes(img);
                                    return (
                                      <button
                                        key={img}
                                        type="button"
                                        onClick={() =>
                                          toggleVariantImage(key, img)
                                        }
                                        className={`relative h-10 w-10 overflow-hidden rounded-md border-2 transition-all ${
                                          on
                                            ? "border-accent"
                                            : "border-transparent opacity-50 hover:opacity-100"
                                        }`}
                                        title={`Photo ${idx + 1}${
                                          on ? " (shown)" : ""
                                        }`}
                                      >
                                        <Image
                                          src={img}
                                          alt={`Photo ${idx + 1}`}
                                          fill
                                          sizes="40px"
                                          className="object-cover"
                                        />
                                        {on && (
                                          <span className="absolute inset-0 grid place-items-center bg-accent/30">
                                            <Check className="h-3.5 w-3.5 text-white drop-shadow" />
                                          </span>
                                        )}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground">
                  Blank price → base price ({formatINR(Number(form.price || 0))}).
                  No photos on a variant → the product’s main photos are shown.
                </p>
              </div>
            )}
          </Card>
        )}
      </div>

      {/* Sidebar */}
      <div className="space-y-6">
        <Card title="Pricing & stock">
          <label className="block">
            <span className="label">Price (₹) *</span>
            <input
              required
              type="number"
              min={0}
              value={form.price}
              onChange={(e) => set("price", e.target.value)}
              className="input"
            />
          </label>
          <label className="block">
            <span className="label">Compare-at price (₹)</span>
            <input
              type="number"
              min={0}
              value={form.compareAtPrice}
              onChange={(e) => set("compareAtPrice", e.target.value)}
              className="input"
              placeholder="Optional — shows a discount"
            />
          </label>
          <label className="block">
            <span className="label">Stock *</span>
            <input
              required
              type="number"
              min={0}
              value={form.stock}
              onChange={(e) => set("stock", e.target.value)}
              className="input"
            />
          </label>
        </Card>

        <Card title="Organisation">
          <label className="block">
            <span className="label">Category *</span>
            <select
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
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

        <div className="flex gap-3">
          <Button type="submit" disabled={saving} className="flex-1" size="lg">
            {saving ? (
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
