"use client";

import { useEffect, useState } from "react";
import { Heart, ArrowRight, Loader2 } from "lucide-react";
import { useWishlist } from "@/context/wishlist";
import { ButtonLink, Button } from "@/components/ui/button";
import { ProductCard } from "@/components/store/product-card";
import type { ProductDTO } from "@/lib/types";

export default function WishlistPage() {
  const { slugs, count, clear } = useWishlist();
  const [products, setProducts] = useState<ProductDTO[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (slugs.length === 0) {
        if (!cancelled) {
          setProducts([]);
          setLoading(false);
        }
        return;
      }
      try {
        const res = await fetch("/api/store/wishlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slugs }),
        });
        const data = await res.json();
        if (!cancelled) setProducts(data.products ?? []);
      } catch {
        if (!cancelled) setProducts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [slugs]);

  if (loading) {
    return (
      <div className="container-px mx-auto flex max-w-2xl flex-col items-center py-28">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (count === 0) {
    return (
      <div className="container-px mx-auto flex max-w-2xl flex-col items-center py-28 text-center">
        <Heart className="h-12 w-12 text-muted-foreground" />
        <h1 className="mt-6 font-serif text-3xl">Your wishlist is empty</h1>
        <p className="mt-2 text-muted-foreground">
          Tap the heart on any style to save it here for later.
        </p>
        <ButtonLink href="/shop" className="mt-8" size="lg">
          Browse the shop <ArrowRight className="h-4 w-4" />
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="container-px mx-auto max-w-7xl py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest gold-text">Saved</p>
          <h1 className="mt-1 font-serif text-3xl md:text-4xl">
            My wishlist
            <span className="ml-2 text-lg text-muted-foreground">({count})</span>
          </h1>
        </div>
        <Button variant="outline" onClick={clear}>
          Clear all
        </Button>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-x-3 gap-y-7 sm:gap-x-5 sm:gap-y-10 md:grid-cols-3 lg:grid-cols-4">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>

      {products.length < count && (
        <p className="mt-8 text-sm text-muted-foreground">
          Some saved styles are no longer available and have been hidden.
        </p>
      )}
    </div>
  );
}
