import Link from "next/link";
import { Star, MessageSquare } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { ReviewRowActions } from "./review-row-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reviews" };

export default async function AdminReviews() {
  const reviews = await prisma.review
    .findMany({ orderBy: [{ approved: "asc" }, { createdAt: "desc" }] })
    .catch(() => []);

  const productIds = [...new Set(reviews.map((r) => r.productId))];
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, slug: true },
      })
    : [];
  const productById = new Map(products.map((p) => [p.id, p]));

  const pendingCount = reviews.filter((r) => !r.approved).length;

  return (
    <div>
      <div>
        <h1 className="font-serif text-3xl">Reviews</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {reviews.length} review{reviews.length === 1 ? "" : "s"}
          {pendingCount > 0 && ` · ${pendingCount} awaiting approval`}
        </p>
      </div>

      {reviews.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border p-12 text-center">
          <MessageSquare className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-4 font-serif text-xl">No reviews yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Customer reviews submitted on product pages will appear here for
            approval.
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Rating</th>
                  <th className="px-4 py-3 font-medium">Review</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {reviews.map((r) => {
                  const product = productById.get(r.productId);
                  return (
                    <tr key={r.id} className="hover:bg-muted/40">
                      <td className="px-4 py-3 align-top">
                        {product ? (
                          <Link
                            href={`/product/${product.slug}`}
                            className="font-medium hover:text-accent"
                          >
                            {product.name}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">
                            (deleted product)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span className="inline-flex items-center gap-0.5 text-accent">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star
                              key={i}
                              className={`h-3.5 w-3.5 ${
                                i < r.rating
                                  ? "fill-current"
                                  : "text-muted-foreground/30"
                              }`}
                            />
                          ))}
                        </span>
                      </td>
                      <td className="max-w-md px-4 py-3 align-top">
                        {r.title && <p className="font-medium">{r.title}</p>}
                        <p className="mt-0.5 text-muted-foreground">{r.body}</p>
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          — {r.name} ·{" "}
                          {r.createdAt.toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs ${
                            r.approved
                              ? "bg-success/15 text-success"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {r.approved ? "Published" : "Pending"}
                        </span>
                        {r.featured && (
                          <span className="ml-1.5 rounded-full bg-accent/15 px-2.5 py-1 text-xs text-accent">
                            Featured
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <ReviewRowActions
                          id={r.id}
                          approved={r.approved}
                          featured={r.featured}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
