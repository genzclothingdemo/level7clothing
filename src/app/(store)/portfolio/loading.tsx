import { Skeleton } from "@/components/store/skeletons";

/**
 * The portfolio is DB-backed (items plus the products they name), so it is
 * exactly the kind of route CLAUDE.md wants a skeleton on.
 *
 * The shapes match the real page's geometry — centred header, two jump chips,
 * a group heading and the square 3-up / 6-up reel grid — so nothing jumps when
 * the content lands. The buttons are `rounded-lg`, not `rounded-full`: the
 * design system squared every storefront button, and a rounded skeleton under
 * a squared button is a visible pop on arrival.
 */
export default function PortfolioLoading() {
  return (
    <div className="container-px mx-auto max-w-7xl py-14">
      <div className="flex flex-col items-center">
        <Skeleton className="h-2.5 w-20" />
        <Skeleton className="mt-3 h-10 w-52" />
        <Skeleton className="mt-4 h-4 w-full max-w-md" />
        <div className="mt-6 flex gap-3">
          <Skeleton className="h-11 w-40 rounded-lg" />
          <Skeleton className="h-11 w-36 rounded-lg" />
        </div>
      </div>

      {/* Section jump chips */}
      <div className="mt-8 flex justify-center gap-2">
        <Skeleton className="h-11 w-28 rounded-lg" />
        <Skeleton className="h-11 w-28 rounded-lg" />
      </div>

      {/* "Social", then the first group heading */}
      <Skeleton className="mt-12 h-8 w-40" />
      <Skeleton className="mt-2 h-4 w-full max-w-sm" />
      <Skeleton className="mt-8 h-6 w-48" />
      <Skeleton className="mt-2 h-3.5 w-full max-w-xs" />

      <ul className="mt-4 grid grid-cols-3 gap-2 sm:gap-3 md:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <li key={i} className="min-w-0">
            <Skeleton className="aspect-square w-full rounded-lg" />
          </li>
        ))}
      </ul>
    </div>
  );
}
