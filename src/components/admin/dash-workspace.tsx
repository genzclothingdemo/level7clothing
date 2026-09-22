import { Suspense } from "react";
import { WorkspaceNav } from "@/components/admin/finance-nav";
import { InfoTip } from "@/components/store/info-tip";

/**
 * The chrome every section of the analytics workspace wears: one heading, one
 * section bar, one filter row.
 *
 * It exists as a component rather than as a layout because the workspace
 * straddles a route boundary it cannot cross. Overview is the admin panel's
 * index page (`/admin`) and the other five sections are `/admin/finance/*`, so
 * no single Next layout wraps all six. Duplicating the heading and the nav
 * into both places would mean a tab added to one and forgotten in the other —
 * the exact failure the merged workspace is meant to remove. One component,
 * rendered by `page.tsx` and by `finance/layout.tsx`.
 *
 * `WorkspaceNav` reads the filters with `useSearchParams`, which needs a
 * Suspense boundary if a route is ever prerendered. Everything under the admin
 * panel layout is `force-dynamic`, so it will not be — the boundary is here
 * anyway, because relying on an inherited render mode for correctness is how a
 * build-time change turns into a runtime error.
 */
export function Workspace({ children }: { children: React.ReactNode }) {
  return (
    <div>
      {/* The conventions this workspace runs on used to sit here as three
          lines of prose above every section, on every visit. They are true
          forever and change nothing day to day, so they are behind the (i)
          instead — which is also the thing they are describing. */}
      <h1 className="flex items-center gap-1.5 font-serif text-3xl">
        Dashboard
        <InfoTip term="How to read this workspace">
          Every figure states its own definition behind the (i) beside it — if
          you cannot reproduce a number from that sentence, treat it as a bug.
          Money is in whole rupees. Orders count from when they were{" "}
          <strong className="font-medium">placed</strong>, not when they were
          paid, and days start at midnight IST. Two things sit outside the
          range control and say so where they appear: refunds, dated by when
          the money left, and the lifetime customer figures, which are
          all-time.
        </InfoTip>
      </h1>

      <div className="mt-4">
        <Suspense
          fallback={<div className="h-[6.5rem] rounded-lg border border-border bg-card" />}
        >
          <WorkspaceNav />
        </Suspense>
      </div>

      <div className="mt-5">{children}</div>
    </div>
  );
}

/**
 * The search parameters every section shares. Each page adds its own paging
 * keys on top; these three are the ones the nav writes and every section
 * reads, so they are typed in one place.
 */
export type WorkspaceParams = {
  range?: string;
  grain?: string;
};

/**
 * Wall clock, read through an async boundary rather than called in a render
 * body — the same pattern as Admin → Customers. Every section is
 * force-dynamic, so the value is genuinely per-request, and passing one `now`
 * into every query means two panels on a page can never straddle midnight.
 */
export async function readClock(): Promise<Date> {
  return new Date();
}
