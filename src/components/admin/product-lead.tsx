import Image from "next/image";
import Link from "next/link";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Lead with what was bought, not with the string we filed it under.
 *
 * The owner's note: *"order || payment || product || add to cart || wishlist —
 * all this entities me kuch kuch jagah pe order ID and payment ID first
 * impression me show hoti hai. lekin right vision kya hota hai? → product name
 * (with redirectable clickable URL) and image."*
 *
 * Every admin surface that describes an order, a payment or a return used to
 * open with `L7-MUCL3FCASI` and, in several cases, never say what was in the
 * parcel at all — the payment ledger on a customer record listed six orders by
 * reference number, method and three money columns, and you could not tell a
 * hoodie from a tee without opening each one.
 *
 * This is the one component that fixes it, so the fix cannot land differently
 * in six places. **It is not "delete the id"**: an order number is how a
 * customer refers to their order in a WhatsApp message, and how an operator
 * finds it again. It is "stop making it the headline" — so the id moves into
 * `meta`, one size down and in the muted colour, where it is still readable and
 * still selectable.
 *
 * ## Why this is not `ProductThumb` from `order-facts.tsx`
 *
 * It is the same idea and deliberately the same geometry — `aspect-[4/5]`,
 * `ImageOff` when there is no photo, no link when the product is gone — but the
 * storefront pair is `"use client"` and links to `/product/<slug>`. An admin
 * row wants the **editor** (`/admin/products/<id>/edit`): that is what somebody
 * looking at an order is going to want to open. So the destination is passed in
 * as `href` rather than derived, this file stays server-renderable, and the two
 * cannot drift on the thing that actually matters, which is the shape.
 *
 * A null `href` renders plain text. A dead link out of an order history reads
 * as "you deleted my product", and in the admin it is worse — it looks like the
 * catalogue is broken rather than like the piece was discontinued.
 */

/**
 * "Black · M" from an order line's options.
 *
 * Here rather than at each call site because four screens render the same
 * string from the same shape, and three of them had written their own join.
 */
export function variantText(
  options?: { name: string; value: string }[] | null
): string | null {
  const parts = (options ?? []).map((o) => o.value).filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export type AdminProductRef = {
  name: string;
  /** Captured on the order line, else the product's own first photo. */
  image?: string | null;
  /** Usually `adminLink.product(id)`. Null when the product no longer exists. */
  href?: string | null;
  /** "Black · M" — rendered after the name at the same size, muted. */
  variant?: string | null;
  /** Shown as "× 2" when more than one. */
  quantity?: number;
};

/**
 * Three sizes, and they are widths rather than squares because product imagery
 * in this store is portrait everywhere (CLAUDE.md: `aspect-[4/5]`). `sm` is
 * 44px so that on a row where the thumb is the only tappable thing it is still
 * a thumb-sized target.
 */
const THUMB = {
  xs: { box: "w-8", sizes: "32px" },
  sm: { box: "w-11", sizes: "44px" },
  md: { box: "w-14", sizes: "56px" },
} as const;

export type ThumbSize = keyof typeof THUMB;

export function AdminProductThumb({
  item,
  size = "sm",
  className,
  /** Set when something around it is already the link — nested <a> is invalid. */
  unlinked = false,
}: {
  item: AdminProductRef;
  size?: ThumbSize;
  className?: string;
  unlinked?: boolean;
}) {
  const spec = THUMB[size];
  const box = cn(
    "relative block aspect-[4/5] shrink-0 overflow-hidden rounded-lg bg-muted ring-1 ring-border/60",
    spec.box,
    className
  );

  const content = item.image ? (
    <Image
      // Photo paths in this store are written with real characters and stored
      // encoded; `next/image` encodes again, so a name with a space 404s
      // without this. Same call the storefront thumb makes.
      src={decodeURI(item.image)}
      alt=""
      fill
      sizes={spec.sizes}
      className="object-cover"
    />
  ) : (
    <span className="grid h-full w-full place-items-center text-muted-foreground">
      <ImageOff aria-hidden className="h-3.5 w-3.5" />
    </span>
  );

  if (!item.href || unlinked) return <span className={box}>{content}</span>;
  return (
    <Link
      href={item.href}
      aria-label={item.name}
      className={cn(
        box,
        "transition-opacity hover:opacity-90",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
    >
      {content}
    </Link>
  );
}

/** The name: a link to its editor when it still exists, plain text when not. */
export function AdminProductName({
  item,
  className,
}: {
  item: AdminProductRef;
  className?: string;
}) {
  if (!item.href) {
    return (
      <span
        className={cn("text-muted-foreground", className)}
        title="This product is no longer in the catalogue"
      >
        {item.name}
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      title="Open this product"
      className={cn(
        "rounded-sm transition-colors hover:text-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    >
      {item.name}
    </Link>
  );
}

/**
 * The headline of a row that is *about* an order: one thumb, the product's
 * name, and whatever reference the row needs underneath it.
 *
 * An order is a list and a row has one headline, so the first line is the one
 * shown and the rest become "+2 more". That is not a compromise — it is what a
 * human does when asked "what was that order?", and the full list is one
 * expand away on every screen that uses this.
 *
 * `meta` is the demotion. Callers pass the order number (usually wrapped in
 * `CopyId`), the date, anything that used to be the first thing on the row.
 */
export function ProductLead({
  items,
  size = "sm",
  meta,
  className,
  /** Orders placed before line items recorded anything, and hand-made rows. */
  emptyLabel = "No items recorded",
}: {
  items: AdminProductRef[];
  size?: ThumbSize;
  meta?: React.ReactNode;
  className?: string;
  emptyLabel?: string;
}) {
  const [first, ...rest] = items;
  const extra = rest.reduce((n, i) => n + Math.max(1, i.quantity ?? 1), 0);

  if (!first) {
    return (
      <div className={cn("min-w-0", className)}>
        <p className="truncate text-xs text-muted-foreground">{emptyLabel}</p>
        {meta}
      </div>
    );
  }

  const firstQty = first.quantity ?? 1;

  return (
    <div className={cn("flex min-w-0 items-start gap-2", className)}>
      <AdminProductThumb item={first} size={size} />
      <div className="min-w-0 flex-1">
        {/* Two lines, not one: a product name truncated to a single line at
            9rem is a column of prefixes. Clamping lets the long ones breathe
            without letting one row set the height of the table. */}
        <p className="line-clamp-2 text-xs font-medium leading-snug">
          <AdminProductName item={first} />
          {firstQty > 1 && (
            <span className="ml-1 font-normal text-muted-foreground tabular-nums">
              × {firstQty}
            </span>
          )}
        </p>
        {(first.variant || extra > 0) && (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {first.variant}
            {first.variant && extra > 0 ? " · " : ""}
            {extra > 0 && `+${extra} more`}
          </p>
        )}
        {meta}
      </div>
    </div>
  );
}
