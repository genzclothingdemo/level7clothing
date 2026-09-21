"use client";

import { useEffect } from "react";
import { PushPrompt } from "@/components/store/push-prompt";

/**
 * Registers the service worker that makes the store installable and gives it
 * an offline fallback, and carries the one piece of push UI that has to exist
 * without a layout change: the opt-in bar.
 *
 * Production only. In dev the worker sits in front of Turbopack's HMR assets
 * and serves stale chunks, which looks exactly like a broken build — and any
 * worker registered during a previous dev session is unregistered here so it
 * can't keep haunting localhost. A consequence worth knowing: **web push
 * cannot be exercised with `npm run dev`**, because there is no worker to
 * receive it. Use `npx next build && npx next start` to test push locally.
 */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => void r.unregister()))
        .catch(() => {});
      return;
    }

    // Registering after load keeps the worker off the critical path for the
    // first paint, which is the metric shoppers actually feel.
    const register = () => {
      void navigator.serviceWorker
        .register("/sw.js", {
          scope: "/",
          // The worker script itself must never come from the HTTP cache, or a
          // device can sit on an old copy — which, now that the worker handles
          // push, means silently missing notifications rather than just
          // serving a stale shell.
          updateViaCache: "none",
        })
        .catch(() => {
          /* unsupported, blocked by policy, or private mode — the site works without it */
        });
    };

    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  /*
   * `PushPrompt` decides entirely on its own whether to render — installed app
   * only, permission still unasked, not previously dismissed — so mounting it
   * here costs a hidden component and nothing else. It is mounted from this
   * file because `PwaRegister` is already in the root layout, which keeps the
   * whole feature out of files other people own.
   */
  return <PushPrompt />;
}
