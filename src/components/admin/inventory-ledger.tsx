/**
 * inventory-ledger — every stock entry, read like a bank statement.
 *
 * The owner asked to *see* the entries ("entry bhi see kar sake"), and the
 * test of this component is that they can point at any number on the stock
 * screen and walk back to exactly where it came from. So each row carries the
 * balances **after** it, the way a statement carries a closing balance: nothing
 * has to be re-added in the reader's head, and a gap or a jump between two rows
 * is visible to the eye.
 *
 * Deposits and withdrawals get their own columns — In and Out — because that
 * is the statement layout everyone already reads without instruction. Reserve
 * and release move no units, so their In and Out are blank and the change
 * shows in the Reserved column instead: a promise, not a parcel.
 *
 * **Server-rendered only.** No directive and no hooks, but the dates are
 * formatted here, pinned to Asia/Kolkata — Vercel's functions run in UTC — and
 * formatting them again in a browser would be a second clock to disagree with.
 */

import Link from "next/link";
import type { MovementType } from "@/lib/inventory-types";
import { cn, formatINR } from "@/lib/utils";
import {
  MovementBadge,
  actorText,
  formatBalance,
  formatSigned,
  formatUnits,
  inventoryHref,
} from "@/components/admin/inventory-ui";

/** One entry, flattened for rendering. Plain data — dates as ISO strings. */
export type LedgerRow = {
  id: string;
  at: string;
  type: MovementType;
  onHandDelta: number;
  reservedDelta: number;
  onHandAfter: number;
  reservedAfter: number;
  unitCost: number | null;
  note: string | null;
  orderId: string | null;
  returnId: string | null;
  actorType: string;
  actorName: string | null;
  variantId: string;
  sku: string;
  /** "M", "M / red". */
  label: string;
  productId: string;
  productName: string;
};

/**
 * The quotable references behind the ids on a page of rows. The ledger stores
 * ids, because an order number is display and an id is identity; the screens
 * it links to are searched by the number.
 */
export type LedgerRefs = {
  orders: Record<string, string>;
  returns: Record<string, string>;
};

const DAY = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

const TIME = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

const link =
  "underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm";

/** What caused the entry, and why: the order or return behind it, the price paid, the reason typed. */
function Reference({ row, refs }: { row: LedgerRow; refs: LedgerRefs }) {
  const parts: React.ReactNode[] = [];

  if (row.returnId) {
    const n = refs.returns[row.returnId];
    parts.push(
      n ? (
        <Link key="ret" href={inventoryHref.return(n)} className={link}>
          Return {n}
        </Link>
      ) : (
        <span key="ret">Return (removed)</span>
      )
    );
  }
  if (row.orderId) {
    const n = refs.orders[row.orderId];
    parts.push(
      n ? (
        <Link key="ord" href={inventoryHref.order(n)} className={link}>
          Order {n}
        </Link>
      ) : (
        // The ledger outlives an order on purpose (plain-string reference, not
        // a foreign key), so a deleted one is named as such rather than hidden.
        <span key="ord">Order (removed)</span>
      )
    );
  }
  if (row.type === "RECEIPT" && row.unitCost != null) {
    parts.push(<span key="cost">{formatINR(row.unitCost)} each</span>);
  }

  if (parts.length === 0 && !row.note) return null;

  return (
    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span aria-hidden="true"> · </span>}
          {p}
        </span>
      ))}
      {row.note && (
        <span className={cn("block break-words text-foreground/80", parts.length > 0 && "mt-0.5")}>
          {row.note}
        </span>
      )}
    </span>
  );
}

function Actor({ row }: { row: LedgerRow }) {
  const a = actorText(row.actorType, row.actorName);
  return (
    <>
      <span className={cn(row.actorType === "system" && "text-muted-foreground")}>{a.name}</span>
      {a.note && <span className="block text-[11px] text-muted-foreground">{a.note}</span>}
    </>
  );
}

/** Units promised past what is on the shelf, as of this row. */
function shortBy(row: LedgerRow): number {
  return Math.max(0, row.reservedAfter - row.onHandAfter);
}

export function LedgerTable({
  rows,
  refs,
  showProduct = true,
  showSize = true,
}: {
  rows: LedgerRow[];
  refs: LedgerRefs;
  /** Off when every row is one product — its name would be a column of repeats. */
  showProduct?: boolean;
  /** Off when every row is one size, for the same reason. */
  showSize?: boolean;
}) {
  const sizeCell = (r: LedgerRow) => (
    <>
      {showProduct && (
        <Link
          href={inventoryHref.product(r.productId)}
          className={cn("block truncate text-xs text-muted-foreground", link)}
          title={r.productName}
        >
          {r.productName}
        </Link>
      )}
      <span className="font-medium">{r.label}</span>
      <span className="block font-mono text-[11px] text-muted-foreground">{r.sku}</span>
    </>
  );

  return (
    <div className="min-w-0">
      {/* ---- md and up: the statement, one entry per row. ---- */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-medium">
                When
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Entry
              </th>
              {(showSize || showProduct) && (
                <th scope="col" className="px-3 py-2 font-medium">
                  Size
                </th>
              )}
              <th scope="col" className="px-3 py-2 text-right font-medium">
                In
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Out
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                On hand
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Reserved
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                By
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const at = new Date(r.at);
              const short = shortBy(r);
              return (
                <tr key={r.id} className="align-top">
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <span className="block tabular-nums">{DAY.format(at)}</span>
                    <span className="block text-[11px] tabular-nums text-muted-foreground">
                      {TIME.format(at)}
                    </span>
                  </td>
                  <td className="min-w-[12rem] max-w-[22rem] px-3 py-2.5">
                    <MovementBadge type={r.type} />
                    <Reference row={r} refs={refs} />
                  </td>
                  {(showSize || showProduct) && (
                    <td className="max-w-[14rem] px-3 py-2.5">{sizeCell(r)}</td>
                  )}
                  <td className="px-3 py-2.5 text-right tabular-nums text-success">
                    {r.onHandDelta > 0 ? formatUnits(r.onHandDelta) : ""}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {r.onHandDelta < 0 ? formatUnits(-r.onHandDelta) : ""}
                  </td>
                  <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                    {formatBalance(r.onHandAfter)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                    <span className={cn(r.reservedDelta === 0 && "text-muted-foreground")}>
                      {formatBalance(r.reservedAfter)}
                    </span>
                    {r.reservedDelta !== 0 && (
                      <span className="block text-[11px] text-muted-foreground">
                        {formatSigned(r.reservedDelta)}
                      </span>
                    )}
                    {short > 0 && (
                      <span className="block text-[11px] font-medium text-danger">
                        short {formatUnits(short)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    <Actor row={r} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ---- Phones: a banking app's list. What happened on the left, the
          change and the balance after it on the right. ---- */}
      <ul className="divide-y divide-border md:hidden">
        {rows.map((r) => {
          const at = new Date(r.at);
          const short = shortBy(r);
          const moved = r.onHandDelta !== 0;
          return (
            <li key={r.id} className="flex gap-3 px-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5">
                  <MovementBadge type={r.type} />
                  {showSize && <span className="text-sm font-medium">{r.label}</span>}
                </p>
                {(showProduct || showSize) && (
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {showProduct && <>{r.productName} · </>}
                    <span className="font-mono">{r.sku}</span>
                  </p>
                )}
                <Reference row={r} refs={refs} />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {DAY.format(at)}, {TIME.format(at)} · {actorText(r.actorType, r.actorName).name}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p
                  className={cn(
                    "text-base font-medium leading-tight tabular-nums",
                    r.onHandDelta > 0 && "text-success"
                  )}
                >
                  {moved ? formatSigned(r.onHandDelta) : formatSigned(r.reservedDelta)}
                  {!moved && (
                    <span className="ml-1 text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
                      res.
                    </span>
                  )}
                </p>
                <p className="text-[11px] tabular-nums text-muted-foreground">
                  On hand {formatBalance(r.onHandAfter)}
                </p>
                {(r.reservedAfter !== 0 || r.reservedDelta !== 0) && (
                  <p className="text-[11px] tabular-nums text-muted-foreground">
                    Reserved {formatBalance(r.reservedAfter)}
                  </p>
                )}
                {short > 0 && (
                  <p className="text-[11px] font-medium text-danger">short {formatUnits(short)}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
