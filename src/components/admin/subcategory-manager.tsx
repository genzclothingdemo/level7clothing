"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  Edit2,
  ExternalLink,
  Image as ImageIcon,
  Layers,
  Loader2,
  Package,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhotoPicker } from "@/components/admin/photo-picker";
import { formatINR } from "@/lib/utils";
import {
  createSubcategory,
  deleteSubcategory,
  setProductSubcategory,
  updateSubcategory,
} from "@/app/actions/admin";

type Sub = {
  id: string;
  name: string;
  slug: string;
  images: string[];
  priceMin: number | null;
  priceMax: number | null;
  isActive: boolean;
  productCount: number;
  autoPriceMin: number;
  autoPriceMax: number;
  coverImages: string[];
};

type MiniProduct = {
  id: string;
  name: string;
  price: number;
  images: string[];
  isActive: boolean;
  subcategoryId: string | null;
};

type Draft = {
  name: string;
  images: string[];
  priceMin: string;
  priceMax: string;
  isActive: boolean;
};

const emptyDraft: Draft = {
  name: "",
  images: [],
  priceMin: "",
  priceMax: "",
  isActive: true,
};

export function SubcategoryManager({
  category,
  subcategories,
  products,
}: {
  category: { id: string; name: string };
  subcategories: Sub[];
  products: MiniProduct[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Which group's assign-products panel is open.
  const [assigningId, setAssigningId] = useState<string | null>(null);

  // Each section filters on its own, so narrowing the product list never hides
  // the subcategory you are editing.
  const [subQuery, setSubQuery] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState<string>("all");

  const loose = useMemo(
    () => products.filter((p) => !p.subcategoryId),
    [products]
  );
  const subById = useMemo(
    () => new Map(subcategories.map((s) => [s.id, s.name])),
    [subcategories]
  );

  const visibleSubs = useMemo(() => {
    const n = subQuery.trim().toLowerCase();
    return n
      ? subcategories.filter((s) => s.name.toLowerCase().includes(n))
      : subcategories;
  }, [subcategories, subQuery]);

  const visibleProducts = useMemo(() => {
    const n = productQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (n && !p.name.toLowerCase().includes(n)) return false;
      if (groupFilter === "all") return true;
      if (groupFilter === "__none") return !p.subcategoryId;
      return p.subcategoryId === groupFilter;
    });
  }, [products, productQuery, groupFilter]);

  function beginEdit(sub: Sub) {
    setAdding(false);
    setEditingId(sub.id);
    setDraft({
      name: sub.name,
      images: sub.images,
      priceMin: sub.priceMin?.toString() ?? "",
      priceMax: sub.priceMax?.toString() ?? "",
      isActive: sub.isActive,
    });
  }

  function closeForm() {
    setAdding(false);
    setEditingId(null);
    setDraft(emptyDraft);
  }

  function save() {
    if (!draft.name.trim()) {
      toast.error("Give the subcategory a name");
      return;
    }
    start(async () => {
      const payload = {
        categoryId: category.id,
        name: draft.name.trim(),
        images: draft.images,
        priceMin: draft.priceMin === "" ? null : Number(draft.priceMin),
        priceMax: draft.priceMax === "" ? null : Number(draft.priceMax),
        isActive: draft.isActive,
      };
      const res = editingId
        ? await updateSubcategory(editingId, payload)
        : await createSubcategory(payload);
      if (res.ok) {
        toast.success(editingId ? "Subcategory updated" : "Subcategory created");
        closeForm();
        router.refresh();
      } else {
        toast.error(res.error || "Could not save");
      }
    });
  }

  function remove(sub: Sub) {
    if (
      !confirm(
        `Delete the subcategory "${sub.name}"?\n\nIts ${sub.productCount} product(s) are NOT deleted — they will show directly on the ${category.name} page instead.`
      )
    )
      return;
    start(async () => {
      const res = await deleteSubcategory(sub.id);
      if (res.ok) {
        toast.success("Subcategory deleted");
        router.refresh();
      } else {
        toast.error(res.error || "Could not delete");
      }
    });
  }

  function assign(productId: string, subcategoryId: string | null) {
    start(async () => {
      const res = await setProductSubcategory(productId, subcategoryId);
      if (res.ok) router.refresh();
      else toast.error(res.error || "Could not move product");
    });
  }

  return (
    <div className="space-y-10">
      {/* ---------- Header ---------- */}
      <div>
        <Link
          href="/admin/categories"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> All categories
        </Link>
        <h1 className="mt-2 font-serif text-2xl">{category.name}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Subcategories are the groups shoppers see on this category page. A
          group with <b>2 or more</b> products shows as one tile (name, photo,
          price range); a group with <b>one</b> product shows as that product.
        </p>
      </div>

      {/* ---------- Section 1: subcategories (full CRUD) ---------- */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <h2 className="flex items-center gap-2 font-serif text-xl">
            <Layers className="h-5 w-5 text-muted-foreground" />
            Subcategories
            <span className="text-sm font-normal text-muted-foreground">
              ({subcategories.length})
            </span>
          </h2>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setEditingId(null);
              setDraft(emptyDraft);
              setAdding((v) => !v);
            }}
          >
            {adding ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {adding ? "Cancel" : "Add subcategory"}
          </Button>
        </div>

        {(adding || editingId) && (
          <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
            <h3 className="font-serif text-lg">
              {editingId ? "Edit subcategory" : "New subcategory"}
            </h3>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="label">Name *</span>
                <input
                  value={draft.name}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, name: e.target.value }))
                  }
                  className="input"
                  placeholder="e.g. Oversized Tees"
                />
              </label>
              <label className="flex items-center gap-2 self-end pb-3">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, isActive: e.target.checked }))
                  }
                  className="h-4 w-4"
                />
                <span className="text-sm">Visible on the store</span>
              </label>
            </div>

            <div>
              <span className="label">Price range (optional)</span>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min={0}
                  value={draft.priceMin}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, priceMin: e.target.value }))
                  }
                  className="input h-10 w-32"
                  placeholder="500"
                />
                <span className="text-muted-foreground">to</span>
                <input
                  type="number"
                  min={0}
                  value={draft.priceMax}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, priceMax: e.target.value }))
                  }
                  className="input h-10 w-32"
                  placeholder="2000"
                />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Leave both blank and the range is worked out from the products
                inside, so it stays correct on its own as you add or reprice
                pieces.
              </p>
            </div>

            <div>
              <span className="label">Cover photo (up to 2)</span>
              {draft.images.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-3">
                  {draft.images.map((img) => (
                    <div
                      key={img}
                      className="relative h-24 w-24 overflow-hidden rounded-xl border border-border bg-muted"
                    >
                      <Image
                        src={img}
                        alt=""
                        fill
                        sizes="96px"
                        className="object-cover"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            images: d.images.filter((u) => u !== img),
                          }))
                        }
                        className="absolute right-1 top-1 grid h-6 w-6 cursor-pointer place-items-center rounded-lg bg-black/65 text-white backdrop-blur"
                        title="Remove (the file itself is never deleted)"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <PhotoPicker
                selected={draft.images}
                onChange={(images) => setDraft((d) => ({ ...d, images }))}
                max={2}
                preferCategory={category.name}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Leave empty to reuse the first photo of the products inside — no
                need to pick the same picture twice.
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={closeForm}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={save} disabled={pending}>
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingId ? "Save changes" : "Create subcategory"}
              </Button>
            </div>
          </div>
        )}

        {subcategories.length > 1 && (
          <FilterBox
            value={subQuery}
            onChange={setSubQuery}
            placeholder="Filter subcategories…"
            matched={visibleSubs.length}
            total={subcategories.length}
            noun="subcategories"
          />
        )}

        {subcategories.length === 0 && !adding && (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center">
            <Layers className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-3 font-serif text-lg">No subcategories yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Add one — e.g. “Oversized Tees” — then assign the individual
              products to it. Until then, all {products.length} product(s) show
              directly on the {category.name} page.
            </p>
          </div>
        )}

        <div className="space-y-3">
          {visibleSubs.map((sub) => {
            const inside = products.filter((p) => p.subcategoryId === sub.id);
            const min = sub.priceMin ?? sub.autoPriceMin;
            const max = sub.priceMax ?? sub.autoPriceMax;
            const manual = sub.priceMin != null || sub.priceMax != null;
            const cover = sub.coverImages[0];

            return (
              <div
                key={sub.id}
                className="overflow-hidden rounded-2xl border border-border bg-card"
              >
                <div className="flex flex-wrap items-center gap-4 p-4">
                  <div className="relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-muted">
                    {cover ? (
                      <Image
                        src={cover}
                        alt={sub.name}
                        fill
                        sizes="64px"
                        className="object-cover"
                      />
                    ) : (
                      <ImageIcon className="h-5 w-5 text-muted-foreground/60" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{sub.name}</p>
                      {!sub.isActive && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          Hidden
                        </span>
                      )}
                      {sub.images.length === 0 && cover && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          Photo borrowed from product
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {sub.productCount === 0
                        ? "No products assigned — hidden from the store"
                        : `${sub.productCount} product${
                            sub.productCount === 1 ? "" : "s"
                          } · ${
                            min === max
                              ? formatINR(min)
                              : `${formatINR(min)} – ${formatINR(max)}`
                          }`}
                      {manual && sub.productCount > 0 && " (manual range)"}
                    </p>
                    {sub.productCount === 1 && (
                      <p className="mt-1 text-xs text-accent">
                        Only one product inside — the store shows that product
                        directly, not this group.
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setAssigningId((v) => (v === sub.id ? null : sub.id))
                      }
                      className="cursor-pointer rounded-full border border-border px-3.5 py-2 text-xs hover:bg-muted"
                    >
                      {assigningId === sub.id ? "Done" : "Assign products"}
                    </button>
                    <button
                      type="button"
                      onClick={() => beginEdit(sub)}
                      className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="Edit"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(sub)}
                      className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg border border-border text-muted-foreground hover:border-danger/20 hover:bg-danger/10 hover:text-danger"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {assigningId === sub.id && (
                  <div className="space-y-4 border-t border-border bg-muted/30 p-4">
                    <p className="text-xs text-muted-foreground">
                      Only products that already exist can be assigned. To create
                      a new piece, go to{" "}
                      <Link
                        href="/admin/products/new"
                        className="underline hover:text-foreground"
                      >
                        Admin → Products → Add product
                      </Link>
                      .
                    </p>

                    <div>
                      <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                        In this subcategory ({inside.length})
                      </p>
                      {inside.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Nothing here yet. Add products from the list below.
                        </p>
                      ) : (
                        <ul className="space-y-1.5">
                          {inside.map((p) => (
                            <ProductRow
                              key={p.id}
                              product={p}
                              actionLabel="Remove"
                              onAction={() => assign(p.id, null)}
                              disabled={pending}
                            />
                          ))}
                        </ul>
                      )}
                    </div>

                    <div>
                      <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                        Not in any subcategory ({loose.length})
                      </p>
                      {loose.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Every product in {category.name} is already grouped.
                        </p>
                      ) : (
                        <ul className="space-y-1.5">
                          {loose.map((p) => (
                            <ProductRow
                              key={p.id}
                              product={p}
                              actionLabel="Add"
                              onAction={() => assign(p.id, sub.id)}
                              disabled={pending}
                            />
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ---------- Section 2: products (read-only) ---------- */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <h2 className="flex items-center gap-2 font-serif text-xl">
            <Package className="h-5 w-5 text-muted-foreground" />
            Products in {category.name}
            <span className="text-sm font-normal text-muted-foreground">
              ({products.length})
            </span>
          </h2>
          <span className="rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground">
            Read-only — add and edit in Admin → Products
          </span>
        </div>

        {products.length > 0 && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[14rem] flex-1">
              <FilterBox
                value={productQuery}
                onChange={setProductQuery}
                placeholder="Filter products…"
                matched={visibleProducts.length}
                total={products.length}
                noun="products"
                hideCount
              />
            </div>
            <label className="block">
              <span className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">
                Subcategory
              </span>
              <select
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
                className="input h-10 w-56"
              >
                <option value="all">All</option>
                <option value="__none">Not in any subcategory</option>
                {subcategories.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="pb-3 text-xs text-muted-foreground">
              {visibleProducts.length} of {products.length}
            </p>
          </div>
        )}

        {visibleProducts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            {products.length === 0
              ? "No products in this category yet."
              : "No products match this filter."}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Product</th>
                    <th className="px-4 py-3 font-medium">Subcategory</th>
                    <th className="px-4 py-3 font-medium">Price</th>
                    <th className="px-4 py-3 font-medium text-right">Open</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibleProducts.map((p) => (
                    <tr key={p.id} className="hover:bg-muted/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-muted">
                            {p.images[0] && (
                              <Image
                                src={p.images[0]}
                                alt=""
                                fill
                                sizes="40px"
                                className="object-cover"
                              />
                            )}
                          </div>
                          <span className="min-w-0">
                            <span className="block truncate">{p.name}</span>
                            {!p.isActive && (
                              <span className="text-xs text-muted-foreground">
                                Hidden
                              </span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {p.subcategoryId ? (
                          <span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs text-foreground">
                            {subById.get(p.subcategoryId) ?? "—"}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Directly on category page
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">{formatINR(p.price)}</td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/admin/products/${p.id}/edit`}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          Edit <ExternalLink className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function FilterBox({
  value,
  onChange,
  placeholder,
  matched,
  total,
  noun,
  hideCount,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  matched: number;
  total: number;
  noun: string;
  hideCount?: boolean;
}) {
  return (
    <div>
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="input h-10 pl-9 pr-9"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted"
            aria-label="Clear filter"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {!hideCount && value.trim() && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {matched} of {total} {noun} match
        </p>
      )}
    </div>
  );
}

function ProductRow({
  product,
  actionLabel,
  onAction,
  disabled,
}: {
  product: MiniProduct;
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
}) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2">
      <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-muted">
        {product.images[0] && (
          <Image
            src={product.images[0]}
            alt=""
            fill
            sizes="40px"
            className="object-cover"
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{product.name}</p>
        <p className="text-xs text-muted-foreground">
          {formatINR(product.price)}
          {!product.isActive && " · hidden"}
        </p>
      </div>
      <button
        type="button"
        onClick={onAction}
        disabled={disabled}
        className="shrink-0 cursor-pointer rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
      >
        {actionLabel === "Add" ? (
          <Check className="mr-1 inline h-3 w-3" />
        ) : (
          <X className="mr-1 inline h-3 w-3" />
        )}
        {actionLabel}
      </button>
    </li>
  );
}
