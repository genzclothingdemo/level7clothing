"use client";

import { useState } from "react";
import { Star, Quote, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ReviewItem {
  id: string;
  name: string;
  rating: number;
  title?: string | null;
  body: string;
  createdAt: string; // ISO string
  featured: boolean;
}

function StarRow({ rating, size = "sm" }: { rating: number; size?: "sm" | "md" }) {
  return (
    <div className={cn("flex gap-0.5", size === "md" && "gap-1")}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={cn(
            size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4",
            i < rating
              ? "fill-amber-400 text-amber-400"
              : "fill-muted text-muted"
          )}
        />
      ))}
    </div>
  );
}

function RatingBar({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-5 shrink-0 text-right text-muted-foreground">{label}</span>
      <div className="flex-1 overflow-hidden rounded-full bg-muted h-1.5">
        <div
          className="h-full rounded-full bg-amber-400 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-6 shrink-0 text-muted-foreground">{count}</span>
    </div>
  );
}

function ReviewCard({ review }: { review: ReviewItem }) {
  const date = new Date(review.createdAt).toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
  });
  return (
    <div
      className={cn(
        "relative flex h-full flex-col rounded-2xl border border-border bg-card p-5 transition-all duration-200",
        review.featured && "border-accent/30 shadow-sm"
      )}
    >
      {review.featured && (
        <span className="absolute right-4 top-4 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
          Featured
        </span>
      )}
      <Quote className="h-5 w-5 text-accent/40 mb-3 shrink-0" />
      <StarRow rating={review.rating} />
      {review.title && (
        <p className="mt-2 font-medium text-sm">{review.title}</p>
      )}
      <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground line-clamp-4">
        {review.body}
      </p>
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
            {review.name.charAt(0).toUpperCase()}
          </span>
          <span className="text-xs font-medium">{review.name}</span>
        </div>
        <span className="text-[10px] text-muted-foreground">{date}</span>
      </div>
    </div>
  );
}

export function PortfolioSection({ reviews }: { reviews: ReviewItem[] }) {
  const [page, setPage] = useState(0);
  const PER_PAGE = 6;
  const totalPages = Math.ceil(reviews.length / PER_PAGE);
  const visible = reviews.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

  // Stats
  const total = reviews.length;
  const avg = total > 0
    ? (reviews.reduce((s, r) => s + r.rating, 0) / total).toFixed(1)
    : "—";
  const dist = [5, 4, 3, 2, 1].map((s) => ({
    star: s,
    count: reviews.filter((r) => r.rating === s).length,
  }));

  if (total === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center">
        <Star className="mx-auto h-10 w-10 text-muted-foreground/30" />
        <p className="mt-3 text-muted-foreground text-sm">
          No reviews yet — be the first to share your experience!
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Summary bar ── */}
      <div className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center">
        {/* Big average */}
        <div className="flex shrink-0 flex-col items-center gap-1 sm:pr-6 sm:border-r sm:border-border">
          <span className="font-serif text-5xl font-light text-foreground">{avg}</span>
          <StarRow rating={Math.round(Number(avg))} size="md" />
          <span className="text-xs text-muted-foreground">{total} review{total !== 1 ? "s" : ""}</span>
        </div>
        {/* Distribution bars */}
        <div className="flex-1 space-y-1.5">
          {dist.map(({ star, count }) => (
            <RatingBar key={star} label={`${star}★`} count={count} total={total} />
          ))}
        </div>
      </div>

      {/* ── Review cards grid ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((r) => (
          <ReviewCard key={r.id} review={r} />
        ))}
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="grid h-9 w-9 place-items-center rounded-full border border-border hover:bg-muted disabled:opacity-30 transition-all"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm text-muted-foreground tabular-nums">
            {page + 1} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page === totalPages - 1}
            className="grid h-9 w-9 place-items-center rounded-full border border-border hover:bg-muted disabled:opacity-30 transition-all"
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
