"use client";

/**
 * ProductFilters — the bar above the admin product table.
 *
 * It used to open into a three-column grid of labelled fields, roughly 260px of
 * chrome pushing the table below the fold on a laptop and off the screen on a
 * phone. The rewrite keeps every filter and removes the height:
 *
 *  - **One wrapping row, no stacked labels.** Each select names itself in its
 *    own placeholder option ("All categories", "Any status"), so the label and
 *    the control are the same 40px instead of two stacked boxes.
 *  - **Collapsed by default, with a count badge.** The row only appears when
 *    the admin asks for it, and the badge says how many filters are live while
 *    it is shut — so closing it never hides state.
 *  - **A set filter is tinted violet**, which is the other half of not hiding
 *    state: on a row of six selects, "which of these is doing something?" has
 *    to be answerable at a glance.
 */

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { CountBadge, MiniButton } from "@/components/admin/form-kit";
import { cn } from "@/lib/utils";

type SubcategoryOption = { id: string; name: string; categoryName: string };

type FilterState = {
  q: string;
  category: string;
  subcategoryId: string;
  status: string;
  stock: string;
  sort: string;
};

function fromParams(params: URLSearchParams): FilterState {
  return {
    q: params.get("q") ?? "",
    category: params.get("category") ?? "",
    subcategoryId: params.get("subcategoryId") ?? "",
    status: params.get("status") ?? "",
    stock: params.get("stock") ?? "",
    sort: params.get("sort") ?? "newest",
  };
}

export function ProductFilters({
  categories,
  subcategories = [],
}: {
  categories: string[];
  subcategories?: SubcategoryOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<FilterState>(() => fromParams(params));

  const activeCount = [
    f.category,
    f.subcategoryId,
    f.status,
    f.stock,
    f.sort !== "newest" ? f.sort : "",
  ].filter(Boolean).length;

  // Narrow the group list to the chosen category, when there is one.
  const groupChoices = f.category
    ? subcategories.filter((s) => s.categoryName === f.category)
    : subcategories;

  function set<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    setF((prev) => ({ ...prev, [key]: value }));
  }

  function setCategory(category: string) {
    setF((prev) => {
      const keep = subcategories.some(
        (s) =>
          s.id === prev.subcategoryId &&
          (!category || s.categoryName === category)
      );
      return { ...prev, category, subcategoryId: keep ? prev.subcategoryId : "" };
    });
  }

  function apply() {
    const next = new URLSearchParams();
    if (f.q) next.set("q", f.q.trim());
    if (f.category) next.set("category", f.category);
    if (f.subcategoryId) next.set("subcategoryId", f.subcategoryId);
    if (f.status) next.set("status", f.status);
    if (f.stock) next.set("stock", f.stock);
    if (f.sort && f.sort !== "newest") next.set("sort", f.sort);
    router.replace(`${pathname}?${next.toString()}`);
  }

  function clearAll() {
    setF({
      q: "",
      category: "",
      subcategoryId: "",
      status: "",
      stock: "",
      sort: "newest",
    });
    router.replace(pathname);
  }

  /** Shared look for the compact selects — tinted while the filter is live. */
  const select = (live: boolean) =>
    cn(
      "input h-11 w-full min-w-0 sm:h-10 sm:w-auto sm:max-w-[13rem]",
      live && "border-accent text-accent"
    );

  return (
    <div className="rounded-2xl border border-border bg-card">
      {/* Always visible: search + the Filters disclosure. */}
      <div className="flex flex-wrap items-center gap-2 p-2.5">
        <div className="relative min-w-[10rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={f.q}
            onChange={(e) => set("q", e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && apply()}
            aria-label="Search products"
            placeholder="Search by name, tag or description…"
            className="input h-11 pl-9 sm:h-10"
          />
        </div>

        <MiniButton
          onClick={() => setOpen((v) => !v)}
          active={open || activeCount > 0}
          aria-expanded={open}
          className="h-11 sm:h-10"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filters
          {activeCount > 0 && <CountBadge>{activeCount}</CountBadge>}
        </MiniButton>

        <button
          type="button"
          onClick={apply}
          className="inline-flex h-11 shrink-0 cursor-pointer items-center rounded-lg bg-foreground px-4 text-[11px] font-medium uppercase tracking-widest text-background transition-opacity hover:opacity-90 sm:h-10"
        >
          Search
        </button>
      </div>

      {open && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border p-2.5">
          <select
            value={f.category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Filter by category"
            className={select(!!f.category)}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            value={f.subcategoryId}
            onChange={(e) => set("subcategoryId", e.target.value)}
            aria-label="Filter by subcategory"
            disabled={subcategories.length === 0}
            className={select(!!f.subcategoryId)}
          >
            <option value="">All subcategories</option>
            <option value="__none">Not in any subcategory</option>
            {groupChoices.map((s) => (
              <option key={s.id} value={s.id}>
                {f.category ? s.name : `${s.categoryName} › ${s.name}`}
              </option>
            ))}
          </select>

          <select
            value={f.status}
            onChange={(e) => set("status", e.target.value)}
            aria-label="Filter by status"
            className={select(!!f.status)}
          >
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="hidden">Hidden</option>
          </select>

          <select
            value={f.stock}
            onChange={(e) => set("stock", e.target.value)}
            aria-label="Filter by stock level"
            className={select(!!f.stock)}
          >
            <option value="">Any stock level</option>
            <option value="instock">In stock ({">"}0)</option>
            <option value="lowstock">Low stock (≤ 5)</option>
            <option value="outofstock">Out of stock (0)</option>
          </select>

          <select
            value={f.sort}
            onChange={(e) => set("sort", e.target.value)}
            aria-label="Sort products"
            className={select(f.sort !== "newest")}
          >
            <option value="newest">Newest first</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
            <option value="stock-asc">Stock: low to high</option>
            <option value="stock-desc">Stock: high to low</option>
          </select>

          <div className="ml-auto flex items-center gap-2">
            {(activeCount > 0 || f.q) && (
              <MiniButton onClick={clearAll} className="h-11 sm:h-10">
                <X className="h-3.5 w-3.5" /> Clear
              </MiniButton>
            )}
            <MiniButton onClick={apply} active className="h-11 sm:h-10">
              Apply
            </MiniButton>
          </div>
        </div>
      )}
    </div>
  );
}
