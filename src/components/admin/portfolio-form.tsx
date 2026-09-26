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
import { useRouter } from "next/navigation";
import {
  Download,
  Eye,
  EyeOff,
  Images,
  Loader2,
  MousePointerClick,
  RefreshCw,
  Star,
  Text,
} from "lucide-react";
import { Card, Field, Segmented, SwitchRow } from "@/components/admin/form-kit";
import { Disclosure } from "@/components/store/disclosure";
import {
  PortfolioExtraPhotos,
  PortfolioThumbnail,
} from "@/components/admin/portfolio-media";
import {
  createPortfolioItem,
  importSocialPost,
  previewPortfolioBody,
  refreshPortfolioItem,
  updatePortfolioItem,
} from "@/app/actions/portfolio";
import type { PortfolioKind } from "@/lib/portfolio";
import { socialProviderOf, type SocialProvider } from "@/lib/instagram-resolve";
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
  /**
   * Pasted markup for a written page. **Never rendered in this component** —
   * the preview goes through `previewPortfolioBody`, which is the same
   * sanitiser the save runs, so what the owner is shown is what gets stored.
   */
  bodyHtml: string;
  /** Extra photos beyond the cover, in the order they are shown. */
  images: string[];
  ctaLabel: string;
  ctaUrl: string;
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
  bodyHtml: "",
  images: [],
  ctaLabel: "",
  ctaUrl: "",
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

/**
 * The shelves on /portfolio, as UI copy — same reason as `KIND_OPTIONS`: the
 * real list lives in `PORTFOLIO_SECTION_META`, and this is a client component.
 *
 * Adding a section means a line here and a line there. That duplication is
 * deliberate and cheap; the alternative is a Prisma client in the browser.
 *
 * The picker writes a reserved `section:<id>` tag rather than a column,
 * because the schema is not ours to migrate. `sectionOf()` on the server reads
 * that tag first, so this control is exact — "Work it out for me" leaves the
 * tag off and lets the keyword guess run instead.
 */
const SECTION_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Work it out from the tags" },
  { value: "story", label: "Who we are" },
  { value: "milestones", label: "Milestones" },
  { value: "reels", label: "Reels & films" },
  { value: "customers", label: "Happy customers" },
  { value: "collabs", label: "Collaborations" },
  { value: "bulk", label: "Bulk & custom work" },
];

const SECTION_LABEL = new Map(SECTION_OPTIONS.map((o) => [o.value, o.label]));

/** `section:<id>` out of a comma-separated tag string. */
function sectionFromTags(tags: string): string {
  for (const raw of tags.split(",")) {
    const m = /^\s*section:(.+?)\s*$/i.exec(raw);
    const id = m?.[1]?.toLowerCase();
    if (id && SECTION_LABEL.has(id)) return id;
  }
  return "";
}

/**
 * Swap the `section:` tag without disturbing the owner's own tags or their
 * order — the picker and the tag box are two views of one column, so this is
 * the read-modify-write that keeps them from fighting.
 */
function withSectionTag(tags: string, section: string): string {
  const kept = tags
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t && !/^section:/i.test(t));
  if (section) kept.unshift(`section:${section}`);
  return kept.join(", ");
}

/* ------------------------------------------------------------------ */
/*  The form                                                           */
/* ------------------------------------------------------------------ */

export function PortfolioForm({
  itemId,
  initial,
  products,
  harvestedFrom,
}: {
  /** Absent when creating. */
  itemId?: string;
  initial: PortfolioFormValues;
  /** Active products offered in the "about one product" picker. */
  products: { id: string; name: string }[];
  /**
   * The product this row was harvested from, when it was.
   *
   * A plain string resolved on the server, not the id: `sourceProductId` is
   * not offered as an input anywhere and `toRow()` deliberately leaves the
   * column out of every write, so this is here to *say* where the row came
   * from and to put Refresh beside it — never to edit it.
   */
  harvestedFrom?: { productName: string | null } | null;
}) {
  const router = useRouter();
  const [v, setV] = useState<PortfolioFormValues>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ---- Mirror an Instagram post or a YouTube video -------------------
     Paste a permalink, press the button, and the caption, the embed and a
     *copy* of the poster arrive filled in. The copy matters for Instagram:
     its CDN addresses carry a signed expiry — four days on the posts this
     was built against — so the obvious move of pasting the image address
     gives a grid that breaks next week with nothing to explain it. The
     action puts the bytes in our own blob store and returns that address.
     YouTube posters live on `i.ytimg.com`, which does not expire and is
     already allow-listed, so there the copy is a preference rather than a
     requirement and the fallback is a real one. */
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<{
    provider: SocialProvider;
    author: string | null;
    warning?: string;
  } | null>(null);

  /** null when the link is not one we can read; drives the button's label. */
  const linkProvider = useMemo(() => socialProviderOf(v.url), [v.url]);

  const runImport = useCallback(async () => {
    setImporting(true);
    setError(null);
    setImported(null);
    const res = await importSocialPost(v.url);
    setImporting(false);

    if (!res.success) {
      setError(res.error);
      return;
    }

    setV((prev) => ({
      ...prev,
      kind:
        res.provider === "youtube"
          ? "video"
          : res.provider === "instagram"
            ? "instagram"
            : // Anything else is a page we read the Open Graph tags off — a
              // blog post, a press mention. It links out; it does not play.
              "link",
      url: res.url,
      // Never clobber a title the owner has already written.
      title: prev.title.trim() || res.title || prev.title,
      imageUrl: res.imageUrl ?? prev.imageUrl,
      embedHtml: res.embedHtml,
      // A reel or a film belongs on the reels shelf, and the owner just told
      // us which it is by pasting the link. Only filled in when they have not
      // already chosen a shelf themselves — and only for something that plays,
      // because a blog post on the reels shelf is just wrong.
      tags:
        sectionFromTags(prev.tags) || res.provider === "link"
          ? prev.tags
          : withSectionTag(prev.tags, "reels"),
    }));
    setImported({
      provider: res.provider,
      author: res.author,
      warning: res.warning,
    });
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

  /** The shelf currently chosen, or "" while it is being worked out. */
  const section = useMemo(() => sectionFromTags(v.tags), [v.tags]);

  /**
   * The one sentence that answers "where does this end up?".
   *
   * **It only names a shelf when it can be certain**, which is when the picker
   * has written a `section:` tag. Without one the server runs a keyword pass
   * over the plain tags *before* falling back to "playable means reels"
   * (`sectionOf` in `lib/portfolio.ts`), and this component cannot run that
   * pass: the table lives in a module that imports Prisma.
   *
   * The tempting shortcut — guess "Reels & films" whenever there is a link —
   * is wrong the moment somebody tags a reel `testimonial`, and a verdict that
   * says one shelf while the page shows another is worse than one that admits
   * it does not know. So it names the rule instead of guessing the answer.
   */
  const verdict = useMemo(() => {
    if (!v.isActive) {
      return { tone: "idle" as const, line: "Hidden. Nobody sees this piece." };
    }
    if (section) {
      return {
        tone: "good" as const,
        line: `Shows under "${SECTION_LABEL.get(section)}".`,
      };
    }
    const playable = Boolean(v.embedHtml.trim()) || isSocialUrl(v.url);
    return {
      tone: "good" as const,
      line: playable
        ? "No section picked — your tags decide, and if none of them say otherwise this plays, so it lands under Reels & films."
        : "No section picked — your tags decide, and with nothing to go on it lands under Who we are.",
    };
  }, [v.isActive, section, v.embedHtml, v.url]);

  /* ---- The written page ------------------------------------------------
     `bodyHtml` is markup the owner pasted, so what they typed and what will
     be stored are two different strings. Rather than let them find that out
     on the live page, Preview runs the *same* sanitiser the save runs
     (`previewPortfolioBody` is a thin wrapper on it) and prints both the
     result and a list of what went. A second, client-side cleaner would be a
     second answer to "what is safe", and the two would drift. */
  const [preview, setPreview] = useState<{
    html: string;
    removed: string[];
  } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const runPreview = useCallback(async () => {
    setPreviewing(true);
    const res = await previewPortfolioBody(v.bodyHtml);
    setPreviewing(false);
    setPreview(res);
  }, [v.bodyHtml]);

  /* ---- Refresh a harvested piece from its link ---- */
  const [refreshing, setRefreshing] = useState(false);
  const runRefresh = useCallback(async () => {
    if (!itemId) return;
    setRefreshing(true);
    setError(null);
    const res = await refreshPortfolioItem(itemId);
    setRefreshing(false);
    if (res.success) {
      // Everything it rewrote is server-side; re-reading is the only way this
      // form sees it without a second source of truth for the same columns.
      router.refresh();
    } else {
      setError(res.error ?? "Couldn't refresh this piece.");
    }
  }, [itemId, router]);

  /** Nothing to show = a title on a grey box. Mirrored server-side. */
  const emptyPiece =
    !v.imageUrl.trim() &&
    !v.url.trim() &&
    !v.embedHtml.trim() &&
    !v.productId &&
    !v.bodyHtml.trim() &&
    v.images.length === 0;

  /** Half a CTA is a button that does nothing, or no button at all. */
  const halfCta = Boolean(v.ctaLabel.trim()) !== Boolean(v.ctaUrl.trim());

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
    fd.append("bodyHtml", v.bodyHtml);
    // One entry per photo: a blob filename can contain very nearly anything,
    // and choosing a separator is choosing a filename that splits in two.
    for (const url of v.images) fd.append("images", url);
    fd.append("ctaLabel", v.ctaLabel);
    fd.append("ctaUrl", v.ctaUrl);
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

      {/* ---- Where this row came from ----
           Only for a harvested row, and read-only: `sourceProductId` is the
           harvester's own record and no form writes it. Refresh sits here
           rather than in the sweep because it *overwrites* the title, the
           cover and the player — a background sweep doing that would quietly
           undo an afternoon's editing, so it is one deliberate press on one
           piece. It leaves the description, tags, section and position alone. */}
      {harvestedFrom && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-muted/30 p-4 sm:p-5">
          <p className="min-w-0 text-sm text-muted-foreground">
            Added automatically from a video link on{" "}
            <span className="text-foreground">
              {harvestedFrom.productName ?? "a product that has since gone"}
            </span>
            . It is an ordinary piece now — edit it, hide it or delete it, and
            re-harvesting will not bring it back or overwrite what you change.
          </p>
          {v.url.trim() && (
            <button
              type="button"
              onClick={runRefresh}
              disabled={refreshing}
              className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-[11px] font-medium uppercase tracking-widest transition-colors hover:bg-muted disabled:opacity-50 sm:min-h-10"
            >
              {refreshing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              )}
              {refreshing ? "Refreshing…" : "Refresh from the link"}
            </button>
          )}
        </div>
      )}

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
          label="Section"
          tip="Which part of the portfolio page this shows under. Leave it on 'Work it out from the tags' and we place it from what you typed — a tag like 'bulk order' or 'testimonial' is enough. Anything that plays and has no tag lands under Reels & films."
        >
          {(id) => (
            <select
              id={id}
              value={section}
              onChange={(e) => set("tags", withSectionTag(v.tags, e.target.value))}
              className="input"
            >
              {SECTION_OPTIONS.map((o) => (
                <option key={o.value || "auto"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field
          label="Tags"
          tip="Comma separated. They show as small chips under the tile and are searchable in this admin — useful for grouping a shoot or a collaboration. A tag with a colon in it (like section:reels) is ours: it places the piece and is never shown to shoppers."
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
          tip="The Instagram permalink, YouTube video, blog post or page this piece lives at. For Instagram and YouTube we fetch the caption, the cover image and the player from it, so the piece plays on your site instead of sending shoppers away."
        >
          {(id) => (
            <div className="flex flex-wrap items-center gap-2">
              <input
                id={id}
                type="url"
                inputMode="url"
                value={v.url}
                onChange={(e) => set("url", e.target.value)}
                placeholder="https://www.instagram.com/reel/… or https://youtu.be/…"
                className="input min-w-0 flex-1"
              />
              {linkProvider && (
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
                  {importing
                    ? "Fetching…"
                    : linkProvider === "youtube"
                      ? "Fetch from YouTube"
                      : linkProvider === "instagram"
                        ? "Fetch from Instagram"
                        : "Fetch details"}
                </button>
              )}
            </div>
          )}
        </Field>

        {/* The two things the owner must know after an import, and neither is
            an error, so neither is red. */}
        {imported?.author && (
          <p className="-mt-1 rounded-lg border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-xs text-orange-600 dark:text-orange-400">
            {imported.provider === "youtube" ? (
              <>
                Uploaded by{" "}
                <strong className="font-medium">{imported.author}</strong>. Check
                that is your own channel — if it is somebody else&rsquo;s, credit
                them in the title.
              </>
            ) : (
              <>
                Posted by{" "}
                <strong className="font-medium">@{imported.author}</strong>, not
                your own account. Fine for a collaboration or a creator feature —
                worth crediting them in the title if you keep it.
              </>
            )}
          </p>
        )}
        {imported?.warning && (
          <p className="-mt-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {imported.warning}
          </p>
        )}

        <Field
          label="About a product"
          tip="Optional. Attaching a garment adds a small 'Wearing …' link on the card so a shopper can find the piece in the shot. It no longer decides which section this shows under — the portfolio is about the label, not the catalogue."
        >
          {(id) => (
            <select
              id={id}
              value={v.productId}
              onChange={(e) => set("productId", e.target.value)}
              className="input"
            >
              <option value="">None</option>
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

      {/* ---- Cover photo ---- */}
      <Card
        title="Cover photo"
        tip="The still shown in the grid. Instagram and YouTube links usually supply their own, so this is only needed when they don't — or when you want a better one. A piece with no cover still works."
      >
        <PortfolioThumbnail
          value={v.imageUrl}
          onChange={(next) => set("imageUrl", next)}
          /* Every link on this form is offered as a source, in the order they
             are worth trying. The button names the host rather than the
             field, because "use the photo from instagram.com" is a sentence
             and "use the photo from the link" is a riddle. */
          sources={[
            { label: "the link", url: v.url },
            { label: "the button link", url: v.ctaUrl },
          ]}
          onResolved={({ title, embedHtml }) => {
            // Fetching a cover also resolved the caption and the player. Take
            // them, but never over a title the owner has already written.
            setV((prev) => ({
              ...prev,
              title: prev.title.trim() || title || prev.title,
              embedHtml: prev.embedHtml.trim() || embedHtml || prev.embedHtml,
            }));
          }}
        />
      </Card>

      {/* ---- The written page ----
           Folded away, because most pieces are a link and a photo and never
           need any of this. It opens itself for a piece that already has a
           body, extra photos or a button, so an existing page is never
           hidden behind a closed panel the owner has to find. */}
      <Card
        title="Write a page"
        tip="Optional. Give the piece a body and it becomes something to read rather than a tile to click through — which is what an achievement, a press mention or a bulk-order write-up needs. You can paste formatted text or HTML; anything unsafe is removed before it is saved, and Preview shows you exactly what will be kept."
      >
        <Disclosure
          label="Page body"
          icon={<Text className="h-3.5 w-3.5" />}
          summary={
            v.bodyHtml.trim()
              ? `${v.bodyHtml.trim().length.toLocaleString()} characters`
              : "Empty"
          }
          defaultOpen={Boolean(initial.bodyHtml.trim())}
        >
          <div className="space-y-3 pt-1">
            <textarea
              value={v.bodyHtml}
              onChange={(e) => {
                set("bodyHtml", e.target.value);
                // A preview of markup that has since been edited is a lie.
                setPreview(null);
              }}
              rows={10}
              maxLength={60_000}
              aria-label="Page body"
              placeholder={
                "<h2>250 pieces in eleven days</h2>\n<p>Two rounds of proofing, one rail, and a deadline that did not move.</p>\n<ul><li>240 GSM cotton</li><li>Two-pass screen print</li></ul>"
              }
              className="input min-h-48 font-mono text-xs leading-relaxed"
            />

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={runPreview}
                disabled={previewing || !v.bodyHtml.trim()}
                className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/5 px-3 text-[11px] font-semibold uppercase tracking-wider text-accent transition-colors hover:bg-accent/10 disabled:opacity-50 sm:min-h-10"
              >
                {previewing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Eye className="h-3.5 w-3.5" aria-hidden />
                )}
                {previewing ? "Checking…" : "Preview what will be saved"}
              </button>
              {preview && (
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-border px-3 text-[11px] font-medium uppercase tracking-widest transition-colors hover:bg-muted sm:min-h-10"
                >
                  Close preview
                </button>
              )}
            </div>

            {preview && (
              <div className="space-y-2">
                {preview.removed.length > 0 && (
                  <p className="rounded-lg border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-xs text-orange-600 dark:text-orange-400">
                    Removed: {preview.removed.join(", ")}. Formatting that
                    isn&rsquo;t on the safe list is taken out — the words inside
                    it are kept.
                  </p>
                )}
                {preview.html ? (
                  <div className="rounded-xl border border-border bg-muted/20 p-4">
                    <p className="eyebrow mb-2 text-muted-foreground">
                      How it will read
                    </p>
                    {/*
                      The one `dangerouslySetInnerHTML` in this admin, and it is
                      safe for a specific reason rather than by convention: this
                      string did not come from the textarea, it came back from
                      the server's own sanitiser — the same function that runs
                      on save. Rendering `v.bodyHtml` here instead would be a
                      live XSS hole in the editor.
                    */}
                    <div
                      className="portfolio-body space-y-2 text-sm leading-relaxed [&_a]:text-accent [&_a]:underline [&_h2]:font-serif [&_h2]:text-lg [&_h3]:font-serif [&_img]:max-w-full [&_img]:rounded-lg [&_li]:ml-4 [&_li]:list-disc"
                      dangerouslySetInnerHTML={{ __html: preview.html }}
                    />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Nothing survived the clean-up — there is no readable text in
                    what you pasted.
                  </p>
                )}
              </div>
            )}
          </div>
        </Disclosure>

        <Disclosure
          label="Extra photos"
          icon={<Images className="h-3.5 w-3.5" />}
          summary={v.images.length ? `${v.images.length} chosen` : "None"}
          defaultOpen={initial.images.length > 0}
        >
          <div className="pt-1">
            <PortfolioExtraPhotos
              value={v.images}
              onChange={(next) => set("images", next)}
            />
          </div>
        </Disclosure>

        <Disclosure
          label="Button"
          icon={<MousePointerClick className="h-3.5 w-3.5" />}
          summary={v.ctaLabel.trim() || "None"}
          defaultOpen={Boolean(initial.ctaLabel.trim() || initial.ctaUrl.trim())}
        >
          <div className="space-y-4 pt-1">
            <Field
              label="Button label"
              tip="What the button says. Keep it a verb — 'Get a quote', 'Read the write-up'. Leave both fields empty for no button."
            >
              {(id) => (
                <input
                  id={id}
                  value={v.ctaLabel}
                  onChange={(e) => set("ctaLabel", e.target.value)}
                  maxLength={40}
                  placeholder="Get a quote"
                  className="input"
                />
              )}
            </Field>
            <Field
              label="Button link"
              tip="Where it goes. A path inside this store (/contact) or a full https:// address."
            >
              {(id) => (
                <input
                  id={id}
                  type="url"
                  inputMode="url"
                  value={v.ctaUrl}
                  onChange={(e) => set("ctaUrl", e.target.value)}
                  placeholder="/contact"
                  className="input"
                />
              )}
            </Field>
            {halfCta && (
              <p className="text-xs text-danger">
                {v.ctaLabel.trim()
                  ? "Give the button somewhere to go, or clear its label."
                  : "Give the button a label, or clear its address."}
              </p>
            )}
          </div>
        </Disclosure>
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
          tip="Featured pieces sort to the front of their section and carry a small Featured badge. Feature a handful, not everything — if all of them are featured, none of them are."
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
          Give this piece something to show: a photo, a link, an embed, a
          product, or a written page.
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
          disabled={saving || emptyPiece || halfCta}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg bg-foreground px-6 text-[11px] font-medium uppercase tracking-widest text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : itemId ? "Save changes" : "Add to portfolio"}
        </button>
      </div>
    </form>
  );
}

/**
 * Would the server treat this link as playable?
 *
 * Only used to keep the "where this shows" verdict honest before a save — the
 * real placement is `sectionOf()` on the server, which decides from the embed
 * it actually resolved rather than from the raw URL.
 */
function isSocialUrl(url: string): boolean {
  return socialProviderOf(url) !== null;
}
