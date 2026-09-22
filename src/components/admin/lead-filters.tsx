"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search, X } from "lucide-react";
import { LEAD_STATUSES, LEAD_STATUS_LABEL } from "@/lib/leads";

export function LeadFilters({ counts }: { counts: Record<string, number> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const activeStatus = params.get("status") || "all";
  const q = params.get("q") || "";

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`);
  }

  const tabs = [
    { key: "all", label: "All" },
    ...LEAD_STATUSES.map((s) => ({ key: s, label: LEAD_STATUS_LABEL[s] })),
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => {
          const active = activeStatus === t.key;
          const count = t.key === "all" ? counts.all : counts[t.key] ?? 0;
          return (
            <button
              key={t.key}
              onClick={() => setParam("status", t.key === "all" ? null : t.key)}
              className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm transition-colors ${
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

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          defaultValue={q}
          onChange={(e) => {
            const v = e.target.value.trim();
            // debounce-lite: update on each change (list is small)
            setParam("q", v || null);
          }}
          placeholder="Search name, phone, email or product…"
          className="input h-10 pl-9 pr-9"
        />
        {q && (
          <button
            onClick={() => setParam("q", null)}
            className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
