"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Btn } from "@/components/admin/order-ui";
import {
  CUSTOMER_SORTS,
  CUSTOMER_STATUSES,
  CUSTOMER_STATUS_HELP,
  CUSTOMER_STATUS_LABEL,
} from "@/lib/customers";

/**
 * One wrapping row: search, the three status chips, a sort control.
 *
 * Deliberately not the collapsible panel the orders screen needs — there are
 * only three facets here, and a "Filters" toggle hiding two selects costs more
 * taps than it saves. Everything lives in the URL so a filtered view is
 * shareable and the back button behaves.
 */

/** Typing shouldn't fire a query per keystroke: every load is a DB round trip. */
const SEARCH_DEBOUNCE_MS = 300;

export function CustomerFilters({ counts }: { counts: Record<string, number> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const urlQ = params.get("q") ?? "";
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
    push(next);
  }

  function onSearch(value: string) {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setParam("q", value.trim() || null), SEARCH_DEBOUNCE_MS);
  }

  function clearAll() {
    if (timer.current) clearTimeout(timer.current);
    setQ("");
    router.replace(pathname);
  }

  const active = (urlQ ? 1 : 0) + (status !== "all" ? 1 : 0);

  const tabs = [
    { key: "all", label: "All", help: "Everyone the store has a contact detail for." },
    ...CUSTOMER_STATUSES.map((s) => ({
      key: s,
      label: CUSTOMER_STATUS_LABEL[s],
      help: CUSTOMER_STATUS_HELP[s],
    })),
  ];

  return (
    <div className="rounded-lg border border-border bg-card p-2">
      <div className="flex flex-wrap items-center gap-2">
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
