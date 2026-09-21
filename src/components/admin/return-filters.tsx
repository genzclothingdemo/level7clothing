"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search, X, AlertTriangle } from "lucide-react";
import {
  RETURN_STATUSES,
  RETURN_STATUS_LABEL,
  RETURN_REASONS,
} from "@/lib/returns";

/**
 * Status tabs plus the extra narrowing a growing queue needs: free-text
 * search, reason, pickup-problem and age.
 *
 * "Needs action" leads because it is the only tab that represents work — the
 * per-status tabs are for auditing, not for the daily pass.
 *
 * Every control is a URL parameter, never local state: a filtered queue is
 * something the owner sends to themselves or reloads after acting on a row.
 */
export function ReturnFilters({
  counts,
  reasons,
}: {
  counts: Record<string, number>;
  /** The admin's live list, so the filter can't offer a reason nobody can pick. */
  reasons: string[];
}) {
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

  // Reasons retired from the settings list, but still on rows already raised —
  // dropping them from the filter would make those rows unfindable.
  const legacy = RETURN_REASONS.filter(
    (r) => !reasons.some((c) => c.toLowerCase() === r.label.toLowerCase())
  );

  const narrowed = !!(q || reason || issue || age);
  const pill =
    "inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors";

  return (
    <div className="space-y-2">
      {/* Status rail — scrolls sideways on mobile rather than wrapping to 3 rows */}
      <div className="-mx-1 overflow-x-auto px-1">
        <div className="flex w-max gap-1.5 pb-1 md:w-auto md:flex-wrap">
          {tabs.map((t) => {
            const active = status === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setParam("status", t.key === "open" ? null : t.key)}
                className={`inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm transition-colors ${
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
                  {counts[t.key] ?? 0}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            defaultValue={q}
            onChange={(e) => setParam("q", e.target.value.trim() || null)}
            placeholder="Search RET, order, customer or product…"
            aria-label="Search returns"
            className="input pl-9 pr-9"
          />
          {q && (
            <button
              type="button"
              onClick={() => setParam("q", null)}
              className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <select
          value={reason}
          onChange={(e) => setParam("reason", e.target.value || null)}
          className="input min-w-0 flex-1 basis-44"
          aria-label="Filter by reason"
        >
          <option value="">Any reason</option>
          <option value="our_fault">Our fault (damaged / wrong / missing)</option>
          {reasons.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
          {legacy.length > 0 && (
            <optgroup label="No longer offered">
              {legacy.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>

        <select
          value={age}
          onChange={(e) => setParam("age", e.target.value || null)}
          className="input min-w-0 flex-1 basis-36"
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
          className={`${pill} ${
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
            type="button"
            onClick={() =>
              router.replace(pathname + (status === "open" ? "" : `?status=${status}`))
            }
            className={`${pill} border border-border text-muted-foreground hover:bg-muted`}
          >
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>
    </div>
  );
}
