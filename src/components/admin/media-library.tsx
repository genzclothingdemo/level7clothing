"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import {
  Check,
  RefreshCw,
  Search,
  Upload,
  X,
  Filter,
  Image as ImageIcon,
  Tag as TagIcon,
  HardDrive,
  Info
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type Photo = {
  id: string;
  url: string;
  file: string;
  // Human-editable display name ("Image Name" in the UI) — independent of
  // the on-disk filename. Nullable: falls back to the filename when unset.
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
type Library = { photos: Photo[]; usage: Record<string, PhotoUse[]> };

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

// A saved combination of every sidebar/search filter, persisted to
// localStorage so admins can re-apply common views in one click.
type FilterPreset = {
  name: string;
  q: string;
  source: string;
  role: string;
  tag: string;
  usage: string;
  subcategory: string;
  variantAttr: string;
  variantValue: string;
};

const PRESETS_KEY = "level7:media-filter-presets";

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

/**
 * Coerce raw API rows into render-safe photos. `tags` and `roles` are JSON
 * columns that can come back `null`, which would crash the `.forEach`/`.map`/
 * `.includes` calls used on every render — so they are forced to arrays here.
 */
function normalizePhotos(rows: unknown): Photo[] {
  return (Array.isArray(rows) ? rows : []).map((p: any) => ({
    ...p,
    tags: Array.isArray(p?.tags) ? p.tags : [],
    roles: Array.isArray(p?.roles) ? p.roles : []
  })) as Photo[];
}

export function MediaLibrary() {
  const [library, setLibrary] = useState<Library | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  
  // Filters
  const [filterSource, setFilterSource] = useState<string>("All");
  const [filterRole, setFilterRole] = useState<string>("All");
  const [filterTag, setFilterTag] = useState<string>("All");
  const [filterUsage, setFilterUsage] = useState<string>("All");
  // Meta-tag (classification) filters — find product images by their metadata.
  const [filterSubcategory, setFilterSubcategory] = useState<string>("All");
  const [filterVariantAttr, setFilterVariantAttr] = useState<string>("All");
  const [filterVariantValue, setFilterVariantValue] = useState<string>("All");

  // Saved filter presets, hydrated from localStorage on mount.
  const [presets, setPresets] = useState<FilterPreset[]>([]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);

  // Classification dropdown options (categories + variant attribute values).
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
  // UI-only scoping category for the Info panel: narrows the Subcategory
  // options. Does NOT persist (Media has no category column).
  const [catFilter, setCatFilter] = useState<string>("");
  // UI-only product scope for the Info panel: picks which product's variant
  // attributes/values populate the cascade below. Does NOT persist (Media has
  // no product column) — it only narrows the Attribute/Value dropdowns.
  const [selectedProductId, setSelectedProductId] = useState<string>("");

  // Pagination — the API is capped at `PAGE_SIZE` per request; "Load more"
  // fetches the next page and appends it.
  const PAGE_SIZE = 100;
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  // Upload plumbing
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /** Loads the first page of media, replacing whatever is on screen. */
  const fetchLibrary = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/media?page=1&limit=${PAGE_SIZE}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load photos");
      const photos = normalizePhotos(data.photos);
      setLibrary({ photos, usage: data.usage ?? {} });
      setTotal(data.total ?? photos.length);
      setPage(1);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  /** Fetches the next page and appends it to the current list. */
  const loadMore = async () => {
    const next = page + 1;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/media?page=${next}&limit=${PAGE_SIZE}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load photos");
      const more = normalizePhotos(data.photos);
      const moreUsage = data.usage ?? {};
      setLibrary((prev) =>
        prev
          ? { photos: [...prev.photos, ...more], usage: { ...prev.usage, ...moreUsage } }
          : { photos: more, usage: moreUsage }
      );
      setTotal(data.total ?? 0);
      setPage(next);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLibrary();
  }, []);

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

  // Hydrate saved presets once, client-side only (localStorage is undefined
  // during SSR, so guard against `typeof window`).
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(PRESETS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) setPresets(parsed as FilterPreset[]);
    } catch {
      /* ignore malformed/blocked storage */
    }
  }, []);

  /** Writes presets to state and localStorage together. */
  const savePresets = (next: FilterPreset[]) => {
    setPresets(next);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
    } catch {
      /* ignore — storage may be full or blocked */
    }
  };

  /** Snapshots the current filter combination under a prompted name. */
  const saveCurrentPreset = () => {
    const name = window.prompt("Name this filter preset")?.trim();
    if (!name) return;
    const preset: FilterPreset = {
      name,
      q,
      source: filterSource,
      role: filterRole,
      tag: filterTag,
      usage: filterUsage,
      subcategory: filterSubcategory,
      variantAttr: filterVariantAttr,
      variantValue: filterVariantValue
    };
    // Overwrite any preset with the same name; keep the list to a sane length.
    const next = [...presets.filter((p) => p.name !== name), preset].slice(-8);
    savePresets(next);
    toast.success(`Saved preset "${name}"`);
  };

  /** Re-applies a saved preset to every filter in one click. */
  const applyPreset = (p: FilterPreset) => {
    setQ(p.q ?? "");
    setFilterSource(p.source ?? "All");
    setFilterRole(p.role ?? "All");
    setFilterTag(p.tag ?? "All");
    setFilterUsage(p.usage ?? "All");
    setFilterSubcategory(p.subcategory ?? "All");
    setFilterVariantAttr(p.variantAttr ?? "All");
    setFilterVariantValue(p.variantValue ?? "All");
  };

  /** Drops a saved preset by name. */
  const deletePreset = (name: string) => {
    savePresets(presets.filter((p) => p.name !== name));
  };

  /** Resets every filter and the search box to their defaults. */
  const clearFilters = () => {
    setQ("");
    setFilterSource("All");
    setFilterRole("All");
    setFilterTag("All");
    setFilterUsage("All");
    setFilterSubcategory("All");
    setFilterVariantAttr("All");
    setFilterVariantValue("All");
  };

  const activePhoto = useMemo(() => {
    if (!activePhotoId || !library) return null;
    return library.photos.find(p => p.id === activePhotoId) || null;
  }, [activePhotoId, library]);

  // Derive the scoping Category from the selected photo's subcategory whenever
  // the selection or taxonomy changes. `library` is intentionally omitted so a
  // manual category choice survives subsequent subcategory edits (which mutate
  // `library` but not the active photo id).
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
  // Choosing one auto-fills Category (scope) + Subcategory below.
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

  /**
   * Product picked in the Info panel: scope the variant dropdowns to it AND
   * auto-detect the photo's classification from the product itself —
   * Category (scoping select) + Subcategory (persisted). Variant attr/value
   * are kept when they exist on the chosen product, cleared when they don't.
   */
  const chooseProduct = (id: string) => {
    setSelectedProductId(id);
    if (!id || !activePhoto) return;
    const prod = taxonomy?.products?.find((p) => p.id === id);
    if (!prod) return;

    setCatFilter(prod.category || "");

    const updates: Partial<Photo> = {};
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
  // product when set, else the global values for that attribute (empty when none).
  const valueOptions = useMemo(() => {
    const attr = activePhoto?.variantAttribute || "";
    let base: string[] = [];
    if (attr) {
      if (selectedProduct) base = selectedProduct.variantAttributes[attr] ?? [];
      else if (taxonomy) base = taxonomy.variantAttributes[attr] ?? [];
    }
    return withCurrent(base, activePhoto?.variantValue);
  }, [selectedProduct, taxonomy, activePhoto?.variantAttribute, activePhoto?.variantValue]);

  const allTags = useMemo(() => {
    if (!library) return [];
    const tags = new Set<string>();
    library.photos.forEach(p => p.tags.forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  }, [library]);

  const allRoles = useMemo(() => {
    if (!library) return [];
    const roles = new Set<string>();
    library.photos.forEach(p => p.roles.forEach(r => roles.add(r)));
    return Array.from(roles).sort();
  }, [library]);

  // Meta-tag filter options: union of taxonomy values and what the loaded
  // media actually carry, so both known and legacy values are selectable.
  const allSubcategories = useMemo(() => {
    const set = new Set<string>();
    (taxonomy?.categories ?? []).forEach(c => c.subcategories.forEach(s => set.add(s.name)));
    (library?.photos ?? []).forEach(p => { if (p.subcategoryName) set.add(p.subcategoryName); });
    return Array.from(set).sort();
  }, [taxonomy, library]);

  const allVariantAttrs = useMemo(() => {
    const set = new Set<string>();
    Object.keys(taxonomy?.variantAttributes ?? {}).forEach(a => set.add(a));
    (library?.photos ?? []).forEach(p => { if (p.variantAttribute) set.add(p.variantAttribute); });
    return Array.from(set).sort();
  }, [taxonomy, library]);

  // Values are scoped to the selected variant attribute when one is active.
  const allVariantValues = useMemo(() => {
    const set = new Set<string>();
    const attrs = taxonomy?.variantAttributes ?? {};
    if (filterVariantAttr !== "All") {
      (attrs[filterVariantAttr] ?? []).forEach(v => set.add(v));
    } else {
      Object.values(attrs).forEach(list => list.forEach(v => set.add(v)));
    }
    (library?.photos ?? []).forEach(p => {
      if (!p.variantValue) return;
      if (filterVariantAttr !== "All" && p.variantAttribute !== filterVariantAttr) return;
      set.add(p.variantValue);
    });
    return Array.from(set).sort();
  }, [taxonomy, library, filterVariantAttr]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (library?.photos ?? []).filter((p) => {
      if (filterSource !== "All" && p.source !== filterSource) return false;
      if (filterRole !== "All" && !p.roles.includes(filterRole)) return false;
      if (filterTag !== "All" && !p.tags.includes(filterTag)) return false;
      if (filterSubcategory !== "All" && p.subcategoryName !== filterSubcategory) return false;
      if (filterVariantAttr !== "All" && p.variantAttribute !== filterVariantAttr) return false;
      if (filterVariantValue !== "All" && p.variantValue !== filterVariantValue) return false;

      const uses = library?.usage[p.url] || [];
      if (filterUsage === "Unused" && uses.length > 0) return false;
      if (filterUsage === "Used" && uses.length === 0) return false;

      if (!needle) return true;
      const searchable = `${p.file} ${p.tags.join(" ")} ${p.roles.join(" ")}`.toLowerCase();
      return searchable.includes(needle);
    });
  }, [library, q, filterSource, filterRole, filterTag, filterUsage, filterSubcategory, filterVariantAttr, filterVariantValue]);

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  /** Optimistically merge changes into local state so inputs stay responsive. */
  const mergeLocal = (id: string, updates: Partial<Photo>) => {
    setLibrary(prev =>
      prev
        ? { ...prev, photos: prev.photos.map(p => (p.id === id ? { ...p, ...updates } : p)) }
        : prev
    );
  };

  /** Persist metadata to the server. Only toasts on success when `notify` is set. */
  const persist = async (id: string, updates: Partial<Photo>, notify = false) => {
    try {
      const res = await fetch(`/api/admin/media/${id}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
        headers: { "Content-Type": "application/json" }
      });
      if (!res.ok) throw new Error("Failed to update");
      if (notify) toast.success("Updated");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // Debounce metadata edits so typing "Pink" is one PATCH, not four.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ id: string; updates: Partial<Photo> } | null>(null);

  /** Updates local state immediately and debounces the PATCH by 500ms. */
  const editMeta = (id: string, updates: Partial<Photo>) => {
    mergeLocal(id, updates);
    const prev = pendingRef.current;
    pendingRef.current = {
      id,
      updates: prev && prev.id === id ? { ...prev.updates, ...updates } : updates
    };
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const p = pendingRef.current;
      pendingRef.current = null;
      debounceRef.current = null;
      if (p) void persist(p.id, p.updates);
    }, 500);
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
      } catch (err: any) {
        toast.error(`${file.name}: ${err.message}`);
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
    } catch (err: any) {
      toast.error(err.message);
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
    const update: Partial<Photo> = kind === "roles" ? { roles: next } : { tags: next };
    mergeLocal(activePhoto.id, update);
    void persist(activePhoto.id, update, true);
  };

  /** Removes a role/tag from the active photo and persists it via PATCH. */
  const removeTerm = (kind: "roles" | "tags", value: string) => {
    if (!activePhoto) return;
    const next = activePhoto[kind].filter(v => v !== value);
    const update: Partial<Photo> = kind === "roles" ? { roles: next } : { tags: next };
    mergeLocal(activePhoto.id, update);
    void persist(activePhoto.id, update, true);
  };

  if (loading && !library) {
    return <div className="p-8 flex items-center justify-center text-muted-foreground"><RefreshCw className="animate-spin w-5 h-5 mr-2"/> Loading library...</div>;
  }

  return (
    <div className="flex h-full">
      {/* Left Filters Sidebar */}
      <div className="w-64 shrink-0 border-r border-border bg-card overflow-y-auto hidden md:block p-4 space-y-6">
        {/* Saved filter presets */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Saved Filters</h3>
            <button
              onClick={clearFilters}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          </div>
          <div className="space-y-1">
            {presets.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-1">No saved presets yet.</p>
            )}
            {presets.map((preset) => (
              <div key={preset.name} className="flex items-center gap-1">
                <button
                  onClick={() => applyPreset(preset)}
                  className="flex-1 text-left px-2 py-1.5 text-sm rounded-md transition-colors hover:bg-muted text-muted-foreground truncate"
                  title={`Apply "${preset.name}"`}
                >
                  {preset.name}
                </button>
                <button
                  onClick={() => deletePreset(preset.name)}
                  className="p-1 rounded-md hover:bg-muted text-muted-foreground shrink-0"
                  aria-label={`Delete preset ${preset.name}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <button
              onClick={saveCurrentPreset}
              className="w-full mt-1 px-2 py-1.5 text-xs rounded-md border border-dashed border-border text-muted-foreground hover:bg-muted"
            >
              + Save current filters
            </button>
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Source</h3>
          <div className="space-y-1">
            {["All", "repo", "blob", "external"].map(src => (
              <button 
                key={src} 
                onClick={() => setFilterSource(src)}
                className={cn("w-full text-left px-2 py-1.5 text-sm rounded-md transition-colors", filterSource === src ? "bg-accent/10 text-accent font-medium" : "hover:bg-muted text-muted-foreground")}
              >
                {src === "All" ? "All Sources" : src === "repo" ? "Public Folder" : src === "blob" ? "Blob Storage" : "External URLs"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Usage</h3>
          <div className="space-y-1">
            {["All", "Used", "Unused"].map(use => (
              <button 
                key={use} 
                onClick={() => setFilterUsage(use)}
                className={cn("w-full text-left px-2 py-1.5 text-sm rounded-md transition-colors", filterUsage === use ? "bg-accent/10 text-accent font-medium" : "hover:bg-muted text-muted-foreground")}
              >
                {use}
              </button>
            ))}
          </div>
        </div>

        {allSubcategories.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Subcategory</h3>
            <select
              value={filterSubcategory}
              onChange={(e) => setFilterSubcategory(e.target.value)}
              className="input h-8 px-2 text-xs w-full"
            >
              <option value="All">All Subcategories</option>
              {allSubcategories.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        )}

        {allVariantAttrs.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Variant Attribute</h3>
            <select
              value={filterVariantAttr}
              onChange={(e) => { setFilterVariantAttr(e.target.value); setFilterVariantValue("All"); }}
              className="input h-8 px-2 text-xs w-full"
            >
              <option value="All">All Attributes</option>
              {allVariantAttrs.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
        )}

        {allVariantValues.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Variant Value</h3>
            <select
              value={filterVariantValue}
              onChange={(e) => setFilterVariantValue(e.target.value)}
              className="input h-8 px-2 text-xs w-full"
            >
              <option value="All">All Values</option>
              {allVariantValues.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
        )}

        {allRoles.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Roles</h3>
            <div className="space-y-1">
              <button 
                onClick={() => setFilterRole("All")}
                className={cn("w-full text-left px-2 py-1.5 text-sm rounded-md transition-colors", filterRole === "All" ? "bg-accent/10 text-accent font-medium" : "hover:bg-muted text-muted-foreground")}
              >
                All Roles
              </button>
              {allRoles.map(role => (
                <button 
                  key={role} 
                  onClick={() => setFilterRole(role)}
                  className={cn("w-full text-left px-2 py-1.5 text-sm rounded-md transition-colors", filterRole === role ? "bg-accent/10 text-accent font-medium" : "hover:bg-muted text-muted-foreground")}
                >
                  {role}
                </button>
              ))}
            </div>
          </div>
        )}

        {allTags.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Tags</h3>
            <div className="flex flex-wrap gap-1.5">
              <button 
                onClick={() => setFilterTag("All")}
                className={cn("px-2.5 py-1 text-xs rounded-full border transition-colors", filterTag === "All" ? "bg-foreground text-background border-foreground" : "bg-card border-border text-muted-foreground hover:bg-muted")}
              >
                All
              </button>
              {allTags.map(tag => (
                <button 
                  key={tag} 
                  onClick={() => setFilterTag(tag)}
                  className={cn("px-2.5 py-1 text-xs rounded-full border transition-colors", filterTag === tag ? "bg-foreground text-background border-foreground" : "bg-card border-border text-muted-foreground hover:bg-muted")}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Main Grid Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-muted/20">
        {/* Toolbar */}
        <div className="h-14 border-b border-border bg-card px-4 flex items-center justify-between shrink-0 gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input 
              className="input pl-8 py-1.5 h-8 text-xs w-full"
              placeholder="Search images..."
              value={q}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => fetchLibrary()}>
              <RefreshCw className={cn("w-4 h-4 mr-2", loading && "animate-spin")} /> Refresh
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
            <Button size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              {uploading ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              {uploading ? "Uploading…" : "Upload"}
            </Button>
          </div>
        </div>

        {/* Gallery */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {visible.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              <ImageIcon className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p>No media found.</p>
            </div>
          ) : (
            <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {visible.map(photo => {
                const uses = library?.usage[photo.url] || [];
                const isSelected = selectedIds.has(photo.id);
                const isActive = activePhotoId === photo.id;
                
                return (
                  <div 
                    key={photo.id}
                    onClick={() => setActivePhotoId(photo.id)}
                    className={cn(
                      "group relative aspect-square rounded-xl border bg-card overflow-hidden cursor-pointer transition-all hover:border-accent hover:shadow-sm",
                      isActive ? "ring-2 ring-accent border-accent" : "border-border",
                      isSelected && "ring-2 ring-primary border-primary"
                    )}
                  >
                    <Image 
                      src={photo.url} 
                      alt={photo.file} 
                      fill 
                      className="object-cover transition-transform group-hover:scale-105" 
                      sizes="(max-width: 768px) 50vw, 25vw"
                    />
                    
                    {/* Checkbox Overlay */}
                    <div 
                      className={cn(
                        "absolute top-2 left-2 z-10 p-1 rounded-md transition-opacity",
                        isSelected ? "opacity-100 bg-primary text-primary-foreground" : "opacity-0 group-hover:opacity-100 bg-background/80 hover:bg-background"
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelect(photo.id);
                      }}
                    >
                      <Check className={cn("w-4 h-4", !isSelected && "opacity-30")} />
                    </div>
                    
                    {/* Info Overlay */}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 pt-8 pointer-events-none">
                      <p className="text-white text-xs truncate drop-shadow-md">{photo.alt || photo.file.split('/').pop()}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {uses.length > 0 && (
                          <span className="text-[10px] text-white/80 bg-white/20 rounded px-1.5 py-0.5 backdrop-blur-sm">
                            {uses.length} use{uses.length !== 1 && 's'}
                          </span>
                        )}
                        {photo.roles.length > 0 && (
                          <span className="text-[10px] text-accent-foreground bg-accent/80 rounded px-1.5 py-0.5 backdrop-blur-sm truncate">
                            {photo.roles[0]}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Count + Load more (paginated) */}
            <div className="mt-6 flex flex-col items-center gap-2">
              <p className="text-xs text-muted-foreground">
                {visible.length} shown · {library?.photos.length ?? 0} of {total} loaded
              </p>
              {library && library.photos.length < total && (
                <Button variant="outline" size="sm" onClick={loadMore} disabled={loading}>
                  {loading && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                  Load more
                </Button>
              )}
            </div>
            </>
          )}
        </div>
      </div>

      {/* Slide-out Info Panel */}
      {activePhoto && (
        <div className="w-80 shrink-0 border-l border-border bg-card overflow-y-auto flex flex-col">
          <div className="h-14 border-b border-border flex items-center justify-between px-4 shrink-0">
            <h3 className="font-medium text-sm">Image Details</h3>
            <button onClick={() => setActivePhotoId(null)} className="p-1 rounded-md hover:bg-muted text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          
          <div className="p-4 space-y-6">
            <div className="aspect-square relative rounded-lg border border-border overflow-hidden bg-muted/30">
              <Image 
                src={activePhoto.url} 
                alt={activePhoto.file} 
                fill 
                className="object-contain" 
              />
            </div>
            
            <div className="space-y-4 text-sm">
              <div>
                <label className="text-muted-foreground text-xs mb-1 block">Image Name</label>
                <input
                  type="text"
                  value={activePhoto.alt ?? ""}
                  placeholder={activePhoto.file.split('/').pop()}
                  onChange={(e) => editMeta(activePhoto.id, { alt: e.target.value || null })}
                  className="input h-8 px-2 text-sm w-full"
                />
              </div>

              <div>
                <p className="text-muted-foreground text-xs mb-1">Filename</p>
                <p className="break-all">{activePhoto.file.split('/').pop()}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Source</p>
                  <p className="capitalize flex items-center gap-1.5"><HardDrive className="w-3.5 h-3.5" /> {activePhoto.source}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Added</p>
                  <p>{new Date(activePhoto.createdAt).toLocaleDateString()}</p>
                </div>
              </div>

              <div className="pt-4 border-t border-border">
                <p className="text-muted-foreground text-xs mb-2">Smart Categorization</p>
                <p className="text-[10px] text-muted-foreground mb-3">
                  Pick a Product first — Category &amp; Subcategory are auto-detected
                  from it, and the Variant dropdowns show only that product&apos;s
                  options. Or set them manually below.
                </p>
                <div className="space-y-3">
                  <div>
                    {/* Product-first: choosing a product auto-fills Category +
                        Subcategory and scopes the Variant selects. The product
                        itself is not persisted (Media has no product column). */}
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Product</label>
                    <select
                      value={selectedProductId}
                      onChange={(e) => chooseProduct(e.target.value)}
                      className="input h-7 px-2 text-xs w-full mt-1"
                      disabled={productGroups.length === 0}
                    >
                      <option value="">
                        {productGroups.length === 0 ? "— no products —" : "— select a product —"}
                      </option>
                      {productGroups.map(([cat, prods]) => (
                        <optgroup key={cat} label={cat}>
                          {prods.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Category (Derived)</label>
                    <input
                      type="text"
                      value={activePhoto.category || ""}
                      disabled
                      className="input h-7 px-2 text-xs w-full mt-1 bg-muted/50 cursor-not-allowed"
                    />
                  </div>
                  <div>
                    {/* Scoping-only: narrows the Subcategory list. Auto-set when a
                        product is chosen. Not persisted. */}
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Category</label>
                    <select
                      value={catFilter}
                      onChange={(e) => setCatFilter(e.target.value)}
                      className="input h-7 px-2 text-xs w-full mt-1"
                    >
                      <option value="">— none —</option>
                      {(taxonomy?.categories ?? []).map((c) => (
                        <option key={c.slug} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Subcategory</label>
                    <select
                      value={activePhoto.subcategoryName || ""}
                      onChange={(e) => editMeta(activePhoto.id, { subcategoryName: e.target.value || null })}
                      className="input h-7 px-2 text-xs w-full mt-1"
                    >
                      <option value="">— none —</option>
                      {subcatOptions.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Variant Attr</label>
                      <select
                        value={activePhoto.variantAttribute || ""}
                        onChange={(e) => editMeta(activePhoto.id, { variantAttribute: e.target.value || null })}
                        className="input h-7 px-2 text-xs w-full mt-1"
                      >
                        <option value="">— none —</option>
                        {attrOptions.map((a) => (
                          <option key={a} value={a}>{a}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Variant Value</label>
                      <select
                        value={activePhoto.variantValue || ""}
                        onChange={(e) => editMeta(activePhoto.id, { variantValue: e.target.value || null })}
                        className="input h-7 px-2 text-xs w-full mt-1"
                      >
                        <option value="">— none —</option>
                        {valueOptions.map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-border">
                <p className="text-muted-foreground text-xs mb-2">Roles (System Level)</p>
                <div className="flex flex-wrap gap-1.5">
                  {activePhoto.roles.map(r => (
                    <span key={r} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/10 text-accent text-xs">
                      {r}
                      <button
                        onClick={() => removeTerm("roles", r)}
                        className="hover:text-danger"
                        aria-label={`Remove role ${r}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  <button
                    onClick={() => addTerm("roles")}
                    className="px-2 py-0.5 rounded-md border border-dashed border-border text-xs text-muted-foreground hover:bg-muted"
                  >
                    + Add Role
                  </button>
                </div>
              </div>

              <div className="pt-4 border-t border-border">
                <p className="text-muted-foreground text-xs mb-2">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {activePhoto.tags.map(t => (
                    <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border bg-muted/50 text-xs">
                      {t}
                      <button
                        onClick={() => removeTerm("tags", t)}
                        className="hover:text-danger"
                        aria-label={`Remove tag ${t}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  <button
                    onClick={() => addTerm("tags")}
                    className="px-2 py-0.5 rounded-full border border-dashed border-border text-xs text-muted-foreground hover:bg-muted"
                  >
                    + Add Tag
                  </button>
                </div>
              </div>

              <div className="pt-4 border-t border-border">
                <p className="text-muted-foreground text-xs mb-2">Usage Context</p>
                {(() => {
                  const uses = library?.usage[activePhoto.url] || [];
                  if (uses.length === 0) return <p className="text-muted-foreground text-xs italic">Not used anywhere</p>;
                  return (
                    <ul className="space-y-2">
                      {uses.map((u, i) => (
                        <li key={i} className="flex flex-col gap-0.5 text-xs">
                          <div className="flex items-center gap-1.5">
                            <Info className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="font-medium truncate">{u.name}</span>
                          </div>
                          <span className="text-muted-foreground pl-5 capitalize">
                            {u.kind} • {u.slot || "Gallery"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  );
                })()}
              </div>
            </div>
            
            <div className="pt-4 mt-auto">
              <Button
                variant="danger"
                className="w-full"
                disabled={deleting || (library?.usage[activePhoto.url] || []).length > 0}
                onClick={() => deletePhoto(activePhoto.id)}
              >
                {deleting ? "Deleting…" : "Delete Image"}
              </Button>
              {(library?.usage[activePhoto.url] || []).length > 0 && (
                <p className="text-center text-[10px] text-muted-foreground mt-2">Cannot delete image while it is in use.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
