import { Skeleton } from "@/components/store/skeletons";

/**
 * The portfolio runs three queries (items, their products, every active
 * product's video links), so it is exactly the kind of DB-backed route
 * CLAUDE.md wants a skeleton on. The shapes here match the real page's
 * geometry — centred header, two chips, a 4/5 grid — so nothing jumps when
 * the content lands.
 */
export default function PortfolioLoading() {
  return (
    <div className="container-px mx-auto max-w-7xl py-14">
      <div className="flex flex-col items-center">
        <Skeleton className="h-2.5 w-20" />
        <Skeleton className="mt-3 h-10 w-52" />
        <Skeleton className="mt-4 h-4 w-full max-w-md" />
        <div className="mt-6 flex gap-3">
          <Skeleton className="h-11 w-40 rounded-full" />
          <Skeleton className="h-11 w-36 rounded-full" />
        </div>
      </div>

      {/* Shelf chips */}
      <div className="mt-8 flex justify-center gap-2">
        <Skeleton className="h-11 w-44 rounded-lg" />
        <Skeleton className="h-11 w-40 rounded-lg" />
      </div>

      <ul className="mt-8 grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 sm:gap-x-5 sm:gap-y-10 md:mt-10 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <li key={i} className="min-w-0">
            <Skeleton className="aspect-[4/5] w-full rounded-2xl" />
            <Skeleton className="mt-2 h-4 w-3/4" />
            <Skeleton className="mt-2 h-3 w-1/2" />
          </li>
        ))}
      </ul>
    </div>
  );
}
