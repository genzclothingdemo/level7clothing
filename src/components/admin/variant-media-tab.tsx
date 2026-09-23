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
 *                          Colour, Finish…), or **None**. Nothing below is
 *                          hardcoded to a particular attribute or naming scheme.
 *   1. Variant Previews  — exactly ONE thumbnail per value; this is the image on
 *                          the storefront's variant picker cards.
 *   2. Variant Galleries — per-value galleries (accordion, photo counts on the
 *                          header).
 *   3. Common Gallery    — photos shown for every value (packaging, size chart,
 *                          care card — whatever the whole product shares).
 *
 * With **None**, or with no options at all, 1–3 collapse into one flat gallery.
 *
 * ── One gallery edits one thing ──
 *
 * Each value's section edits and orders ONLY that value's photos. Common photos
 * are edited and ordered ONLY in the Common Gallery. There used to be a merged
 * "Final gallery" strip under every value showing its photos *plus* the common
 * ones tagged `common`, editable from there — and it read as though the common
 * shots belonged to that value, which is exactly the complaint it caused
 * ("agar red variant me photo add kare to woh yaha reflect nahi hone chahiye").
 * It is gone. The merge is a storefront concern, and it happens once, in
 * `galleryForSelection`.
 *
 * Order contract the storefront honours: picking Red shows Red's photos in
 * Red's order, then the common photos in the common order. Never interleaved,
 * and each order is changed in exactly one place. Persisted via
 * `ProductImage.sortOrder` — see `syncProductImages`.
 *
 * ── Spacing ──
 *
 * One scale, the same one form-kit documents: block padding `p-3`, `space-y-3`
 * inside a block, `space-y-4` between them, 44px (`min-h-11`) on every real
 * control. Explanation goes behind an `InfoTip`, never into a paragraph.
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
import { InfoTip } from "@/components/store/info-tip";
import { IMAGE_CONTROLLER_NONE } from "@/lib/variants";
import { cn } from "@/lib/utils";
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
  /**
   * Which option is the visual (gallery-driving) one. `IMAGE_CONTROLLER_NONE`
   * is the admin's explicit "photos don't vary" answer; "" means unset, which
   * defaults to the first option.
   */
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

  // "None" is a real, persisted answer — not the absence of one. It has to
  // survive here rather than collapsing into the `?? optionMatrix[0]` default,
  // which is the whole reason the sentinel is passed in.
  const noneSelected = visualOptionName === IMAGE_CONTROLLER_NONE;

  const visualOption = noneSelected
    ? undefined
    : (optionMatrix.find(
        (o) =>
          visualOptionName &&
          o.name.toLowerCase() === visualOptionName.trim().toLowerCase()
      ) ?? optionMatrix[0]);

  const visualValues = visualOption?.values ?? [];
  // Human label for the image-driving option, used in the section copy.
  const visualName = visualOption?.name || "variant";
  const isActive = (val: string) => !activeValues || activeValues.includes(val);

  // One flat gallery: either nothing varies the photos (None) or there are no
  // options to vary them by. Same screen, same data — the common gallery IS the
  // product gallery in both cases.
  const flat = visualValues.length === 0;

  // Track which accordion sections are open
  const [openSections, setOpenSections] = useState<Set<string>>(() =>
    new Set(visualValues.slice(0, 1)) // open first by default
  );

  // Which image is being dragged: { scope: variantValue | COMMON_SCOPE, index }.
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
  // Drops only apply within the same scope. Since each gallery is now edited on
  // its own, a drag can't even start in one scope and land in another — but the
  // guard stays, because a stale `drag` from a section the admin has since
  // collapsed would otherwise reorder the wrong list.
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

  /**
   * Galleries filed under a value the Image Controller does not drive — because
   * the admin switched which option controls images, or answered **None**.
   *
   * They are **kept in the database**, not deleted: nothing reads a gallery
   * whose `variantValue` no option is filtering on, so they are stored and
   * invisible until that option is chosen again. This used to be computed only
   * under None and announced as "saving drops them", which was both alarming
   * and, in the controller-switch case, silent — switching Colour → Size wiped
   * every Colour gallery with no warning at all. Now it is neither: the same
   * notice fires in both branches and states what actually happens.
   */
  const keptValues = Object.entries(state.galleries)
    .filter(([val, imgs]) => imgs.length > 0 && !visualValues.includes(val))
    .map(([val]) => val);

  const keptNotice = keptValues.length > 0 && (
    <Notice tone="info">
      Photos are also filed under <b>{keptValues.join(", ")}</b>.{" "}
      {flat
        ? "With None, only the Common gallery below is shown — on the product page, on listing cards and on the picker."
        : `Only ${visualName} drives the galleries now, so these are not shown anywhere.`}{" "}
      They stay saved: pick that option as the Image Controller again and they
      come straight back.
    </Notice>
  );

  const controller = optionMatrix.length > 0 && onVisualOptionChange && (
    <Block>
      <SectionHeader
        title="Image Controller"
        tip={
          <>
            Which option&apos;s values swap the photos. Combinations differing
            only by the other options reuse the same gallery, so you shoot once
            per value rather than once per combination — Colour is almost always
            the right answer, Size almost never. Pick <b>None</b> when the photos
            are the same whatever the customer chooses; the product then has one
            gallery and every option is offered as plain buttons.
          </>
        }
        aside={
          <span className="text-xs text-muted-foreground">
            {flat ? "One gallery for the whole product" : `${visualValues.length} galleries`}
          </span>
        }
      />
      <select
        value={noneSelected ? IMAGE_CONTROLLER_NONE : visualName}
        onChange={(e) => onVisualOptionChange(e.target.value)}
        aria-label="Option that controls the galleries"
        className="input max-w-sm"
      >
        <option value={IMAGE_CONTROLLER_NONE}>
          None — photos don&apos;t vary by option
        </option>
        {optionMatrix.map((o) => (
          <option key={o.name} value={o.name}>
            {o.name} — {o.values.length} value{o.values.length === 1 ? "" : "s"}
          </option>
        ))}
      </select>
      {keptNotice}
    </Block>
  );

  // ── One flat gallery: None, or a product with no options ──
  if (flat) {
    return (
      <div className="space-y-4">
        {controller}
        <Block>
          <SectionHeader
            title="Product Gallery"
            tip="Every photo this product has, in the order the customer swipes them. The first is the cover shown on listing cards, in search results and on social previews. Drag to reorder."
            aside={
              <span className="text-xs text-muted-foreground">
                {countLabel(state.common.length)}
              </span>
            }
          />
          <GalleryActions
            selected={state.common}
            onChange={setCommon}
            preferCategory={productCategory}
            preferSubcategory={productSubcategory}
            preferVariantValue=""
            onUploadFiles={onUploadFiles}
            onUploaded={(urls) => appendTo(COMMON_SCOPE, urls)}
          />
          {state.common.length > 0 ? (
            <GalleryGrid
              images={state.common}
              scope={COMMON_SCOPE}
              drag={drag}
              setDrag={setDrag}
              onDrop={onDropInCommon}
              onRemove={removeFromCommon}
              firstIsCover
            />
          ) : (
            <Notice tone="warn">
              This product has no photos yet. Add at least one before saving.
            </Notice>
          )}
        </Block>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {controller}

      {/* ── Readiness summary ──
          The preview note below is no longer part of this verdict: it reports a
          placement, not a gap, so it must not hold back the green tick. */}
      <div className="space-y-2">
        {needsPhotos.length === 0 ? (
          <Notice tone="ok">
            Every active {visualName} has its own photos. The storefront picker
            will show a distinct image for each.
          </Notice>
        ) : (
          <Notice tone="warn">
            No photos yet for <b>{needsPhotos.join(", ")}</b>. Without their own
            gallery these fall back to a common photo, so two values look
            identical on the storefront picker.
          </Notice>
        )}
        {/* NOT a warning that the photo is invisible — it isn't. The
              storefront gallery is every ProductImage row for the chosen value
              in sortOrder, and a preview outside its gallery is written at -1,
              so the customer sees it FIRST. The old copy said the opposite
              ("a photo they can't then find in the gallery"), which was
              measured false, and its one action was a no-op on the storefront.
              What is actually true is that this list can't order it. */}
        {previewNotInGallery.length > 0 && (
          <Notice tone="info">
            The preview for <b>{previewNotInGallery.join(", ")}</b> sits outside
            that gallery, so it leads the photos on the product page but
            can&apos;t be dragged into position here.{" "}
            <button
              type="button"
              onClick={() => previewNotInGallery.forEach(addPreviewToGallery)}
              className="cursor-pointer font-medium underline underline-offset-2"
            >
              Add each preview to its gallery
            </button>{" "}
            to place it yourself.
          </Notice>
        )}
      </div>

      {/* ── Section 1: Variant Previews (manually chosen per value) ── */}
      <Block>
        <SectionHeader
          title="Variant Previews"
          tip={`One image per ${visualName} — the thumbnail on the storefront's picker cards. Leave it unset and that value's first gallery photo is used instead, which is usually what you want.`}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
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
                className={cn(
                  "min-w-0 space-y-2 rounded-lg border p-2",
                  effective ? "border-border" : "border-danger/50 bg-danger/5"
                )}
              >
                <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-border bg-muted">
                  {effective ? (
                    <>
                      <Image
                        src={decodeURI(effective)}
                        alt={val}
                        fill
                        sizes="120px"
                        className="object-cover"
                      />
                      {manual ? (
                        <button
                          type="button"
                          onClick={() => setPreview(val, null)}
                          className="absolute right-1 top-1 grid h-7 w-7 cursor-pointer place-items-center rounded-lg bg-black/70 text-white transition-colors hover:bg-danger"
                          aria-label={`Clear the chosen preview for ${val}`}
                          title="Clear manual preview"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[9px] leading-tight text-white">
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

                <div className="min-w-0">
                  <p className="truncate text-center text-xs font-medium" title={val}>
                    {val}
                  </p>
                  <p className="text-center text-[11px] text-muted-foreground">
                    {inactive ? "inactive" : countLabel(gallery.length)}
                  </p>
                </div>

                <div className="[&_button]:w-full [&_button]:justify-center [&_button]:px-2">
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
      </Block>

      {/* ── Section 2: Variant Galleries ── */}
      <Block>
        <SectionHeader
          title={`${visualName} Galleries`}
          tip={
            <>
              The photos shown once a customer picks each {visualName}, in the
              order you drag them into. Each section holds <b>only</b> that
              value&apos;s own photos — nothing shared. Anything the whole
              product shares goes in the Common Gallery below and is appended
              after these on the storefront, never mixed into them.
            </>
          }
          aside={
            <span className="text-xs text-muted-foreground">
              {visualValues.length} {visualName.toLowerCase()}
              {visualValues.length === 1 ? "" : "s"}
            </span>
          }
        />
        <div className="space-y-2">
          {visualValues.map((val) => {
            const gallery = state.galleries[val] ?? [];
            const isOpen = openSections.has(val);
            const inactive = !isActive(val);
            const manual = state.previews[val];
            const previewMissing = !!manual && !gallery.includes(manual);

            return (
              <div key={val} className="overflow-hidden rounded-lg border border-border">
                {/* Accordion header */}
                <button
                  type="button"
                  onClick={() => toggleSection(val)}
                  aria-expanded={isOpen}
                  className="flex min-h-11 w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50"
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {val}
                  </span>
                  {inactive && (
                    <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      inactive
                    </span>
                  )}
                  {gallery.length === 0 && !inactive && (
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-danger" />
                  )}
                  {/* This value's own photos, and nothing else. It used to read
                      "2 / 7", where the 7 counted the common photos too — the
                      number that made them look like they belonged here. */}
                  <span
                    className={cn(
                      "shrink-0 rounded-md px-2 py-0.5 text-xs tabular-nums",
                      gallery.length === 0
                        ? "bg-danger/10 text-danger"
                        : "bg-muted text-muted-foreground"
                    )}
                    title={`${countLabel(gallery.length)} of its own`}
                  >
                    {gallery.length}
                  </span>
                </button>

                {isOpen && (
                  <div className="space-y-3 border-t border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <GalleryActions
                        selected={gallery}
                        onChange={(imgs) => setGallery(val, imgs)}
                        preferCategory={productCategory}
                        preferVariantValue={val}
                        preferSubcategory={productSubcategory}
                        onUploadFiles={onUploadFiles}
                        onUploaded={(urls) => appendTo(val, urls)}
                      />
                      {previewMissing && (
                        <button
                          type="button"
                          onClick={() => addPreviewToGallery(val)}
                          className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-danger/40 bg-danger/5 px-3 text-[11px] font-medium uppercase tracking-widest text-danger transition-colors hover:bg-danger/10"
                        >
                          Use preview in gallery
                        </button>
                      )}
                    </div>

                    {gallery.length > 0 ? (
                      <GalleryGrid
                        images={gallery}
                        scope={val}
                        drag={drag}
                        setDrag={setDrag}
                        onDrop={(target) => onDropInGallery(val, target)}
                        onRemove={(url) => removeFromGallery(val, url)}
                        label={val}
                        previewUrl={state.previews[val]}
                        onSetPreview={(url) => setPreview(val, url)}
                      />
                    ) : (
                      <Notice tone={inactive ? "info" : "warn"}>
                        {inactive
                          ? `No combination with this ${visualName} is available, so photos are optional.`
                          : `No photos for this ${visualName} yet — add some, or the picker card falls back to a common photo.`}
                      </Notice>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Block>

      {/* ── Section 3: Common Gallery ── */}
      <Block>
        <SectionHeader
          title="Common Gallery"
          tip={`Photos the whole product shares — packaging, a size chart, a care card. They are appended AFTER the chosen ${visualName}'s own photos on the storefront, never interleaved, and they are only ever added or reordered here.`}
          aside={
            <span className="text-xs text-muted-foreground">
              {countLabel(state.common.length)} · shown for every {visualName}
            </span>
          }
        />
        <GalleryActions
          selected={state.common}
          onChange={setCommon}
          preferCategory={productCategory}
          preferSubcategory={productSubcategory}
          preferVariantValue="" // "" = common sentinel (no variant tag)
          onUploadFiles={onUploadFiles}
          onUploaded={(urls) => appendTo(COMMON_SCOPE, urls)}
        />
        {state.common.length > 0 ? (
          <GalleryGrid
            images={state.common}
            scope={COMMON_SCOPE}
            drag={drag}
            setDrag={setDrag}
            onDrop={onDropInCommon}
            onRemove={removeFromCommon}
            label="Common"
          />
        ) : (
          <Notice tone="info">
            Optional — leave empty if every photo is {visualName}-specific.
          </Notice>
        )}
      </Block>
    </div>
  );
}

// ---- Helper components ----

/**
 * One section. Every block in this tab has the same border, radius and padding
 * so the tab reads as a rhythm rather than a pile — `p-3` / `space-y-3`, the
 * scale form-kit documents.
 */
function Block({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-3 rounded-lg border border-border p-3">
      {children}
    </div>
  );
}

/**
 * Section title + an `(i)`. The descriptions used to be two-line paragraphs
 * under every heading, which added ~120px of prose to a tab whose whole job is
 * showing photographs. The explanation is unchanged — it just waits to be asked
 * for. `aside` takes a count or a control pinned to the right.
 */
function SectionHeader({
  title,
  tip,
  aside,
}: {
  title: string;
  tip: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-2 gap-y-1">
      <h4 className="flex items-center gap-1 text-sm font-medium">
        {title}
        <InfoTip term={title}>{tip}</InfoTip>
      </h4>
      {aside}
    </div>
  );
}

/**
 * The picker + upload pair that opens every gallery. One component so the two
 * buttons keep the same height and gap wherever a gallery appears — they had
 * drifted to 44px and 36px sitting next to each other.
 */
function GalleryActions({
  selected,
  onChange,
  preferCategory,
  preferSubcategory,
  preferVariantValue,
  onUploadFiles,
  onUploaded,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  preferCategory?: string;
  preferSubcategory?: string;
  preferVariantValue?: string;
  onUploadFiles?: (files: File[]) => Promise<string[]>;
  onUploaded: (urls: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <PhotoPicker
        selected={selected}
        onChange={onChange}
        preferCategory={preferCategory}
        preferSubcategory={preferSubcategory}
        preferVariantValue={preferVariantValue}
        label={pickerLabel(selected.length)}
      />
      {onUploadFiles && (
        <UploadButton onFiles={async (files) => onUploaded(await onUploadFiles(files))} />
      )}
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
      className={cn(
        "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card px-4",
        "text-sm transition-colors hover:bg-muted",
        busy && "pointer-events-none opacity-60"
      )}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Upload className="h-4 w-4" />
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

/**
 * Square, draggable photo grid — the ONE grid every gallery uses, so a variant
 * gallery and the common gallery cannot drift apart in size, spacing or
 * controls. It edits exactly the list it is given: there is no second,
 * read-only view of these photos anywhere.
 */
function GalleryGrid({
  images,
  scope,
  drag,
  setDrag,
  onDrop,
  onRemove,
  firstIsCover = false,
  label,
  previewUrl,
  onSetPreview,
}: {
  images: string[];
  scope: string;
  drag: { scope: string; index: number } | null;
  setDrag: (d: { scope: string; index: number } | null) => void;
  onDrop: (target: number) => void;
  onRemove: (url: string) => void;
  firstIsCover?: boolean;
  /** Used in the alt text, so screen readers can tell two grids apart. */
  label?: string;
  /** The value's chosen preview, when this grid belongs to one. */
  previewUrl?: string;
  onSetPreview?: (url: string) => void;
}) {
  if (images.length === 0) return null;
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7">
      {images.map((img, i) => (
        <div
          key={img}
          draggable
          onDragStart={() => setDrag({ scope, index: i })}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => onDrop(i)}
          onDragEnd={() => setDrag(null)}
          className={cn(
            "group relative aspect-square cursor-move overflow-hidden rounded-lg border bg-muted transition-all",
            drag?.scope === scope && drag.index === i
              ? "border-accent opacity-40 ring-2 ring-accent"
              : "border-border"
          )}
        >
          <Image
            src={decodeURI(img)}
            alt={`${label ? `${label} ` : ""}image ${i + 1}`}
            fill
            sizes="96px"
            className="pointer-events-none object-cover"
          />
          {firstIsCover && i === 0 && (
            <span className="absolute inset-x-0 bottom-0 bg-accent/90 py-0.5 text-center text-[9px] font-semibold text-white">
              Cover
            </span>
          )}
          <span className="absolute left-1 top-1 grid h-7 w-7 place-items-center rounded-lg bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100">
            <GripVertical className="h-3.5 w-3.5" />
          </span>
          {onSetPreview && previewUrl === img && (
            <span className="absolute inset-x-0 bottom-0 bg-accent/90 py-0.5 text-center text-[9px] font-semibold text-white">
              Preview
            </span>
          )}
          {onSetPreview && previewUrl !== img && (
            <button
              type="button"
              onClick={() => onSetPreview(img)}
              className="absolute inset-x-0 bottom-0 cursor-pointer bg-black/60 py-1 text-center text-[9px] text-white opacity-0 transition-opacity group-hover:opacity-100"
              title="Use this as the picker thumbnail"
            >
              Set preview
            </button>
          )}
          <button
            type="button"
            onClick={() => onRemove(img)}
            className="absolute right-1 top-1 grid h-7 w-7 cursor-pointer place-items-center rounded-lg bg-black/70 text-white opacity-0 transition-opacity hover:bg-danger group-hover:opacity-100"
            aria-label={`Remove ${label ? `${label} ` : ""}image ${i + 1}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
