"use client";

/**
 * MediaLibrary — Admin → Media.
 *
 * What changed and why, so it doesn't get "fixed" back:
 *
 * - **The left filter sidebar is gone.** Seven stacked filter groups (plus a
 *   localStorage preset manager) took a fixed 256px column, were hidden below
 *   `md` so phones had no filtering at all, and offered options that matched
 *   nothing. Filtering now lives in the shared, collapsible `MediaFilterBar`
 *   above the grid — same control set as the PhotoPicker, so there is one
 *   thing to learn.
 * - **Selection does something.** `selectedIds` used to drive nothing but a
 *   ring on the thumbnail. There is now a select-all that agrees with the
 *   active filters, an indeterminate partial state, a live readout, and bulk
 *   tag/delete.
 * - **"All" is spelled out.** The API is paged, so "select all" can only ever
 *   mean "every loaded photo that matches the filters". The bar says exactly
 *   that and offers to load the rest.
 * - **The details panel is a bottom sheet on phones** — conditionally
 *   rendered, fading in only, never parked offscreen with a transform (see the
 *   "Modal pattern" note in CLAUDE.md).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import {
  Check,
  HardDrive,
  Image as ImageIcon,
  Info,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/store/info-tip";
import {
  MediaFilterBar,
  NO_FILTERS,
  TriCheckbox,
  errorMessage,
  filterPhotos,
  normalizePhotos,
  photoFolder,
  photoLabel,
  safeSrc,
  selectionSummary,
  useFilterOptions,
  type MediaFilters,
  type MediaPhoto,
  type UsageMap,
} from "@/components/admin/media-filters";

type Library = { photos: MediaPhoto[]; usage: UsageMap };

// Classification options served by GET /api/admin/taxonomy.
type TaxSubcategory = { name: string; slug: string };
type TaxCategory = { name: string; slug: string; subcategories: TaxSubcategory[] };
// One product with its own variant attributes → values, used to scope the
// cascade so the Attribute/Value selects show only that product's options.
type TaxProduct = {
  id: string;
  name: string;
  category: string;
  subcategoryName: string | null;
  variantAttributes: Record<string, string[]>;
};
type Taxonomy = {
  categories: TaxCategory[];
  variantAttributes: Record<string, string[]>;
  products: TaxProduct[];
};

const PAGE_SIZE = 100;
/** Safety net for "Load all" — 20 pages is 2000 photos, far past this store. */
const MAX_AUTO_PAGES = 20;

/**
 * Build a <select> option list from `options`, de-duped and order-preserving,
 * that always includes the photo's currently-stored `current` value — so
 * pre-existing tags are never dropped from the dropdown or silently changed.
 */
function withCurrent(options: string[], current?: string | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of options) {
    if (o && !seen.has(o)) {
      seen.add(o);
      out.push(o);
    }
  }
  if (current && !seen.has(current)) out.push(current);
  return out;
}

export function MediaLibrary() {
  const [library, setLibrary] = useState<Library | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<MediaFilters>({ ...NO_FILTERS });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);

  // Classification dropdown options (categories + variant attribute values).
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
  // UI-only scoping category for the details panel: narrows the Subcategory
  // options. Does NOT persist (Media has no category column).
  const [catFilter, setCatFilter] = useState<string>("");
  // UI-only product scope for the details panel: picks which product's variant
  // attributes/values populate the cascade below. Does NOT persist (Media has
  // no product column) — it only narrows the Attribute/Value dropdowns.
  const [selectedProductId, setSelectedProductId] = useState<string>("");

  // Pagination — the API is capped at `PAGE_SIZE` per request.
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  // Upload / mutation plumbing
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  /* ------------------------------------------------------------------ */
  /*  Loading                                                            */
  /* ------------------------------------------------------------------ */

  /** Loads the first page of media, replacing whatever is on screen. */
  const fetchLibrary = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/media?page=1&limit=${PAGE_SIZE}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load photos");
      const photos = normalizePhotos(data.photos);
      setLibrary({ photos, usage: data.usage ?? {} });
      setTotal(data.total ?? photos.length);
      setPage(1);
    } catch (err) {
      toast.error(errorMessage(err, "Could not load photos"));
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Append the next `count` pages. One path for both "Load more" (1) and
   * "Load all" (the rest), so the merge logic only exists once.
   */
  const loadMore = useCallback(
    async (count = 1) => {
      setLoading(true);
      try {
        let current = page;
        let known = total;
        for (let i = 0; i < count && i < MAX_AUTO_PAGES; i++) {
          const next = current + 1;
          const res = await fetch(`/api/admin/media?page=${next}&limit=${PAGE_SIZE}`);
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Could not load photos");
          const more = normalizePhotos(data.photos);
          known = data.total ?? known;
          setLibrary((prev) =>
            prev
              ? {
                  photos: [...prev.photos, ...more],
                  usage: { ...prev.usage, ...(data.usage ?? {}) },
                }
              : { photos: more, usage: data.usage ?? {} }
          );
          setTotal(known);
          current = next;
          setPage(next);
          if (more.length === 0 || current * PAGE_SIZE >= known) break;
        }
      } catch (err) {
        toast.error(errorMessage(err, "Could not load photos"));
      } finally {
        setLoading(false);
      }
    },
    [page, total]
  );

  useEffect(() => {
    void fetchLibrary();
  }, [fetchLibrary]);

  // Load classification options once. Non-fatal if it fails — the panel just
  // falls back to whatever value the photo already carries.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/taxonomy");
        if (!res.ok) return;
        setTaxonomy(await res.json());
      } catch {
        /* ignore — dropdowns degrade to the stored value only */
      }
    })();
  }, []);

  /* ------------------------------------------------------------------ */
  /*  Filtering + selection                                              */
  /* ------------------------------------------------------------------ */

  const photos = useMemo(() => library?.photos ?? [], [library]);
  const usage = useMemo(() => library?.usage ?? {}, [library]);
  const options = useFilterOptions(photos);

  /** The filtered result set — the single definition of "shown". */
  const visible = useMemo(
    () => filterPhotos(photos, usage, filters),
    [photos, usage, filters]
  );

  const selectedInView = useMemo(
    () => visible.reduce((n, p) => n + (selectedIds.has(p.id) ? 1 : 0), 0),
    [visible, selectedIds]
  );
  const allInViewSelected = visible.length > 0 && selectedInView === visible.length;

  const loadedAll = photos.length >= total;
  const remaining = Math.max(0, total - photos.length);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /**
   * Select all — deliberately scoped to `visible`, i.e. exactly the photos the
   * active filters are showing, never the whole table. Unchecking removes only
   * those, so a selection made under a different filter survives.
   */
  const toggleAllShown = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allInViewSelected) visible.forEach((p) => next.delete(p.id));
      else visible.forEach((p) => next.add(p.id));
      return next;
    });
  };

  const selectedPhotos = useMemo(
    () => photos.filter((p) => selectedIds.has(p.id)),
    [photos, selectedIds]
  );

  /* ------------------------------------------------------------------ */
  /*  Details panel (tagging)                                            */
  /* ------------------------------------------------------------------ */

  const activePhoto = useMemo(
    () => (activePhotoId ? photos.find((p) => p.id === activePhotoId) ?? null : null),
    [activePhotoId, photos]
  );

  // Derive the scoping Category from the selected photo's subcategory whenever
  // the selection or taxonomy changes. `photos` is intentionally omitted so a
  // manual category choice survives subsequent subcategory edits (which mutate
  // the photo list but not the active photo id).
  useEffect(() => {
    setSelectedProductId(""); // new photo → drop any product scope
    if (!activePhotoId || !taxonomy) {
      setCatFilter("");
      return;
    }
    const photo = library?.photos.find((p) => p.id === activePhotoId);
    const sub = photo?.subcategoryName;
    const parent = sub
      ? taxonomy.categories.find((c) => c.subcategories.some((s) => s.name === sub))
      : undefined;
    setCatFilter(parent?.name ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePhotoId, taxonomy]);

  // Subcategory options = subcategories of the chosen Category, or ALL when no
  // category is scoped. Always keeps the photo's stored value selectable.
  const subcatOptions = useMemo(() => {
    const cats = taxonomy
      ? catFilter
        ? taxonomy.categories.filter((c) => c.name === catFilter)
        : taxonomy.categories
      : [];
    const names = cats.flatMap((c) => c.subcategories.map((s) => s.name));
    return withCurrent(names, activePhoto?.subcategoryName);
  }, [taxonomy, catFilter, activePhoto?.subcategoryName]);

  // The product chosen as the variant scope, resolved from taxonomy.products.
  const selectedProduct = useMemo(
    () => taxonomy?.products?.find((p) => p.id === selectedProductId) ?? null,
    [taxonomy, selectedProductId]
  );

  // Product-first flow: the Product select always offers EVERY product,
  // grouped by category, so the admin can start from the product they know.
  const productGroups = useMemo(() => {
    const all = [...(taxonomy?.products ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    const map = new Map<string, TaxProduct[]>();
    for (const p of all) {
      const key = p.category || "Uncategorised";
      const list = map.get(key);
      if (list) list.push(p);
      else map.set(key, [p]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [taxonomy]);

  // Variant attribute names: the scoped product's own keys when a product is
  // chosen, otherwise the global set auto-collected across all products.
  const attrOptions = useMemo(() => {
    const base = selectedProduct
      ? Object.keys(selectedProduct.variantAttributes)
      : taxonomy
        ? Object.keys(taxonomy.variantAttributes)
        : [];
    return withCurrent(base, activePhoto?.variantAttribute);
  }, [selectedProduct, taxonomy, activePhoto?.variantAttribute]);

  // Values for the currently-selected variant attribute — scoped to the chosen
  // product when set, else the global values for that attribute.
  const valueOptions = useMemo(() => {
    const attr = activePhoto?.variantAttribute || "";
    let base: string[] = [];
    if (attr) {
      if (selectedProduct) base = selectedProduct.variantAttributes[attr] ?? [];
      else if (taxonomy) base = taxonomy.variantAttributes[attr] ?? [];
    }
    return withCurrent(base, activePhoto?.variantValue);
  }, [selectedProduct, taxonomy, activePhoto?.variantAttribute, activePhoto?.variantValue]);

  /* ------------------------------------------------------------------ */
  /*  Mutations                                                          */
  /* ------------------------------------------------------------------ */

  /** Optimistically merge changes into local state so inputs stay responsive. */
  const mergeLocal = (id: string, updates: Partial<MediaPhoto>) => {
    setLibrary((prev) =>
      prev
        ? { ...prev, photos: prev.photos.map((p) => (p.id === id ? { ...p, ...updates } : p)) }
        : prev
    );
  };

  /** Persist metadata to the server. Only toasts on success when `notify` is set. */
  const persist = async (id: string, updates: Partial<MediaPhoto>, notify = false) => {
    try {
      const res = await fetch(`/api/admin/media/${id}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error("Failed to update");
      if (notify) toast.success("Updated");
      return true;
    } catch (err) {
      toast.error(errorMessage(err, "Could not update image"));
      return false;
    }
  };

  // Debounce metadata edits so typing "Pink" is one PATCH, not four.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ id: string; updates: Partial<MediaPhoto> } | null>(null);

  /** Updates local state immediately and debounces the PATCH by 500ms. */
  const editMeta = (id: string, updates: Partial<MediaPhoto>) => {
    mergeLocal(id, updates);
    const prev = pendingRef.current;
    pendingRef.current = {
      id,
      updates: prev && prev.id === id ? { ...prev.updates, ...updates } : updates,
    };
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const p = pendingRef.current;
      pendingRef.current = null;
      debounceRef.current = null;
      if (p) void persist(p.id, p.updates);
    }, 500);
  };

  /**
   * Product picked in the details panel: scope the variant dropdowns to it AND
   * auto-detect the photo's classification from the product itself.
   */
  const chooseProduct = (id: string) => {
    setSelectedProductId(id);
    if (!id || !activePhoto) return;
    const prod = taxonomy?.products?.find((p) => p.id === id);
    if (!prod) return;

    setCatFilter(prod.category || "");

    const updates: Partial<MediaPhoto> = {};
    if (prod.subcategoryName && prod.subcategoryName !== activePhoto.subcategoryName) {
      updates.subcategoryName = prod.subcategoryName;
    }
    const attrs = prod.variantAttributes ?? {};
    const curAttr = activePhoto.variantAttribute || "";
    if (curAttr && !(curAttr in attrs)) {
      // Stored attribute doesn't exist on this product — clear both.
      updates.variantAttribute = null;
      updates.variantValue = null;
    } else if (
      curAttr &&
      activePhoto.variantValue &&
      !(attrs[curAttr] ?? []).includes(activePhoto.variantValue)
    ) {
      // Attribute matches but the stored value isn't one of this product's.
      updates.variantValue = null;
    }
    if (Object.keys(updates).length > 0) editMeta(activePhoto.id, updates);
  };

  /** Sends each chosen file to /api/upload, then refreshes the library. */
  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    let ok = 0;
    for (const file of Array.from(files)) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Upload failed");
        ok++;
      } catch (err) {
        toast.error(`${file.name}: ${errorMessage(err, "Upload failed")}`);
      }
    }
    setUploading(false);
    if (ok > 0) toast.success(`Uploaded ${ok} image${ok !== 1 ? "s" : ""}`);
    await fetchLibrary();
  };

  /** Deletes a media row; surfaces the 409 "in use" message via toast. */
  const deletePhoto = async (id: string) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/media/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not delete image");
      toast.success("Image deleted");
      setActivePhotoId(null);
      await fetchLibrary();
    } catch (err) {
      toast.error(errorMessage(err, "Could not delete image"));
    } finally {
      setDeleting(false);
    }
  };

  /** Adds a role/tag to the active photo and persists it via PATCH. */
  const addTerm = (kind: "roles" | "tags") => {
    if (!activePhoto) return;
    const label = kind === "roles" ? "role (e.g. hero, thumbnail)" : "tag";
    const value = window.prompt(`Add ${label}`)?.trim();
    if (!value) return;
    const current = activePhoto[kind];
    if (current.includes(value)) return;
    const next = [...current, value];
    const update: Partial<MediaPhoto> = kind === "roles" ? { roles: next } : { tags: next };
    mergeLocal(activePhoto.id, update);
    void persist(activePhoto.id, update, true);
  };

  /** Removes a role/tag from the active photo and persists it via PATCH. */
  const removeTerm = (kind: "roles" | "tags", value: string) => {
    if (!activePhoto) return;
    const next = activePhoto[kind].filter((v) => v !== value);
    const update: Partial<MediaPhoto> = kind === "roles" ? { roles: next } : { tags: next };
    mergeLocal(activePhoto.id, update);
    void persist(activePhoto.id, update, true);
  };

  /* ---- Bulk actions on the selection ---- */

  const bulkAddTag = async () => {
    if (selectedPhotos.length === 0) return;
    const value = window.prompt(
      `Tag to add to ${selectedPhotos.length} selected photo${
        selectedPhotos.length === 1 ? "" : "s"
      }`
    )?.trim();
    if (!value) return;

    setBulkBusy(true);
    let ok = 0;
    let already = 0;
    for (const p of selectedPhotos) {
      if (p.tags.includes(value)) {
        already++;
        continue;
      }
      const next = [...p.tags, value];
      mergeLocal(p.id, { tags: next });
      if (await persist(p.id, { tags: next })) ok++;
    }
    setBulkBusy(false);

    // Spell out the "already had it" case — otherwise re-applying a tag to a
    // selection reads as "Tagged 0 photos", which looks like a failure.
    const parts: string[] = [];
    if (ok > 0) parts.push(`Tagged ${ok} photo${ok === 1 ? "" : "s"}`);
    if (already > 0) parts.push(`${already} already had it`);
    toast.success(`${parts.join(" · ")} — “${value}”`);
  };

  const bulkDelete = async () => {
    const inUse = selectedPhotos.filter((p) => (usage[p.url]?.length ?? 0) > 0);
    const free = selectedPhotos.filter((p) => (usage[p.url]?.length ?? 0) === 0);

    if (free.length === 0) {
      toast.error(
        "Every selected photo is in use by a product. Remove it from the product first."
      );
      return;
    }
    const warning =
      inUse.length > 0
        ? `\n\n${inUse.length} of them are in use and will be skipped.`
        : "";
    if (
      !window.confirm(
        `Permanently delete ${free.length} photo${free.length === 1 ? "" : "s"}?${warning}`
      )
    ) {
      return;
    }

    setBulkBusy(true);
    let ok = 0;
    for (const p of free) {
      try {
        const res = await fetch(`/api/admin/media/${p.id}`, { method: "DELETE" });
        if (res.ok) ok++;
      } catch {
        /* counted as a failure below */
      }
    }
    setBulkBusy(false);
    setSelectedIds(new Set());
    setActivePhotoId(null);
    if (ok > 0) toast.success(`Deleted ${ok} photo${ok === 1 ? "" : "s"}.`);
    if (ok < free.length) toast.error(`${free.length - ok} could not be deleted.`);
    await fetchLibrary();
  };

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */

  if (loading && !library) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">
        <RefreshCw className="mr-2 h-5 w-5 animate-spin" /> Loading library…
      </div>
    );
  }

  const activeUses = activePhoto ? usage[activePhoto.url] ?? [] : [];

  return (
    <div className="flex h-full min-w-0">
      {/* ── Main column ── */}
      <div className="flex min-w-0 flex-1 flex-col bg-muted/20">
        {/* Filters + library actions */}
        <div className="shrink-0 border-b border-border bg-card px-3 py-3 sm:px-5">
          <MediaFilterBar
            filters={filters}
            onChange={setFilters}
            options={options}
            actions={
              <>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  aria-label="Refresh library"
                  className="h-11 w-11 shrink-0 p-0 sm:w-auto sm:px-3.5"
                  onClick={() => void fetchLibrary()}
                  disabled={loading}
                >
                  <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                  <span className="hidden sm:inline">Refresh</span>
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={async (e) => {
                    await handleUpload(e.target.files);
                    e.target.value = "";
                  }}
                />
                <Button
                  size="sm"
                  type="button"
                  aria-label="Upload images"
                  className="h-11 w-11 shrink-0 p-0 sm:w-auto sm:px-3.5"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  <span className="hidden sm:inline">
                    {uploading ? "Uploading…" : "Upload"}
                  </span>
                </Button>
              </>
            }
          />
        </div>

        {/* Selection bar — select-all always agrees with the filters above. */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-card px-3 py-1 sm:px-5">
          <TriCheckbox
            checked={allInViewSelected}
            indeterminate={selectedInView > 0}
            onChange={toggleAllShown}
            label={
              <span className="text-muted-foreground">
                {visible.length === 0
                  ? "Nothing to select"
                  : selectionSummary({
                      selectedInView,
                      inView: visible.length,
                      // Counted from the loaded photos, not `selectedIds.size`,
                      // so an id left over from a deleted row can't inflate it.
                      totalSelected: selectedPhotos.length,
                    })}
              </span>
            }
          />

          <span className="flex items-center text-[11px] text-muted-foreground">
            {loadedAll
              ? `all ${total} loaded`
              : `${photos.length} of ${total} loaded`}
            <InfoTip term="What “all” selects" className="shrink-0">
              The tick box selects every photo the current filters are showing —
              not the whole library. Photos are fetched a page at a time, so it
              can only reach the {photos.length} loaded so far
              {loadedAll ? "" : `; “Load all ${total}” pulls in the rest`}.
            </InfoTip>
          </span>

          {selectedPhotos.length > 0 && (
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={bulkAddTag}
                disabled={bulkBusy}
                className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-xs hover:bg-muted disabled:opacity-50 sm:min-h-8"
              >
                Add tag
              </button>
              <button
                type="button"
                onClick={bulkDelete}
                disabled={bulkBusy}
                className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-danger/40 px-3 text-xs text-danger hover:bg-danger/10 disabled:opacity-50 sm:min-h-8"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="inline-flex min-h-11 cursor-pointer items-center rounded-lg px-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground sm:min-h-8"
              >
                Clear
              </button>
            </div>
          )}
        </div>

        {/* Gallery */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          {visible.length === 0 ? (
            <div className="py-20 text-center text-muted-foreground">
              <ImageIcon className="mx-auto mb-3 h-12 w-12 opacity-20" />
              <p className="text-sm">
                {photos.length === 0
                  ? "No images yet. Use Upload to add your first one."
                  : "No photos match your filters."}
              </p>
              {photos.length > 0 && (
                <button
                  type="button"
                  onClick={() => setFilters({ ...NO_FILTERS })}
                  className="mt-2 min-h-11 cursor-pointer text-xs underline hover:text-foreground"
                >
                  Clear all filters
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {visible.map((photo) => {
                  const uses = usage[photo.url] ?? [];
                  const isSelected = selectedIds.has(photo.id);
                  const isActive = activePhotoId === photo.id;

                  return (
                    <div
                      key={photo.id}
                      className={cn(
                        "group relative aspect-square overflow-hidden rounded-lg border bg-card transition-colors",
                        isActive ? "border-accent ring-2 ring-accent" : "border-border",
                        isSelected && "border-primary ring-2 ring-primary"
                      )}
                    >
                      <Image
                        src={safeSrc(photo.url)}
                        alt={photoLabel(photo)}
                        fill
                        className="object-cover"
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 16vw"
                      />

                      {/* Whole tile opens the details panel. A real button so
                          it's reachable by keyboard; the tick box sits above
                          it rather than nested inside it (nested buttons are
                          invalid HTML). */}
                      <button
                        type="button"
                        onClick={() => setActivePhotoId(photo.id)}
                        aria-label={`Details for ${photoLabel(photo)}`}
                        className="absolute inset-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />

                      <button
                        type="button"
                        onClick={() => toggleSelect(photo.id)}
                        aria-pressed={isSelected}
                        aria-label={`${isSelected ? "Deselect" : "Select"} ${photoLabel(photo)}`}
                        className="absolute left-0 top-0 z-10 grid h-11 w-11 cursor-pointer place-items-center md:h-9 md:w-9"
                      >
                        <span
                          className={cn(
                            "grid h-6 w-6 place-items-center rounded-md border transition-colors",
                            isSelected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-white/70 bg-background/80 text-transparent group-hover:text-muted-foreground"
                          )}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </span>
                      </button>

                      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-2 pt-8">
                        <p className="truncate text-[11px] text-white drop-shadow-md">
                          {photoLabel(photo)}
                        </p>
                        <div className="mt-1 flex items-center gap-1.5">
                          {uses.length > 0 && (
                            <span className="rounded px-1.5 py-0.5 text-[10px] text-white/90 backdrop-blur-sm bg-white/20">
                              {uses.length} use{uses.length !== 1 && "s"}
                            </span>
                          )}
                          {photo.roles.length > 0 && (
                            <span className="truncate rounded bg-accent/80 px-1.5 py-0.5 text-[10px] text-white backdrop-blur-sm">
                              {photo.roles[0]}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {!loadedAll && (
                <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                  <p className="w-full text-center text-xs text-muted-foreground">
                    {remaining} more photo{remaining === 1 ? "" : "s"} not loaded yet
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => void loadMore(1)}
                    disabled={loading}
                  >
                    {loading && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
                    Load more
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => void loadMore(MAX_AUTO_PAGES)}
                    disabled={loading}
                  >
                    Load all {total}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Details panel ──
          A docked column from `md` up, a bottom sheet below it. Mounted only
          while a photo is active and faded in only — never parked offscreen
          with a transform. */}
      {activePhoto && (
        <>
          <button
            type="button"
            aria-label="Close image details"
            onClick={() => setActivePhotoId(null)}
            className="fixed inset-0 z-40 cursor-default bg-black/50 animate-[fadeIn_0.2s_ease-out_both] md:hidden"
          />
          <aside
            className={cn(
              "fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col overflow-y-auto rounded-t-2xl border border-border bg-card",
              "md:static md:z-auto md:h-full md:max-h-none md:w-80 md:shrink-0 md:rounded-none md:border-0 md:border-l",
              "animate-[fadeIn_0.2s_ease-out_both] md:animate-none"
            )}
          >
            <div className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4">
              <h3 className="text-sm font-medium">Image details</h3>
              <button
                type="button"
                onClick={() => setActivePhotoId(null)}
                aria-label="Close image details"
                className="grid h-11 w-11 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-6 p-4">
              <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-muted/30">
                <Image
                  src={safeSrc(activePhoto.url)}
                  alt={photoLabel(activePhoto)}
                  fill
                  sizes="320px"
                  className="object-contain"
                />
              </div>

              <div className="space-y-4 text-sm">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Image name
                  </label>
                  <input
                    type="text"
                    value={activePhoto.alt ?? ""}
                    placeholder={activePhoto.file.split("/").pop()}
                    onChange={(e) =>
                      editMeta(activePhoto.id, { alt: e.target.value || null })
                    }
                    className="input"
                  />
                </div>

                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Filename</p>
                  <p className="break-all">{activePhoto.file.split("/").pop()}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="min-w-0">
                    <p className="mb-1 text-xs text-muted-foreground">Stored in</p>
                    <p className="flex items-center gap-1.5 break-all">
                      <HardDrive className="h-3.5 w-3.5 shrink-0" />
                      {photoFolder(activePhoto)}
                    </p>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">Added</p>
                    <p>{new Date(activePhoto.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="mb-3 flex items-center text-xs text-muted-foreground">
                    Tagging
                    <InfoTip term="Tagging">
                      Optional labels that make a photo easier to find later.
                      Pick the Product first and the Category, Subcategory and
                      variant options fill themselves in from it; or set each one
                      by hand. Nothing here changes where the photo is used.
                    </InfoTip>
                  </p>
                  <div className="space-y-3">
                    <div>
                      {/* Product-first: choosing a product auto-fills Category +
                          Subcategory and scopes the Variant selects. The product
                          itself is not persisted (Media has no product column). */}
                      <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Product
                      </label>
                      <select
                        value={selectedProductId}
                        onChange={(e) => chooseProduct(e.target.value)}
                        className="input mt-1"
                        disabled={productGroups.length === 0}
                      >
                        <option value="">
                          {productGroups.length === 0
                            ? "— no products —"
                            : "— select a product —"}
                        </option>
                        {productGroups.map(([cat, prods]) => (
                          <optgroup key={cat} label={cat}>
                            {prods.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                    <div>
                      {/* Scoping-only: narrows the Subcategory list. Auto-set when
                          a product is chosen. Not persisted. */}
                      <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Category
                      </label>
                      <select
                        value={catFilter}
                        onChange={(e) => setCatFilter(e.target.value)}
                        className="input mt-1"
                      >
                        <option value="">— none —</option>
                        {(taxonomy?.categories ?? []).map((c) => (
                          <option key={c.slug} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Subcategory
                      </label>
                      <select
                        value={activePhoto.subcategoryName || ""}
                        onChange={(e) =>
                          editMeta(activePhoto.id, {
                            subcategoryName: e.target.value || null,
                          })
                        }
                        className="input mt-1"
                      >
                        <option value="">— none —</option>
                        {subcatOptions.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="min-w-0">
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Variant attr
                        </label>
                        <select
                          value={activePhoto.variantAttribute || ""}
                          onChange={(e) =>
                            editMeta(activePhoto.id, {
                              variantAttribute: e.target.value || null,
                            })
                          }
                          className="input mt-1"
                        >
                          <option value="">— none —</option>
                          {attrOptions.map((a) => (
                            <option key={a} value={a}>
                              {a}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="min-w-0">
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Variant value
                        </label>
                        <select
                          value={activePhoto.variantValue || ""}
                          onChange={(e) =>
                            editMeta(activePhoto.id, {
                              variantValue: e.target.value || null,
                            })
                          }
                          className="input mt-1"
                        >
                          <option value="">— none —</option>
                          {valueOptions.map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="mb-2 flex items-center text-xs text-muted-foreground">
                    Roles
                    <InfoTip term="Roles">
                      Slots the store itself understands, like “hero” or
                      “thumbnail”. Use them sparingly — a tag is the right choice
                      for your own labels.
                    </InfoTip>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {activePhoto.roles.map((r) => (
                      <span
                        key={r}
                        className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-2 py-1 text-xs text-accent"
                      >
                        {r}
                        <button
                          type="button"
                          onClick={() => removeTerm("roles", r)}
                          className="cursor-pointer hover:text-danger"
                          aria-label={`Remove role ${r}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                    <button
                      type="button"
                      onClick={() => addTerm("roles")}
                      className="cursor-pointer rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                    >
                      + Add role
                    </button>
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="mb-2 text-xs text-muted-foreground">Tags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {activePhoto.tags.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-1 text-xs"
                      >
                        {t}
                        <button
                          type="button"
                          onClick={() => removeTerm("tags", t)}
                          className="cursor-pointer hover:text-danger"
                          aria-label={`Remove tag ${t}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                    <button
                      type="button"
                      onClick={() => addTerm("tags")}
                      className="cursor-pointer rounded-full border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                    >
                      + Add tag
                    </button>
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <p className="mb-2 text-xs text-muted-foreground">Where it&apos;s used</p>
                  {activeUses.length === 0 ? (
                    <p className="text-xs italic text-muted-foreground">
                      Not used anywhere
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {activeUses.map((u, i) => (
                        <li key={i} className="flex flex-col gap-0.5 text-xs">
                          <div className="flex items-center gap-1.5">
                            <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate font-medium">{u.name}</span>
                          </div>
                          <span className="pl-5 capitalize text-muted-foreground">
                            {u.kind} • {u.slot || "Gallery"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="pt-2">
                <Button
                  variant="danger"
                  type="button"
                  className="w-full"
                  disabled={deleting || activeUses.length > 0}
                  onClick={() => deletePhoto(activePhoto.id)}
                >
                  {deleting ? "Deleting…" : "Delete image"}
                </Button>
                {activeUses.length > 0 && (
                  <p className="mt-2 text-center text-[10px] text-muted-foreground">
                    In use by {activeUses.length} product
                    {activeUses.length === 1 ? "" : "s"} — remove it there first.
                  </p>
                )}
              </div>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
