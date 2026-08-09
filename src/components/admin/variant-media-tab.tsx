"use client";

/**
 * VariantMediaTab — the "Media" tab, and the ONLY place a product's photos are
 * managed. (The old "Images" card on the details form was removed: two image
 * systems writing to the same gallery was the single biggest source of admin
 * confusion.)
 *
 * Sections, in the order an admin works through them:
 *
 *   0. Image Controller  — which option's values swap the gallery (Design,
 *                          Colour, Finish, …). Nothing below is hardcoded to a
 *                          particular attribute or photo naming scheme.
 *   1. Variant Previews  — exactly ONE thumbnail per value; this is the image on
 *                          the storefront's variant picker cards.
 *   2. Variant Galleries — per-value galleries (accordion, photo counts on the
 *                          header), each with an editable "Final gallery"
 *                          preview of what the customer will actually swipe.
 *   3. Common Gallery    — photos shown for every value (packaging, dimensions,
 *                          care card — whatever the product needs).
 *
 * Products with NO options skip 0–2 entirely and manage one flat gallery.
 *
 * Order rule: the Final gallery for a value = that value's photos (in the
 * admin's drag order) THEN the common photos (in their drag order). Common
 * photos are never interleaved into the middle of the variant photos — reorder
 * happens WITHIN each group. Persisted via ProductImage.sortOrder (see
 * syncProductImages).
 *
 * Bidirectional editing: the Final gallery is fully interactive — delete or
 * reorder there and the source (variant gallery OR common gallery) updates.
 */

import { useState } from "react";
import Image from "next/image";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { PhotoPicker } from "@/components/admin/photo-picker";
import type { ProductOption } from "@/lib/types";

export type VisualGalleryState = {
  /** key = variantValue string; null key = "common" gallery */
  galleries: Record<string, string[]>;
  /**
   * Preview thumbnail per variant value — the image on the storefront's variant
   * picker card. Manually chosen here; falls back to the value's first gallery
   * photo at save time (see product-form.tsx).
   */
  previews: Record<string, string>;
  common: string[];
};

type Props = {
  options: ProductOption[];
  /** Which option is the visual (gallery-driving) one. Defaults to first option. */
  visualOptionName?: string;
  /** Lets the Image Controller live inside this tab rather than above it. */
  onVisualOptionChange?: (name: string) => void;
  state: VisualGalleryState;
  onChange: (next: VisualGalleryState) => void;
  productCategory?: string;
  productSubcategory?: string;
  /**
   * Values that still have at least one available combo. Values outside this set
   * are flagged as inactive and exempt from the "needs photos" check, so an
   * admin isn't forced to shoot a design they've switched off.
   */
  activeValues?: string[];
  /** Uploads files and resolves with their public URLs (empty on failure). */
  onUploadFiles?: (files: File[]) => Promise<string[]>;
};

/** Sentinel scope for the common gallery when tracking a drag. */
const COMMON_SCOPE = "__common__";

/** Reorder helper — move `from` to `to`, returning a new array. */
function reorder(list: string[], from: number, to: number): string[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Photo count label — "No photos" / "1 photo" / "6 photos". */
function countLabel(n: number) {
  if (n === 0) return "No photos";
  return `${n} photo${n === 1 ? "" : "s"}`;
}

/** Picker label that tells the admin how many photos are already assigned. */
function pickerLabel(n: number) {
  return n === 0 ? "+ Add Images" : `Manage Images (${n})`;
}

export function VariantMediaTab({
  options,
  visualOptionName,
  onVisualOptionChange,
  state,
  onChange,
  productCategory,
  productSubcategory,
  activeValues,
  onUploadFiles,
}: Props) {
  // The option matrix, cleaned the same way the variant builder cleans it, so
  // the controller never offers an option with no usable choices.
  const optionMatrix = options
    .map((o) => ({
      name: o.name.trim(),
      values: o.choices.map((c) => c.label.trim()).filter(Boolean),
    }))
    .filter((o) => o.name && o.values.length > 0);

  const visualOption =
    optionMatrix.find(
      (o) =>
        visualOptionName &&
        o.name.toLowerCase() === visualOptionName.trim().toLowerCase()
    ) ?? optionMatrix[0];

  const visualValues = visualOption?.values ?? [];
  // Human label for the image-driving option, used in the section copy.
  const visualName = visualOption?.name || "variant";
  const isActive = (val: string) => !activeValues || activeValues.includes(val);

  // Track which accordion sections are open
  const [openSections, setOpenSections] = useState<Set<string>>(() =>
    new Set(visualValues.slice(0, 1)) // open first by default
  );

  // Which image is being dragged: { scope: variantValue | COMMON_SCOPE, index }.
  // `index` is LOCAL to the source array (not the combined Final index).
  const [drag, setDrag] = useState<{ scope: string; index: number } | null>(null);

  function toggleSection(val: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val);
      else next.add(val);
      return next;
    });
  }

  // ---- Gallery helpers ----

  function setGallery(variantValue: string, images: string[]) {
    onChange({
      ...state,
      galleries: { ...state.galleries, [variantValue]: images },
    });
  }

  function setCommon(images: string[]) {
    onChange({ ...state, common: images });
  }

  /** Append newly uploaded urls to a scope, skipping ones already present. */
  function appendTo(scope: string, urls: string[]) {
    if (!urls.length) return;
    if (scope === COMMON_SCOPE) {
      setCommon([...state.common, ...urls.filter((u) => !state.common.includes(u))]);
      return;
    }
    const cur = state.galleries[scope] ?? [];
    setGallery(scope, [...cur, ...urls.filter((u) => !cur.includes(u))]);
  }

  // Manually chosen preview thumbnail per variant value.
  function setPreview(variantValue: string, url: string | null) {
    const previews = { ...state.previews };
    if (url === null) delete previews[variantValue];
    else previews[variantValue] = url;
    onChange({ ...state, previews });
  }

  /** Push a preview that isn't in its gallery to the front of that gallery. */
  function addPreviewToGallery(variantValue: string) {
    const url = state.previews[variantValue];
    if (!url) return;
    const cur = state.galleries[variantValue] ?? [];
    if (cur.includes(url)) return;
    setGallery(variantValue, [url, ...cur]);
  }

  // Remove a single image from a variant gallery (clears the preview too when
  // it pointed at the removed photo).
  function removeFromGallery(variantValue: string, url: string) {
    const cur = state.galleries[variantValue] ?? [];
    const galleries = { ...state.galleries, [variantValue]: cur.filter((u) => u !== url) };
    const previews = { ...state.previews };
    if (previews[variantValue] === url) delete previews[variantValue];
    onChange({ ...state, galleries, previews });
  }

  function removeFromCommon(url: string) {
    setCommon(state.common.filter((u) => u !== url));
  }

  // ---- Drag-and-drop reordering ----
  // Drops only apply within the same scope — dragging a common photo onto a
  // variant slot (or vice versa) is a no-op so the "variant photos first, then
  // common" rule is preserved.
  function onDropInGallery(variantValue: string, target: number) {
    if (drag && drag.scope === variantValue) {
      setGallery(variantValue, reorder(state.galleries[variantValue] ?? [], drag.index, target));
    }
    setDrag(null);
  }

  function onDropInCommon(target: number) {
    if (drag && drag.scope === COMMON_SCOPE) {
      setCommon(reorder(state.common, drag.index, target));
    }
    setDrag(null);
  }

  // ---- Readiness summary (mirrors the save-time validation) ----
  const needsPhotos = visualValues.filter(
    (v) => isActive(v) && (state.galleries[v]?.length ?? 0) === 0
  );
  const previewNotInGallery = visualValues.filter((v) => {
    const p = state.previews[v];
    return p && !(state.galleries[v] ?? []).includes(p);
  });

  // ── Products with no options: one flat gallery, nothing else ──
  if (visualValues.length === 0) {
    return (
      <div className="space-y-3">
        <SectionHeader
          title="Product Gallery"
          description="This product has no options, so it has a single gallery. The first photo is the cover shown on listings. Drag to reorder."
        />
        <GalleryGrid
          images={state.common}
          scope={COMMON_SCOPE}
          drag={drag}
          setDrag={setDrag}
          onDrop={onDropInCommon}
          onRemove={removeFromCommon}
          firstIsCover
        />
        <div className="flex flex-wrap items-center gap-2">
          <PhotoPicker
            selected={state.common}
            onChange={setCommon}
            preferCategory={productCategory}
            preferSubcategory={productSubcategory}
            preferVariantValue=""
            label={pickerLabel(state.common.length)}
          />
          {onUploadFiles && (
            <UploadButton
              onFiles={async (files) => appendTo(COMMON_SCOPE, await onUploadFiles(files))}
            />
          )}
        </div>
        {state.common.length === 0 && (
          <Notice tone="warn">
            This product has no photos yet. Add at least one before saving.
          </Notice>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Readiness summary ── */}
      {needsPhotos.length === 0 && previewNotInGallery.length === 0 ? (
        <Notice tone="ok">
          Every active {visualName} has its own photos. The storefront picker will
          show a distinct image for each.
        </Notice>
      ) : (
        <div className="space-y-2">
          {needsPhotos.length > 0 && (
            <Notice tone="warn">
              No photos yet for <b>{needsPhotos.join(", ")}</b>. Without their own
              gallery these fall back to a common photo, so two values look
              identical on the storefront picker.
            </Notice>
          )}
          {previewNotInGallery.length > 0 && (
            <Notice tone="warn">
              The preview for <b>{previewNotInGallery.join(", ")}</b> is not in
              that gallery — the customer sees a photo on the picker card that
              they can&apos;t then find in the gallery.{" "}
              <button
                type="button"
                onClick={() => previewNotInGallery.forEach(addPreviewToGallery)}
                className="font-medium underline underline-offset-2"
              >
                Add each preview to its gallery
              </button>
            </Notice>
          )}
        </div>
      )}

      {/* ── Section 0: Image Controller ── */}
      {optionMatrix.length > 1 && onVisualOptionChange && (
        <div>
          <SectionHeader
            title="Image Controller"
            description="Which option's values swap the photos. Combinations differing only by the other options reuse the same gallery — so you shoot once per value, not once per combination."
          />
          <select
            value={visualName}
            onChange={(e) => onVisualOptionChange(e.target.value)}
            className="input mt-3 max-w-xs"
          >
            {optionMatrix.map((o) => (
              <option key={o.name} value={o.name}>
                {o.name} — {o.values.length} value{o.values.length === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* ── Section 1: Variant Previews (manually chosen per value) ── */}
      <div>
        <SectionHeader
          title="Variant Previews"
          description={`One image per ${visualName} — this is the thumbnail on the storefront's picker cards. Leave it unset to use that value's first gallery photo.`}
        />
        <div className="mt-3 flex flex-wrap gap-3">
          {visualValues.map((val) => {
            const manual = state.previews[val] ?? null;
            const gallery = state.galleries[val] ?? [];
            // What the customer will actually see: the manual pick, else the
            // gallery's first photo (the same fallback the save path applies).
            const effective = manual ?? gallery[0] ?? null;
            const inactive = !isActive(val);

            return (
              <div
                key={val}
                className={`w-[104px] rounded-xl border p-2 ${
                  effective ? "border-border" : "border-danger/50 bg-danger/5"
                }`}
              >
                <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-border bg-muted">
                  {effective ? (
                    <>
                      <Image
                        src={decodeURI(effective)}
                        alt={val}
                        fill
                        sizes="96px"
                        className="object-cover"
                      />
                      {manual ? (
                        <button
                          type="button"
                          onClick={() => setPreview(val, null)}
                          className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-white hover:bg-danger"
                          aria-label="Clear preview"
                          title="Clear manual preview"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      ) : (
                        <span className="absolute inset-x-0 bottom-0 bg-black/60 text-center text-[8px] leading-tight text-white">
                          auto
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="grid h-full w-full place-items-center text-[10px] text-muted-foreground">
                      No preview
                    </span>
                  )}
                </div>

                <p className="mt-1.5 truncate text-center text-[11px] font-medium" title={val}>
                  {val}
                </p>
                <p className="text-center text-[10px] text-muted-foreground">
                  {inactive ? "inactive" : countLabel(gallery.length)}
                </p>

                <div className="mt-1.5 [&_button]:w-full [&_button]:justify-center">
                  <PhotoPicker
                    selected={manual ? [manual] : []}
                    onChange={([url]) => setPreview(val, url ?? null)}
                    max={1}
                    preferCategory={productCategory}
                    preferVariantValue={val}
                    preferSubcategory={productSubcategory}
                    label={manual ? "Change" : "Set"}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Section 2: Variant Galleries ── */}
      <div>
        <SectionHeader
          title={`${visualName} Galleries`}
          description={`The photos shown when a customer picks each ${visualName}. Any number per value — some may have three, others eight. The Final gallery is what they'll actually swipe through.`}
        />
        <div className="mt-3 space-y-2">
          {visualValues.map((val) => {
            const gallery = state.galleries[val] ?? [];
            const isOpen = openSections.has(val);
            const inactive = !isActive(val);
            const manual = state.previews[val];
            const previewMissing = !!manual && !gallery.includes(manual);
            // Default (and only) order: this value's gallery first, then the
            // common gallery. Reorder within each group by dragging; common
            // photos are never interleaved into the middle of the variant photos.
            const finalGallery = [...gallery, ...state.common];

            return (
              <div key={val} className="overflow-hidden rounded-xl border border-border">
                {/* Accordion header */}
                <button
                  type="button"
                  onClick={() => toggleSection(val)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="flex-1 text-sm font-medium">{val}</span>
                  {inactive && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      inactive
                    </span>
                  )}
                  {gallery.length === 0 && !inactive && (
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-danger" />
                  )}
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                      gallery.length === 0
                        ? "bg-danger/10 text-danger"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {countLabel(gallery.length)}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    → {finalGallery.length} total
                  </span>
                </button>

                {isOpen && (
                  <div className="space-y-3 border-t border-border px-4 pb-4 pt-3">
                    {/* Actions row */}
                    <div className="flex flex-wrap items-center gap-2">
                      <PhotoPicker
                        selected={gallery}
                        onChange={(imgs) => setGallery(val, imgs)}
                        preferCategory={productCategory}
                        preferVariantValue={val}
                        preferSubcategory={productSubcategory}
                        label={pickerLabel(gallery.length)}
                      />
                      {onUploadFiles && (
                        <UploadButton
                          onFiles={async (files) => appendTo(val, await onUploadFiles(files))}
                        />
                      )}
                      {previewMissing && (
                        <button
                          type="button"
                          onClick={() => addPreviewToGallery(val)}
                          className="rounded-full border border-danger/40 bg-danger/5 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10"
                        >
                          Use preview in gallery
                        </button>
                      )}
                    </div>

                    {/* Variant-only gallery grid (drag to reorder, click X to remove).
                        Editing here reflects in the Final gallery below. */}
                    {gallery.length > 0 ? (
                      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                        {gallery.map((img, i) => (
                          <div
                            key={img}
                            draggable
                            onDragStart={() => setDrag({ scope: val, index: i })}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => onDropInGallery(val, i)}
                            onDragEnd={() => setDrag(null)}
                            className={`group relative aspect-square cursor-move overflow-hidden rounded-lg border bg-muted transition-all ${
                              drag?.scope === val && drag.index === i
                                ? "border-accent opacity-40 ring-2 ring-accent"
                                : "border-border"
                            }`}
                          >
                            <Image
                              src={decodeURI(img)}
                              alt={`${val} image ${i + 1}`}
                              fill
                              sizes="80px"
                              className="pointer-events-none object-cover"
                            />
                            {/* Drag handle hint */}
                            <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100">
                              <GripVertical className="h-3 w-3" />
                            </span>
                            {/* Set as preview / preview badge (manual choice) */}
                            {state.previews[val] !== img && (
                              <button
                                type="button"
                                onClick={() => setPreview(val, img)}
                                className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[9px] text-white opacity-0 transition-opacity group-hover:opacity-100"
                                title="Set as preview"
                              >
                                Set preview
                              </button>
                            )}
                            {state.previews[val] === img && (
                              <span className="absolute left-1 top-1 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-semibold text-white">
                                Preview
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => removeFromGallery(val, img)}
                              className="absolute bottom-1 right-1 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-white opacity-0 transition-opacity hover:bg-danger group-hover:opacity-100"
                              aria-label="Remove"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Notice tone={inactive ? "info" : "warn"}>
                        {inactive
                          ? `No combination with this ${visualName} is available, so photos are optional.`
                          : `No photos for this ${visualName} yet — add some, or the picker card falls back to a common photo.`}
                      </Notice>
                    )}

                    {/* Interactive "Final gallery" — variant gallery + common.
                        Removing/reordering here writes back to the correct
                        source (variant vs. common). */}
                    <div>
                      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        Final gallery ({finalGallery.length}) — what the customer
                        swipes. Drag to reorder, × to remove.
                      </p>
                      {finalGallery.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {finalGallery.map((img, i) => {
                            const isCommon = i >= gallery.length;
                            const scope = isCommon ? COMMON_SCOPE : val;
                            const localIndex = isCommon ? i - gallery.length : i;
                            const isDragging =
                              drag?.scope === scope && drag.index === localIndex;
                            return (
                              <div
                                key={`${img}-${i}`}
                                draggable
                                onDragStart={() => setDrag({ scope, index: localIndex })}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={() => {
                                  if (isCommon) onDropInCommon(localIndex);
                                  else onDropInGallery(val, localIndex);
                                }}
                                onDragEnd={() => setDrag(null)}
                                className={`group relative h-14 w-14 cursor-move overflow-hidden rounded-md border bg-muted transition-all ${
                                  isDragging
                                    ? "border-accent opacity-40 ring-2 ring-accent"
                                    : "border-border"
                                }`}
                                title={isCommon ? "Common image" : `${visualName} image`}
                              >
                                <Image
                                  src={decodeURI(img)}
                                  alt={`Final ${i + 1}`}
                                  fill
                                  sizes="56px"
                                  className="pointer-events-none object-cover"
                                />
                                {isCommon && (
                                  <span className="absolute inset-x-0 bottom-0 bg-black/60 text-center text-[7px] leading-tight text-white">
                                    common
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (isCommon) removeFromCommon(img);
                                    else removeFromGallery(val, img);
                                  }}
                                  className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-black/70 text-white opacity-0 transition-opacity hover:bg-danger group-hover:opacity-100"
                                  aria-label="Remove"
                                >
                                  <X className="h-2.5 w-2.5" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Nothing yet — this {visualName} has no photos and there are
                          no common photos.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Section 3: Common Gallery ── */}
      <div>
        <SectionHeader
          title="Common Gallery"
          description={`Photos appended to every ${visualName}'s gallery — packaging, dimensions, a care card, whatever this product needs. Drag to reorder; they always come after the ${visualName} photos.`}
        />
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <PhotoPicker
              selected={state.common}
              onChange={setCommon}
              preferCategory={productCategory}
              preferSubcategory={productSubcategory}
              preferVariantValue=""   // "" = common sentinel (no variant tag)
              label={pickerLabel(state.common.length)}
            />
            {onUploadFiles && (
              <UploadButton
                onFiles={async (files) => appendTo(COMMON_SCOPE, await onUploadFiles(files))}
              />
            )}
            <span className="text-xs text-muted-foreground">
              {countLabel(state.common.length)} · added to all{" "}
              {visualValues.length} {visualName} galleries
            </span>
          </div>
          {state.common.length > 0 ? (
            <GalleryGrid
              images={state.common}
              scope={COMMON_SCOPE}
              drag={drag}
              setDrag={setDrag}
              onDrop={onDropInCommon}
              onRemove={removeFromCommon}
            />
          ) : (
            <Notice tone="info">
              Optional — leave empty if every photo is {visualName}-specific.
            </Notice>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Helper components ----

function SectionHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h4 className="text-sm font-medium">{title}</h4>
      <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "info";
  children: React.ReactNode;
}) {
  const styles = {
    ok: "border-green-600/30 bg-green-600/5 text-green-700",
    warn: "border-danger/40 bg-danger/5 text-danger",
    info: "border-border bg-muted/40 text-muted-foreground",
  }[tone];
  const Icon = tone === "ok" ? Check : tone === "warn" ? AlertTriangle : null;
  return (
    <div className={`flex gap-2 rounded-lg border px-3 py-2 text-xs ${styles}`}>
      {Icon && <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <span className="leading-relaxed">{children}</span>
    </div>
  );
}

/** Upload straight into the section being edited, so files land where expected. */
function UploadButton({ onFiles }: { onFiles: (files: File[]) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <label
      className={`inline-flex cursor-pointer items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted ${
        busy ? "pointer-events-none opacity-60" : ""
      }`}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Upload className="h-3.5 w-3.5" />
      )}
      Upload
      <input
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        disabled={busy}
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (!files.length) return;
          setBusy(true);
          try {
            await onFiles(files);
          } finally {
            setBusy(false);
          }
        }}
      />
    </label>
  );
}

/** Square, draggable photo grid — used by the common/flat galleries. */
function GalleryGrid({
  images,
  scope,
  drag,
  setDrag,
  onDrop,
  onRemove,
  firstIsCover = false,
}: {
  images: string[];
  scope: string;
  drag: { scope: string; index: number } | null;
  setDrag: (d: { scope: string; index: number } | null) => void;
  onDrop: (target: number) => void;
  onRemove: (url: string) => void;
  firstIsCover?: boolean;
}) {
  if (images.length === 0) return null;
  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
      {images.map((img, i) => (
        <div
          key={img}
          draggable
          onDragStart={() => setDrag({ scope, index: i })}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => onDrop(i)}
          onDragEnd={() => setDrag(null)}
          className={`group relative aspect-square cursor-move overflow-hidden rounded-lg border bg-muted transition-all ${
            drag?.scope === scope && drag.index === i
              ? "border-accent opacity-40 ring-2 ring-accent"
              : "border-border"
          }`}
        >
          <Image
            src={decodeURI(img)}
            alt={`Image ${i + 1}`}
            fill
            sizes="80px"
            className="pointer-events-none object-cover"
          />
          {firstIsCover && i === 0 && (
            <span className="absolute inset-x-0 bottom-0 bg-accent/90 text-center text-[9px] font-semibold text-white">
              Cover
            </span>
          )}
          <span className="absolute left-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100">
            <GripVertical className="h-3 w-3" />
          </span>
          <button
            type="button"
            onClick={() => onRemove(img)}
            className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-white opacity-0 transition-opacity hover:bg-danger group-hover:opacity-100"
            aria-label="Remove"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
