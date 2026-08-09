"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BadgeCheck, Check, Loader2, Pin, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { submitReview } from "@/app/actions/reviews";
import type { PublicReview, ReviewSummary } from "@/lib/reviews";

/**
 * The Customer Reviews panel: the published reviews, the star breakdown, and the
 * form to leave one.
 *
 * A submitted review is held for approval, and the form says so before you type
 * rather than after — nobody should be surprised that their words didn't appear.
 */
export function ReviewPanel({
  productId,
  summary,
  items,
  distribution,
  signedInName,
}: {
  productId: string;
  summary: ReviewSummary | null;
  items: PublicReview[];
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  /** Prefills the name field when the shopper has an account. */
  signedInName?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    rating: 0,
    name: signedInName ?? "",
    email: "",
    title: "",
    body: "",
  });
  const [hover, setHover] = useState(0);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.rating < 1) {
      setError("Please pick a star rating.");
      return;
    }
    setBusy(true);
    const res = await submitReview({ productId, ...form });
    setBusy(false);
    if (res.ok) {
      setDone(res.message);
      setOpen(false);
      setForm({ rating: 0, name: signedInName ?? "", email: "", title: "", body: "" });
    } else {
      setError(res.error);
    }
  }

  const total = summary?.count ?? 0;

  return (
    <div className="space-y-4">
      {/* ── Summary ── */}
      {summary ? (
        <div className="flex flex-wrap items-start gap-6">
          <div>
            <p className="text-3xl font-semibold text-foreground">
              {summary.average}
            </p>
            <StarRow rating={Math.round(summary.average)} />
            <p className="mt-0.5 text-xs">
              {summary.count} review{summary.count === 1 ? "" : "s"}
            </p>
          </div>

          <div className="min-w-[10rem] flex-1 space-y-1">
            {([5, 4, 3, 2, 1] as const).map((star) => {
              const n = distribution[star] ?? 0;
              const pct = total > 0 ? Math.round((n / total) * 100) : 0;
              return (
                <div key={star} className="flex items-center gap-2 text-[11px]">
                  <span className="w-3 tabular-nums">{star}</span>
                  <Star className="h-3 w-3 fill-accent text-accent" />
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-accent"
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className="w-6 text-right tabular-nums">{n}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="text-sm">
          No reviews yet — <b>be the first to review this piece.</b>
        </p>
      )}

      {/* ── Published reviews ── */}
      {items.length > 0 && (
        <ul className="space-y-3 border-t border-border pt-4">
          {items.map((r) => (
            <li key={r.id}>
              <div className="flex flex-wrap items-center gap-2">
                <StarRow rating={r.rating} small />
                <span className="text-sm font-medium text-foreground">{r.name}</span>
                {r.verified && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-success">
                    <BadgeCheck className="h-3 w-3" /> Verified buyer
                  </span>
                )}
                {r.featured && (
                  <Pin className="h-3 w-3 text-accent" aria-label="Highlighted review" />
                )}
                <span className="text-[11px] text-muted-foreground">
                  {new Date(r.createdAt).toLocaleDateString("en-IN", {
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </div>
              {r.title && (
                <p className="mt-0.5 text-sm font-medium text-foreground">{r.title}</p>
              )}
              <p className="mt-0.5 whitespace-pre-line text-sm leading-relaxed">
                {r.body}
              </p>
            </li>
          ))}
        </ul>
      )}

      {/* ── Write a review ── */}
      <div className="border-t border-border pt-4">
        {done ? (
          <p className="flex items-start gap-2 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
            <Check className="mt-0.5 h-4 w-4 shrink-0" />
            {done}
          </p>
        ) : !open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:border-foreground/40 hover:bg-muted"
          >
            Write a review
          </button>
        ) : (
          <AnimatePresence>
            <motion.form
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              onSubmit={onSubmit}
              className="space-y-3"
            >
              <div>
                <p className="mb-1 text-xs font-medium text-foreground">
                  Your rating <span className="text-danger">*</span>
                </p>
                <div
                  className="flex gap-1"
                  onMouseLeave={() => setHover(0)}
                  role="radiogroup"
                  aria-label="Your rating"
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={form.rating === n}
                      aria-label={`${n} star${n === 1 ? "" : "s"}`}
                      onMouseEnter={() => setHover(n)}
                      onClick={() => setForm((p) => ({ ...p, rating: n }))}
                      className="p-0.5"
                    >
                      <Star
                        className={cn(
                          "h-6 w-6 transition-transform hover:scale-110",
                          n <= (hover || form.rating)
                            ? "fill-accent text-accent"
                            : "fill-muted text-muted-foreground"
                        )}
                      />
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="label">Your name *</span>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    className="input h-10"
                    placeholder="Priya S."
                  />
                </label>
                <label className="block">
                  <span className="label">Email (not shown publicly)</span>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                    className="input h-10"
                    placeholder="you@example.com"
                  />
                </label>
              </div>

              <label className="block">
                <span className="label">Headline (optional)</span>
                <input
                  value={form.title}
                  onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                  className="input h-10"
                  placeholder="Beautiful finish, arrived safely"
                />
              </label>

              <label className="block">
                <span className="label">Your review *</span>
                <textarea
                  rows={4}
                  value={form.body}
                  onChange={(e) => setForm((p) => ({ ...p, body: e.target.value }))}
                  className="input resize-none"
                  placeholder="What did you think of the piece — the colours, the finish, the packaging?"
                />
              </label>

              {error && <p className="text-sm text-danger">{error}</p>}

              <p className="text-xs text-muted-foreground">
                Reviews are read before they&apos;re published, so yours won&apos;t
                appear straight away. If you bought this piece with the same email,
                it&apos;ll be marked as a verified purchase.
              </p>

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Submit review
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-full border border-border px-4 py-2.5 text-sm hover:bg-muted"
                >
                  Cancel
                </button>
              </div>
            </motion.form>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

function StarRow({ rating, small = false }: { rating: number; small?: boolean }) {
  return (
    <span className="flex gap-0.5" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={cn(
            small ? "h-3 w-3" : "h-3.5 w-3.5",
            s <= rating ? "fill-accent text-accent" : "fill-muted text-muted-foreground"
          )}
        />
      ))}
    </span>
  );
}
