"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createCoupon, updateCoupon } from "./actions";

type Product = { id: string; name: string };

export function CouponForm({
  coupon,
  products,
}: {
  coupon?: any;
  products: Product[];
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [code, setCode] = useState(coupon?.code || "");
  const [discountAmount, setDiscountAmount] = useState(
    coupon?.discountAmount || ""
  );
  const [isPercentage, setIsPercentage] = useState(
    coupon?.isPercentage || false
  );
  const [isActive, setIsActive] = useState(coupon?.isActive ?? true);
  const [usageLimit, setUsageLimit] = useState(coupon?.usageLimit || "");
  
  // selected products
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>(
    coupon?.productIds || []
  );

  const toggleProduct = (id: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const formData = new FormData();
    formData.append("code", code);
    formData.append("discountAmount", discountAmount.toString());
    formData.append("isPercentage", isPercentage.toString());
    formData.append("isActive", isActive.toString());
    if (usageLimit) formData.append("usageLimit", usageLimit.toString());
    
    selectedProductIds.forEach((id) => {
      formData.append("productIds", id);
    });

    const res = coupon
      ? await updateCoupon(coupon.id, formData)
      : await createCoupon(formData);

    setIsSubmitting(false);

    if (res.success) {
      router.push("/admin/coupons");
      router.refresh();
    } else {
      setError(res.error || "Something went wrong.");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8 max-w-2xl">
      <div className="space-y-4">
        {error && (
          <div className="p-4 rounded-md bg-danger/10 text-danger text-sm">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Coupon Code</label>
          <input
            type="text"
            required
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm uppercase"
            placeholder="e.g. SUMMER20"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Discount Amount</label>
            <input
              type="number"
              required
              min="0"
              value={discountAmount}
              onChange={(e) => setDiscountAmount(e.target.value)}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
              placeholder="e.g. 100"
            />
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isPercentage}
                onChange={(e) => setIsPercentage(e.target.checked)}
                className="rounded border-input text-primary focus:ring-primary"
              />
              <span className="text-sm font-medium">Is Percentage (%)?</span>
            </label>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Usage Limit (optional)
          </label>
          <input
            type="number"
            min="1"
            value={usageLimit}
            onChange={(e) => setUsageLimit(e.target.value)}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            placeholder="e.g. 100 (leave blank for unlimited)"
          />
        </div>

        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="rounded border-input text-primary focus:ring-primary"
            />
            <span className="text-sm font-medium">Active</span>
          </label>
          <p className="text-xs text-muted-foreground mt-1 ml-6">
            If unchecked, this coupon cannot be used by customers.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Applicable Products
          </label>
          <p className="text-xs text-muted-foreground mb-3">
            Select the specific products that this coupon applies to.
          </p>
          <div className="max-h-60 overflow-y-auto border border-input rounded-md p-2 space-y-1 bg-card">
            {products.map((p) => (
              <label
                key={p.id}
                className="flex items-center gap-3 p-2 hover:bg-muted rounded-sm cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedProductIds.includes(p.id)}
                  onChange={() => toggleProduct(p.id)}
                  className="rounded border-input text-primary focus:ring-primary"
                />
                <span className="text-sm">{p.name}</span>
              </label>
            ))}
            {products.length === 0 && (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No products found.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-border">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg px-5 py-2.5 text-sm font-medium border border-input bg-transparent hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg px-5 py-2.5 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {isSubmitting ? "Saving..." : coupon ? "Update Coupon" : "Create Coupon"}
        </button>
      </div>
    </form>
  );
}
