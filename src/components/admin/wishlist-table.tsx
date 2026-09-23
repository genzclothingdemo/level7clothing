"use client";

import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, Check, Copy, ImageOff, Mail, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, Btn } from "@/components/admin/order-ui";
import {
  SelectHandle,
  SelectionBar,
  useMultiSelect,
} from "@/components/admin/selection";
import {
  WISHLIST_AVAILABILITY_HELP,
  WISHLIST_AVAILABILITY_LABEL,
  WISHLIST_AVAILABILITY_TONE,
  emailsOf,
  type WishlistAvailability,
  type WishlistPivot,
} from "@/lib/wishlist-insights";

/**
 * The saved-intent list, grouped whichever way the pivot asks for.
 *
 * ── One component, two pivots ────────────────────────────────────────────────
 *
 * Not two components, because the *card* is the same object either way: a
 * subject, a count, and the saves underneath it. Only the subject swaps. Two
 * implementations would have been two places for the selection rule, the copy
 * action and the empty state to drift apart — and the whole point of building
 * the pivot on a single filtered list of saves is that the two directions are
 * arrangements of one answer, not two features.
 *
 * ── Every product leads with its picture and its name ────────────────────────
 *
 * On the product pivot that is the card header. On the person pivot the header
 * is the shopper, so each save underneath is itself a row that opens with the
 * thumbnail and the linked name — a clothing admin where a piece is a slug is
 * an admin nobody can scan. A piece that has been deleted from the catalogue
 * has no editor to open, so it prints its slug as plain text rather than
 * offering a link to a 404.
 *
 * ── Dates arrive pre-formatted ───────────────────────────────────────────────
 *
 * `savedAgo` / `savedAt` are strings built on the server, where the formatter
 * is pinned to Asia/Kolkata. Formatting them here would read the *viewer's*
 * timezone, so the same save would be dated differently on a phone abroad than
 * in the shop — and every other admin screen would disagree with this one.
 *
 * ── What the selection is for ────────────────────────────────────────────────
 *
 * A restock is worth telling the people who already asked for it, and the only
 * thing stopping that is that their addresses are spread over N cards. Select
 * pieces, copy the addresses. It reads and copies; it sends nothing, and there
 * is no destructive bulk action on this screen at all — but the selection
 * still intersects with what is visible (`useMultiSelect`), so narrowing a
 * filter narrows what "Copy emails" can reach. A copy list that silently
 * includes rows you filtered out is the same bug as a delete that does.
 */

/* ------------------------------------------------------------------ */
/*  View rows — plain data, built by the page                          */
/* ------------------------------------------------------------------ */

export type WishlistPieceView = {
  slug: string;
  name: string;
  image: string | null;
  /** The admin editor, or null when the piece is no longer in the catalogue. */
  href: string | null;
  /** Formatted, or null for a piece with no price to read. */
  price: string | null;
  availability: WishlistAvailability;
  /** "60 left", "None left", "Not in the catalogue". */
  stockLabel: string;
  category: string | null;
};

export type WishlistSaverView = {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  orderCount: number;
  href: string;
};

export type WishlistSaveView = {
  id: string;
  /** "3 days ago" — relative, formatted server-side. */
  savedAgo: string;
  /** The full timestamp, for the `title`. */
  savedAt: string;
  converted: boolean;
  saver: WishlistSaverView;
  piece: WishlistPieceView;
};

type GroupBase = {
  id: string;
  saves: WishlistSaveView[];
  count: number;
  converted: number;
  lastSavedAgo: string;
  lastSavedAt: string;
  /** Formatted. Σ list price of the saves that have not been bought. */
  openValue: string;
};

export type WishlistGroupView =
  | (GroupBase & { kind: "product"; piece: WishlistPieceView })
  | (GroupBase & { kind: "person"; saver: WishlistSaverView });

/* ------------------------------------------------------------------ */
/*  Table                                                              */
/* ------------------------------------------------------------------ */

export function WishlistTable({
  pivot,
  groups,
}: {
  pivot: WishlistPivot;
  groups: WishlistGroupView[];
}) {
  const selection = useMultiSelect(groups.map((g) => g.id));

  const selectedGroups = groups.filter((g) => selection.isSelected(g.id));
  const selectedSaves = selectedGroups.flatMap((g) => g.saves);
  const emails = emailsOf(selectedSaves);

  async function copy(text: string, what: string) {
    if (!text) {
      toast.error(`Nothing to copy — no ${what} on the selected rows`);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      // Clipboard access needs a secure context.
      toast.error("Couldn't copy — the browser blocked clipboard access");
    }
  }

  /** One tab-separated line per save: piece, who, when, bought yet. */
  function copyRows() {
    const lines = selectedSaves.map((s) =>
      [
        s.piece.name,
        s.piece.price ?? "",
        WISHLIST_AVAILABILITY_LABEL[s.piece.availability],
        s.saver.displayName,
        s.saver.email ?? s.saver.phone ?? "",
        s.savedAt,
        s.converted ? "bought" : "open",
      ].join("\t")
    );
    void copy(lines.join("\n"), "Rows");
  }

  return (
    <div className="min-w-0 space-y-2">
      <SelectionBar
        selection={selection}
        noun={pivot === "product" ? "piece" : "shopper"}
      >
        <Btn
          tone="outline"
          onClick={() => void copy(emails.join(", "), "Email addresses")}
          disabled={emails.length === 0}
          title={
            emails.length
              ? `Copy ${emails.length} address${emails.length === 1 ? "" : "es"} — for a back-in-stock or launch note`
              : "None of the selected rows has an email address"
          }
        >
          <Mail className="h-3.5 w-3.5" />
          Copy emails
          {emails.length > 0 && (
            <span className="tabular-nums">({emails.length})</span>
          )}
        </Btn>
        <Btn tone="ghost" onClick={copyRows} title="Copy the selected saves as rows you can paste into a sheet">
          <Copy className="h-3.5 w-3.5" /> Copy rows
        </Btn>
      </SelectionBar>

      <ul className="space-y-2">
        {groups.map((g) => (
          <li
            key={g.id}
            className={cn(
              "min-w-0 rounded-lg border bg-card p-2.5 transition-colors sm:p-3",
              selection.isSelected(g.id)
                ? "border-accent bg-accent/5"
                : "border-border"
            )}
          >
            {g.kind === "product" ? (
              <ProductCard group={g} selection={selection} />
            ) : (
              <PersonCard group={g} selection={selection} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Product pivot — the piece, then who wants it                       */
/* ------------------------------------------------------------------ */

function ProductCard({
  group,
  selection,
}: {
  group: GroupBase & { kind: "product"; piece: WishlistPieceView };
  selection: ReturnType<typeof useMultiSelect>;
}) {
  const { piece } = group;

  return (
    <>
      <div className="flex min-w-0 items-start gap-1.5">
        <SelectHandle
          selection={selection}
          id={group.id}
          label={`Select ${piece.name}`}
          className="-ml-2 -mt-1.5"
        />
        <Thumb src={piece.image} alt={piece.name} />

        <div className="min-w-0 flex-1">
          <PieceName piece={piece} className="text-sm font-medium" />
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
            {piece.price && <span className="tabular-nums">{piece.price}</span>}
            {piece.category && (
              <>
                <span aria-hidden="true">·</span>
                <span className="min-w-0 truncate">{piece.category}</span>
              </>
            )}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Badge
              tone={WISHLIST_AVAILABILITY_TONE[piece.availability]}
              title={WISHLIST_AVAILABILITY_HELP[piece.availability]}
            >
              {WISHLIST_AVAILABILITY_LABEL[piece.availability]}
            </Badge>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {piece.stockLabel}
            </span>
          </div>
        </div>

        <CountBlock
          count={group.count}
          noun="saved"
          converted={group.converted}
          openValue={group.openValue}
          ago={group.lastSavedAgo}
          agoTitle={group.lastSavedAt}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
        <span className="eyebrow shrink-0">Saved by</span>
        {group.saves.map((s) => (
          <Link
            key={s.id}
            href={s.saver.href}
            title={`${s.saver.displayName} — saved ${s.savedAt}${
              s.converted ? ", and has since bought it" : ""
            }. Open their customer record.`}
            className={cn(
              "inline-flex min-h-9 max-w-full items-center gap-1 rounded-lg border px-2 text-[11px] transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              s.converted
                ? "border-success/40 text-success hover:bg-success/10"
                : "border-border text-muted-foreground hover:border-accent hover:text-accent"
            )}
          >
            {s.converted && <Check className="h-3 w-3 shrink-0" aria-hidden="true" />}
            <span className="min-w-0 truncate">{s.saver.displayName}</span>
            <span className="shrink-0 text-muted-foreground/70">· {s.savedAgo}</span>
          </Link>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Person pivot — the shopper, then what they want                    */
/* ------------------------------------------------------------------ */

function PersonCard({
  group,
  selection,
}: {
  group: GroupBase & { kind: "person"; saver: WishlistSaverView };
  selection: ReturnType<typeof useMultiSelect>;
}) {
  const { saver } = group;

  return (
    <>
      <div className="flex min-w-0 items-start gap-1.5">
        <SelectHandle
          selection={selection}
          id={group.id}
          label={`Select ${saver.displayName}`}
          className="-ml-2 -mt-1.5"
        />

        <div className="min-w-0 flex-1">
          <Link
            href={saver.href}
            title="Everything this person has done — orders, carts, chats, returns"
            className="block min-w-0 truncate text-sm font-medium transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {saver.displayName}
          </Link>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
            <span>
              {saver.orderCount > 0
                ? `${saver.orderCount} order${saver.orderCount === 1 ? "" : "s"}`
                : "Never ordered"}
            </span>
            {saver.location && (
              <>
                <span aria-hidden="true">·</span>
                <span className="min-w-0 truncate">{saver.location}</span>
              </>
            )}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {saver.email && (
              <a
                href={`mailto:${saver.email}`}
                title={saver.email}
                className="inline-flex min-h-9 max-w-full items-center gap-1 rounded-lg border border-border px-2 text-[11px] text-muted-foreground transition-colors hover:border-accent hover:text-accent"
              >
                <Mail className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="min-w-0 truncate">{saver.email}</span>
              </a>
            )}
            {saver.phone && (
              <a
                href={`tel:${saver.phone}`}
                title={saver.phone}
                className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-border px-2 text-[11px] text-muted-foreground transition-colors hover:border-accent hover:text-accent"
              >
                <Phone className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{saver.phone}</span>
              </a>
            )}
          </div>
        </div>

        <CountBlock
          count={group.count}
          noun="saved"
          converted={group.converted}
          openValue={group.openValue}
          ago={group.lastSavedAgo}
          agoTitle={group.lastSavedAt}
        />
      </div>

      {/* Each save is a row that opens with the piece — picture, then name. */}
      <ul className="mt-2 divide-y divide-border border-t border-border">
        {group.saves.map((s) => (
          <li key={s.id} className="flex min-w-0 items-center gap-2 py-1.5">
            <Thumb src={s.piece.image} alt={s.piece.name} small />
            <div className="min-w-0 flex-1">
              <PieceName piece={s.piece} className="text-xs" />
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                <span title={s.savedAt}>{s.savedAgo}</span>
                {s.piece.price && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{s.piece.price}</span>
                  </>
                )}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Badge
                tone={WISHLIST_AVAILABILITY_TONE[s.piece.availability]}
                title={WISHLIST_AVAILABILITY_HELP[s.piece.availability]}
              >
                {WISHLIST_AVAILABILITY_LABEL[s.piece.availability]}
              </Badge>
              {s.converted && (
                <Badge
                  tone="success"
                  title="They have since ordered this exact piece — the save converted."
                >
                  <Check className="h-2.5 w-2.5" aria-hidden="true" /> Bought
                </Badge>
              )}
            </div>
          </li>
        ))}
      </ul>

      <Link
        href={saver.href}
        className="mt-1.5 inline-flex min-h-9 items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-accent"
      >
        Customer record
        <ArrowRight className="h-3 w-3 shrink-0" aria-hidden="true" />
      </Link>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared pieces                                                      */
/* ------------------------------------------------------------------ */

/**
 * Portrait `4/5`, the house ratio for product imagery everywhere on this site
 * except the Instagram grid and the admin's own square thumbs.
 */
function Thumb({
  src,
  alt,
  small,
}: {
  src: string | null;
  alt: string;
  small?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-lg bg-muted",
        small ? "h-10 w-8" : "h-14 w-11"
      )}
    >
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={small ? "32px" : "44px"}
          className="object-cover"
        />
      ) : (
        <span className="grid h-full w-full place-items-center text-muted-foreground">
          <ImageOff className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      )}
    </div>
  );
}

/**
 * The piece's name, linked to its editor — except when the catalogue no longer
 * has a row for the slug, in which case there is nothing to open and the slug
 * is printed instead. A link to a deleted product is worse than plain text:
 * it looks like the piece is still there.
 */
function PieceName({
  piece,
  className,
}: {
  piece: WishlistPieceView;
  className?: string;
}) {
  if (!piece.href) {
    return (
      <p
        className={cn("min-w-0 truncate text-muted-foreground", className)}
        title={`${piece.slug} — no product in the catalogue matches this slug any more.`}
      >
        {piece.slug}
      </p>
    );
  }
  return (
    <Link
      href={piece.href}
      title={`Edit ${piece.name}`}
      className={cn(
        "block min-w-0 truncate transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    >
      {piece.name}
    </Link>
  );
}

/**
 * The right-hand figure: how many, how many of those converted, what is still
 * open, and when it last moved. Same block on both pivots, because it answers
 * the same question from either end.
 */
function CountBlock({
  count,
  noun,
  converted,
  openValue,
  ago,
  agoTitle,
}: {
  count: number;
  noun: string;
  converted: number;
  openValue: string;
  ago: string;
  agoTitle: string;
}) {
  return (
    <div className="shrink-0 text-right">
      <p className="text-lg font-medium leading-none tabular-nums">{count}</p>
      <p className="eyebrow mt-0.5">{noun}</p>
      {converted > 0 && (
        <p
          className="mt-1 text-[11px] text-success tabular-nums"
          title={`${converted} of these ${count} ${noun} has since been bought by the person who saved it.`}
        >
          {converted} bought
        </p>
      )}
      <p
        className="mt-0.5 text-[11px] text-muted-foreground tabular-nums"
        title="List price of the saves that have not been bought yet. A ceiling, not a forecast."
      >
        {openValue}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground" title={agoTitle}>
        {ago}
      </p>
    </div>
  );
}
