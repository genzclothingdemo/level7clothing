"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoTip } from "@/components/store/info-tip";
import { Btn, LabelledField } from "@/components/admin/order-ui";

/**
 * Orders filter bar.
 *
 * One wrapping row is always visible — search, the two shortcuts an operator
 * actually uses every day, and a "Filters" toggle carrying the active count.
 * Everything else lives behind that toggle, so the bar costs one row instead
 * of a third of the screen.
 */

const ORDER_STATUSES = ["pending", "confirmed", "shipped", "delivered", "cancelled"];
const PAYMENT_METHODS = ["COD", "Razorpay", "Partial", "Direct"];

type FilterState = {
  q: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  from: string;
  to: string;
  min: string;
  max: string;
  coupon: string;
  /** "1" = only orders flagged as needing customisation. */
  custom: string;
  match: "all" | "any";
};

const EMPTY: FilterState = {
  q: "",
  status: "",
  paymentStatus: "",
  paymentMethod: "",
  from: "",
  to: "",
  min: "",
  max: "",
  coupon: "",
  custom: "",
  match: "all",
};

function fromParams(params: URLSearchParams): FilterState {
  return {
    q: params.get("q") ?? "",
    status: params.get("status") ?? "",
    paymentStatus: params.get("paymentStatus") ?? "",
    paymentMethod: params.get("paymentMethod") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    min: params.get("min") ?? "",
    max: params.get("max") ?? "",
    coupon: params.get("coupon") ?? "",
    custom: params.get("custom") ?? "",
    match: (params.get("match") as "all" | "any") ?? "all",
  };
}

function countActive(f: FilterState): number {
  return [
    f.q,
    f.status,
    f.paymentStatus,
    f.paymentMethod,
    f.from,
    f.to,
    f.min,
    f.max,
    f.coupon,
    f.custom,
  ].filter(Boolean).length;
}

export function OrderFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<FilterState>(() => fromParams(params));

  const activeCount = countActive(f);

  function set<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    setF((prev) => ({ ...prev, [key]: value }));
  }

  /** Push a given state to the URL — the page reads its filters from there. */
  function applyWith(state: FilterState) {
    const next = new URLSearchParams();
    if (state.q) next.set("q", state.q.trim());
    if (state.status) next.set("status", state.status);
    if (state.paymentStatus) next.set("paymentStatus", state.paymentStatus);
    if (state.paymentMethod) next.set("paymentMethod", state.paymentMethod);
    if (state.from) next.set("from", state.from);
    if (state.to) next.set("to", state.to);
    if (state.min) next.set("min", state.min);
    if (state.max) next.set("max", state.max);
    if (state.coupon) next.set("coupon", state.coupon.toUpperCase());
    if (state.custom) next.set("custom", "1");
    if (countActive(state) > 1) next.set("match", state.match);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  /** A one-tap shortcut: flip one field and search straight away. */
  function toggle<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    const next = { ...f, [key]: f[key] === value ? "" : value } as FilterState;
    setF(next);
    applyWith(next);
  }

  function clearAll() {
    setF(EMPTY);
    router.replace(pathname);
  }

  return (
    <div className="rounded-lg border border-border bg-card p-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-full sm:basis-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={f.q}
            onChange={(e) => set("q", e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyWith(f)}
            placeholder="Order #, name, email or phone"
            className="input h-11 pl-8 text-xs sm:h-9"
          />
        </div>

        <Chip
          active={f.status === "pending"}
          onClick={() => toggle("status", "pending")}
          title="Orders awaiting your acceptance"
        >
          Needs confirmation
        </Chip>

        <Chip
          active={f.custom === "1"}
          onClick={() => toggle("custom", "1")}
          title="Orders containing a made-to-order piece"
        >
          <Sparkles className="h-3 w-3" /> Needs customisation
        </Chip>

        <Btn
          tone="outline"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="ml-auto"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filters
          {activeCount > 0 && (
            <span className="grid h-4 min-w-4 place-items-center rounded px-1 text-[10px] bg-foreground text-background">
              {activeCount}
            </span>
          )}
        </Btn>

        <Btn tone="solid" onClick={() => applyWith(f)}>
          Search
        </Btn>

        {activeCount > 0 && (
          <Btn tone="ghost" onClick={clearAll} title="Clear every filter">
            <X className="h-3.5 w-3.5" /> Clear
          </Btn>
        )}
      </div>

      {open && (
        <div className="mt-2 border-t border-border pt-2">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <LabelledField label="Order status">
              <select
                value={f.status}
                onChange={(e) => set("status", e.target.value)}
                className="input h-11 text-xs capitalize sm:h-9"
              >
                <option value="">Any status</option>
                {ORDER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </LabelledField>

            <LabelledField
              label="Payment status"
              hint={
                <InfoTip term="Partial payment">
                  An advance was paid online and the balance is collected on
                  delivery, so a part-paid order still has cash to collect.
                </InfoTip>
              }
            >
              <select
                value={f.paymentStatus}
                onChange={(e) => set("paymentStatus", e.target.value)}
                className="input h-11 text-xs sm:h-9"
              >
                <option value="">Any</option>
                <option value="pending">Pending (COD)</option>
                <option value="partial">Part-paid</option>
                <option value="paid">Paid</option>
                <option value="failed">Failed</option>
              </select>
            </LabelledField>

            <LabelledField label="Payment method">
              <select
                value={f.paymentMethod}
                onChange={(e) => set("paymentMethod", e.target.value)}
                className="input h-11 text-xs sm:h-9"
              >
                <option value="">Any</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </LabelledField>

            <LabelledField label="Coupon code">
              <input
                type="text"
                value={f.coupon}
                onChange={(e) => set("coupon", e.target.value.toUpperCase())}
                className="input h-11 text-xs uppercase sm:h-9"
                placeholder="e.g. SUMMER20"
              />
            </LabelledField>

            <LabelledField label="From date">
              <input
                type="date"
                value={f.from}
                onChange={(e) => set("from", e.target.value)}
                className="input h-11 text-xs sm:h-9"
              />
            </LabelledField>

            <LabelledField label="To date">
              <input
                type="date"
                value={f.to}
                onChange={(e) => set("to", e.target.value)}
                className="input h-11 text-xs sm:h-9"
              />
            </LabelledField>

            <div className="grid grid-cols-2 gap-2">
              <LabelledField label="Min ₹">
                <input
                  type="number"
                  min={0}
                  value={f.min}
                  onChange={(e) => set("min", e.target.value)}
                  className="input h-11 text-xs sm:h-9"
                  placeholder="0"
                />
              </LabelledField>
              <LabelledField label="Max ₹">
                <input
                  type="number"
                  min={0}
                  value={f.max}
                  onChange={(e) => set("max", e.target.value)}
                  className="input h-11 text-xs sm:h-9"
                  placeholder="—"
                />
              </LabelledField>
            </div>

            <LabelledField
              label="Customisation"
              hint={
                <InfoTip term="Needs customisation">
                  Set at checkout when the basket contains a made-to-order
                  piece. Those orders need details from the customer before
                  they can be dispatched.
                </InfoTip>
              }
            >
              <select
                value={f.custom}
                onChange={(e) => set("custom", e.target.value)}
                className="input h-11 text-xs sm:h-9"
              >
                <option value="">Any order</option>
                <option value="1">Needs customisation</option>
              </select>
            </LabelledField>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Match
              </span>
              <div className="inline-flex overflow-hidden rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => set("match", "all")}
                  className={cn(
                    "cursor-pointer px-2.5 py-2 text-[10px] font-medium uppercase tracking-wider transition-colors sm:py-1.5",
                    f.match === "all"
                      ? "bg-foreground text-background"
                      : "hover:bg-muted"
                  )}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => set("match", "any")}
                  className={cn(
                    "cursor-pointer px-2.5 py-2 text-[10px] font-medium uppercase tracking-wider transition-colors sm:py-1.5",
                    f.match === "any"
                      ? "bg-foreground text-background"
                      : "hover:bg-muted"
                  )}
                >
                  Any
                </button>
              </div>
              <InfoTip term="Match">
                <b>All</b> keeps only orders that satisfy every filter;{" "}
                <b>Any</b> widens the list to orders matching at least one.
              </InfoTip>
            </div>
            <Btn tone="solid" onClick={() => applyWith(f)}>
              Apply filters
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

/** A one-tap filter shortcut. Same metrics as `Btn`, with an on/off look. */
function Chip({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-[11px] font-medium uppercase tracking-wider transition-colors sm:min-h-9",
        active
          ? "border-accent bg-accent/10 text-accent"
          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
