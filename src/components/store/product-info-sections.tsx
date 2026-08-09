"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  PackageOpen,
  Sparkles,
  Truck,
  RotateCcw,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Everything a customer reads *after* deciding — description, care, shipping,
 * returns, reviews. Collapsed by default (except the description) so the buy
 * block stays within a thumb's reach on mobile.
 */

function Row({
  icon,
  title,
  meta,
  defaultOpen = false,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  meta?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 py-4 text-left"
      >
        <span className="gold-text shrink-0">{icon}</span>
        <span className="flex-1 text-sm font-medium">{title}</span>
        {meta && <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>}
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300",
            open && "rotate-180"
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="pb-5 pl-7 pr-1 text-sm leading-relaxed text-muted-foreground">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Renders admin-authored copy as bullets — one line in, one bullet out. Leading
 * "-"/"•" markers are tolerated so it doesn't matter whether the admin typed
 * them. Returns null for blank copy, which is how a section gets hidden.
 */
function Bullets({ text }: { text: string }) {
  const items = text
    .split("\n")
    .map((l) => l.replace(/^\s*[-•*]\s*/, "").trim())
    .filter(Boolean);
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {items.map((t, i) => (
        <li key={`${i}-${t}`} className="flex gap-2">
          <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

export function ProductInfoSections({
  description,
  materialsCare,
  shippingInfo,
  returnsInfo,
  rating,
  reviewCount,
  reviews,
  specs,
}: {
  /** Always per-product — Admin › Products › Description. */
  description: string;
  /**
   * Already resolved by `resolveProductInfo()` — the product's own copy or the
   * store default. Blank hides the section, so an admin can switch a block off
   * store-wide (clear it under Settings › Product defaults) or per product.
   */
  materialsCare: string;
  shippingInfo: string;
  returnsInfo: string;
  /** Headline rating, or null when the product has no approved reviews. */
  rating: number | null;
  reviewCount: number;
  /**
   * The reviews panel — list plus the submit form. Passed in as a slot so this
   * component stays a server component and the review fetch lives on the page.
   */
  reviews: React.ReactNode;
  /** Label/value pairs rendered inside Materials & Care (dimensions, weight…). */
  specs?: { label: string; value: string }[];
}) {
  const hasSpecs = !!specs && specs.length > 0;

  return (
    <div className="rounded-2xl border border-border px-4 md:px-5">
      <Row
        icon={<PackageOpen className="h-4 w-4" />}
        title="Product Details"
        defaultOpen
      >
        <p className="whitespace-pre-line">{description}</p>
      </Row>

      {(materialsCare.trim() || hasSpecs) && (
        <Row icon={<Sparkles className="h-4 w-4" />} title="Materials & Care">
          <Bullets text={materialsCare} />
          {hasSpecs && (
            <dl className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {specs.map(({ label, value }) => (
                <div key={label} className="flex justify-between gap-3 sm:justify-start">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-medium text-foreground sm:ml-auto">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </Row>
      )}

      {shippingInfo.trim() && (
        <Row icon={<Truck className="h-4 w-4" />} title="Shipping & Delivery">
          <Bullets text={shippingInfo} />
        </Row>
      )}

      {returnsInfo.trim() && (
        <Row icon={<RotateCcw className="h-4 w-4" />} title="Returns & Refunds">
          <Bullets text={returnsInfo} />
        </Row>
      )}

      <Row
        icon={<Star className="h-4 w-4" />}
        title="Customer Reviews"
        meta={
          rating != null ? (
            <span className="flex items-center gap-1">
              <Star className="h-3 w-3 fill-accent text-accent" />
              {rating} · {reviewCount}
            </span>
          ) : (
            <span>None yet</span>
          )
        }
      >
        {reviews}
      </Row>
    </div>
  );
}
