"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Route-level error boundary. Without this a runtime error renders a blank
 * white page, which reads as "the shop is broken" and loses the sale.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="container-px mx-auto flex max-w-xl flex-col items-center py-24 text-center">
      <h1 className="font-serif text-3xl md:text-4xl">Something went wrong</h1>
      <p className="mt-4 text-muted-foreground">
        That page didn&apos;t load properly. It&apos;s us, not you — try again, or head
        back to the shop.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={reset}
          className="cursor-pointer rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Try again
        </button>
        <Link
          href="/shop"
          className="rounded-full border border-border px-6 py-3 text-sm font-medium transition-colors hover:bg-muted"
        >
          Back to shop
        </Link>
      </div>
      {error.digest && (
        <p className="mt-8 text-xs text-muted-foreground">
          Reference: {error.digest}
        </p>
      )}
    </div>
  );
}
