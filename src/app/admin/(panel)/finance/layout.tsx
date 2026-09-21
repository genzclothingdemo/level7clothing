import { Suspense } from "react";
import { FinanceNav } from "@/components/admin/finance-nav";

/**
 * Admin → Finance.
 *
 * The heading and the one filter row live in the layout so every tab is
 * scoped by the same range control, rendered once. Per-panel date pickers are
 * how a dashboard ends up with two charts answering different questions while
 * looking like they answer the same one.
 *
 * `FinanceNav` reads the range with `useSearchParams`, which needs a Suspense
 * boundary if the route is ever prerendered. This subtree is `force-dynamic`
 * through the admin panel layout, so it will not be — the boundary is here
 * anyway, because relying on an inherited render mode for correctness is how
 * a build-time change turns into a runtime error.
 */
export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <h1 className="font-serif text-3xl">Finance</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Every figure here is defined behind the (i) beside it. Money is in whole
        rupees; orders count from when they were placed, not when they were paid.
      </p>

      <div className="mt-4">
        <Suspense
          fallback={<div className="h-[3.75rem] rounded-lg border border-border bg-card" />}
        >
          <FinanceNav />
        </Suspense>
      </div>

      <div className="mt-5">{children}</div>
    </div>
  );
}
