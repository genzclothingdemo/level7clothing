import { Skeleton } from "@/components/store/skeletons";

/**
 * The portfolio is DB-backed (items plus the products they name), so it is
 * exactly the kind of route CLAUDE.md wants a skeleton on.
 *
 * The shapes match the real page's geometry — a short centred masthead with no
 * paragraph and one button under it, a hairline section rule with the heading
 * and its count against it, the group tab row, and the square 3-up / 6-up reel
 * grid — so nothing jumps when the content lands. Twelve tiles, because twelve
 * is what the real grid renders eagerly (`EAGER` in `portfolio-grid.tsx`); a
 * skeleton promising more than the first paint delivers is its own flash.
 *
 * The buttons are `rounded-lg`, not `rounded-full`: the design system squared
 * every storefront button, and a rounded skeleton under a squared button is a
 * visible pop on arrival.
 */
export default function PortfolioLoading() {
  return (
    <div className="container-px mx-auto max-w-7xl py-9 sm:py-14">
      <div className="flex flex-col items-center">
        <Skeleton className="h-2.5 w-20" />
        <Skeleton className="mt-2.5 h-12 w-56 sm:h-14 sm:w-72" />
        <Skeleton className="mt-3.5 h-3 w-40" />
        <Skeleton className="mt-5 h-11 w-44 rounded-lg" />
      </div>

      {/* The section divider: rule, then heading left and count right */}
      <div className="rule mt-10 sm:mt-14" />
      <div className="mt-4 flex items-end justify-between gap-4">
        <Skeleton className="h-9 w-40 sm:h-10 sm:w-48" />
        <Skeleton className="h-2.5 w-20" />
      </div>

      {/* Group tabs */}
      <div className="mt-5 flex flex-wrap gap-2">
        <Skeleton className="h-11 w-32 rounded-lg" />
        <Skeleton className="h-11 w-24 rounded-lg" />
        <Skeleton className="h-11 w-28 rounded-lg" />
      </div>

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
