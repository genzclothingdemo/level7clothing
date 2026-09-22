"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSettings } from "@/context/settings";
import { AppQuickActions } from "@/components/store/app-quick-actions";

/**
 * The top utility strip — the first thing on every page.
 *
 * It is still exported as `AnnouncementBar` because `(store)/layout.tsx` mounts
 * it under that name, but it now carries two things: the scrolling
 * announcement, and the install / notification icons that used to be a
 * 40%-of-the-screen card on the account profile (`AppQuickActions`).
 *
 * They sit here rather than in the navbar's icon row for a measured reason.
 * At 320px the navbar has 280px of usable width; five 44px targets is 220px of
 * that, leaving 60px for a wordmark that wants 140px. The strip, by contrast,
 * has one line of text that can simply be shorter. It is also literally where
 * the owner asked for them — *"navbar ke upar kam place me"*.
 *
 * The strip renders whenever there is an announcement OR a control to show, and
 * `AppQuickActions` renders nothing at all when neither install nor
 * notifications apply — so a store with no announcement on a browser that can
 * do neither still gets no strip, exactly as before.
 */

/**
 * Scroll speed in pixels per second.
 *
 * Tuned for reading, not spectacle: much above ~70 and the text is a blur on a
 * phone, much below ~40 and a long announcement takes half a minute to come
 * round. The duration is derived from the measured width so a short message and
 * a long one travel at the same speed — a fixed duration would make longer copy
 * race and shorter copy crawl.
 */
const PIXELS_PER_SECOND = 55;

export function AnnouncementBar() {
  const s = useSettings();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const copyRef = useRef<HTMLSpanElement | null>(null);

  // Static until measured. Starting "off" matters: the server render and the
  // first paint are identical, so there is no flash of scrolling text on short
  // announcements that never needed to scroll.
  const [overflows, setOverflows] = useState(false);
  const [duration, setDuration] = useState(0);
  const [reduced, setReduced] = useState(false);

  // globals.css disables `.animate-marquee` under prefers-reduced-motion. That
  // alone would leave an overflowing track frozen mid-sentence, so the
  // component has to know too: when motion is reduced the text wraps normally
  // instead of scrolling, which is readable rather than truncated.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    const copy = copyRef.current;
    if (!viewport || !copy) return;

    // The copy is nowrap while measuring, so "wider than the viewport" is
    // exactly the condition under which the text would wrap to a second line.
    const copyWidth = copy.scrollWidth;
    const doesOverflow = copyWidth > viewport.clientWidth + 1;

    setOverflows(doesOverflow);
    setDuration(doesOverflow ? copyWidth / PIXELS_PER_SECOND : 0);
  }, []);

  useEffect(() => {
    if (reduced) {
      setOverflows(false);
      return;
    }

    measure();

    const viewport = viewportRef.current;
    const copy = copyRef.current;
    if (!viewport || !copy) return;

    // Re-measure on rotation, breakpoint changes and late webfont swap — Space
    // Grotesk loading after first paint changes the text width materially.
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(copy);

    if (document.fonts?.ready) void document.fonts.ready.then(measure);

    return () => observer.disconnect();
  }, [measure, reduced, s.announcement]);

  const label = `✦ ${s.announcement} ✦`;
  const animate = overflows && !reduced;

  return (
    <div className="border-b border-background/10 bg-foreground text-background">
      {/* No explicit height: the row is as tall as its tallest child. With the
          controls that is 44px; with only an announcement it is the ~33px it
          always was; with neither it collapses to nothing and the remaining
          hairline is `--background` at 10% over `--background`, i.e. invisible.
          That is why this needs no "is there anything to show" flag. */}
      <div className="container-px mx-auto flex max-w-7xl items-center justify-end gap-2">
        {s.announcement && (
          <div
            ref={viewportRef}
            className="relative min-w-0 flex-1 overflow-hidden py-2"
          >
            <div
              className={
                animate ? "animate-marquee flex w-max" : "flex justify-center"
              }
              style={animate ? { animationDuration: `${duration}s` } : undefined}
            >
              <span
                ref={copyRef}
                className={`text-xs tracking-[0.15em] ${
                  reduced ? "text-center" : "whitespace-nowrap"
                } ${animate ? "pr-16" : ""}`}
              >
                {label}
              </span>

              {/*
                The loop is `translateX(0)` → `translateX(-50%)`, which is only
                seamless when the track is exactly two identical copies. The
                second is decorative — hidden from assistive tech so the
                announcement is not read out twice.
              */}
              {animate && (
                <span
                  aria-hidden="true"
                  className="whitespace-nowrap pr-16 text-xs tracking-[0.15em]"
                >
                  {label}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Negative margin so the ICON looks 20px from the edge like every
            other piece of content, rather than its 44px box doing so. */}
        <AppQuickActions className="-mr-3" />
      </div>
    </div>
  );
}
