"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Package, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/store/reveal";

export default function TrackOrderPage() {
  const router = useRouter();
  const [orderNumber, setOrderNumber] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = orderNumber.trim();
    if (!trimmed) return;
    router.push(`/order/${encodeURIComponent(trimmed)}`);
  }

  return (
    <div className="container-px mx-auto flex max-w-xl flex-col items-center py-20 text-center">
      <Reveal>
        <Package className="mx-auto h-12 w-12 text-muted-foreground" />
        <p className="mt-6 text-xs uppercase tracking-widest text-muted-foreground">
          Where&apos;s my order
        </p>
        <h1 className="mt-2 font-serif text-4xl md:text-5xl">Track your order</h1>
        <p className="mx-auto mt-4 max-w-sm text-muted-foreground">
          Enter your order number to see the latest status and delivery
          updates.
        </p>
      </Reveal>

      <Reveal delay={0.08} className="w-full">
        <form
          onSubmit={onSubmit}
          className="mt-10 flex w-full flex-col gap-3 sm:flex-row"
        >
          <input
            required
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            placeholder="e.g. L7-10234"
            className="input flex-1"
            aria-label="Order number"
          />
          <Button type="submit" size="lg" className="sm:w-auto">
            <Search className="h-4 w-4" /> Track order
          </Button>
        </form>
      </Reveal>

      <Reveal delay={0.14}>
        <p className="mt-6 text-sm text-muted-foreground">
          Have an account? You can also see all your orders under{" "}
          <a href="/account" className="link-underline text-foreground">
            My Account
          </a>
          .
        </p>
      </Reveal>
    </div>
  );
}
