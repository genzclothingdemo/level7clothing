"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search, X, AlertTriangle } from "lucide-react";
import {
  RETURN_STATUSES,
  RETURN_STATUS_LABEL,
  RETURN_REASONS,
} from "@/lib/returns";

/**
 * Navbar-style status tabs plus the extra narrowing a growing queue needs:
 * free-text search, reason, pickup-problem and age.
 *
 * "Needs action" leads because it is the only tab that represents work — the
 * per-status tabs are for auditing, not for the daily pass.
 */
export function ReturnFilters({ counts }: { counts: Record<string, number> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const status = params.get("status") || "open";
  const q = params.get("q") || "";
  const reason = params.get("reason") || "";
  const issue = params.get("issue") || "";
  const age = params.get("age") || "";

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`);
  }

  const tabs = [
    { key: "open", label: "Needs action" },
    { key: "all", label: "All" },
    ...RETURN_STATUSES.map((s) => ({ key: s, label: RETURN_STATUS_LABEL[s] })),
  ];

  const narrowed = !!(q || reason || issue || age);

  return (
    <div className="space-y-3">
      {/* Status rail — scrolls sideways on mobile rather than wrapping to 3 rows */}
      <div className="-mx-1 overflow-x-auto px-1">
        <div className="flex w-max gap-2 pb-1 md:w-auto md:flex-wrap">
          {tabs.map((t) => {
            const active = status === t.key;
            const count = counts[t.key] ?? 0;
            return (
              <button
                key={t.key}
                onClick={() => setParam("status", t.key === "open" ? null : t.key)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-foreground text-background"
                    : "border border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {t.label}
                <span
                  className={`rounded-full px-1.5 text-xs ${
                    active ? "bg-background/20" : "bg-muted"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[15rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            defaultValue={q}
            onChange={(e) => setParam("q", e.target.value.trim() || null)}
            placeholder="Search RET number, order, customer or product…"
            className="input h-10 pl-9 pr-9"
          />
          {q && (
            <button
              onClick={() => setParam("q", null)}
              className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <select
          value={reason}
          onChange={(e) => setParam("reason", e.target.value || null)}
          className="input h-10 w-auto min-w-[12rem]"
          aria-label="Filter by reason"
        >
          <option value="">Any reason</option>
          <option value="our_fault">Our fault (damaged / wrong / missing)</option>
          {RETURN_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>

        <select
          value={age}
          onChange={(e) => setParam("age", e.target.value || null)}
          className="input h-10 w-auto min-w-[10rem]"
          aria-label="Filter by age"
        >
          <option value="">Any time</option>
          <option value="today">Raised today</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="stale">Waiting 3+ days</option>
        </select>

        <button
          type="button"
          onClick={() => setParam("issue", issue === "pickup" ? null : "pickup")}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition-colors ${
            issue === "pickup"
              ? "bg-danger text-white"
              : "border border-border text-muted-foreground hover:bg-muted"
          }`}
          title="Approved but the reverse pickup never got booked"
        >
          <AlertTriangle className="h-3.5 w-3.5" /> Pickup failed
        </button>

        {narrowed && (
          <button
            onClick={() =>
              router.replace(pathname + (status === "open" ? "" : `?status=${status}`))
            }
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
          >
            <X className="h-3.5 w-3.5" /> Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
