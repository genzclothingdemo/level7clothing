"use client";

/**
 * The coupon editor.
 *
 * A coupon is nine fields that only make sense in combination, and the old
 * form listed them flat with a paragraph under each — which is how you end up
 * with a 20% code that quietly takes ₹4,000 off a jacket. Three things fix
 * that here:
 *
 * 1. **Fields that don't apply aren't shown.** `Max discount` only exists once
 *    the coupon is a percentage; the product picker only exists once the scope
 *    is "selected products". A field on screen is a field the admin has to
 *    reason about, so an irrelevant one is worse than a missing one.
 * 2. **Every explanation is an `(i)`, never a paragraph.** Same `InfoTip` the
 *    storefront uses, via `form-kit`'s `Field`.
 * 3. **A live sentence at the top says what the rules add up to.** It is built
 *    from the same words the list uses, so "20% off the whole cart, capped at
 *    ₹300" reads identically in both places.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Search, Ticket, X } from "lucide-react";
import { Card, Check, Field, MiniButton, Segmented, SwitchRow } from "@/components/admin/form-kit";
import {
  couponLimitSummary,
  couponOfferSummary,
  couponWindowSummary,
  formatStoreInputValue,
} from "@/components/admin/coupon-summary";
import { createCoupon, updateCoupon } from "@/components/admin/coupon-actions";
import { cn } from "@/lib/utils";

export type CouponProductOption = { id: string; name: string; category: string };

/**
 * Everything as strings, because that is what the inputs hold and what the
 * server action parses. The pages build this — including the two dates, which
 * are formatted into the store's time zone server-side so the value is
 * identical on both renders and there is nothing for hydration to disagree
 * about.
 */
export type CouponFormValues = {
  code: string;
  discountAmount: string;
  isPercentage: boolean;
  isActive: boolean;
  productIds: string[];
  maxDiscount: string;
  minSpend: string;
  usageLimit: string;
  perUserLimit: string;
  startsAt: string;
  expiresAt: string;
};

export const EMPTY_COUPON: CouponFormValues = {
  code: "",
  discountAmount: "",
  isPercentage: false,
  isActive: true,
  productIds: [],
  maxDiscount: "",
  minSpend: "",
  usageLimit: "",
  perUserLimit: "",
  startsAt: "",
  expiresAt: "",
};

export function CouponForm({
  couponId,
  initial,
  products,
  usedCount = 0,
}: {
  /** Absent when creating. */
  couponId?: string;
  initial: CouponFormValues;
  products: CouponProductOption[];
  /** Redemptions so far — read-only context, never editable. */
  usedCount?: number;
}) {
  const router = useRouter();
  const [v, setV] = useState<CouponFormValues>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [productQuery, setProductQuery] = useState("");
  // Scope is its own state rather than `productIds.length > 0`, so choosing
  // "Chosen items" can show an empty picker instead of snapping back to cart.
  const [scopeChoice, setScopeChoice] = useState<"cart" | "products">(
    initial.productIds.length ? "products" : "cart"
  );

  function set<K extends keyof CouponFormValues>(key: K, value: CouponFormValues[K]) {
    setV((prev) => ({ ...prev, [key]: value }));
    setError(null);
  }

  const scoped = v.productIds.length > 0;

  /** The live sentence. Blank/garbage inputs read as zero rather than NaN. */
  const preview = useMemo(() => {
    const num = (s: string) => {
      const n = Number(s.trim());
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    };
    const rules = {
      discountAmount: num(v.discountAmount) ?? 0,
      isPercentage: v.isPercentage,
      productIds: v.productIds,
      minSpend: num(v.minSpend),
      maxDiscount: num(v.maxDiscount),
      usageLimit: num(v.usageLimit),
      perUserLimit: num(v.perUserLimit),
    };
    return {
      offer: couponOfferSummary(rules),
      limits: couponLimitSummary(rules),
      window: couponWindowSummary(
        formatStoreInputValue(v.startsAt),
        formatStoreInputValue(v.expiresAt)
      ),
    };
  }, [v]);

  const visibleProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
    );
  }, [products, productQuery]);

  function toggleProduct(id: string) {
    setV((prev) => ({
      ...prev,
      productIds: prev.productIds.includes(id)
        ? prev.productIds.filter((p) => p !== id)
        : [...prev.productIds, id],
    }));
  }

  /**
   * Switching to "whole cart" clears the picked products, because
   * `productIds` IS the scope in the database — an empty array is what "whole
   * cart" means. Leaving them selected but ignored is the kind of hidden state
   * that makes a coupon behave differently from how it reads.
   */
  function setScope(next: "cart" | "products") {
    if (next === "cart") setV((prev) => ({ ...prev, productIds: [] }));
    else setProductQuery("");
    setScopeChoice(next);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const fd = new FormData();
    fd.append("code", v.code);
    fd.append("discountAmount", v.discountAmount);
    fd.append("isPercentage", String(v.isPercentage));
    fd.append("isActive", String(v.isActive));
    fd.append("maxDiscount", v.maxDiscount);
    fd.append("minSpend", v.minSpend);
    fd.append("usageLimit", v.usageLimit);
    fd.append("perUserLimit", v.perUserLimit);
    fd.append("startsAt", v.startsAt);
    fd.append("expiresAt", v.expiresAt);
    for (const id of v.productIds) fd.append("productIds", id);

    const res = couponId ? await updateCoupon(couponId, fd) : await createCoupon(fd);
    setSaving(false);

    if (res.success) {
      router.push("/admin/coupons");
      router.refresh();
    } else {
      setError(res.error ?? "Couldn't save the coupon.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="min-w-0 max-w-3xl space-y-4">
      {/* ---- What this adds up to ---- */}
      <div className="min-w-0 rounded-2xl border border-accent/30 bg-accent/5 p-4 sm:p-5">
        <p className="eyebrow text-accent">This code does</p>
        <p className="mt-2 break-words font-serif text-lg leading-snug">
          {preview.offer}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {[preview.limits, preview.window].filter(Boolean).join(" ")}
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger"
        >
          {error}
        </p>
      )}

      {/* ---- Code ---- */}
      <Card
        title="Code"
        tip="What the shopper types at checkout. It is matched without case, so SUMMER20 and summer20 are the same code."
        aside={
          usedCount > 0 ? (
            <span className="text-xs text-muted-foreground">
              Used {usedCount} time{usedCount === 1 ? "" : "s"}
            </span>
          ) : null
        }
      >
        <Field
          label="Coupon code"
          required
          tip="Letters, numbers, hyphens and underscores. Keep it short and unambiguous — people read these off a phone screen, so avoid O/0 and I/l together."
        >
          {(id) => (
            <input
              id={id}
              value={v.code}
              onChange={(e) => set("code", e.target.value.toUpperCase())}
              required
              maxLength={32}
              autoComplete="off"
              spellCheck={false}
              placeholder="SUMMER20"
              className="input font-mono uppercase tracking-widest"
            />
          )}
        </Field>

        <SwitchRow
          label="Active"
          tip="Off pauses the code immediately for everyone, without deleting it or losing who has already redeemed it. This is the safe way to stop a code."
          checked={v.isActive}
          onChange={(on) => set("isActive", on)}
          icon={<Ticket className="h-4 w-4 shrink-0 text-muted-foreground" />}
          detail={v.isActive ? "Shoppers can use this code" : "Paused — nobody can use it"}
        />
      </Card>

      {/* ---- Discount ---- */}
      <Card
        title="Discount"
        tip="How much comes off. Percentages are worked out on the lines this code applies to, then rounded down to the rupee."
      >
        <Field
          label="Type"
          tip="A flat code takes a fixed number of rupees off. A percentage scales with the basket, which is why it needs a cap."
        >
          <Segmented
            ariaLabel="Discount type"
            value={v.isPercentage ? "percent" : "flat"}
            onChange={(next) => set("isPercentage", next === "percent")}
            options={[
              { value: "flat", label: "Flat ₹" },
              { value: "percent", label: "Percent %" },
            ]}
          />
        </Field>

        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field
            label={v.isPercentage ? "Percent off" : "Amount off (₹)"}
            required
            tip={
              v.isPercentage
                ? "Between 1 and 100. Applied to the eligible lines only, then rounded down — 10% of ₹1,999 is ₹199."
                : "Whole rupees. If the eligible items come to less than this, the shopper gets the items free rather than a negative total — the discount is never more than what it applies to."
            }
          >
            {(id) => (
              <input
                id={id}
                type="number"
                inputMode="numeric"
                required
                min={1}
                max={v.isPercentage ? 100 : undefined}
                step={1}
                value={v.discountAmount}
                onChange={(e) => set("discountAmount", e.target.value)}
                placeholder={v.isPercentage ? "20" : "250"}
                className="input"
              />
            )}
          </Field>

          {/* Only exists for a percentage — a flat coupon's amount is its own cap. */}
          {v.isPercentage && (
            <Field
              label="Cap the discount at (₹)"
              tip="The most this code can ever take off, however big the basket. '20% off, up to ₹300' is this field. Leave blank for no ceiling."
            >
              {(id) => (
                <input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={v.maxDiscount}
                  onChange={(e) => set("maxDiscount", e.target.value)}
                  placeholder="No cap"
                  className="input"
                />
              )}
            </Field>
          )}
        </div>

        <Field
          label="Minimum spend (₹)"
          tip={
            scoped
              ? "Measured against the eligible lines only, not the whole cart. With these products selected, the shopper needs this much of THEM before the code applies."
              : "The cart subtotal the shopper has to reach before this code applies. A cart exactly on the number qualifies. Shipping is not counted."
          }
          hint={
            scoped ? "Counted across the selected products only." : undefined
          }
        >
          {(id) => (
            <input
              id={id}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={v.minSpend}
              onChange={(e) => set("minSpend", e.target.value)}
              placeholder="No minimum"
              className="input"
            />
          )}
        </Field>
      </Card>

      {/* ---- Scope ---- */}
      <Card
        title="What it applies to"
        tip="A whole-cart code discounts everything in the basket. A scoped code discounts only the products you pick — the rest of the cart is charged in full."
        aside={
          scoped ? (
            <span className="text-xs text-muted-foreground">
              {v.productIds.length} selected
            </span>
          ) : null
        }
      >
        <Segmented
          ariaLabel="What the coupon applies to"
          value={scopeChoice}
          onChange={setScope}
          options={[
            { value: "cart", label: "Whole cart" },
            { value: "products", label: "Chosen items" },
          ]}
        />

        {scopeChoice === "products" && (
          <div className="min-w-0 space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)}
                aria-label="Search products"
                placeholder="Search products…"
                className="input pl-9"
              />
            </div>

            <div className="max-h-72 overflow-y-auto overscroll-contain rounded-lg border border-border">
              {visibleProducts.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  {products.length === 0 ? "No products yet." : "Nothing matches that search."}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {visibleProducts.map((p) => {
                    const on = v.productIds.includes(p.id);
                    return (
                      <li key={p.id}>
                        {/*
                          A `<label>`, not a button wrapping a checkbox — that
                          nesting is invalid HTML and gives screen readers two
                          controls for one choice. The label makes the whole
                          44px row the hit target for free.
                        */}
                        <label
                          className={cn(
                            "flex min-h-11 w-full cursor-pointer items-center gap-1 pr-3 transition-colors",
                            on ? "bg-accent/10" : "hover:bg-muted/50"
                          )}
                        >
                          <Check
                            checked={on}
                            onChange={() => toggleProduct(p.id)}
                            label={`Include ${p.name}`}
                          />
                          <span className="min-w-0 flex-1 py-2">
                            <span className="block truncate text-sm">{p.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {p.category}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {scoped && (
              <MiniButton onClick={() => setV((prev) => ({ ...prev, productIds: [] }))}>
                <X className="h-3.5 w-3.5" /> Clear selection
              </MiniButton>
            )}

            {!scoped && (
              <p className="text-xs text-danger">
                Pick at least one product, or switch back to Whole cart.
              </p>
            )}
          </div>
        )}
      </Card>

      {/* ---- Limits ---- */}
      <Card
        title="How many times"
        tip="Both limits are counted from real redemptions, at the moment the order is placed — not from how many people typed the code."
      >
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field
            label="Total uses"
            tip="Across all customers. Once this is reached the code stops working for everyone, and two checkouts racing for the last use cannot both take it. Leave blank for unlimited."
            hint={usedCount > 0 ? `${usedCount} already used.` : undefined}
          >
            {(id) => (
              <input
                id={id}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={v.usageLimit}
                onChange={(e) => set("usageLimit", e.target.value)}
                placeholder="Unlimited"
                className="input"
              />
            )}
          </Field>

          <Field
            label="Uses per customer"
            tip="Counted per account. Set it to 1 for a welcome code so the same person cannot keep re-using it. Leave blank for unlimited."
          >
            {(id) => (
              <input
                id={id}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={v.perUserLimit}
                onChange={(e) => set("perUserLimit", e.target.value)}
                placeholder="Unlimited"
                className="input"
              />
            )}
          </Field>
        </div>
      </Card>

      {/* ---- Window ---- */}
      <Card
        title="When it runs"
        tip="Both times are in India Standard Time, whatever time zone the server happens to run in. Leave either blank for an open end."
      >
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field
            label="Starts"
            tip="The code is refused before this moment, so a sale can be set up days ahead and left to switch itself on. Blank means it works straight away."
          >
            {(id) => (
              <input
                id={id}
                type="datetime-local"
                value={v.startsAt}
                onChange={(e) => set("startsAt", e.target.value)}
                className="input"
              />
            )}
          </Field>

          <Field
            label="Ends"
            tip="The code dies the instant the clock reaches this, so set it to 23:59 for 'last day of the month'. Blank means it never expires."
          >
            {(id) => (
              <input
                id={id}
                type="datetime-local"
                value={v.expiresAt}
                onChange={(e) => set("expiresAt", e.target.value)}
                className="input"
              />
            )}
          </Field>
        </div>

        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{preview.window} (IST)</span>
        </p>
      </Card>

      {/* ---- Save ---- */}
      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => router.push("/admin/coupons")}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-border px-5 text-[11px] font-medium uppercase tracking-widest transition-colors hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || (scopeChoice === "products" && !scoped)}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg bg-foreground px-6 text-[11px] font-medium uppercase tracking-widest text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : couponId ? "Save changes" : "Create coupon"}
        </button>
      </div>
    </form>
  );
}
