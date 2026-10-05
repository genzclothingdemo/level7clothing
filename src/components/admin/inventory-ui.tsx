/**
 * inventory-ui — the shared furniture of Admin → Inventory.
 *
 * **No directive and no hooks**, so the server pages and the client islands
 * (the stock list, the entry forms) render the same badge, the same number and
 * the same link for the same fact. It imports only pure modules —
 * `lib/inventory-types` and `lib/utils` — and never the engine, which is
 * `server-only` (CLAUDE.md, "RSC boundary traps").
 *
 * The vocabulary itself — what each entry is called, what it means, which ones
 * need a reason, what "low" means — lives in `lib/inventory-types`. This file
 * only decides how it looks. A label typed here would be a second copy of one
 * that already exists, and the first time they disagreed nobody could tell
 * which was right.
 */

import Link from "next/link";
import { History } from "lucide-react";
import {
  MOVEMENT_META,
  STOCK_STATE_META,
  type MovementType,
  type StockState,
} from "@/lib/inventory-types";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Numbers                                                            */
/* ------------------------------------------------------------------ */

const COUNT = new Intl.NumberFormat("en-IN");

/** Indian grouping (1,23,456), the way the owner reads every other figure. */
export function formatUnits(n: number): string {
  return COUNT.format(n);
}

/** A balance: `12`, `0`, `−2`. Only a negative carries a sign. */
export function formatBalance(n: number): string {
  return n < 0 ? `−${COUNT.format(-n)}` : COUNT.format(n);
}

/**
 * `+20`, `−2`, `0`. The minus is U+2212, which is digit-width, so a column of
 * signed changes lines up — a hyphen is narrower and makes a statement ragged.
 */
export function formatSigned(n: number): string {
  if (n === 0) return "0";
  return `${n > 0 ? "+" : "−"}${COUNT.format(Math.abs(n))}`;
}

/* ------------------------------------------------------------------ */
/*  Labels                                                             */
/* ------------------------------------------------------------------ */

/** The option names in the order the product editor lists them. */
export function axisOrderOf(attributes: unknown): string[] {
  if (!Array.isArray(attributes)) return [];
  return attributes
    .map((a) => (a && typeof a === "object" ? (a as { name?: unknown }).name : null))
    .filter((n): n is string => typeof n === "string" && n.length > 0);
}

/**
 * `{ Size: "M", color: "red" }` → `"M / red"`, in the product's own option
 * order — the way Shopify names a variant, and short enough for a table cell.
 * A product with no options has one unit and it is called "One size".
 */
export function variantLabel(combo: unknown, axisOrder: readonly string[] = []): string {
  const map = combo && typeof combo === "object" ? (combo as Record<string, unknown>) : {};
  const names = Object.keys(map);
  if (names.length === 0) return "One size";
  const ordered = [
    ...axisOrder.filter((n) => names.includes(n)),
    ...names.filter((n) => !axisOrder.includes(n)),
  ];
  return ordered
    .map((n) => String(map[n] ?? ""))
    .filter(Boolean)
    .join(" / ");
}

/**
 * Who made an entry, as the ledger prints it. The engine copies the name onto
 * the row, so a deleted temporary admin is still named here.
 */
export function actorText(type: string, name: string | null): { name: string; note?: string } {
  if (type === "system") return { name: "Automatic" };
  if (type === "temp_admin") return { name: name || "Temporary admin", note: "temporary admin" };
  return { name: name || "Admin" };
}

/* ------------------------------------------------------------------ */
/*  Links                                                              */
/* ------------------------------------------------------------------ */

/**
 * The stock list's quick filters. `all` is the bare URL. Kept here, in a module
 * with no directive, because the server page reads `?show=` to render the
 * first paint and the client list writes it back.
 */
export const STOCK_FILTERS = ["all", "tracked", "untracked", "oversold", "out", "low"] as const;
export type StockFilter = (typeof STOCK_FILTERS)[number];

export function isStockFilter(v: unknown): v is StockFilter {
  return typeof v === "string" && (STOCK_FILTERS as readonly string[]).includes(v);
}

export type LedgerLinkFilter = {
  product?: string;
  variant?: string;
  type?: MovementType;
  order?: string;
};

/**
 * Every destination this section links to, in one list, so "no dead ends" is
 * one place to check. Orders and returns have no detail route — both screens
 * are a searchable list — so they are reached by their quotable reference, the
 * same way the customer record links them (`adminLink` in `lib/customers`).
 */
export const inventoryHref = {
  stock: (show?: StockFilter) =>
    show && show !== "all" ? `/admin/inventory?show=${show}` : "/admin/inventory",
  product: (productId: string) => `/admin/inventory/${encodeURIComponent(productId)}`,
  ledger: (f: LedgerLinkFilter = {}) => {
    const qs = new URLSearchParams();
    if (f.product) qs.set("product", f.product);
    if (f.variant) qs.set("variant", f.variant);
    if (f.type) qs.set("type", f.type);
    if (f.order) qs.set("order", f.order);
    const s = qs.toString();
    return s ? `/admin/inventory/ledger?${s}` : "/admin/inventory/ledger";
  },
  /** SKU, price, cost and the low-stock line are edited there, never here. */
  editor: (productId: string) => `/admin/products/${encodeURIComponent(productId)}/edit`,
  order: (orderNumber: string) => `/admin/orders?q=${encodeURIComponent(orderNumber)}`,
  return: (requestNumber: string) =>
    `/admin/returns?status=all&q=${encodeURIComponent(requestNumber)}`,
} as const;

/* ------------------------------------------------------------------ */
/*  Badges                                                             */
/* ------------------------------------------------------------------ */

const BADGE =
  "inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider";

/**
 * Oversold is the only **solid** badge on the screen. It is the one state that
 * needs a person — open orders cannot all be filled from the shelf — so it has
 * to out-shout "out of stock", which merely stops new sales.
 */
const STATE_TONE: Record<StockState, string> = {
  oversold: "bg-danger text-background",
  out: "bg-danger/15 text-danger",
  low: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  ok: "bg-success/15 text-success",
};

/** The same scale as ink, for a number rather than a badge. */
export const STATE_INK: Record<StockState, string> = {
  oversold: "text-danger",
  out: "text-danger",
  low: "text-orange-600 dark:text-orange-400",
  ok: "text-foreground",
};

export function StateBadge({ state, className }: { state: StockState; className?: string }) {
  return (
    <span className={cn(BADGE, STATE_TONE[state], className)}>{STOCK_STATE_META[state].label}</span>
  );
}

/**
 * One colour per kind of entry, and never colour alone — the label is always
 * printed, so the tint is the third signal after the word and the sign.
 */
const MOVEMENT_TONE: Record<MovementType, string> = {
  OPENING: "bg-foreground/10 text-foreground",
  RECEIPT: "bg-success/15 text-success",
  RESERVE: "bg-muted text-muted-foreground",
  RELEASE: "bg-muted text-muted-foreground",
  SALE: "bg-accent/15 text-accent",
  RETURN: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  RTO: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  DAMAGE: "bg-danger/15 text-danger",
  PERSONAL_USE: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  ADJUSTMENT: "bg-foreground/10 text-foreground",
};

export function MovementBadge({ type }: { type: MovementType }) {
  const meta = MOVEMENT_META[type];
  return (
    <span title={meta.description} className={cn(BADGE, MOVEMENT_TONE[type])}>
      {meta.label}
    </span>
  );
}

/** A small neutral tag — "Hidden", "Retired", "Not tracked". */
export function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn(BADGE, "bg-muted text-muted-foreground", className)}>{children}</span>;
}

/* ------------------------------------------------------------------ */
/*  The sizes of one product                                           */
/* ------------------------------------------------------------------ */

export type VariantLine = {
  id: string;
  /** "M", "M / red", "One size". */
  label: string;
  sku: string;
  onHand: number;
  reserved: number;
  available: number;
  /** Null while the product is not tracked — its counters mean nothing yet. */
  state: StockState | null;
  /** Switched off in the editor but still holding units or promises. */
  retired: boolean;
};

const historyLink =
  "grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:h-9 sm:w-9 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function HistoryLink({ v }: { v: VariantLine }) {
  return (
    <Link
      href={inventoryHref.ledger({ variant: v.id })}
      title={`History of ${v.label}`}
      aria-label={`History of ${v.label} (${v.sku})`}
      className={historyLink}
    >
      <History className="h-4 w-4" aria-hidden="true" />
    </Link>
  );
}

/**
 * On hand, reserved and available for every size, with a one-click history
 * link on each.
 *
 * Two layouts from one list: a real table from `sm` up, where the three
 * numbers need aligned columns to be compared down the page, and one line per
 * size on a phone, where three numeric columns plus a SKU do not fit in 343px
 * and "available" — what the shop can still sell — leads.
 */
export function VariantTable({
  variants,
  highlight,
  detail,
  className,
}: {
  variants: VariantLine[];
  /** Sizes a search or a filter picked out. Null or absent: none singled out. */
  highlight?: ReadonlySet<string> | null;
  /** Extra line under a size's name — overrides, the orders holding it. */
  detail?: Record<string, React.ReactNode>;
  className?: string;
}) {
  const lit = (id: string) => highlight?.has(id) ?? false;

  return (
    <div className={cn("min-w-0", className)}>
      <table className="hidden w-full text-sm sm:table">
        <thead>
          <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th scope="col" className="px-3 py-2 font-medium">
              Size
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              On hand
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Reserved
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Available
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              State
            </th>
            <th scope="col" className="w-12 px-1 py-2">
              <span className="sr-only">History</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {variants.map((v) => (
            <tr key={v.id} className={cn(lit(v.id) && "bg-accent/5")}>
              <td className="px-3 py-2 align-top">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{v.label}</span>
                  {v.retired && <Tag>Retired</Tag>}
                </span>
                <span className="block font-mono text-[11px] text-muted-foreground">{v.sku}</span>
                {detail?.[v.id]}
              </td>
              <td className="px-3 py-2 text-right align-top tabular-nums">{formatUnits(v.onHand)}</td>
              <td className="px-3 py-2 text-right align-top tabular-nums text-muted-foreground">
                {formatUnits(v.reserved)}
              </td>
              <td
                className={cn(
                  "px-3 py-2 text-right align-top font-medium tabular-nums",
                  v.state ? STATE_INK[v.state] : "text-muted-foreground"
                )}
              >
                {v.state ? formatBalance(v.available) : "—"}
              </td>
              <td className="px-3 py-2 align-top">
                {v.state ? <StateBadge state={v.state} /> : <Tag>Not tracked</Tag>}
              </td>
              <td className="px-1 py-1 align-top">
                <HistoryLink v={v} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="divide-y divide-border sm:hidden">
        {variants.map((v) => (
          <li key={v.id} className={cn("flex items-start gap-2 px-3 py-2", lit(v.id) && "bg-accent/5")}>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-1.5 text-sm">
                <span className="font-medium">{v.label}</span>
                {v.state && v.state !== "ok" && <StateBadge state={v.state} />}
                {v.retired && <Tag>Retired</Tag>}
              </p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">{v.sku}</p>
              {detail?.[v.id]}
            </div>
            <div className="shrink-0 text-right">
              <p
                className={cn(
                  "text-base font-medium leading-tight tabular-nums",
                  v.state ? STATE_INK[v.state] : "text-muted-foreground"
                )}
              >
                {v.state ? formatBalance(v.available) : "—"}
                <span className="ml-1 text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
                  avail.
                </span>
              </p>
              <p className="text-[11px] tabular-nums text-muted-foreground">
                {formatUnits(v.onHand)} on hand · {formatUnits(v.reserved)} reserved
              </p>
            </div>
            <HistoryLink v={v} />
          </li>
        ))}
      </ul>
    </div>
  );
}
