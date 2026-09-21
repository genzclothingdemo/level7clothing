"use client";

import { useEffect } from "react";

/**
 * Registers the service worker that makes the store installable and gives it
 * an offline fallback.
 *
 * Production only. In dev the worker sits in front of Turbopack's HMR assets
 * and serves stale chunks, which looks exactly like a broken build — and any
 * worker registered during a previous dev session is unregistered here so it
 * can't keep haunting localhost.
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
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        /* unsupported, blocked by policy, or private mode — the site works without it */
      });
    };

    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
