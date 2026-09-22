"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Btn } from "@/components/admin/order-ui";
import {
  CUSTOMER_KINDS,
  CUSTOMER_KIND_HELP,
  CUSTOMER_KIND_LABEL,
  CUSTOMER_SORTS,
  CUSTOMER_STATUS_HELP,
  CUSTOMER_STATUS_LABEL,
  type CustomerKind,
  type CustomerStatus,
} from "@/lib/customers";

/**
 * Two rows: the Customers / Guests split, then search, status chips and sort.
 *
 * ── Why the split is a row of its own ────────────────────────────────────────
 *
 * It is not another facet. Everything on the second row narrows *within* a
 * group, and the group decides which statuses can even occur (`registered`
 * only exists for customers, `interested` only for guests). Mixing them into
 * one strip would offer chips that are always zero.
 *
 * Switching group **keeps the search and drops the status**, for the same
 * reason: a status that means something on one side may not exist on the
 * other, and carrying it over would land the reader on an empty list they did
 * not ask for. The page number goes too — see `setParam`.
 *
 * Deliberately not the collapsible panel the orders screen needs — there are
 * only a few facets here, and a "Filters" toggle hiding two selects costs more
 * taps than it saves. Everything lives in the URL so a filtered view is
 * shareable and the back button behaves.
 */

/** Typing shouldn't fire a query per keystroke: every load is a DB round trip. */
const SEARCH_DEBOUNCE_MS = 300;

export function CustomerFilters({
  counts,
  kindCounts,
  /** Which statuses can occur in the group being shown. */
  statuses,
}: {
  counts: Record<string, number>;
  kindCounts: Record<CustomerKind, number>;
  statuses: readonly CustomerStatus[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const urlQ = params.get("q") ?? "";
  const group = params.get("group") === "guest" ? "guest" : "customer";
  const status = params.get("status") ?? "all";
  const sort = params.get("sort") ?? "recent";

  const [q, setQ] = useState(urlQ);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function push(next: URLSearchParams) {
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    // Any change to what is being listed resets the page. Keeping `?page=4`
    // through a narrowing filter leaves the reader on page 4 of a list that is
    // now one page long — the URL would be honest and the screen would look
    // broken. The page number is clamped server-side too, so this is about the
    // link being right rather than about the page surviving.
    next.delete("page");
    push(next);
  }

  function onSearch(value: string) {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setParam("q", value.trim() || null), SEARCH_DEBOUNCE_MS);
  }

  /**
   * Switching group keeps the query, drops the status and the page. Written
   * out rather than reusing `setParam` because that one preserves everything
   * it is not given, which is the wrong rule here.
   */
  function setGroup(next: CustomerKind) {
    const p = new URLSearchParams();
    const typed = q.trim();
    if (typed) p.set("q", typed);
    if (sort !== "recent") p.set("sort", sort);
    if (next === "guest") p.set("group", "guest");
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  function clearAll() {
    if (timer.current) clearTimeout(timer.current);
    setQ("");
    // Stays in the group being looked at: "Clear" means clear the filters, not
    // navigate somewhere else.
    router.replace(group === "guest" ? `${pathname}?group=guest` : pathname);
  }

  const active = (urlQ ? 1 : 0) + (status !== "all" ? 1 : 0);

  const tabs = [
    {
      key: "all",
      label: "All",
      help:
        group === "guest"
          ? "Everyone without an account that the store has a contact detail for."
          : "Everyone with an account.",
    },
    ...statuses.map((s) => ({
      key: s,
      label: CUSTOMER_STATUS_LABEL[s],
      help: CUSTOMER_STATUS_HELP[s],
    })),
  ];

  return (
    <div className="rounded-lg border border-border bg-card p-2">
      {/* ---- The split ---- */}
      <div
        role="group"
        aria-label="Customers or guests"
        className="flex flex-wrap items-center gap-2 border-b border-border pb-2"
      >
        {CUSTOMER_KINDS.map((k) => {
          const on = group === k;
          return (
            <button
              key={k}
              type="button"
              title={CUSTOMER_KIND_HELP[k]}
              aria-pressed={on}
              onClick={() => setGroup(k)}
              className={cn(
                "inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 text-[11px] font-medium uppercase tracking-wider transition-colors sm:min-h-9 sm:flex-none",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                on
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {CUSTOMER_KIND_LABEL[k]}
              <span
                className={cn(
                  "rounded px-1 text-[10px] tabular-nums",
                  on ? "bg-accent/20" : "bg-muted"
                )}
              >
                {kindCounts[k]}
              </span>
            </button>
          );
        })}
        <p className="basis-full text-[11px] leading-relaxed text-muted-foreground sm:basis-auto sm:pl-1">
          {CUSTOMER_KIND_HELP[group]}
        </p>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-full sm:basis-52">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Name, email, phone or order #"
            aria-label="Search customers"
            className="input h-11 pl-8 text-xs sm:h-9"
          />
        </div>

        {tabs.map((t) => {
          const on = status === t.key;
          return (
            <button
              key={t.key}
              type="button"
              title={t.help}
              aria-pressed={on}
              onClick={() => setParam("status", t.key === "all" ? null : t.key)}
              className={cn(
                "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium uppercase tracking-wider transition-colors sm:min-h-9",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                on
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {t.label}
              <span
                className={cn(
                  "rounded px-1 text-[10px] tabular-nums",
                  on ? "bg-accent/20" : "bg-muted"
                )}
              >
                {counts[t.key] ?? 0}
              </span>
            </button>
          );
        })}

        <label className="ml-auto flex min-w-0 items-center gap-1.5">
          <span className="eyebrow shrink-0">Sort</span>
          <select
            value={sort}
            onChange={(e) =>
              setParam("sort", e.target.value === "recent" ? null : e.target.value)
            }
            className="input h-11 w-auto min-w-0 text-xs sm:h-9"
          >
            {CUSTOMER_SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        {active > 0 && (
          <Btn tone="ghost" onClick={clearAll} title="Clear search and filters">
            <X className="h-3.5 w-3.5" /> Clear
          </Btn>
        )}
      </div>
    </div>
  );
}
