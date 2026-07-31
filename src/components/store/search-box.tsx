"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Search, X, Loader2, TrendingUp } from "lucide-react";
import { formatINR } from "@/lib/utils";

type Suggestion = {
  id: string;
  name: string;
  slug: string;
  category: string;
  price: number;
  image: string;
};

const POPULAR = [
  "Oversized T-Shirt",
  "Drop-Shoulder Hoodie",
  "Premium Tees",
  "Minimalistic Tees",
  "Oversized Hoodie",
];

export function SearchBox({
  variant = "bar",
  onNavigate,
}: {
  variant?: "bar" | "icon";
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(variant === "bar");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced fetch of suggestions.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: ctrl.signal,
        });
        const data = await res.json();
        setResults(data.results ?? []);
        setActive(-1);
      } catch {
        /* aborted */
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  // Close on outside click / Esc (icon variant only).
  useEffect(() => {
    if (variant !== "icon") return;
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [variant]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const go = useCallback(
    (term: string) => {
      const t = term.trim();
      if (!t) return;
      setOpen(variant === "bar");
      setQ("");
      setResults([]);
      onNavigate?.();
      router.push(`/shop?q=${encodeURIComponent(t)}`);
    },
    [router, variant, onNavigate]
  );

  const openProduct = useCallback(
    (slug: string) => {
      setOpen(variant === "bar");
      setQ("");
      setResults([]);
      onNavigate?.();
      router.push(`/product/${slug}`);
    },
    [router, variant, onNavigate]
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && results[active]) openProduct(results[active].slug);
      else go(q);
    } else if (e.key === "Escape") {
      if (variant === "icon") setOpen(false);
    }
  }

  const showPanel = open && q.trim().length > 0;

  if (variant === "icon" && !open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Search"
        className="grid h-10 w-10 place-items-center rounded-full border border-border hover:bg-muted cursor-pointer"
      >
        <Search className="h-[18px] w-[18px]" />
      </button>
    );
  }

  return (
    <div
      ref={boxRef}
      className={
        variant === "icon"
          ? "relative w-full max-w-md"
          : "relative w-full"
      }
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          placeholder="Search tees, hoodies…"
          className="h-11 w-full rounded-full border border-input bg-card pl-10 pr-10 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring"
          aria-label="Search products"
        />
        {q && (
          <button
            onClick={() => {
              setQ("");
              inputRef.current?.focus();
            }}
            className="absolute right-3 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted"
            aria-label="Clear"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <AnimatePresence>
        {showPanel && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
          >
            {loading && results.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching…
              </div>
            ) : results.length > 0 ? (
              <ul className="max-h-[22rem] overflow-y-auto py-1.5">
                {results.map((r, i) => (
                  <li key={r.id}>
                    <button
                      onMouseEnter={() => setActive(i)}
                      onClick={() => openProduct(r.slug)}
                      className={`flex w-full items-center gap-3 px-3 py-2 text-left ${
                        active === i ? "bg-muted" : ""
                      }`}
                    >
                      <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-muted">
                        {r.image && (
                          <Image
                            src={r.image}
                            alt={r.name}
                            fill
                            sizes="44px"
                            className="object-cover"
                          />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {r.name}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {r.category}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-medium">
                        {formatINR(r.price)}
                      </span>
                    </button>
                  </li>
                ))}
                <li className="border-t border-border">
                  <button
                    onClick={() => go(q)}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-accent hover:bg-muted"
                  >
                    <Search className="h-4 w-4" />
                    See all results for “{q.trim()}”
                  </button>
                </li>
              </ul>
            ) : (
              <div className="px-4 py-4">
                <p className="text-sm text-muted-foreground">
                  No matches for “{q.trim()}”.
                </p>
                <div className="mt-3">
                  <p className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
                    <TrendingUp className="h-3.5 w-3.5" /> Popular
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {POPULAR.map((p) => (
                      <button
                        key={p}
                        onClick={() => go(p)}
                        className="rounded-full border border-border px-3 py-1 text-xs hover:bg-muted"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
