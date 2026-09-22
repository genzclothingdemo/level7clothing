"use client";

/**
 * The portfolio piece editor.
 *
 * Carries the three rules the rest of this admin follows:
 *
 * 1. **Every explanation is an `(i)`, never a paragraph under the field** —
 *    reached through `form-kit`'s `Field`, which uses the storefront's
 *    portalled, tap-driven `InfoTip`.
 * 2. **Fields that don't apply aren't shown.** The embed box only appears once
 *    there is a link to embed; the product picker explains which tab the piece
 *    will land on as you change it.
 * 3. **A live verdict sits at the top**, in the same words the list uses, so
 *    "showing" cannot mean one thing here and another there.
 *
 * The photo comes from the same `PhotoPicker` every other admin screen uses,
 * with a URL box beside it for a poster that isn't in the library (an
 * Instagram CDN thumbnail, say). Both write the one `imageUrl` column — there
 * is deliberately no second source of truth, which is the lost-update trap
 * CLAUDE.md records for `defaultReturnsInfo`.
 */

import { useCallback, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Download, Eye, EyeOff, Image as ImageIcon, Loader2, Star } from "lucide-react";
import { Card, Field, Segmented, SwitchRow } from "@/components/admin/form-kit";
import { PhotoPicker } from "@/components/admin/photo-picker";
import {
  createPortfolioItem,
  importInstagramPost,
  updatePortfolioItem,
} from "@/app/actions/portfolio";
import type { PortfolioKind } from "@/lib/portfolio";
import { instagramShortcode } from "@/lib/instagram-resolve";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Shape                                                              */
/* ------------------------------------------------------------------ */

/** Everything as strings, because that is what the inputs hold and what the
 *  server action parses out of `FormData`. */
export type PortfolioFormValues = {
  title: string;
  description: string;
  kind: PortfolioKind;
  url: string;
  imageUrl: string;
  embedHtml: string;
  productId: string;
  /** Comma-separated in the form; split and de-duplicated server-side. */
  tags: string;
  sortOrder: string;
  isFeatured: boolean;
  isActive: boolean;
};

export const EMPTY_PORTFOLIO_ITEM: PortfolioFormValues = {
  title: "",
  description: "",
  // Instagram is the default because it is what most of this table will be,
  // and it matches the column default in the schema.
  kind: "instagram",
  url: "",
  imageUrl: "",
  embedHtml: "",
  productId: "",
  tags: "",
  sortOrder: "0",
  isFeatured: false,
  isActive: true,
};

/**
 * The kinds, as UI copy. Declared here rather than imported from
 * `lib/portfolio.ts`: that module imports Prisma, so pulling a *runtime* value
 * out of it across the client boundary would drag the database client into the
 * browser bundle. Types are erased, so `PortfolioKind` above is free.
 */
const KIND_OPTIONS: { value: PortfolioKind; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "video", label: "Video" },
  { value: "image", label: "Image" },
  { value: "link", label: "Link" },
];

/* ------------------------------------------------------------------ */
/*  The form                                                           */
/* ------------------------------------------------------------------ */

export function PortfolioForm({
  itemId,
  initial,
  products,
}: {
  /** Absent when creating. */
  itemId?: string;
  initial: PortfolioFormValues;
  /** Active products offered in the "about one product" picker. */
  products: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [v, setV] = useState<PortfolioFormValues>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ---- Instagram import ---------------------------------------------
     Paste a permalink, press the button, and the caption, the embed and a
     *copy* of the poster arrive filled in. The copy matters: Instagram's
     CDN addresses carry a signed expiry — four days on the posts this was
     built against — so the obvious move of pasting the image address gives
     a grid that breaks next week with nothing to explain it. The action
     puts the bytes in our own blob store and returns that address. */
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<{
    author: string | null;
    warning?: string;
  } | null>(null);

  const runImport = useCallback(async () => {
    setImporting(true);
    setError(null);
    setImported(null);
    const res = await importInstagramPost(v.url);
    setImporting(false);

    if (!res.success) {
      setError(res.error);
      return;
    }

    setV((prev) => ({
      ...prev,
      kind: "instagram",
      url: res.url,
      // Never clobber a title the owner has already written.
      title: prev.title.trim() || res.title || prev.title,
      imageUrl: res.imageUrl ?? prev.imageUrl,
      embedHtml: res.embedHtml,
    }));
    setImported({ author: res.author, warning: res.warning });
  }, [v.url]);

  const set = useCallback(
    <K extends keyof PortfolioFormValues>(
      key: K,
      value: PortfolioFormValues[K]
    ) => {
      setV((prev) => ({ ...prev, [key]: value }));
      setError(null);
    },
    []
  );

  /** The one sentence that answers "where does this end up?". */
  const verdict = useMemo(() => {
    if (!v.isActive) {
      return { tone: "idle" as const, line: "Hidden. Nobody sees this piece." };
    }
    if (v.productId) {
      return {
        tone: "good" as const,
        line: 'Shows under "From our products", linked to that product.',
      };
    }
    return {
      tone: "good" as const,
      line: 'Shows under "Everything else".',
    };
  }, [v.isActive, v.productId]);

  /** Nothing to show = a title on a grey box. Mirrored server-side. */
  const emptyPiece =
    !v.imageUrl.trim() && !v.url.trim() && !v.embedHtml.trim() && !v.productId;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const fd = new FormData();
    fd.append("title", v.title);
    fd.append("description", v.description);
    fd.append("kind", v.kind);
    fd.append("url", v.url);
    fd.append("imageUrl", v.imageUrl);
    fd.append("embedHtml", v.embedHtml);
    fd.append("productId", v.productId);
    fd.append("tags", v.tags);
    fd.append("sortOrder", v.sortOrder);
    fd.append("isFeatured", String(v.isFeatured));
    fd.append("isActive", String(v.isActive));

    const res = itemId
      ? await updatePortfolioItem(itemId, fd)
      : await createPortfolioItem(fd);

    setSaving(false);
    if (res.success) {
      router.push("/admin/portfolio");
      router.refresh();
    } else {
      setError(res.error ?? "Couldn't save this piece.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="min-w-0 space-y-4">
      {/* ---- Verdict ---- */}
      <div
        className={cn(
          "min-w-0 rounded-2xl border p-4 sm:p-5",
          verdict.tone === "good"
            ? "border-success/40 bg-success/10"
            : "border-border bg-muted/30"
        )}
      >
        <p className="eyebrow text-muted-foreground">Where this shows</p>
        <p className="mt-2 break-words font-serif text-lg leading-snug">
          {verdict.line}
        </p>
      </div>

      {/* ---- The piece ---- */}
      <Card
        title="The piece"
        tip="What this is and what it says. The title is what a visitor reads under the tile, so write it for them, not for your own filing."
      >
        <Field label="Title" required>
          {(id) => (
            <input
              id={id}
              value={v.title}
              onChange={(e) => set("title", e.target.value)}
              maxLength={120}
              placeholder="Core tee — street shoot"
              className="input"
            />
          )}
        </Field>

        <Field
          label="Kind"
          tip="Only affects how the tile is framed and labelled. An Instagram piece is framed portrait, like a reel; a video or link is framed landscape unless the link itself says otherwise."
        >
          <Segmented
            value={v.kind}
            onChange={(next) => set("kind", next)}
            options={KIND_OPTIONS}
            ariaLabel="Kind of piece"
          />
        </Field>

        <Field
          label="Description"
          tip="Shown when someone opens the piece, not on the tile. Leave it blank if the title says enough."
        >
          {(id) => (
            <textarea
              id={id}
              value={v.description}
              onChange={(e) => set("description", e.target.value)}
              rows={3}
              maxLength={600}
              className="input"
            />
          )}
        </Field>

        <Field
          label="Tags"
          tip="Comma separated. They show as small chips under the tile and are searchable in this admin — useful for grouping a shoot or a collaboration."
        >
          {(id) => (
            <input
              id={id}
              value={v.tags}
              onChange={(e) => set("tags", e.target.value)}
              placeholder="bulk order, collaboration"
              className="input"
            />
          )}
        </Field>
      </Card>

      {/* ---- Where it points ---- */}
      <Card
        title="Where it points"
        tip="A tile needs something to open: a link, an image, an embed, or a product. Give it at least one."
      >
        <Field
          label="Link"
          tip="The Instagram permalink, blog post or page this piece lives at. If it's a reel or a YouTube video, we work out the embed and the poster from this automatically — you usually don't need the embed box below."
        >
          {(id) => (
            <div className="flex flex-wrap items-center gap-2">
              <input
                id={id}
                type="url"
                inputMode="url"
                value={v.url}
                onChange={(e) => set("url", e.target.value)}
                placeholder="https://www.instagram.com/reel/…"
                className="input min-w-0 flex-1"
              />
              {isInstagramUrl(v.url) && (
                <button
                  type="button"
                  onClick={runImport}
                  disabled={importing}
                  className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/5 px-3 text-[11px] font-semibold uppercase tracking-wider text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"
                >
                  {importing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Download className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {importing ? "Fetching…" : "Fetch from Instagram"}
                </button>
              )}
            </div>
          )}
        </Field>

        {/* The two things the owner must know after an import, and neither is
            an error, so neither is red. */}
        {imported?.author && (
          <p className="-mt-1 rounded-lg border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-xs text-orange-600 dark:text-orange-400">
            Posted by <strong className="font-medium">@{imported.author}</strong>,
            not your own account. Fine for a collaboration or a creator feature —
            worth crediting them in the title if you keep it.
          </p>
        )}
        {imported?.warning && (
          <p className="-mt-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {imported.warning}
          </p>
        )}

        <Field
          label="About a product"
          tip="Attach a product and this piece moves to the 'From our products' tab, with a Shop this piece button on it. Leave it as None for collaborations, bulk work and blog posts."
        >
          {(id) => (
            <select
              id={id}
              value={v.productId}
              onChange={(e) => set("productId", e.target.value)}
              className="input"
            >
              <option value="">None — everything else</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </Field>

        {/* Only offered once there is a link to embed — an embed with nothing
            to embed is a box that can only be filled in wrong. */}
        {v.url.trim() !== "" && (
          <Field
            label="Embed code"
            tip="Optional, and only for a link we can't work out ourselves. Paste the embed HTML and we take the iframe address out of it — the HTML itself is never put on the page, because that would let anything pasted here run on every visitor's browser."
          >
            {(id) => (
              <textarea
                id={id}
                value={v.embedHtml}
                onChange={(e) => set("embedHtml", e.target.value)}
                rows={3}
                maxLength={4000}
                placeholder='<iframe src="https://www.youtube.com/embed/…"></iframe>'
                className="input font-mono text-xs"
              />
            )}
          </Field>
        )}
      </Card>

      {/* ---- Photo ---- */}
      <Card
        title="Photo"
        tip="The still shown in the grid. Instagram and YouTube links usually supply their own, so this is only needed when they don't — or when you want a better one."
      >
        {v.imageUrl ? (
          <div className="flex items-center gap-3">
            <span className="relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted">
              {/* `next/image` only for hosts `next.config.ts` allows; anything
                  else 400s through the optimiser. Admin thumbs stay square. */}
              {v.imageUrl.startsWith("/") ? (
                <Image
                  src={decodeURI(v.imageUrl)}
                  alt=""
                  fill
                  sizes="80px"
                  className="object-cover"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- arbitrary host
                <img
                  src={v.imageUrl}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                />
              )}
            </span>
            <button
              type="button"
              onClick={() => set("imageUrl", "")}
              className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-border px-4 text-[11px] font-medium uppercase tracking-widest transition-colors hover:bg-muted"
            >
              Remove photo
            </button>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <ImageIcon className="h-4 w-4 shrink-0" aria-hidden />
            No photo chosen — we&rsquo;ll use the link&rsquo;s own still if it has one.
          </p>
        )}

        <PhotoPicker
          selected={v.imageUrl ? [v.imageUrl] : []}
          onChange={(next) => set("imageUrl", next[0] ?? "")}
          max={1}
        />

        <Field
          label="…or paste an image address"
          tip="For a still that isn't in the photo library. It has to be a full https:// address. Pictures from hosts we don't optimise still work — they're just served as-is."
        >
          {(id) => (
            <input
              id={id}
              type="url"
              inputMode="url"
              value={v.imageUrl}
              onChange={(e) => set("imageUrl", e.target.value)}
              placeholder="https://…"
              className="input"
            />
          )}
        </Field>
      </Card>

      {/* ---- Placement ---- */}
      <Card title="Placement">
        <SwitchRow
          label="Show on the site"
          tip="Off keeps the piece here but takes it off the portfolio page immediately. Use this instead of deleting if you might put it back."
          checked={v.isActive}
          onChange={(next) => set("isActive", next)}
          icon={
            v.isActive ? (
              <Eye className="h-4 w-4 shrink-0" />
            ) : (
              <EyeOff className="h-4 w-4 shrink-0" />
            )
          }
        />

        <SwitchRow
          label="Feature this"
          tip="Featured pieces sort to the front of their tab and carry a small Featured badge. Feature a handful, not everything — if all of them are featured, none of them are."
          checked={v.isFeatured}
          onChange={(next) => set("isFeatured", next)}
          icon={<Star className="h-4 w-4 shrink-0" />}
        />

        <Field
          label="Position"
          tip="Lower numbers come first. You normally don't type this — use the up and down arrows on the list, which renumber everything for you."
        >
          {(id) => (
            <input
              id={id}
              type="number"
              inputMode="numeric"
              min={0}
              max={9999}
              step={1}
              value={v.sortOrder}
              onChange={(e) => set("sortOrder", e.target.value)}
              className="input"
            />
          )}
        </Field>
      </Card>

      {emptyPiece && (
        <p className="text-xs text-danger">
          Give this piece something to show: a photo, a link, an embed, or a
          product.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {/* ---- Save ---- */}
      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => router.push("/admin/portfolio")}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-border px-5 text-[11px] font-medium uppercase tracking-widest transition-colors hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || emptyPiece}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg bg-foreground px-6 text-[11px] font-medium uppercase tracking-widest text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : itemId ? "Save changes" : "Add to portfolio"}
        </button>
      </div>
    </form>
  );
}

/** Only offer the import button for something it can actually read. */
function isInstagramUrl(url: string): boolean {
  return instagramShortcode(url) !== null;
}
