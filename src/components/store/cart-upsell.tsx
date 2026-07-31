"use client";

import { useEffect, useState } from "react";
import { ProductCard } from "@/components/store/product-card";
import type { ProductDTO } from "@/lib/types";

export function CartUpsell({
  slugs,
  title = "Complete the look",
  limit = 4,
}: {
  slugs: string[];
  title?: string;
  limit?: number;
}) {
  const [products, setProducts] = useState<ProductDTO[]>([]);

  // Join to a primitive so the effect doesn't refire on every array identity change.
  const key = slugs.join(",");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/store/recommendations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slugs: key ? key.split(",") : [], limit }),
        });
        const data = await res.json();
        if (!cancelled) setProducts(data.products ?? []);
      } catch {
        if (!cancelled) setProducts([]);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [key, limit]);

  if (products.length === 0) return null;

  return (
    <section className="mt-16">
      <h2 className="font-serif text-2xl md:text-3xl">{title}</h2>
      <div className="mt-6 grid grid-cols-2 gap-x-3 gap-y-7 sm:gap-x-5 sm:gap-y-10 md:grid-cols-4">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}
