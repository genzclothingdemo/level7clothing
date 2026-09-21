"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  clearMyWishlist,
  mergeWishlist,
  setWishlistItem,
} from "@/app/actions/wishlist";

const STORAGE_KEY = "level7_wishlist";

type WishlistContextType = {
  slugs: string[];
  count: number;
  has: (slug: string) => boolean;
  toggle: (slug: string, name?: string) => void;
  remove: (slug: string) => void;
  clear: () => void;
};

const WishlistContext = createContext<WishlistContextType | null>(null);

function readLocal(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === "string")
      : [];
  } catch {
    return []; // corrupt or blocked storage
  }
}

/**
 * Wishlist state.
 *
 * Two backing stores, one at a time:
 *  - Signed in  → `WishlistItem` rows are the source of truth. Local storage
 *    is drained into the account once and then cleared, so the two can never
 *    drift and the next guest on this browser doesn't inherit the list.
 *  - Guest      → localStorage, exactly as before.
 *
 * `initialSlugs` is rendered by the server so a signed-in customer's saves are
 * correct on first paint instead of popping in after a fetch.
 */
export function WishlistProvider({
  children,
  signedIn = false,
  initialSlugs = [],
}: {
  children: React.ReactNode;
  signedIn?: boolean;
  initialSlugs?: string[];
}) {
  const [slugs, setSlugs] = useState<string[]>(initialSlugs);
  const [loaded, setLoaded] = useState(signedIn);
  const mergedRef = useRef(false);

  // ---- Hydrate ------------------------------------------------------------
  useEffect(() => {
    if (signedIn) {
      // Drain anything saved while logged out into the account, once.
      if (mergedRef.current) return;
      mergedRef.current = true;

      const local = readLocal();
      if (local.length === 0) return;

      void mergeWishlist(local)
        .then((merged) => {
          setSlugs(merged);
          // Only clear after the server has confirmed the union, or a failed
          // merge would silently lose the guest's saves.
          try {
            localStorage.removeItem(STORAGE_KEY);
          } catch {
            /* blocked storage — harmless */
          }
        })
        .catch(() => {
          /* keep the local copy for the next attempt */
        });
      return;
    }

    setSlugs(readLocal());
    setLoaded(true);
  }, [signedIn]);

  // ---- Persist (guests only) ---------------------------------------------
  useEffect(() => {
    if (signedIn || !loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slugs));
    } catch {
      /* private mode */
    }
  }, [slugs, loaded, signedIn]);

  const has = useCallback((slug: string) => slugs.includes(slug), [slugs]);

  /** Optimistic locally, then reconciled with the server when signed in. */
  const persist = useCallback(
    (slug: string, saved: boolean) => {
      if (!signedIn) return;
      void setWishlistItem(slug, saved).then((res) => {
        if (res.ok || res.guest) return;
        // The write failed — put the UI back rather than showing a heart that
        // isn't really saved.
        setSlugs((prev) =>
          saved ? prev.filter((s) => s !== slug) : [...prev, slug]
        );
        toast.error(res.error ?? "Could not update your wishlist");
      });
    },
    [signedIn]
  );

  const toggle = useCallback(
    (slug: string, name?: string) => {
      setSlugs((prev) => {
        const saved = !prev.includes(slug);
        toast.success(
          saved
            ? name
              ? `Saved ${name} to wishlist`
              : "Saved to wishlist"
            : name
              ? `Removed ${name} from wishlist`
              : "Removed from wishlist"
        );
        persist(slug, saved);
        return saved ? [...prev, slug] : prev.filter((s) => s !== slug);
      });
    },
    [persist]
  );

  const remove = useCallback(
    (slug: string) => {
      setSlugs((prev) => prev.filter((s) => s !== slug));
      persist(slug, false);
    },
    [persist]
  );

  const clear = useCallback(() => {
    setSlugs([]);
    if (signedIn) void clearMyWishlist();
  }, [signedIn]);

  return (
    <WishlistContext.Provider
      value={{ slugs, count: slugs.length, has, toggle, remove, clear }}
    >
      {children}
    </WishlistContext.Provider>
  );
}

export function useWishlist() {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error("useWishlist must be used inside WishlistProvider");
  return ctx;
}
