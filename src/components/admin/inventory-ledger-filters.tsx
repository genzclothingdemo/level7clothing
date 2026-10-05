"use client";

/**
 * The ledger's filter bar: product, size, kind of entry, and a date range —
 * the questions an owner actually asks of a stock history ("what happened to
 * the medium Samurai", "every write-off this month").
 *
 * Every choice is a URL, so a filtered statement is a link that can be sent
 * to someone, and Back steps to the previous view. Choices apply as they are
 * made; there is no Apply button to forget.
 *
 * The size picker only exists once a product is chosen. Before that it would
 * be a list of 107 SKUs, or a disabled box — and a control that cannot apply
 * is absent, not greyed out.
 */

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import { MOVEMENT_META, MOVEMENT_TYPES, type MovementType } from "@/lib/inventory-types";
import { cn } from "@/lib/utils";

export type LedgerFilterValues = {
  product: string;
  variant: string;
  type: string;
  order: string;
  from: string;
  to: string;
};

/** Entries a person makes (the stocktake's opening count included) — and the rest. */
const BY_HAND: MovementType[] = ["OPENING", "RECEIPT", "DAMAGE", "PERSONAL_USE", "ADJUSTMENT"];
const AUTOMATIC: MovementType[] = MOVEMENT_TYPES.filter((t) => !BY_HAND.includes(t));

export function InventoryLedgerFilters({
  values,
  products,
  sizes,
  orderLabel,
}: {
  values: LedgerFilterValues;
  products: { id: string; name: string; hidden: boolean }[];
  /** The chosen product's sizes. Empty until a product is chosen. */
  sizes: { id: string; label: string; sku: string }[];
  /** "L7-…" when the view is narrowed to one order's entries. */
  orderLabel: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();

  /** Any change starts the statement again from the newest entry. */
  function go(next: Partial<LedgerFilterValues>) {
    const v = { ...values, ...next };
    const qs = new URLSearchParams();
    for (const key of ["product", "variant", "type", "order", "from", "to"] as const) {
      if (v[key]) qs.set(key, v[key]);
    }
    const s = qs.toString();
    start(() => router.push(s ? `${pathname}?${s}` : pathname, { scroll: false }));
  }

  const active = Object.values(values).some(Boolean);
  const field = (on: boolean) =>
    cn("input h-11 w-full min-w-0 sm:h-10 sm:w-auto sm:max-w-[16rem]", on && "border-accent text-accent");

  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2.5 transition-opacity",
        pending && "opacity-70"
      )}
      aria-busy={pending}
    >
      <select
        value={values.product}
        onChange={(e) => go({ product: e.target.value, variant: "" })}
        aria-label="Product"
        className={field(!!values.product)}
      >
        <option value="">All products</option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.hidden ? " (hidden)" : ""}
          </option>
        ))}
      </select>

      {values.product && sizes.length > 0 && (
        <select
          value={values.variant}
          onChange={(e) => go({ variant: e.target.value })}
          aria-label="Size"
          className={field(!!values.variant)}
        >
          <option value="">All sizes</option>
          {sizes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} — {s.sku}
            </option>
          ))}
        </select>
      )}

      <select
        value={values.type}
        onChange={(e) => go({ type: e.target.value })}
        aria-label="Kind of entry"
        className={field(!!values.type)}
      >
        <option value="">All entries</option>
        <optgroup label="Recorded by hand">
          {BY_HAND.map((t) => (
            <option key={t} value={t}>
              {MOVEMENT_META[t].label}
            </option>
          ))}
        </optgroup>
        <optgroup label="From orders and returns">
          {AUTOMATIC.map((t) => (
            <option key={t} value={t}>
              {MOVEMENT_META[t].label}
            </option>
          ))}
        </optgroup>
      </select>

      <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
        <input
          type="date"
          value={values.from}
          max={values.to || undefined}
          onChange={(e) => go({ from: e.target.value })}
          aria-label="From date"
          className={cn(field(!!values.from), "flex-1 sm:w-[10.5rem] sm:flex-none")}
        />
        <span className="shrink-0 text-xs text-muted-foreground">to</span>
        <input
          type="date"
          value={values.to}
          min={values.from || undefined}
          onChange={(e) => go({ to: e.target.value })}
          aria-label="To date"
          className={cn(field(!!values.to), "flex-1 sm:w-[10.5rem] sm:flex-none")}
        />
      </div>

      {orderLabel && (
        <button
          type="button"
          onClick={() => go({ order: "" })}
          className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-accent bg-accent/10 px-3 text-[11px] font-medium uppercase tracking-wider text-accent sm:min-h-9"
          aria-label={`Stop showing only order ${orderLabel}`}
        >
          Order {orderLabel}
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}

      {active && (
        <button
          type="button"
          onClick={() => go({ product: "", variant: "", type: "", order: "", from: "", to: "" })}
          className="ml-auto inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-[11px] font-medium uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground sm:min-h-9"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          Clear
        </button>
      )}
    </div>
  );
}
