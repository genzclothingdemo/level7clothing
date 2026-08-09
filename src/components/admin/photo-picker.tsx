"use client";

/**
 * PhotoPicker — modal for choosing images from the Media Library, mirroring the
 * standalone Media Library page's filter UX so admins learn one set of controls.
 *
 * Layout: left filter sidebar (Source · Usage · Subcategory · Variant Attribute
 * · Variant Value · Roles · Tags), top search + refresh toolbar, grid of
 * photos, "Load more" pagination, footer with selection count + Done.
 *
 * Filters are applied client-side against a paged fetch of `/api/admin/media`
 * (same endpoint MediaLibrary uses). Smart defaults from `preferVariantValue`
 * and `preferSubcategory` pre-select the corresponding sidebar filter when the
 * picker opens, so opening it from a variant gallery lands on that variant's
 * photos with a single click to clear.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import {
  Check,
  HardDrive,
  Images,
  Loader2,
  RefreshCw,
  Search,
  Tag,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// A single photo row — same shape MediaLibrary uses. `tags` and `roles` can
// come back null from the API, so callers must coerce to arrays before use.
type Photo = {
  id: string;
  url: string;
  file: string;
  alt?: string | null;
  category: string;
  group: string;
  source: "repo" | "blob" | "external";
  tags: string[];
  roles: string[];
  size?: number;
  width?: number;
  height?: number;
  createdAt: string;
  variantAttribute?: string | null;
  variantValue?: string | null;
  subcategoryName?: string | null;
};

type PhotoUse = { kind: string; id: string; name: string; slot?: string };
type Library = { photos: Photo[]; usage: Record<string, PhotoUse[]>; total?: number };

type TaxSubcategory = { name: string; slug: string };
type TaxCategory = { name: string; slug: string; subcategories: TaxSubcategory[] };
type Taxonomy = {
  categories: TaxCategory[];
  variantAttributes: Record<string, string[]>;
};

const PAGE_SIZE = 100;

/** Force JSON `null` tags/roles into arrays so `.includes`/`.forEach` never crash. */
function normalizePhotos(rows: unknown): Photo[] {
  return (Array.isArray(rows) ? rows : []).map((p: any) => ({
    ...p,
    tags: Array.isArray(p?.tags) ? p.tags : [],
    roles: Array.isArray(p?.roles) ? p.roles : [],
  })) as Photo[];
}

export function PhotoPicker({
  selected,
  onChange,
  max,
  /** Pre-selects Subcategory in the sidebar. */
  preferCategory,
  /** Pre-selects Variant Value in the sidebar (empty string = "Common"). */
  preferVariantValue,
  /** Pre-selects Subcategory in the sidebar (alias for preferCategory when both are set). */
  preferSubcategory,
  label = "Choose from photo library",
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  max?: number;
  preferCategory?: string;
  preferVariantValue?: string;
  preferSubcategory?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [library, setLibrary] = useState<Library | null>(null);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  // Filter state — same set as MediaLibrary's left sidebar.
  const [q, setQ] = useState("");
  const [filterSource, setFilterSource] = useState<string>("All");
  const [filterUsage, setFilterUsage] = useState<string>("All");
  const [filterCategory, setFilterCategory] = useState<string>("All");
  const [filterSubcategory, setFilterSubcategory] = useState<string>("All");
  const [filterVariantAttr, setFilterVariantAttr] = useState<string>("All");
  const [filterVariantValue, setFilterVariantValue] = useState<string>("All");
  const [filterRole, setFilterRole] = useState<string>("All");
  const [filterTag, setFilterTag] = useState<string>("All");

  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);

  /** Fetch first page and replace whatever's on screen. */
  async function fetchFirstPage() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/media?page=1&limit=${PAGE_SIZE}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load photos");
      setLibrary({
        photos: normalizePhotos(data.photos),
        usage: data.usage ?? {},
        total: data.total,
      });
      setTotal(data.total ?? data.photos?.length ?? 0);
      setPage(1);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  /** Fetch next page and append. */
  async function loadMore() {
    const next = page + 1;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/media?page=${next}&limit=${PAGE_SIZE}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load photos");
      const more = normalizePhotos(data.photos);
      setLibrary((prev) =>
        prev
          ? {
              photos: [...prev.photos, ...more],
              usage: { ...prev.usage, ...(data.usage ?? {}) },
              total: data.total,
            }
          : { photos: more, usage: data.usage ?? {}, total: data.total }
      );
      setTotal(data.total ?? total);
      setPage(next);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Load library + taxonomy when the picker opens (only the first time).
  useEffect(() => {
    if (!open) return;
    if (!library) void fetchFirstPage();
    if (!taxonomy) {
      fetch("/api/admin/taxonomy")
        .then((r) => (r.ok ? r.json() : null))
        .then((t) => t && setTaxonomy(t))
        .catch(() => {
          /* dropdowns degrade to whatever the loaded photos carry */
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Apply smart defaults on open. Only sets once per open — the admin can
  // clear them from the sidebar and browse freely.
  const primedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      primedRef.current = false;
      return;
    }
    if (primedRef.current) return;
    primedRef.current = true;

    if (preferVariantValue !== undefined) {
      // "" = the "common" bucket (no variant tag). Sidebar shows "Common" for it.
      setFilterVariantValue(preferVariantValue === "" ? "__common__" : preferVariantValue);
    }
    const sub = preferSubcategory ?? preferCategory;
    if (sub) setFilterSubcategory(sub);
  }, [open, preferVariantValue, preferCategory, preferSubcategory]);

  // ---- Derived option lists ----
  const allCategories = useMemo(() => {
    const set = new Set<string>();
    (library?.photos ?? []).forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set).sort();
  }, [library]);

  const allSubcategories = useMemo(() => {
    const set = new Set<string>();
    (taxonomy?.categories ?? []).forEach((c) =>
      c.subcategories.forEach((s) => set.add(s.name))
    );
    (library?.photos ?? []).forEach((p) => {
      if (p.subcategoryName) set.add(p.subcategoryName);
    });
    return Array.from(set).sort();
  }, [taxonomy, library]);

  const allVariantAttrs = useMemo(() => {
    const set = new Set<string>();
    Object.keys(taxonomy?.variantAttributes ?? {}).forEach((a) => set.add(a));
    (library?.photos ?? []).forEach((p) => {
      if (p.variantAttribute) set.add(p.variantAttribute);
    });
    return Array.from(set).sort();
  }, [taxonomy, library]);

  const allVariantValues = useMemo(() => {
    const set = new Set<string>();
    const attrs = taxonomy?.variantAttributes ?? {};
    if (filterVariantAttr !== "All") {
      (attrs[filterVariantAttr] ?? []).forEach((v) => set.add(v));
    } else {
      Object.values(attrs).forEach((list) => list.forEach((v) => set.add(v)));
    }
    (library?.photos ?? []).forEach((p) => {
      if (!p.variantValue) return;
      if (filterVariantAttr !== "All" && p.variantAttribute !== filterVariantAttr) return;
      set.add(p.variantValue);
    });
    return Array.from(set).sort();
  }, [taxonomy, library, filterVariantAttr]);

  const allRoles = useMemo(() => {
    const set = new Set<string>();
    (library?.photos ?? []).forEach((p) => p.roles.forEach((r) => set.add(r)));
    return Array.from(set).sort();
  }, [library]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    (library?.photos ?? []).forEach((p) => p.tags.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [library]);

  // ---- Client-side filtering — same rules as MediaLibrary ----
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (library?.photos ?? []).filter((p) => {
      if (filterSource !== "All" && p.source !== filterSource) return false;
      if (filterCategory !== "All" && p.category !== filterCategory) return false;
      if (filterSubcategory !== "All" && p.subcategoryName !== filterSubcategory) return false;
      if (filterVariantAttr !== "All" && p.variantAttribute !== filterVariantAttr) return false;
      if (filterVariantValue !== "All") {
        // "__common__" sentinel matches photos without any variant value.
        if (filterVariantValue === "__common__") {
          if (p.variantValue) return false;
        } else if (p.variantValue !== filterVariantValue) return false;
      }
      if (filterRole !== "All" && !p.roles.includes(filterRole)) return false;
      if (filterTag !== "All" && !p.tags.includes(filterTag)) return false;

      const uses = library?.usage[p.url] || [];
      if (filterUsage === "Unused" && uses.length > 0) return false;
      if (filterUsage === "Used" && uses.length === 0) return false;

      if (!needle) return true;
      const hay = `${p.file} ${p.alt ?? ""} ${p.category} ${p.group} ${p.subcategoryName ?? ""} ${p.variantValue ?? ""} ${p.tags.join(" ")} ${p.roles.join(" ")}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [
    library,
    q,
    filterSource,
    filterCategory,
    filterSubcategory,
    filterVariantAttr,
    filterVariantValue,
    filterRole,
    filterTag,
    filterUsage,
  ]);

  const atLimit = max !== undefined && selected.length >= max;

  function toggle(url: string) {
    if (selected.includes(url)) {
      onChange(selected.filter((u) => u !== url));
      return;
    }
    if (atLimit) {
      toast.error(`You can pick at most ${max} photo${max === 1 ? "" : "s"}.`);
      return;
    }
    onChange([...selected, url]);
  }

  function clearFilters() {
    setQ("");
    setFilterSource("All");
    setFilterUsage("All");
    setFilterCategory("All");
    setFilterSubcategory("All");
    setFilterVariantAttr("All");
    setFilterVariantValue("All");
    setFilterRole("All");
    setFilterTag("All");
  }

  const activeFilterCount =
    (filterSource !== "All" ? 1 : 0) +
    (filterUsage !== "All" ? 1 : 0) +
    (filterCategory !== "All" ? 1 : 0) +
    (filterSubcategory !== "All" ? 1 : 0) +
    (filterVariantAttr !== "All" ? 1 : 0) +
    (filterVariantValue !== "All" ? 1 : 0) +
    (filterRole !== "All" ? 1 : 0) +
    (filterTag !== "All" ? 1 : 0);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm hover:bg-muted"
      >
        <Images className="h-4 w-4" />
        {label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4 shrink-0">
              <div className="min-w-0">
                <h3 className="font-serif text-lg">Photo library</h3>
                <p className="truncate text-xs text-muted-foreground">
                  {library
                    ? `${total || library.photos.length} photos total`
                    : "Loading…"}
                  {max !== undefined && ` · pick up to ${max}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full border border-border text-muted-foreground hover:bg-muted"
                aria-label="Close photo library"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex min-h-0 flex-1">
              {/* ── Left Filter Sidebar ── */}
              <aside className="w-60 shrink-0 overflow-y-auto border-r border-border bg-muted/20 p-4 space-y-5 hidden md:block">
                <div className="flex items-center justify-between">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Filters
                    {activeFilterCount > 0 && (
                      <span className="ml-1.5 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">
                        {activeFilterCount}
                      </span>
                    )}
                  </h4>
                  {activeFilterCount > 0 && (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Source */}
                <FilterGroup title="Source">
                  {["All", "repo", "blob", "external"].map((src) => (
                    <SidebarPill
                      key={src}
                      active={filterSource === src}
                      onClick={() => setFilterSource(src)}
                    >
                      <HardDrive className="h-3 w-3 opacity-60" />
                      {src === "All"
                        ? "All sources"
                        : src === "repo"
                        ? "Public folder"
                        : src === "blob"
                        ? "Blob storage"
                        : "External URLs"}
                    </SidebarPill>
                  ))}
                </FilterGroup>

                {/* Usage */}
                <FilterGroup title="Usage">
                  {["All", "Used", "Unused"].map((u) => (
                    <SidebarPill
                      key={u}
                      active={filterUsage === u}
                      onClick={() => setFilterUsage(u)}
                    >
                      {u}
                    </SidebarPill>
                  ))}
                </FilterGroup>

                {/* Category */}
                {allCategories.length > 0 && (
                  <FilterGroup title="Category">
                    <select
                      value={filterCategory}
                      onChange={(e) => setFilterCategory(e.target.value)}
                      className="input h-8 w-full px-2 text-xs"
                    >
                      <option value="All">All categories</option>
                      {allCategories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </FilterGroup>
                )}

                {/* Subcategory */}
                {allSubcategories.length > 0 && (
                  <FilterGroup title="Subcategory">
                    <select
                      value={filterSubcategory}
                      onChange={(e) => setFilterSubcategory(e.target.value)}
                      className="input h-8 w-full px-2 text-xs"
                    >
                      <option value="All">All subcategories</option>
                      {allSubcategories.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </FilterGroup>
                )}

                {/* Variant Attribute */}
                {allVariantAttrs.length > 0 && (
                  <FilterGroup title="Variant Attribute">
                    <select
                      value={filterVariantAttr}
                      onChange={(e) => {
                        setFilterVariantAttr(e.target.value);
                        setFilterVariantValue("All");
                      }}
                      className="input h-8 w-full px-2 text-xs"
                    >
                      <option value="All">All attributes</option>
                      {allVariantAttrs.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </FilterGroup>
                )}

                {/* Variant Value */}
                {(allVariantValues.length > 0 || preferVariantValue !== undefined) && (
                  <FilterGroup title="Variant Value">
                    <select
                      value={filterVariantValue}
                      onChange={(e) => setFilterVariantValue(e.target.value)}
                      className="input h-8 w-full px-2 text-xs"
                    >
                      <option value="All">All values</option>
                      <option value="__common__">Common (no variant)</option>
                      {allVariantValues.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </FilterGroup>
                )}

                {/* Roles */}
                {allRoles.length > 0 && (
                  <FilterGroup title="Roles">
                    <SidebarPill
                      active={filterRole === "All"}
                      onClick={() => setFilterRole("All")}
                    >
                      All roles
                    </SidebarPill>
                    {allRoles.map((r) => (
                      <SidebarPill
                        key={r}
                        active={filterRole === r}
                        onClick={() => setFilterRole(r)}
                      >
                        {r}
                      </SidebarPill>
                    ))}
                  </FilterGroup>
                )}

                {/* Tags */}
                {allTags.length > 0 && (
                  <FilterGroup title="Tags">
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => setFilterTag("All")}
                        className={cn(
                          "cursor-pointer rounded-full border px-2.5 py-1 text-xs transition-colors",
                          filterTag === "All"
                            ? "border-foreground bg-foreground text-background"
                            : "border-border bg-card text-muted-foreground hover:bg-muted"
                        )}
                      >
                        All
                      </button>
                      {allTags.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setFilterTag(t)}
                          className={cn(
                            "cursor-pointer rounded-full border px-2.5 py-1 text-xs transition-colors",
                            filterTag === t
                              ? "border-foreground bg-foreground text-background"
                              : "border-border bg-card text-muted-foreground hover:bg-muted"
                          )}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </FilterGroup>
                )}
              </aside>

              {/* ── Main grid ── */}
              <div className="flex min-w-0 flex-1 flex-col">
                {/* Toolbar */}
                <div className="flex items-center gap-3 border-b border-border px-5 py-3 shrink-0">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      className="input h-9 w-full pl-9"
                      placeholder="Search photos, tags, roles…"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void fetchFirstPage()}
                    disabled={loading}
                  >
                    <RefreshCw
                      className={cn("h-4 w-4", loading && "animate-spin")}
                    />
                    <span className="ml-2 hidden sm:inline">Refresh</span>
                  </Button>
                </div>

                {/* Grid */}
                <div className="flex-1 overflow-y-auto px-5 py-4">
                  {loading && !library && (
                    <div className="grid place-items-center py-16 text-muted-foreground">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  )}

                  {!loading && visible.length === 0 && library && (
                    <div className="grid place-items-center py-16 text-center text-sm text-muted-foreground">
                      <p>No photos match your filters.</p>
                      {activeFilterCount > 0 && (
                        <button
                          type="button"
                          onClick={clearFilters}
                          className="mt-2 text-xs underline hover:text-foreground"
                        >
                          Clear all filters
                        </button>
                      )}
                    </div>
                  )}

                  {visible.length > 0 && (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                      {visible.map((p) => {
                        const on = selected.includes(p.url);
                        const uses = library?.usage[p.url] ?? [];
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => toggle(p.url)}
                            title={
                              uses.length
                                ? `${p.file} — used by ${uses.map((u) => u.name).join(", ")}`
                                : p.file
                            }
                            className={cn(
                              "group relative aspect-square cursor-pointer overflow-hidden rounded-xl border-2 bg-muted transition-all",
                              on
                                ? "border-accent ring-2 ring-accent/30"
                                : "border-transparent hover:border-border"
                            )}
                          >
                            <Image
                              src={decodeURI(p.url)}
                              alt={p.alt || p.file}
                              fill
                              sizes="(max-width: 640px) 50vw, 20vw"
                              className="object-cover"
                            />
                            {on && (
                              <span className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-accent text-accent-foreground shadow">
                                <Check className="h-3.5 w-3.5" />
                              </span>
                            )}
                            {/* Info strip on hover */}
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-2 pt-6">
                              <p className="truncate text-[11px] text-white drop-shadow">
                                {p.alt || p.file.split("/").pop()}
                              </p>
                              <div className="mt-0.5 flex items-center gap-1.5">
                                {p.variantValue && (
                                  <span className="inline-flex items-center gap-0.5 rounded-full bg-accent/80 px-1.5 py-0.5 text-[9px] font-semibold text-white backdrop-blur">
                                    <Tag className="h-2.5 w-2.5" />
                                    {p.variantValue}
                                  </span>
                                )}
                                {uses.length > 0 && (
                                  <span className="rounded-full bg-white/25 px-1.5 py-0.5 text-[9px] text-white backdrop-blur">
                                    in {uses.length}
                                  </span>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Load more */}
                  {library && library.photos.length < total && (
                    <div className="mt-6 flex flex-col items-center gap-2">
                      <p className="text-xs text-muted-foreground">
                        {visible.length} shown · {library.photos.length} of {total} loaded
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void loadMore()}
                        disabled={loading}
                      >
                        {loading && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
                        Load more
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3.5 shrink-0">
              <p className="text-xs text-muted-foreground">
                {selected.length} selected. Removing a photo here never deletes
                the file — you can add it back, or to another product, anytime.
              </p>
              <Button type="button" size="sm" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---- Sidebar building blocks ----

function FilterGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h5 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h5>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function SidebarPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        active
          ? "bg-accent/15 font-medium text-accent"
          : "text-muted-foreground hover:bg-muted"
      )}
    >
      {children}
    </button>
  );
}
