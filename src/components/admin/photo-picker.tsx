"use client";

/**
 * PhotoPicker — the modal behind every "choose photo" button in the admin:
 * product galleries, per-variant galleries and previews, category covers and
 * subcategory covers.
 *
 * Four things here were bugs worth not repeating:
 *
 * 1. **Single-select now swaps.** With `max={1}`, picking a second photo used
 *    to be refused ("You can pick at most 1 photo") until the admin deselected
 *    the first. A one-slot picker has no reason to make you empty the slot
 *    before filling it — clicking PH8 while PH1 is chosen simply *is* choosing
 *    PH8. Capped multi-select (`max={2}` on subcategory covers) has the same
 *    dead end and is handled the same way: the oldest pick drops out and a
 *    toast says which.
 *
 * 2. **It opens unfiltered.** `preferVariantValue` / `preferSubcategory` used
 *    to be written straight into the filter state on open. Nothing populates
 *    `Media.variantValue` or `Media.subcategoryName` except manual tagging, so
 *    those filters matched zero rows and the library looked empty every single
 *    time. They are suggestion chips now, and only appear when they'd match a
 *    photo that is actually loaded.
 *
 * 3. **The sheet is portalled, conditionally rendered and fades only.** See
 *    the "Modal pattern" note in CLAUDE.md. It also sizes with `dvh`, never
 *    `vh`, so an open phone keyboard can't push the footer off-screen.
 *
 * 4. **`decodeURI` is guarded.** A blob filename containing a bare `%` made it
 *    throw inside render and took the whole picker down.
 */

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { toast } from "sonner";
import { Check, Images, Loader2, RefreshCw, Tag, X } from "lucide-react";
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
  photoLabel,
  safeSrc,
  selectionSummary,
  useFilterOptions,
  variantKey,
  type MediaFilters,
  type MediaPhoto,
  type UsageMap,
} from "@/components/admin/media-filters";

type Library = { photos: MediaPhoto[]; usage: UsageMap };

const PAGE_SIZE = 100;
/** Safety net for "Load all" — 20 pages is 2000 photos, far past this store. */
const MAX_AUTO_PAGES = 20;

export function PhotoPicker({
  selected,
  onChange,
  max,
  /** Suggestion only: offers a one-click "<name> photos" chip when it matches. */
  preferCategory,
  /** Suggestion only: offers the matching variant chip. "" (common) is ignored. */
  preferVariantValue,
  /** Suggestion only: offers a one-click subcategory chip when it matches. */
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
  const [filters, setFilters] = useState<MediaFilters>({ ...NO_FILTERS });
  const titleId = useId();

  const single = max === 1;

  /* ---------------- data ---------------- */

  const fetchFirstPage = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/media?page=1&limit=${PAGE_SIZE}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load photos");
      setLibrary({ photos: normalizePhotos(data.photos), usage: data.usage ?? {} });
      setTotal(data.total ?? data.photos?.length ?? 0);
      setPage(1);
    } catch (err) {
      toast.error(errorMessage(err, "Could not load photos"));
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Append the next `count` pages. Used by both "Load more" (1) and "Load all"
   * (the rest), so there's one fetch-and-merge path instead of two.
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

  // First open fetches the library. Filters are deliberately NOT primed.
  useEffect(() => {
    if (!open || library) return;
    void fetchFirstPage();
  }, [open, library, fetchFirstPage]);

  /* ---------------- modal chrome ---------------- */

  /**
   * Closing also resets the filters. The whole point of requirement "opens
   * unfiltered" is that the next open starts from everything — a filter left
   * behind from ten minutes ago is the same empty-library trap by another route.
   * The fetched photos are kept, so reopening is instant.
   */
  const close = useCallback(() => {
    setOpen(false);
    setFilters({ ...NO_FILTERS });
  }, []);

  // Escape to dismiss, and don't let the page scroll behind the sheet.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setFilters({ ...NO_FILTERS });
      }
    }
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  /* ---------------- filtering ---------------- */

  // Memoised so the `[]` / `{}` fallbacks aren't fresh references on every
  // render, which would defeat every useMemo downstream.
  const photos = useMemo(() => library?.photos ?? [], [library]);
  const usage = useMemo<UsageMap>(() => library?.usage ?? {}, [library]);
  const options = useFilterOptions(photos);
  const visible = useMemo(
    () => filterPhotos(photos, usage, filters),
    [photos, usage, filters]
  );

  /**
   * One-click starting points built from the caller's `prefer*` hints. Each is
   * checked against the loaded photos first — a suggestion that would empty
   * the grid is simply not offered.
   */
  const suggestions = useMemo(() => {
    const out: { key: string; text: string; apply: () => void }[] = [];

    const sub = preferSubcategory ?? preferCategory;
    if (sub && photos.some((p) => p.subcategoryName === sub)) {
      out.push({
        key: `sub:${sub}`,
        text: `${sub} photos`,
        apply: () => setFilters({ ...NO_FILTERS, subcategory: sub }),
      });
    }

    if (preferVariantValue) {
      const hit = photos.find((p) => p.variantValue === preferVariantValue);
      if (hit) {
        out.push({
          key: `var:${preferVariantValue}`,
          text: `${preferVariantValue} photos`,
          apply: () =>
            setFilters({
              ...NO_FILTERS,
              variant: variantKey(hit.variantAttribute, preferVariantValue),
            }),
        });
      }
    }

    if (photos.length > 0 && photos.some((p) => (usage[p.url]?.length ?? 0) === 0)) {
      out.push({
        key: "unused",
        text: "Not used yet",
        apply: () => setFilters({ ...NO_FILTERS, usage: "unused" }),
      });
    }

    return out;
  }, [photos, usage, preferSubcategory, preferCategory, preferVariantValue]);

  /* ---------------- selection ---------------- */

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedInView = visible.filter((p) => selectedSet.has(p.url)).length;
  const allInViewSelected = visible.length > 0 && selectedInView === visible.length;

  /**
   * The one interaction that matters. Nothing here can dead-end: a single-slot
   * picker swaps, a capped picker drops its oldest pick, an uncapped one just
   * toggles.
   */
  function choose(url: string) {
    const on = selectedSet.has(url);

    if (single) {
      if (on) {
        onChange([]);
        return;
      }
      onChange([url]);
      // One slot, now filled — there is nothing else to do in here.
      close();
      return;
    }

    if (on) {
      onChange(selected.filter((u) => u !== url));
      return;
    }

    if (max !== undefined && selected.length >= max) {
      if (selected.length === 0) {
        // max <= 0 — nonsensical, but better a message than a crash below.
        toast.error("This slot doesn't accept photos.");
        return;
      }
      const [dropped, ...rest] = selected;
      onChange([...rest, url]);
      toast.info(
        `Limit is ${max} photos — dropped ${dropped.split("/").pop()} to make room.`
      );
      return;
    }

    onChange([...selected, url]);
  }

  /** Add every currently-shown photo, or remove them all if they're all in. */
  function toggleAllShown() {
    if (allInViewSelected) {
      const drop = new Set(visible.map((p) => p.url));
      onChange(selected.filter((u) => !drop.has(u)));
      return;
    }
    const merged = [...selected];
    for (const p of visible) if (!selectedSet.has(p.url)) merged.push(p.url);
    onChange(merged);
  }

  const loadedAll = photos.length >= total;
  const remaining = Math.max(0, total - photos.length);

  /* ---------------- render ---------------- */

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm hover:bg-muted"
      >
        <Images className="h-4 w-4" />
        {label}
      </button>

      {/* Mounted only while open, and its resting position comes from layout —
          never from an animation that has to finish. */}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-6"
          >
            <button
              type="button"
              aria-label="Close photo library"
              onClick={close}
              className="absolute inset-0 cursor-default bg-black/50 animate-[fadeIn_0.2s_ease-out_both]"
            />

            <div
              className={cn(
                "relative flex w-full max-w-6xl flex-col overflow-hidden border border-border bg-card shadow-2xl",
                "rounded-t-2xl sm:rounded-2xl",
                // dvh, never vh: on a phone the sheet has to shrink when the
                // keyboard opens or the footer ends up underneath it.
                "max-h-[90dvh] sm:max-h-[88dvh]",
                "animate-[fadeIn_0.2s_ease-out_both]"
              )}
            >
              {/* ── Header ── */}
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-3 py-3 sm:px-5 sm:py-4">
                <div className="min-w-0">
                  <h3 id={titleId} className="font-serif text-lg">
                    Photo library
                  </h3>
                  <p className="truncate text-xs text-muted-foreground">
                    {library
                      ? `${total || photos.length} photos${
                          loadedAll ? "" : ` · ${photos.length} loaded`
                        }`
                      : "Loading…"}
                    {single
                      ? " · pick one"
                      : max !== undefined
                        ? ` · pick up to ${max}`
                        : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={close}
                  className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-lg border border-border text-muted-foreground hover:bg-muted"
                  aria-label="Close photo library"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* ── Filters ── */}
              <div className="shrink-0 border-b border-border px-3 py-3 sm:px-5">
                <MediaFilterBar
                  filters={filters}
                  onChange={setFilters}
                  options={options}
                  suggestions={suggestions}
                  actions={
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      className="h-11 shrink-0"
                      onClick={() => void fetchFirstPage()}
                      disabled={loading}
                    >
                      <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                      <span className="ml-2 hidden sm:inline">Refresh</span>
                    </Button>
                  }
                />
              </div>

              {/* ── Count + select-all (uncapped pickers only) ── */}
              <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1.5 sm:px-5">
                {max === undefined && visible.length > 0 ? (
                  <TriCheckbox
                    checked={allInViewSelected}
                    indeterminate={selectedInView > 0}
                    onChange={toggleAllShown}
                    label={
                      <span className="text-muted-foreground">
                        {selectionSummary({
                          selectedInView,
                          inView: visible.length,
                          totalSelected: selected.length,
                        })}
                      </span>
                    }
                  />
                ) : (
                  <span className="py-2 text-xs text-muted-foreground">
                    {visible.length} shown
                    {selected.length > 0 && ` · ${selected.length} selected`}
                  </span>
                )}
                {!loadedAll && (
                  <span className="text-[11px] text-muted-foreground">
                    {remaining} more not loaded
                    <InfoTip term="Shown" className="shrink-0">
                      Filters and “select all” only ever act on the photos
                      loaded into this window — {photos.length} of {total} so
                      far. Load the rest to include them.
                    </InfoTip>
                  </span>
                )}
              </div>

              {/* ── Grid ── */}
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5 sm:py-4">
                {loading && !library && (
                  <div className="grid place-items-center py-16 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                )}

                {library && visible.length === 0 && (
                  <div className="grid place-items-center py-16 text-center text-sm text-muted-foreground">
                    <p>
                      {photos.length === 0
                        ? "The photo library is empty. Upload images from Admin → Media."
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
                )}

                {visible.length > 0 && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                    {visible.map((p) => {
                      const on = selectedSet.has(p.url);
                      const uses = usage[p.url] ?? [];
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => choose(p.url)}
                          aria-pressed={on}
                          title={
                            uses.length
                              ? `${p.file} — used by ${uses
                                  .map((u) => u.name)
                                  .join(", ")}`
                              : p.file
                          }
                          className={cn(
                            "group relative aspect-square cursor-pointer overflow-hidden rounded-lg border-2 bg-muted transition-colors",
                            on
                              ? "border-accent ring-2 ring-accent/30"
                              : "border-transparent hover:border-border"
                          )}
                        >
                          <Image
                            src={safeSrc(p.url)}
                            alt={photoLabel(p)}
                            fill
                            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 16vw"
                            className="object-cover"
                          />
                          {on && (
                            <span className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-lg bg-accent text-accent-foreground shadow">
                              <Check className="h-3.5 w-3.5" />
                            </span>
                          )}
                          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-2 pt-6">
                            <p className="truncate text-left text-[11px] text-white drop-shadow">
                              {photoLabel(p)}
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

                {!loadedAll && library && (
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
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
              </div>

              {/* ── Footer ── */}
              <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-3 py-3 sm:px-5">
                <p className="flex min-w-0 items-center text-xs text-muted-foreground">
                  <span className="truncate">
                    {single
                      ? selected.length > 0
                        ? "1 photo chosen"
                        : "No photo chosen yet"
                      : `${selected.length} selected`}
                  </span>
                  <InfoTip term="Removing a photo" className="shrink-0">
                    Taking a photo out here only unlinks it from this product or
                    category. The file itself stays in the library and can be
                    added back, or used somewhere else, at any time.
                  </InfoTip>
                </p>
                <Button type="button" size="sm" className="shrink-0" onClick={close}>
                  Done
                </Button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
