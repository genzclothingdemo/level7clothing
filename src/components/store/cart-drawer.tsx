"use client";

import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { X, Minus, Plus, Trash2, ShoppingBag } from "lucide-react";
import { useCart } from "@/context/cart";
import { ButtonLink } from "@/components/ui/button";
import { formatINR } from "@/lib/utils";

export function CartDrawer() {
  const { items, isOpen, setOpen, updateQty, removeItem, subtotal, count } =
    useCart();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          />
          <motion.aside
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-card shadow-2xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="font-serif text-xl">
                Your cart{" "}
                <span className="text-muted-foreground text-base">({count})</span>
              </h2>
              <button
                onClick={() => setOpen(false)}
                className="h-9 w-9 grid place-items-center rounded-full hover:bg-muted cursor-pointer"
                aria-label="Close cart"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {items.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
                <ShoppingBag className="h-10 w-10 text-muted-foreground" />
                <p className="text-muted-foreground">Your cart is empty.</p>
                <ButtonLink href="/shop" onClick={() => setOpen(false)}>
                  Browse the shop
                </ButtonLink>
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto px-5 py-4">
                  <ul className="space-y-4">
                    {items.map((item) => (
                      <li key={item.lineId} className="flex gap-4">
                        <Link
                          href={`/product/${item.slug}`}
                          onClick={() => setOpen(false)}
                          className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-muted"
                        >
                          {item.image && (
                            <Image
                              src={item.image}
                              alt={item.name}
                              fill
                              sizes="80px"
                              className="object-cover"
                            />
                          )}
                        </Link>
                        <div className="flex flex-1 flex-col">
                          <div className="flex justify-between gap-2">
                            <p className="text-sm font-medium leading-snug">
                              {item.name}
                            </p>
                            <button
                              onClick={() => removeItem(item.lineId)}
                              className="text-muted-foreground hover:text-danger cursor-pointer"
                              aria-label="Remove item"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                          {item.options && item.options.length > 0 && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {item.options.map((o) => `${o.name}: ${o.value}`).join(" · ")}
                            </p>
                          )}
                          <p className="mt-1 text-sm text-muted-foreground">
                            {formatINR(item.price)}
                          </p>
                          <div className="mt-auto flex items-center gap-2">
                            <div className="inline-flex items-center rounded-full border border-border">
                              <button
                                onClick={() =>
                                  updateQty(item.lineId, item.quantity - 1)
                                }
                                className="h-8 w-8 grid place-items-center hover:bg-muted rounded-l-full cursor-pointer"
                                aria-label="Decrease"
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                              <span className="w-8 text-center text-sm tabular-nums">
                                {item.quantity}
                              </span>
                              <button
                                onClick={() =>
                                  updateQty(item.lineId, item.quantity + 1)
                                }
                                className="h-8 w-8 grid place-items-center hover:bg-muted rounded-r-full cursor-pointer"
                                aria-label="Increase"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <span className="ml-auto text-sm font-medium">
                              {formatINR(item.price * item.quantity)}
                            </span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="border-t border-border px-5 py-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="text-lg font-medium">
                      {formatINR(subtotal)}
                    </span>
                  </div>
                  <p className="mb-4 text-xs text-muted-foreground">
                    Shipping calculated at checkout.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <ButtonLink
                      href="/cart"
                      variant="outline"
                      onClick={() => setOpen(false)}
                    >
                      View cart
                    </ButtonLink>
                    <ButtonLink
                      href="/checkout"
                      onClick={() => setOpen(false)}
                    >
                      Checkout
                    </ButtonLink>
                  </div>
                </div>
              </>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
