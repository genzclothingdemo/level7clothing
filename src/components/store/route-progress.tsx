"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Thin progress bar across the top of the viewport during navigation.
 *
 * DB-backed routes here are server-rendered, so a tap produces no visible
 * change until the server answers. `loading.tsx` skeletons cover the routes
 * that have them, but filter and pagination changes stay on the same route and
 * render no skeleton at all — without this the page looks frozen and shoppers
 * tap again.
 *
 * Deliberately not ambient motion (see CLAUDE.md): it only exists while a
 * navigation is genuinely in flight, and reports real state.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);

  const clearTimers = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (hideRef.current) clearTimeout(hideRef.current);
    timerRef.current = null;
    hideRef.current = null;
  };

  const start = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    clearTimers();
    setVisible(true);
    setProgress(8);

    // Ease toward 90% and wait there. Never reach 100% on a guess — the bar
    // completes only when the navigation actually lands.
    timerRef.current = setInterval(() => {
      setProgress((p) => (p >= 90 ? p : p + Math.max(0.5, (90 - p) * 0.12)));
    }, 120);
  }, []);

  const finish = useCallback(() => {
    if (!runningRef.current) return;
    runningRef.current = false;
    clearTimers();
    setProgress(100);
    hideRef.current = setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 220);
  }, []);

  // Begin on any same-origin link click that will actually change the URL.
  // Intercepting the click (rather than watching the router) is what lets the
  // bar appear on the tap instead of after the server responds.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const anchor = (e.target as HTMLElement | null)?.closest?.("a");
      if (!anchor) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      // Same page — no navigation will occur, so no progress to report.
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return;
      }
      start();
    };

    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", start);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", start);
    };
  }, [start]);

  // The route actually changed — complete the bar.
  useEffect(() => {
    finish();
    // `searchParams` is a new object each render; its string form is the value
    // that actually identifies the location.
  }, [pathname, searchParams?.toString(), finish]);

  useEffect(() => clearTimers, []);

  if (!visible) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[2px]"
    >
      <div
        className="h-full bg-accent transition-[width,opacity] duration-200 ease-out"
        style={{ width: `${progress}%`, opacity: progress >= 100 ? 0 : 1 }}
      />
    </div>
  );
}
