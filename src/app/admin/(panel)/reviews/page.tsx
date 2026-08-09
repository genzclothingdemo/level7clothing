import Link from "next/link";
import { MessageSquareQuote, Star, BadgeCheck, ExternalLink } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ReviewFilters } from "@/components/admin/review-filters";
import { ReviewActions } from "@/components/admin/review-actions";
import { isReviewFilter } from "@/lib/reviews";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reviews" };

const PAGE_SIZE = 100;

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={`h-3.5 w-3.5 ${
            s <= rating ? "fill-accent text-accent" : "fill-muted text-muted-foreground"
          }`}
        />
      ))}
    </span>
  );
}

export default async function AdminReviews({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    q?: string;
    rating?: string;
    product?: string;
  }>;
}) {
  const sp = await searchParams;
  const view = sp.view && isReviewFilter(sp.view) ? sp.view : "all";

  const where: Prisma.ReviewWhereInput = {};
  if (view === "pending") where.approved = false;
  if (view === "approved") where.approved = true;
  if (view === "featured") where.featured = true;

  if (sp.q) {
    where.OR = [
      { name: { contains: sp.q, mode: "insensitive" } },
      { title: { contains: sp.q, mode: "insensitive" } },
      { body: { contains: sp.q, mode: "insensitive" } },
    ];
  }
  if (sp.rating === "low") where.rating = { lte: 2 };
  else if (sp.rating) {
    const n = Number(sp.rating);
    if (Number.isFinite(n) && n >= 1 && n <= 5) where.rating = n;
  }
  if (sp.product) where.productId = sp.product;

  const [reviews, counts, products] = await Promise.all([
    prisma.review
      .findMany({
        where,
        // Newest first, but anything still awaiting a decision floats to the top
        // so the queue is the queue.
        orderBy: [{ approved: "asc" }, { createdAt: "desc" }],
        take: PAGE_SIZE,
        include: { product: { select: { name: true, slug: true } } },
      })
      .catch(() => []),
    (async () => {
      const [all, pending, approved, featured] = await Promise.all([
        prisma.review.count().catch(() => 0),
        prisma.review.count({ where: { approved: false } }).catch(() => 0),
        prisma.review.count({ where: { approved: true } }).catch(() => 0),
        prisma.review.count({ where: { featured: true } }).catch(() => 0),
      ]);
      return { all, pending, approved, featured } as Record<string, number>;
    })(),
    prisma.product
      .findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })
      .catch(() => []),
  ]);

  const filtered = !!(sp.q || sp.rating || sp.product) || view !== "all";

  return (
    <div>
      <h1 className="font-serif text-3xl">Reviews</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Every review a customer submits lands here <b>unpublished</b> — nothing
        appears on the storefront until you approve it. Product ratings are
        calculated from approved reviews only, so a product with none simply shows
        no stars.
      </p>

      {counts.pending > 0 && (
        <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1.5 text-sm text-accent">
          <MessageSquareQuote className="h-4 w-4" />
          {counts.pending} review{counts.pending === 1 ? "" : "s"} awaiting your
          approval
        </p>
      )}

      <div className="mt-6">
        <ReviewFilters counts={counts} products={products} />
      </div>

      {reviews.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border p-12 text-center">
          <MessageSquareQuote className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-4 font-serif text-xl">
            {filtered ? "No matching reviews" : "No reviews yet"}
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {filtered
              ? "Try clearing the filters."
              : "Customers can leave a rating and comment from the Customer Reviews section on any product page. Submissions show up here for approval."}
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {reviews.map((r) => (
            <div
              key={r.id}
              className={`rounded-2xl border bg-card p-4 ${
                r.approved ? "border-border" : "border-accent/40"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Stars rating={r.rating} />
                    <span className="text-sm font-medium">{r.name}</span>
                    {r.verified && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success"
                        title="Has a delivered order containing this product"
                      >
                        <BadgeCheck className="h-3 w-3" /> Verified buyer
                      </span>
                    )}
                    {!r.approved && (
                      <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-medium text-accent">
                        Awaiting approval
                      </span>
                    )}
                    {r.featured && (
                      <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-foreground">
                        Shown first
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-xs text-muted-foreground">
                    <Link
                      href={`/product/${r.product.slug}`}
                      target="_blank"
                      className="inline-flex items-center gap-1 hover:text-accent"
                    >
                      {r.product.name}
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                    {" · "}
                    {r.createdAt.toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                    {r.email ? ` · ${r.email}` : ""}
                  </p>
                </div>

                <ReviewActions
                  id={r.id}
                  approved={r.approved}
                  featured={r.featured}
                  note={r.adminNote}
                />
              </div>

              {r.title && <p className="mt-3 text-sm font-medium">{r.title}</p>}
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {r.body}
              </p>

              {r.adminNote && (
                <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  <b>Private note:</b> {r.adminNote}
                </p>
              )}
            </div>
          ))}

          {reviews.length === PAGE_SIZE && (
            <p className="pt-2 text-center text-xs text-muted-foreground">
              Showing the first {PAGE_SIZE} matches — narrow the filters to see
              the rest.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
