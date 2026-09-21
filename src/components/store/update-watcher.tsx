"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/** How often to ask the server which deployment it is. */
const POLL_MS = 60_000;

/**
 * Routes where an unannounced reload would destroy real work — a part-filled
 * address, a payment step, an order being tracked. On these we surface the
 * update and let the shopper choose the moment.
 */
const PROTECTED = [/^\/checkout/, /^\/account/, /^\/admin/, /^\/order\//];

/**
 * Watches for a new deployment and refreshes the tab onto it.
 *
 * Why this exists: a phone left on the shop page for two days keeps running
 * the JS bundle it loaded then. After a deploy, that bundle asks for chunks
 * the new build no longer has, and the page starts failing in ways that look
 * random. Reloading onto the current deployment is the fix.
 *
 * Why it is not simply `location.reload()` on sight: a hard refresh in the
 * middle of checkout throws away a shopper's typed address. So the reload is
 * automatic only when it is demonstrably safe — a hidden tab, or a page with
 * nothing typed into it — and otherwise becomes a prompt they can dismiss.
 */
export function UpdateWatcher({ current }: { current: string }) {
  const [pending, setPending] = useState(false);
  const pathname = usePathname();
  // Held in a ref so the poll effect doesn't re-subscribe on every navigation.
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  const hardReload = useCallback(async () => {
    // Clear the worker's caches first, or the "hard" refresh can still be
    // served the previous build's shell.
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg?.active) {
        await new Promise<void>((resolve) => {
          const channel = new MessageChannel();
          channel.port1.onmessage = () => resolve();
          reg.active!.postMessage({ type: "CLEAR_CACHES" }, [channel.port2]);
          // Never block the reload on a worker that doesn't answer.
          setTimeout(resolve, 1500);
        });
        await reg.update().catch(() => {});
      }
    } catch {
      /* no worker, or storage blocked — reload anyway */
    }
    window.location.reload();
  }, []);

  const check = useCallback(async () => {
    if (current === "dev") return; // local dev redeploys constantly

    let latest: string | undefined;
    try {
      const res = await fetch("/api/version", { cache: "no-store" });
      if (!res.ok) return;
      latest = (await res.json())?.id;
    } catch {
      return; // offline or a blip — try again next tick
    }

    if (!latest || latest === current) return;

    // Guard against a reload loop if two deployments are serving at once
    // behind the load balancer: only auto-reload once per target build.
    let alreadyTried = false;
    try {
      const key = `l7:reloaded-for:${latest}`;
      alreadyTried = sessionStorage.getItem(key) === "1";
      if (!alreadyTried) sessionStorage.setItem(key, "1");
    } catch {
      /* private mode — fall through and rely on the safety checks */
    }

    const onProtectedRoute = PROTECTED.some((re) => re.test(pathRef.current || "/"));
    const safe =
      !alreadyTried &&
      !onProtectedRoute &&
      !hasTypedInput() &&
      !hasOpenDialog();

    // A hidden tab is the ideal moment: nobody is looking at it.
    if (safe && (document.visibilityState === "hidden" || !hasTypedInput())) {
      void hardReload();
      return;
    }

    setPending(true);
  }, [current, hardReload]);

  useEffect(() => {
    if (current === "dev") return;

    const timer = setInterval(check, POLL_MS);
    // Coming back to a backgrounded tab is exactly when the build is most
    // likely to have moved on, so check then too rather than waiting out the
    // rest of the interval.
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, [check, current]);

  if (!pending) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-[90] flex justify-center px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:bottom-4"
    >
      <div className="flex w-full max-w-sm items-center gap-3 rounded-lg border border-foreground/12 bg-foreground px-4 py-3 text-background shadow-lg">
        <p className="flex-1 text-xs leading-relaxed tracking-wide">
          A new version of the store is available.
        </p>
        <button
          type="button"
          onClick={() => void hardReload()}
          className="min-h-[40px] shrink-0 rounded-lg bg-background px-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground transition-colors hover:bg-accent hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={() => setPending(false)}
          aria-label="Dismiss update notice"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-background/70 transition-colors hover:text-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span aria-hidden="true" className="text-lg leading-none">
            &times;
          </span>
        </button>
      </div>
    </div>
  );
}

/** True if the shopper has typed anything that a reload would discard. */
function hasTypedInput(): boolean {
  const fields = document.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >("input, textarea, select");

  for (const el of fields) {
    if (el.disabled) continue;
    if (el instanceof HTMLInputElement) {
      if (el.type === "hidden") continue;
      if (el.type === "checkbox" || el.type === "radio") {
        if (el.checked !== el.defaultChecked) return true;
        continue;
      }
      if (el.value && el.value !== el.defaultValue) return true;
      continue;
    }
    if (el instanceof HTMLTextAreaElement) {
      if (el.value && el.value !== el.defaultValue) return true;
      continue;
    }
    if (el.selectedIndex !== -1 && !el.options[el.selectedIndex]?.defaultSelected) return true;
  }

  return !!document.querySelector<HTMLElement>("[contenteditable='true']")?.textContent?.trim();
}

/** True if a modal/drawer is open — reloading would yank it away mid-task. */
function hasOpenDialog(): boolean {
  return !!document.querySelector("[role='dialog'], [aria-modal='true'], dialog[open]");
}
