"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Star, Loader2, PenLine, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { submitReview } from "@/app/actions/reviews";
import { cn } from "@/lib/utils";

export type PublicReview = {
  id: string;
  name: string;
  rating: number;
  title: string | null;
  body: string;
  createdAt: string;
};

function Stars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-accent", className)}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn("h-4 w-4", i < rating ? "fill-current" : "text-muted-foreground/30")}
        />
      ))}
    </span>
  );
}

export function ProductReviews({
  productId,
  productSlug,
  reviews,
}: {
  productId: string;
  productSlug: string;
  reviews: PublicReview[];
}) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", rating: 5, title: "", body: "" });

  const count = reviews.length;
  const average =
    count > 0
      ? Math.round((reviews.reduce((n, r) => n + r.rating, 0) / count) * 10) / 10
      : 0;

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await submitReview({
      productId,
      productSlug,
      name: form.name,
      rating: form.rating,
      title: form.title || undefined,
      body: form.body,
    });
    setSaving(false);
    if (res.ok) {
      toast.success("Thanks! Your review will appear once approved.");
      setForm({ name: "", rating: 5, title: "", body: "" });
      setShowForm(false);
    } else {
      toast.error(res.error);
    }
  }

  return (
    <section className="mt-20">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-serif text-2xl md:text-3xl">Customer reviews</h2>
          {count > 0 ? (
            <div className="mt-2 flex items-center gap-2 text-sm">
              <Stars rating={Math.round(average)} />
              <span className="font-medium">{average}</span>
              <span className="text-muted-foreground">
                · {count} review{count === 1 ? "" : "s"}
              </span>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              No reviews yet — be the first to review this style.
            </p>
          )}
        </div>
        <Button variant="outline" onClick={() => setShowForm((v) => !v)}>
          <PenLine className="h-4 w-4" />
          {showForm ? "Cancel" : "Write a review"}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={onSubmit}
          className="mt-6 grid gap-4 rounded-2xl border border-border bg-card p-5 sm:grid-cols-2"
        >
          <label className="block">
            <span className="mb-1.5 block text-sm text-muted-foreground">Your name *</span>
            <input
              required
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              className="input"
            />
          </label>

          <div>
            <span className="mb-1.5 block text-sm text-muted-foreground">Rating *</span>
            <div className="flex items-center gap-1">
              {Array.from({ length: 5 }).map((_, i) => {
                const value = i + 1;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => set("rating", value)}
                    aria-label={`${value} star${value === 1 ? "" : "s"}`}
                    className="cursor-pointer p-0.5"
                  >
                    <Star
                      className={cn(
                        "h-6 w-6 transition-colors",
                        value <= form.rating
                          ? "fill-current text-accent"
                          : "text-muted-foreground/30"
                      )}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-sm text-muted-foreground">
              Headline (optional)
            </span>
            <input
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Great fit and quality"
              className="input"
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-sm text-muted-foreground">
              Your review *
            </span>
            <textarea
              required
              rows={4}
              value={form.body}
              onChange={(e) => set("body", e.target.value)}
              placeholder="How is the fit, fabric and print quality?"
              className="input resize-none"
            />
          </label>

          <div className="sm:col-span-2">
            <Button type="submit" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Submitting…
                </>
              ) : (
                "Submit review"
              )}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Reviews are published after a quick check by our team.
            </p>
          </div>
        </form>
      )}

      {count > 0 && (
        <ul className="mt-8 grid gap-4 md:grid-cols-2">
          {reviews.map((r) => (
            <li
              key={r.id}
              className="rounded-2xl border border-border bg-card p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <Stars rating={r.rating} />
                <span className="text-xs text-muted-foreground">
                  {new Date(r.createdAt).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </div>
              {r.title && <p className="mt-3 font-medium">{r.title}</p>}
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {r.body}
              </p>
              <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                <MessageSquare className="mr-1.5 inline h-3 w-3" />
                {r.name}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
