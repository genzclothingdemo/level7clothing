"use client";

import { useEffect } from "react";

/**
 * `(3) Level7 Clothing` — the browser tab as an unread indicator.
 *
 * The conventional, dependency-free signal, and the only one that reaches
 * someone who has this tab in the background. Both sides of the store use it:
 * the shopper's chat launcher and the admin's Inquiries badge.
 *
 * ## Why it lives here, and why it is a `<title>` observer
 *
 * There is no `document.title` machinery anywhere else in this app — every
 * title comes from a Next `metadata` export, which Next writes into the
 * `<title>` element **after** a client navigation commits. So a prefix applied
 * once is wiped the first time the operator opens another screen, and an effect
 * keyed on the pathname races that write rather than following it.
 *
 * A `MutationObserver` on the single `<title>` node is what makes this correct:
 * it fires *after* Next has written, whatever order things happened in. The
 * cost is one observer on one node, which is nothing.
 *
 * The loop that looks like it should run forever does not. Setting the title
 * fires the observer, the observer strips the prefix, sees the base is
 * unchanged, computes the same string, and `apply()` does not write because the
 * value already matches — so the second mutation never happens. A *real* title
 * change (a navigation) strips to something new, `base` moves, one write
 * follows, and it settles the same way.
 *
 * ## Why this file is under `components/admin/`
 *
 * Only because that is where new shared code was allowed to land in the change
 * that added it. It has no admin dependency and nothing but React in it — it is
 * imported by the storefront chat widget too. It belongs in `src/lib/`; move it
 * there the next time that directory is in scope, and update the two importers.
 */

/** Strip a badge this hook wrote, so the base title is never double-prefixed. */
const BADGE = /^\(\d+\+?\)\s*/;

const stripBadge = (t: string) => t.replace(BADGE, "");

export function useTitleBadge(count: number) {
  useEffect(() => {
    // `document` is read inside the effect, so this is safe to call from a
    // component that server-renders.
    if (count <= 0 || typeof document === "undefined") return;

    const el = document.querySelector("title");
    // No <title> to watch. Writing `document.title` would create one, but a
    // page with no title is a page with nothing to prefix.
    if (!el) return;

    // Capped the same way the badges are, so a busy inbox reads "(9+)" rather
    // than turning the tab strip into a number.
    const prefix = `(${count > 9 ? "9+" : count}) `;
    let base = stripBadge(document.title);

    const apply = () => {
      const want = prefix + base;
      if (document.title !== want) document.title = want;
    };

    apply();

    const observer = new MutationObserver(() => {
      const current = stripBadge(document.title);
      // A navigation changed the real title — follow it rather than fighting
      // it, so the tab still says which screen you are on.
      if (current !== base) base = current;
      apply();
    });
    observer.observe(el, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
      // Leave the title as the page meant it. Without this, dropping to zero
      // unread (or unmounting) would strand a stale "(2)" on the tab — an
      // indicator that never clears is worse than no indicator at all.
      document.title = stripBadge(document.title);
    };
  }, [count]);
}
