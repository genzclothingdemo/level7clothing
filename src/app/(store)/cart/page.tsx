"use client";

import Image from "next/image";
import Link from "next/link";
import { Minus, Plus, Trash2, ShoppingBag, ArrowRight } from "lucide-react";
import { useCart } from "@/context/cart";
import { ButtonLink } from "@/components/ui/button";
import { CartUpsell } from "@/components/store/cart-upsell";
import { formatINR } from "@/lib/utils";

export default function CartPage() {
  const { items, updateQty, removeItem, subtotal } = useCart();
  const cartSlugs = items.map((i) => i.slug);

  if (items.length === 0) {
    return (
      <div className="container-px mx-auto max-w-6xl py-12">
        <div className="flex flex-col items-center py-16 text-center">
          <ShoppingBag className="h-12 w-12 text-muted-foreground" />
          <h1 className="mt-6 font-serif text-3xl">Your cart is empty</h1>
          <p className="mt-2 text-muted-foreground">
            Discover premium tees and hoodies made to be worn.
          </p>
          <ButtonLink href="/shop" className="mt-8" size="lg">
            Browse the shop <ArrowRight className="h-4 w-4" />
          </ButtonLink>
        </div>
        <CartUpsell slugs={[]} title="Popular right now" />
      </div>
    );
  }

  return (
    <div className="container-px mx-auto max-w-6xl py-12">
      <h1 className="font-serif text-4xl">Shopping cart</h1>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_360px]">
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.lineId} className="flex gap-4 py-5">
              <Link
                href={`/product/${item.slug}`}
                className="relative h-28 w-28 shrink-0 overflow-hidden rounded-2xl bg-muted"
              >
                {item.image && (
                  <Image
                    src={item.image}
                    alt={item.name}
                    fill
                    sizes="112px"
                    className="object-cover"
                  />
                )}
              </Link>
              <div className="flex flex-1 flex-col">
                <div className="flex justify-between gap-3">
                  <Link
                    href={`/product/${item.slug}`}
                    className="font-serif text-lg hover:text-accent"
                  >
                    {item.name}
                  </Link>
                  <button
                    onClick={() => removeItem(item.lineId)}
                    className="text-muted-foreground hover:text-danger cursor-pointer"
                    aria-label="Remove"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
                {item.options && item.options.length > 0 && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.options.map((o) => `${o.name}: ${o.value}`).join(" · ")}
                  </p>
                )}
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatINR(item.price)}
                </p>
                <div className="mt-auto flex items-center justify-between">
                  <div className="inline-flex items-center rounded-full border border-border">
                    <button
                      onClick={() => updateQty(item.lineId, item.quantity - 1)}
                      className="grid h-9 w-9 place-items-center hover:bg-muted rounded-l-full cursor-pointer"
                      aria-label="Decrease"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="w-10 text-center text-sm tabular-nums">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => updateQty(item.lineId, item.quantity + 1)}
                      className="grid h-9 w-9 place-items-center hover:bg-muted rounded-r-full cursor-pointer"
                      aria-label="Increase"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                  <span className="font-medium">
                    {formatINR(item.price * item.quantity)}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <aside className="h-fit rounded-2xl border border-border bg-card p-6 lg:sticky lg:top-24">
          <h2 className="font-serif text-xl">Order summary</h2>
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatINR(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Shipping</span>
              <span className="text-muted-foreground">At checkout</span>
            </div>
          </div>
          <div className="mt-4 flex justify-between border-t border-border pt-4">
            <span className="font-medium">Total</span>
            <span className="text-lg font-medium">{formatINR(subtotal)}</span>
          </div>
          <ButtonLink href="/checkout" className="mt-6 w-full" size="lg">
            Proceed to checkout
          </ButtonLink>
          <ButtonLink href="/shop" variant="ghost" className="mt-2 w-full">
            Continue shopping
          </ButtonLink>
        </aside>
      </div>

      <CartUpsell slugs={cartSlugs} />
    </div>
  );
}
