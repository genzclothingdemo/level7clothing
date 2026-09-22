"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";

/**
 * Error boundary for the admin panel.
 *
 * Without this, an admin crash fell through to the root boundary, which shows
 * the storefront's copy ("head back to the shop") and prints nothing useful.
 * That is the wrong audience and, worse, it throws away the one thing that
 * makes a production error diagnosable: React's `digest`, which is the key you
 * search Vercel's runtime logs with.
 *
 * So this shows the digest and the message, and logs to the console. An admin
 * is the operator, not a shopper — telling them what broke is more useful than
 * protecting them from it.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Also to the browser console, so it survives a page the admin then
    // navigates away from.
    console.error("[admin] render failed:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl py-16">
      <div className="rounded-lg border border-danger/40 bg-danger/5 p-6">
        <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-danger">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          Admin error
        </p>

        <h1 className="mt-3 font-serif text-2xl">This page failed to render</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          The rest of the panel still works — only this screen threw. Retrying
          is safe; nothing was saved.
        </p>

        {(error.message || error.digest) && (
          <dl className="mt-5 space-y-2 rounded-lg border border-border bg-card p-3 text-xs">
            {error.message && (
              <div>
                <dt className="text-muted-foreground">Message</dt>
                <dd className="mt-0.5 break-words font-mono text-foreground">
                  {error.message}
                </dd>
              </div>
            )}
            {error.digest && (
              <div>
                <dt className="text-muted-foreground">
                  Digest — search this in the Vercel runtime logs
                </dt>
                <dd className="mt-0.5 break-all font-mono text-foreground">
                  {error.digest}
                </dd>
              </div>
            )}
          </dl>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-foreground px-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-background transition-colors hover:bg-accent hover:text-white"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Try again
          </button>
          <Link
            href="/admin"
            className="inline-flex min-h-11 items-center rounded-lg border border-border px-5 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors hover:border-accent hover:text-accent"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
