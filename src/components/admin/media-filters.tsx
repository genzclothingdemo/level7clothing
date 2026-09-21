"use client";

/**
 * Shared filtering model for the Media Library page and the PhotoPicker modal,
 * so both learn one set of controls and can never drift apart.
 *
 * Three decisions worth keeping:
 *
 * 1. **Nothing is filtered by default.** `NO_FILTERS` is the starting state
 *    everywhere. The picker used to open with a Subcategory + Variant filter
 *    pre-applied from its `prefer*` props — but `Media.subcategoryName` and
 *    `Media.variantValue` are written by nothing except manual tagging in the
 *    Media Library, so they are null for every seeded photo. The result was a
 *    picker that always opened on "no photos match your filters". Those props
 *    now drive *suggestion chips* instead, and a suggestion is only offered
 *    when it actually matches loaded photos.
 *
 * 2. **Options are derived from the loaded photos, never from the taxonomy.**
 *    Offering every store subcategory when no photo carries one just recreates
 *    the empty-library trap. Every option in this bar matches at least one
 *    loaded photo, and a whole control disappears when it has nothing to offer.
 *
 * 3. **Two rows at rest.** Search plus a "Filters" disclosure; the selects only
 *    take vertical space while the admin is actually using them. Active choices
 *    stay visible as removable chips, which is what makes a collapsed panel
 *    safe — you can always see what is narrowing the results.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoTip } from "@/components/store/info-tip";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** One row from GET /api/admin/media. */
export type MediaPhoto = {
  id: string;
  url: string;
  file: string;
  /** Human-editable display name ("Image Name"); falls back to the filename. */
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

export type PhotoUse = { kind: string; id: string; name: string; slot?: string };
export type UsageMap = Record<string, PhotoUse[]>;

export type MediaFilters = {
  q: string;
  /** "all" | "used" | "unused" */
  usage: string;
  /** "all" | "repo" | "blob" | "external" */
  source: string;
  /** "all" | a subcategory name */
  subcategory: string;
  /** "all" | NO_VARIANT | `${attr}${SEP}${value}` */
  variant: string;
  /** "all" | `role${SEP}${name}` | `tag${SEP}${name}` */
  label: string;
};

/**
 * Separator for composite <select> values. A control character can't occur in
 * an attribute name, tag or role, so splitting is never ambiguous.
 */
const SEP = "";
/** Sentinel for "this photo carries no variant tag at all". */
export const NO_VARIANT = "__none__";

/** The default: everything visible, nothing hidden. */
export const NO_FILTERS: MediaFilters = {
  q: "",
  usage: "all",
  source: "all",
  subcategory: "all",
  variant: "all",
  label: "all",
};

/* ------------------------------------------------------------------ */
/*  Data helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * Coerce raw API rows into render-safe photos. `tags` and `roles` are JSON
 * columns that can come back `null`, which would crash the `.includes`/`.map`
 * calls used on every render — so they are forced to arrays here.
 */
export function normalizePhotos(rows: unknown): MediaPhoto[] {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const p = (row ?? {}) as Partial<MediaPhoto>;
    return {
      ...p,
      tags: Array.isArray(p.tags) ? p.tags : [],
      roles: Array.isArray(p.roles) ? p.roles : [],
    } as MediaPhoto;
  });
}

/** Narrow an unknown thrown value to something worth showing in a toast. */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * `decodeURI` throws a URIError on a stray `%` — which a blob filename can
 * legitimately contain — and an exception thrown inside render takes the whole
 * picker down. Fall back to the raw URL, which `next/image` handles anyway.
 */
export function safeSrc(url: string): string {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}

/** The name to show under a thumbnail: the admin's label, else the filename. */
export function photoLabel(p: MediaPhoto): string {
  return p.alt || p.file.split("/").pop() || p.file;
}

/** Plain-English name for a storage backend. */
export function describeSource(source: string): string {
  if (source === "repo") return "Site folder";
  if (source === "blob") return "Uploads";
  if (source === "external") return "Pasted link";
  return source;
}

/**
 * The folder a photo sits in, read straight off its URL. The API's own
 * `category` field is derived by stripping a hard-coded `/products/gallery/`
 * prefix that this store does not use (photos live flat in
 * `public/products/level7/`), so it comes back empty for every repo photo —
 * this is the honest version.
 */
export function photoFolder(p: MediaPhoto): string {
  if (p.source === "external") return "Pasted link";
  if (p.source === "blob") return "Uploads";
  const path = safeSrc(p.url);
  const parts = path.split("/").filter(Boolean);
  parts.pop(); // drop the filename
  return parts.join(" / ") || "—";
}

/** How many filters are narrowing the results right now (search excluded). */
export function countActiveFilters(f: MediaFilters): number {
  return (
    (f.usage !== "all" ? 1 : 0) +
    (f.source !== "all" ? 1 : 0) +
    (f.subcategory !== "all" ? 1 : 0) +
    (f.variant !== "all" ? 1 : 0) +
    (f.label !== "all" ? 1 : 0)
  );
}

/** True when the view is completely unfiltered (search included). */
export function isUnfiltered(f: MediaFilters): boolean {
  return countActiveFilters(f) === 0 && f.q.trim() === "";
}

/** Apply every active filter. The single source of truth for "what's shown". */
export function filterPhotos(
  photos: MediaPhoto[],
  usage: UsageMap,
  f: MediaFilters
): MediaPhoto[] {
  const needle = f.q.trim().toLowerCase();
  return photos.filter((p) => {
    if (f.source !== "all" && p.source !== f.source) return false;
    if (f.subcategory !== "all" && (p.subcategoryName ?? "") !== f.subcategory) {
      return false;
    }

    if (f.variant !== "all") {
      if (f.variant === NO_VARIANT) {
        if (p.variantValue) return false;
      } else {
        const [attr, value] = f.variant.split(SEP);
        if ((p.variantValue ?? "") !== value) return false;
        if (attr && (p.variantAttribute ?? "") !== attr) return false;
      }
    }

    if (f.label !== "all") {
      const [kind, value] = f.label.split(SEP);
      const hit = kind === "role" ? p.roles.includes(value) : p.tags.includes(value);
      if (!hit) return false;
    }

    if (f.usage !== "all") {
      const used = (usage[p.url]?.length ?? 0) > 0;
      if (f.usage === "used" && !used) return false;
      if (f.usage === "unused" && used) return false;
    }

    if (!needle) return true;
    const hay = `${p.file} ${p.alt ?? ""} ${p.subcategoryName ?? ""} ${
      p.variantValue ?? ""
    } ${p.tags.join(" ")} ${p.roles.join(" ")}`.toLowerCase();
    return hay.includes(needle);
  });
}

/* ------------------------------------------------------------------ */
/*  Option lists                                                       */
/* ------------------------------------------------------------------ */

export type FilterOptions = {
  subcategories: string[];
  /** Distinct attribute/value pairs actually present on the loaded photos. */
  variants: { key: string; label: string }[];
  /** Combined roles + tags, kept apart only for the optgroup headings. */
  roles: string[];
  tags: string[];
  /** Backends present in the loaded set — a lone backend needs no control. */
  sources: string[];
};

/**
 * Build the dropdown contents from the loaded photos. Anything not represented
 * is simply not offered, so no choice in this bar can ever return zero rows.
 */
export function buildFilterOptions(photos: MediaPhoto[]): FilterOptions {
  const subcategories = new Set<string>();
  const variants = new Map<string, string>();
  const roles = new Set<string>();
  const tags = new Set<string>();
  const sources = new Set<string>();

  for (const p of photos) {
    if (p.subcategoryName) subcategories.add(p.subcategoryName);
    if (p.variantValue) {
      const attr = p.variantAttribute ?? "";
      variants.set(
        `${attr}${SEP}${p.variantValue}`,
        attr ? `${attr}: ${p.variantValue}` : p.variantValue
      );
    }
    p.roles.forEach((r) => r && roles.add(r));
    p.tags.forEach((t) => t && tags.add(t));
    if (p.source) sources.add(p.source);
  }

  const sort = (a: string, b: string) => a.localeCompare(b);
  return {
    subcategories: [...subcategories].sort(sort),
    variants: [...variants.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => sort(a.label, b.label)),
    roles: [...roles].sort(sort),
    tags: [...tags].sort(sort),
    sources: [...sources].sort(sort),
  };
}

/** Build the value a Variant `<select>` uses for a given attribute/value pair. */
export function variantKey(attr: string | null | undefined, value: string): string {
  return `${attr ?? ""}${SEP}${value}`;
}

/** Build the value a Tag/Role `<select>` uses. */
export function labelKey(kind: "role" | "tag", value: string): string {
  return `${kind}${SEP}${value}`;
}

/* ------------------------------------------------------------------ */
/*  Chips                                                              */
/* ------------------------------------------------------------------ */

type Chip = { key: string; text: string; clear: () => void };

function buildChips(
  f: MediaFilters,
  onChange: (next: MediaFilters) => void,
  options: FilterOptions
): Chip[] {
  const set = (patch: Partial<MediaFilters>) => onChange({ ...f, ...patch });
  const chips: Chip[] = [];

  if (f.q.trim()) {
    chips.push({ key: "q", text: `Search: ${f.q.trim()}`, clear: () => set({ q: "" }) });
  }
  if (f.usage !== "all") {
    chips.push({
      key: "usage",
      text: f.usage === "used" ? "Used by a product" : "Not used yet",
      clear: () => set({ usage: "all" }),
    });
  }
  if (f.source !== "all") {
    chips.push({
      key: "source",
      text: describeSource(f.source),
      clear: () => set({ source: "all" }),
    });
  }
  if (f.subcategory !== "all") {
    chips.push({
      key: "subcategory",
      text: f.subcategory,
      clear: () => set({ subcategory: "all" }),
    });
  }
  if (f.variant !== "all") {
    const text =
      f.variant === NO_VARIANT
        ? "No variant tag"
        : options.variants.find((v) => v.key === f.variant)?.label ??
          f.variant.split(SEP).filter(Boolean).join(": ");
    chips.push({ key: "variant", text, clear: () => set({ variant: "all" }) });
  }
  if (f.label !== "all") {
    const [kind, value] = f.label.split(SEP);
    chips.push({
      key: "label",
      text: `${kind === "role" ? "Role" : "Tag"}: ${value}`,
      clear: () => set({ label: "all" }),
    });
  }

  return chips;
}

/* ------------------------------------------------------------------ */
/*  UI                                                                 */
/* ------------------------------------------------------------------ */

/**
 * A labelled select in the filter panel. `tip` becomes an (i) button.
 *
 * The `<label>` deliberately does NOT wrap the control: a click anywhere in a
 * label is forwarded to its labelable descendant, so an (i) button nested
 * inside one would pop the select open every time it was tapped. Label and
 * control are siblings tied together by id instead, which is why `children` is
 * a function — it needs that generated id.
 */
function Field({
  label,
  tip,
  children,
}: {
  label: string;
  tip?: React.ReactNode;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center">
        <label
          htmlFor={id}
          className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {label}
        </label>
        {tip ? (
          <InfoTip term={label} className="shrink-0">
            {tip}
          </InfoTip>
        ) : null}
      </div>
      {children(id)}
    </div>
  );
}

export function MediaFilterBar({
  filters,
  onChange,
  options,
  /** Rendered to the right of the search box — Refresh / Upload / Done etc. */
  actions,
  /** One-click starting points offered above the chips (picker suggestions). */
  suggestions,
  className,
}: {
  filters: MediaFilters;
  onChange: (next: MediaFilters) => void;
  options: FilterOptions;
  actions?: React.ReactNode;
  suggestions?: { key: string; text: string; apply: () => void }[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const active = countActiveFilters(filters);
  const chips = buildChips(filters, onChange, options);
  const set = (patch: Partial<MediaFilters>) => onChange({ ...filters, ...patch });

  const showSource = options.sources.length > 1;
  const showSubcategory = options.subcategories.length > 0;
  const showVariant = options.variants.length > 0;
  const showLabel = options.roles.length > 0 || options.tags.length > 0;

  return (
    <div className={cn("space-y-2", className)}>
      {/* Row 1 — search + the disclosure + whatever the host puts in `actions`.
          It wraps rather than squeezing: at 320px the search box keeps a usable
          9rem and the buttons drop to a second line instead of overflowing. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[9rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
            className="input pl-9 pr-9"
            placeholder="Search photos"
            aria-label="Search photos"
          />
          {filters.q !== "" && (
            <button
              type="button"
              onClick={() => set({ q: "" })}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className={cn(
              "inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm transition-colors",
              open || active > 0
                ? "border-accent/50 bg-accent/10 text-accent"
                : "border-border text-muted-foreground hover:bg-muted"
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span className="hidden sm:inline">Filters</span>
            {active > 0 && (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-foreground">
                {active}
              </span>
            )}
          </button>

          {actions}
        </div>
      </div>

      {/* Row 2 — the panel itself, mounted only while open (never parked
          offscreen; see the modal note in CLAUDE.md). */}
      {open && (
        <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Where it's used"
            tip="“Used by a product” means at least one product gallery points at this photo. Those can't be deleted until the product lets go of them."
          >
            {(id) => (
              <select
                id={id}
                value={filters.usage}
                onChange={(e) => set({ usage: e.target.value })}
                className="input"
              >
                <option value="all">Anywhere</option>
                <option value="used">Used by a product</option>
                <option value="unused">Not used yet</option>
              </select>
            )}
          </Field>

          {showSource && (
            <Field
              label="Where it's stored"
              tip="Site folder = shipped with the site in public/products. Uploads = files you added through this panel. Pasted link = an image hosted somewhere else."
            >
              {(id) => (
                <select
                  id={id}
                  value={filters.source}
                  onChange={(e) => set({ source: e.target.value })}
                  className="input"
                >
                  <option value="all">Anywhere</option>
                  {options.sources.map((s) => (
                    <option key={s} value={s}>
                      {describeSource(s)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}

          {showSubcategory && (
            <Field label="Subcategory">
              {(id) => (
                <select
                  id={id}
                  value={filters.subcategory}
                  onChange={(e) => set({ subcategory: e.target.value })}
                  className="input"
                >
                  <option value="all">Any subcategory</option>
                  {options.subcategories.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}

          {showVariant && (
            <Field
              label="Variant"
              tip="Optional labels you add in the Media Library (for example Colour: Black) so a photo can be found by the option it belongs to. Most photos have none."
            >
              {(id) => (
                <select
                  id={id}
                  value={filters.variant}
                  onChange={(e) => set({ variant: e.target.value })}
                  className="input"
                >
                  <option value="all">Any variant</option>
                  <option value={NO_VARIANT}>No variant tag</option>
                  {options.variants.map((v) => (
                    <option key={v.key} value={v.key}>
                      {v.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}

          {showLabel && (
            <Field
              label="Tag or role"
              tip="Roles are slots the store understands, like hero or thumbnail. Tags are your own free-text labels. Both are added from a photo's details panel."
            >
              {(id) => (
                <select
                  id={id}
                  value={filters.label}
                  onChange={(e) => set({ label: e.target.value })}
                  className="input"
                >
                  <option value="all">Any tag or role</option>
                  {options.roles.length > 0 && (
                    <optgroup label="Roles">
                      {options.roles.map((r) => (
                        <option key={`role-${r}`} value={labelKey("role", r)}>
                          {r}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {options.tags.length > 0 && (
                    <optgroup label="Tags">
                      {options.tags.map((t) => (
                        <option key={`tag-${t}`} value={labelKey("tag", t)}>
                          {t}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              )}
            </Field>
          )}

          {!showSource && !showSubcategory && !showVariant && !showLabel && (
            <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-3">
              Nothing else to filter by yet. Tags, roles and variant labels are
              added from a photo&apos;s details panel, and show up here once at
              least one photo has them.
            </p>
          )}
        </div>
      )}

      {/* Row 3 — one-click starting points. Only offered when they'd actually
          match something, so a suggestion can never empty the grid. */}
      {suggestions && suggestions.length > 0 && chips.length === 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Jump to</span>
          {suggestions.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={s.apply}
              className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-dashed border-border px-3 text-xs text-muted-foreground transition-colors hover:border-accent hover:text-accent sm:min-h-8"
            >
              {s.text}
            </button>
          ))}
        </div>
      )}

      {/* Row 4 — what's narrowing the results, and one way out of all of it. */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={c.clear}
              title={`Remove filter: ${c.text}`}
              className="inline-flex min-h-11 max-w-full cursor-pointer items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 text-xs text-accent transition-colors hover:bg-accent/20 sm:min-h-8"
            >
              <span className="truncate">{c.text}</span>
              <X className="h-3.5 w-3.5 shrink-0" />
            </button>
          ))}
          <button
            type="button"
            onClick={() => onChange({ ...NO_FILTERS })}
            className="inline-flex min-h-11 cursor-pointer items-center rounded-full px-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground sm:min-h-8"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Select-all checkbox                                                */
/* ------------------------------------------------------------------ */

/**
 * A checkbox that can also sit in the indeterminate state — which only exists
 * as a DOM property, never as an attribute, so it has to be written through a
 * ref rather than rendered.
 */
export function TriCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  label: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);

  return (
    <label
      className={cn(
        "inline-flex min-h-11 cursor-pointer select-none items-center gap-2 pr-1 text-xs",
        className
      )}
    >
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 shrink-0 cursor-pointer rounded accent-[var(--accent)]"
      />
      {label}
    </label>
  );
}

/**
 * Formats the selection readout shared by the library and the picker. Kept in
 * one place because the wording is the whole point of requirement "N of M":
 * it has to say what "all" means when more pages are still unloaded.
 */
export function selectionSummary({
  selectedInView,
  inView,
  totalSelected,
}: {
  selectedInView: number;
  inView: number;
  totalSelected: number;
}): string {
  const base = `${selectedInView} of ${inView} shown selected`;
  const hidden = totalSelected - selectedInView;
  return hidden > 0 ? `${base} · ${hidden} more selected outside this filter` : base;
}

/** Shared memo helper: options recomputed only when the photo list changes. */
export function useFilterOptions(photos: MediaPhoto[]): FilterOptions {
  return useMemo(() => buildFilterOptions(photos), [photos]);
}
