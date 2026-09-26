"use client";

/**
 * The two photo controls the portfolio editor uses.
 *
 * ## Why a thumbnail control rather than an image field
 *
 * A portfolio piece can get its cover from four different places, and the
 * owner should not have to know which: the library, an address they paste, the
 * Instagram or YouTube link the piece already has, or the page its button
 * points at. Spreading those across four fields is how the old editor ended up
 * with an image box the owner filled in by pasting an Instagram CDN address —
 * which looks perfect for four days and is then a broken tile, silently, and
 * is the whole reason `lib/instagram-resolve.ts` exists.
 *
 * So all four live in one card, in that order, and the ones that need
 * explaining explain themselves behind an `(i)`.
 *
 * ## One column, several ways in
 *
 * Every path writes the single `imageUrl` value the caller owns. There is
 * deliberately no second source of truth and no local copy of the chosen
 * photo — that is the lost-update shape CLAUDE.md records for
 * `defaultReturnsInfo`, where two writers of one column meant a silent
 * overwrite with nothing on screen to say so.
 *
 * ## A missing photo is a state, not a failure
 *
 * Nothing here requires a cover. `lib/portfolio.ts` resolves `thumbnail` from
 * the image, then the resolved link's own poster, then the linked product's
 * photo, and the storefront renders a title card when all three are empty. So
 * the empty state says what will happen rather than warning about it.
 */

import { useCallback, useState } from "react";
import Image from "next/image";
import {
  Download,
  Image as ImageIcon,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { Field, MiniButton } from "@/components/admin/form-kit";
import { PhotoPicker } from "@/components/admin/photo-picker";
import { importSocialPost } from "@/app/actions/portfolio";
import { isFetchableLink } from "@/lib/instagram-resolve";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Preview                                                            */
/* ------------------------------------------------------------------ */

/**
 * `next/image` only for the hosts `next.config.ts` allows; everything else
 * goes through a plain `<img>`.
 *
 * Not a nicety: the optimiser answers **400** for an unlisted host rather than
 * degrading, so a live Instagram CDN address rendered through `Image` is a
 * broken thumbnail in the admin with nothing in the console to explain it.
 * Admin thumbs stay square (CLAUDE.md); portrait `4/5` is the storefront rule.
 */
function Thumb({ url, className }: { url: string; className?: string }) {
  return (
    <span
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-lg bg-muted",
        className
      )}
    >
      {url.startsWith("/") ? (
        <Image src={decodeURI(url)} alt="" fill sizes="96px" className="object-cover" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary host
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Cover photo                                                        */
/* ------------------------------------------------------------------ */

/** One link a poster could be pulled from, and what to call it on the button. */
export type ThumbnailSource = {
  /** How the button names it — "the link", "the button link". */
  label: string;
  url: string;
};

/** The host, for a button that says where it is about to go. */
function hostOf(url: string): string | null {
  try {
    return new URL(url.trim()).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function PortfolioThumbnail({
  value,
  onChange,
  sources,
  onResolved,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Links the poster could come from. Unfetchable ones are simply not offered. */
  sources: ThumbnailSource[];
  /**
   * Told when a fetch also turned up a title or an embed, so the form can use
   * them. Optional: the control is useful on its own.
   */
  onResolved?: (result: {
    title: string | null;
    embedHtml: string;
    author: string | null;
  }) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const usable = sources.filter((s) => s.url.trim() && isFetchableLink(s.url.trim()));

  const fetchFrom = useCallback(
    async (source: ThumbnailSource) => {
      setBusy(source.url);
      setError(null);
      setNote(null);
      const res = await importSocialPost(source.url.trim());
      setBusy(null);

      if (!res.success) {
        setError(res.error);
        return;
      }
      if (res.imageUrl) {
        onChange(res.imageUrl);
        setNote(
          // Worth saying out loud: for Instagram this is a *copy*, and the
          // copy is the only reason the tile still works next week.
          res.imageUrl.includes(".public.blob.vercel-storage.com")
            ? "Cover photo copied into your own storage, so it can't expire."
            : "Cover photo taken from the link."
        );
      } else {
        setNote(res.warning ?? "That link didn't return a preview image.");
      }
      onResolved?.({
        title: res.title,
        embedHtml: res.embedHtml,
        author: res.author,
      });
    },
    [onChange, onResolved]
  );

  return (
    <div className="space-y-4">
      {value ? (
        <div className="flex flex-wrap items-center gap-3">
          <Thumb url={value} className="h-20 w-20" />
          <MiniButton onClick={() => onChange("")} className="h-11 sm:h-10">
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </MiniButton>
        </div>
      ) : (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <ImageIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            No cover photo. The tile falls back to the link&rsquo;s own still, then
            the linked product&rsquo;s photo, and shows a plain title card if there
            is neither — nothing breaks either way.
          </span>
        </p>
      )}

      {usable.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {usable.map((source) => (
            <button
              key={source.url}
              type="button"
              onClick={() => fetchFrom(source)}
              disabled={busy !== null}
              className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/5 px-3 text-[11px] font-semibold uppercase tracking-wider text-accent transition-colors hover:bg-accent/10 disabled:opacity-50 sm:min-h-10"
            >
              {busy === source.url ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Download className="h-3.5 w-3.5" aria-hidden />
              )}
              {busy === source.url
                ? "Fetching…"
                : `Use the photo from ${hostOf(source.url) ?? source.label}`}
            </button>
          ))}
        </div>
      )}

      {note && (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {note}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}

      <PhotoPicker
        selected={value ? [value] : []}
        onChange={(next) => onChange(next[0] ?? "")}
        max={1}
      />

      <Field
        label="…or paste an image address"
        tip="For a still that isn't in the photo library. It has to be a full https:// address. Pictures from hosts we don't optimise still work — they're just served as-is. Avoid pasting an Instagram image address directly: those expire after a few days. Use the fetch button above instead, which copies the picture into your own storage."
      >
        {(id) => (
          <input
            id={id}
            type="url"
            inputMode="url"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://…"
            className="input"
          />
        )}
      </Field>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Extra photos                                                       */
/* ------------------------------------------------------------------ */

/**
 * The `images` column: the photos an achievement or bulk-order page carries
 * beyond its cover.
 *
 * Ordering is the reason this is a list with arrows rather than a bare
 * `PhotoPicker`. A write-up about a 250-piece run reads as a sequence — the
 * rail, the press, the boxes — and a set with no order is a different thing
 * from a gallery.
 *
 * `PhotoPicker` is used in its accumulating mode here, which is the deliberate
 * exception CLAUDE.md names: picking photos means browsing several filters and
 * collecting from each, and nothing in this control destroys anything. The
 * intersect-with-visible rule is for bulk actions, which this is not.
 */
export function PortfolioExtraPhotos({
  value,
  onChange,
  max = 12,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  max?: number;
}) {
  const [pasted, setPasted] = useState("");

  const move = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= value.length) return;
    const next = [...value];
    [next[index], next[to]] = [next[to], next[index]];
    onChange(next);
  };

  const addPasted = () => {
    const url = pasted.trim();
    if (!url || value.includes(url) || value.length >= max) return;
    onChange([...value, url]);
    setPasted("");
  };

  return (
    <div className="space-y-4">
      {value.length > 0 ? (
        <ul className="space-y-2">
          {value.map((url, i) => (
            <li
              key={`${url}-${i}`}
              className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-muted/20 p-2"
            >
              <Thumb url={url} className="h-14 w-14" />
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {url}
              </span>
              <span className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label={`Move photo ${i + 1} earlier`}
                  className="grid h-11 w-11 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:w-9"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === value.length - 1}
                  aria-label={`Move photo ${i + 1} later`}
                  className="grid h-11 w-11 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:w-9"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => onChange(value.filter((_, idx) => idx !== i))}
                  aria-label={`Remove photo ${i + 1}`}
                  className="grid h-11 w-11 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger sm:h-9 sm:w-9"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No extra photos. The piece still shows its cover — these are for a
          write-up that needs more than one picture.
        </p>
      )}

      {value.length < max && (
        <>
          <PhotoPicker
            selected={value}
            onChange={(next) => onChange(next.slice(0, max))}
            max={max}
            label="Add from photo library"
          />

          <Field
            label="…or paste an image address"
            tip="A full https:// address, or a path inside this store starting with /."
          >
            {(id) => (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id={id}
                  type="url"
                  inputMode="url"
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      // Otherwise Enter submits the surrounding form, which is
                      // a save the owner did not ask for.
                      e.preventDefault();
                      addPasted();
                    }
                  }}
                  placeholder="https://…"
                  className="input min-w-0 flex-1"
                />
                <MiniButton onClick={addPasted} className="h-11 sm:h-10">
                  <Plus className="h-3.5 w-3.5" /> Add
                </MiniButton>
              </div>
            )}
          </Field>
        </>
      )}
    </div>
  );
}
