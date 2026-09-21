"use client";

/**
 * One compact row above the coupon table.
 *
 * Coupons are a short list, so there is nothing to hide behind a disclosure —
 * search plus three selects fit on one line on a laptop and wrap to two on a
 * phone. Filters apply on change rather than behind an Apply button, and live
 * in the URL so a filtered view survives the refresh that pausing a coupon
 * triggers. A select that is doing something is tinted violet, which is how
 * the rest of the admin says "this is narrowing what you see".
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { MiniButton } from "@/components/admin/form-kit";
import { cn } from "@/lib/utils";

export function CouponFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const type = params.get("type") ?? "";
  const scope = params.get("scope") ?? "";

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  const narrowing = !!(q || status || type || scope);

  const select = (live: boolean) =>
    cn(
      "input h-11 w-full min-w-0 sm:h-10 sm:w-auto sm:max-w-[12rem]",
      live && "border-accent text-accent"
    );

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2.5">
      <div className="relative min-w-[9rem] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          defaultValue={q}
          onChange={(e) => setParam("q", e.target.value.trim())}
          aria-label="Search coupon codes"
          placeholder="Search codes…"
          className="input h-11 pl-9 sm:h-10"
        />
      </div>

      <select
        value={status}
        onChange={(e) => setParam("status", e.target.value)}
        aria-label="Filter by status"
        className={select(!!status)}
      >
        <option value="">Any status</option>
        <option value="active">Active</option>
        <option value="scheduled">Scheduled</option>
        <option value="expired">Expired</option>
        <option value="exhausted">Used up</option>
        <option value="hidden">Hidden</option>
      </select>

      <select
        value={type}
        onChange={(e) => setParam("type", e.target.value)}
        aria-label="Filter by discount type"
        className={select(!!type)}
      >
        <option value="">Any type</option>
        <option value="flat">Flat ₹</option>
        <option value="percent">Percent %</option>
      </select>

      <select
        value={scope}
        onChange={(e) => setParam("scope", e.target.value)}
        aria-label="Filter by what the coupon applies to"
        className={select(!!scope)}
      >
        <option value="">Any scope</option>
        <option value="cart">Whole cart</option>
        <option value="products">Chosen items</option>
      </select>

      {narrowing && (
        <MiniButton onClick={() => router.replace(pathname)} className="h-11 sm:h-10">
          <X className="h-3.5 w-3.5" /> Clear
        </MiniButton>
      )}
    </div>
  );
}
