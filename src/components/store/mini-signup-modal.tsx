"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ShoppingBag, X } from "lucide-react";
import { useCart } from "@/context/cart";
import { Button } from "@/components/ui/button";

export function MiniSignupModal() {
  const { pendingAdd, submitLead, cancelLead } = useCart();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    const p = phone.trim();
    if (n.length < 2) return setError("Please enter your name");
    if (p.replace(/\D/g, "").length < 6)
      return setError("Please enter a valid mobile number");
    setError("");
    submitLead({ name: n, phone: p });
    setName("");
    setPhone("");
  }

  function close() {
    setError("");
    cancelLead();
  }

  const open = pendingAdd !== null;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
          />
          <div className="fixed inset-0 z-50 grid place-items-center p-4">
            <motion.div
              className="relative w-full max-w-sm rounded-3xl border border-border bg-card p-7 shadow-2xl"
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ type: "spring", damping: 26, stiffness: 320 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={close}
                className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>

              <div className="text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted gold-text">
                  <ShoppingBag className="h-5 w-5" />
                </span>
                <h2 className="mt-4 font-serif text-2xl">Almost there!</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {pendingAdd
                    ? pendingAdd.checkout
                      ? `Just your name & mobile and we'll take you straight to checkout for “${pendingAdd.item.name}”.`
                      : `Just your name & mobile to add “${pendingAdd.item.name}” to your cart.`
                    : "Just your name & mobile to save your cart."}
                </p>
              </div>

              {error && (
                <p className="mt-5 rounded-xl bg-danger/10 px-4 py-2.5 text-sm text-danger">
                  {error}
                </p>
              )}

              <form onSubmit={onSubmit} className="mt-5 space-y-4">
                <label className="block">
                  <span className="mb-1.5 block text-sm text-muted-foreground">
                    Your name
                  </span>
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="input"
                    placeholder="e.g. Priya Sharma"
                    autoComplete="name"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm text-muted-foreground">
                    Mobile number
                  </span>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="input"
                    placeholder="e.g. 98765 43210"
                    inputMode="tel"
                    autoComplete="tel"
                  />
                </label>

                <Button type="submit" className="w-full" size="lg">
                  <ShoppingBag className="h-4 w-4" />
                  {pendingAdd?.checkout ? "Continue to checkout" : "Add to cart"}
                </Button>
              </form>

              <p className="mt-4 text-center text-xs text-muted-foreground">
                We&apos;ll only use this to help with your order — saved on this
                device so you won&apos;t be asked again.
              </p>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
