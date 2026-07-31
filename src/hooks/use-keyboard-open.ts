"use client";

import { useEffect, useState } from "react";

/**
 * True while the on-screen keyboard is covering a meaningful slice of the screen.
 *
 * Mobile browsers shrink `visualViewport` when the keyboard opens but leave the
 * layout viewport alone, so anything `position: fixed` to the bottom (the mobile
 * tab bar, the WhatsApp FAB, back-to-top) ends up stranded behind the keyboard
 * and visibly drifts while the page scrolls. Callers use this to unmount those
 * elements for as long as the keyboard is up.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      // A keyboard eats far more height than browser chrome ever does — the
      // 180px floor keeps the collapsing URL bar from reading as a keyboard.
      setOpen(window.innerHeight - vv.height > 180);
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return open;
}
