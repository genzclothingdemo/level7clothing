"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ShoppingBag,
  Minus,
  Plus,
  Check,
  Zap,
  Loader2,
  HandHeart,
  Truck,
  ShieldCheck,
  IndianRupee,
} from "lucide-react";
import { useCart } from "@/context/cart";
import { useProductView } from "@/context/product-view";
import { Button } from "@/components/ui/button";
import { WhatsAppProductButton } from "@/components/store/product-actions";
import { VisualVariantPicker } from "@/components/store/visual-variant-picker";
import { SizeGuideModal } from "@/components/store/size-guide-modal";
import {
  CustomisationNotice,
  PaymentModesNote,
} from "@/components/store/product-notices";
import { formatINR, cn } from "@/lib/utils";
import {
  priceForSelection,
  isChoiceEnabled,
  repairSelection,
  visualAttributeName,
} from "@/lib/variants";
import type { ProductDTO, Attribute, SellableVariant } from "@/lib/types";
import { comboKey } from "@/lib/options";

function TrustRow() {
  const items = [
    { icon: <HandHeart  className="h-4 w-4" />, label: "Easy 7-Day Returns" },
    { icon: <Truck      className="h-4 w-4" />, label: "Ships Across India" },
    { icon: <ShieldCheck className="h-4 w-4" />, label: "Secure Packaging" },
    { icon: <IndianRupee className="h-4 w-4" />, label: "Cash on Delivery" },
  ];
  // 2-up on phones: 4-up gave each cell ~56px at 320px, stacking every label
  // into three lines of 10px text.
  return (
    <div className="grid grid-cols-2 gap-2 rounded-2xl border border-border p-4 sm:grid-cols-4">
      {items.map(({ icon, label }) => (
        <div key={label} className="flex flex-col items-center gap-1.5 text-center">
          <span className="gold-text">{icon}</span>
          <span className="text-[10px] leading-tight text-muted-foreground sm:text-xs">
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Quantity stepper, shared by the inline CTA and the sticky mobile bar. */
function QtyStepper({
  qty,
  max,
  onChange,
  compact = false,
}: {
  qty: number;
  max: number;
  onChange: (next: number) => void;
  compact?: boolean;
}) {
  const btn = cn(
    "grid shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-30",
    compact ? "h-8 w-8" : "h-10 w-10"
  );
  return (
    <div
      className={cn(
        "flex shrink-0 items-center rounded-full border border-border bg-card p-1",
        compact && "p-0.5"
      )}
    >
      <button
        type="button"
        onClick={() => onChange(Math.max(1, qty - 1))}
        disabled={qty <= 1}
        className={btn}
        aria-label="Decrease quantity"
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className={cn("text-center text-sm font-medium", compact ? "w-6" : "w-8")}>
        {qty}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, qty + 1))}
        disabled={qty >= max}
        className={btn}
        aria-label="Increase quantity"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function StrikeThrough() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
      <line x1="0" y1="100%" x2="100%" y2="0" stroke="currentColor" strokeWidth="1" strokeOpacity="0.3" />
    </svg>
  );
}

export function ProductPurchase({ product }: { product: ProductDTO }) {
  const { addItem, buyNow, leadInfo } = useCart();
  const { selection, setSelection }   = useProductView();

  const attributes = (product.attributes || []) as Attribute[];
  const hasOptions = attributes.length > 0;
  const sellable = (product.sellableVariants || []) as SellableVariant[];

  // The image-driving attribute gets the image-card picker and is always shown
  // first — it's the question the customer is actually asking. Everything else
  // falls through to pills, in the admin's authored order.
  const visualName    = visualAttributeName(product);
  const visualGroup   = attributes.find((a) => a.name === visualName) ?? null;
  const pillGroups    = attributes.filter((a) => a.name !== visualGroup?.name);
  const orderedGroups = visualGroup ? [visualGroup, ...pillGroups] : pillGroups;

  const [qty, setQty]       = useState(1);
  const [added, setAdded]   = useState(false);
  const [buying, setBuying] = useState(false);

  const selKey    = comboKey(selection);
  const matched   = sellable.find((v) => v.id === selKey);
  const unitPrice = priceForSelection(product as any, selection);

  const missing = attributes.filter((g) => !selection[g.name]).map((g) => g.name);
  const needsChoice = missing.length > 0;
  // A fully-chosen combo can still be turned off by the admin's availability toggle.
  const comboUnavailable =
    hasOptions && !needsChoice && matched != null && !matched.available;
  const variantStock = matched ? matched.stock : product.stock;
  const soldOut = (hasOptions ? variantStock : product.stock) <= 0;
  const canOrder = !soldOut && !needsChoice && !comboUnavailable;

  // The sticky mobile bar only appears once the inline CTA has scrolled past the
  // top of the viewport, so the two are never on screen at the same time.
  // A passive scroll listener rather than IntersectionObserver: IO delivers no
  // callbacks while the tab isn't compositing, which left the bar stuck hidden.
  const ctaRef = useRef<HTMLDivElement | null>(null);
  const [ctaVisible, setCtaVisible] = useState(true);
  useEffect(() => {
    const check = () => {
      const el = ctaRef.current;
      if (!el) return;
      const { top, bottom } = el.getBoundingClientRect();
      setCtaVisible(bottom > 0 && top < window.innerHeight);
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, []);

  // Reset quantity whenever the customer switches variant.
  useEffect(() => {
    setQty(1);
  }, [selKey]);

  function toggle(groupName: string, value: string) {
    // Keep a complete selection at all times — clicking the already-active choice
    // is a no-op so the product never drops back into a non-orderable state.
    if (selection[groupName] === value) return;
    if (!isChoiceEnabled(groupName, value, product)) return;
    setSelection(repairSelection(attributes, { ...selection, [groupName]: value }));
  }

  /**
   * What this product would cost if only `groupName` changed to `val` — used for
   * the "+₹80" hints on the pills. Returns null when no available sellable
   * variant matches that combo, so we never advertise a price for something the
   * customer can't actually buy.
   */
  function priceIfSwapped(groupName: string, val: string): number | null {
    if (selection[groupName] === val) return unitPrice;
    const next = repairSelection(attributes, { ...selection, [groupName]: val });
    const v = sellable.find((s) => s.id === comboKey(next));
    return v && v.available ? v.price : null;
  }

  function listNames(names: string[]) {
    if (names.length <= 1) return names[0] ?? "";
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }

  function buildItem() {
    const activeImage = matched?.images?.[0] ?? product.images[0] ?? "";
    // Convert selection Record to SelectedOption[]
    const selectedOptions = Object.entries(selection).map(([name, value]) => ({ name, value }));

    return {
      productId: product.id,
      slug:      product.slug,
      name:      product.name,
      image:     activeImage,
      price:     unitPrice,
      stock:     variantStock,
      options:   selectedOptions.length > 0 ? selectedOptions : undefined,
    };
  }

  function onAdd() {
    if (!canOrder) return;
    const had = leadInfo !== null;
    addItem(buildItem(), qty);
    if (had) {
      setAdded(true);
      setTimeout(() => setAdded(false), 1600);
    }
  }

  function onBuy() {
    if (!canOrder) return;
    if (leadInfo) setBuying(true);
    buyNow(buildItem(), qty);
  }

  return (
    <div className="space-y-6">
      {/* ── Option groups: visual attribute as image cards, the rest as pills ── */}
      {orderedGroups.map((group, i) => {
        const step = orderedGroups.length > 1 ? i + 1 : undefined;

        if (group.name === visualGroup?.name) {
          return (
            <VisualVariantPicker
              key={group.name}
              product={product}
              attributeName={group.name}
              values={group.values}
              selected={selection[group.name]}
              onSelect={(val) => toggle(group.name, val)}
              isEnabled={(val) => isChoiceEnabled(group.name, val, product)}
              index={step}
            />
          );
        }

        return (
          <section key={group.name} aria-label={`Choose ${group.name}`}>
            <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm font-semibold">
                <span>
                  {step ? `${step}. ` : ""}Choose {group.name}
                </span>
                {selection[group.name] ? (
                  <span className="font-normal text-muted-foreground">
                    — {selection[group.name]}
                  </span>
                ) : (
                  <span className="text-xs font-normal text-danger">Select one</span>
                )}
              </p>

              {/* The fits are intentionally oversized, so the chart belongs
                  right where the size is chosen. */}
            </div>

            <div className="flex flex-wrap gap-2">
              {group.values.map((val) => {
                const isActive = selection[group.name] === val;
                const enabled = isChoiceEnabled(group.name, val, product);
                const swapped = enabled ? priceIfSwapped(group.name, val) : null;
                const delta = swapped == null ? 0 : swapped - unitPrice;

                return (
                  <motion.button
                    key={val}
                    type="button"
                    disabled={!enabled}
                    whileTap={enabled ? { scale: 0.96 } : undefined}
                    onClick={() => toggle(group.name, val)}
                    aria-pressed={isActive}
                    className={cn(
                      "relative flex flex-col items-center overflow-hidden rounded-xl border px-4 py-2 text-sm font-medium transition-all",
                      isActive
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                      !enabled && "pointer-events-none opacity-40"
                    )}
                  >
                    <span className="relative z-10">{val}</span>
                    {delta !== 0 && (
                      <span className="relative z-10 text-[11px] font-normal text-muted-foreground">
                        {delta > 0 ? "+" : "−"}
                        {formatINR(Math.abs(delta))}
                      </span>
                    )}
                    {!enabled && <StrikeThrough />}
                  </motion.button>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* Size guide sits after the option groups rather than inside one,
          because "Size" can be either the visual (image-card) group or a pill
          group depending on the product — putting it in the pill branch alone
          meant it never rendered for products where size drives the imagery.
          The fits are intentionally oversized, so this chart matters. */}
      {attributes.some((a) => /size/i.test(a.name)) && (
        <div className="flex justify-end">
          <SizeGuideModal category={product.category} />
        </div>
      )}

      {/* ── Quantity + Add to cart / Buy CTA ── */}
      <div ref={ctaRef} className="space-y-3 pt-1">
        {hasOptions && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm text-muted-foreground">Your selection:</span>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={unitPrice}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
                className="text-xl font-semibold"
              >
                {formatINR(unitPrice)}
              </motion.span>
            </AnimatePresence>
            {qty > 1 && (
              <span className="text-sm text-muted-foreground">
                × {qty} = {formatINR(unitPrice * qty)}
              </span>
            )}
          </div>
        )}

        <div className="flex h-14 gap-3">
          <QtyStepper qty={qty} max={variantStock} onChange={setQty} />

          <Button
            size="lg"
            variant="outline"
            onClick={onAdd}
            disabled={!canOrder || added}
            className={cn("h-14 flex-1 text-sm font-semibold transition-all", added && "border-green-600 bg-green-50 text-green-700")}
          >
            {added ? (
              <span className="flex items-center gap-2"><Check className="h-4 w-4" /> Added</span>
            ) : (
              <span className="flex items-center gap-2"><ShoppingBag className="h-4 w-4" /> Add to Cart</span>
            )}
          </Button>
        </div>

        <Button size="lg" variant="primary" onClick={onBuy} disabled={!canOrder || buying} className="h-14 w-full text-sm font-semibold shadow-xl shadow-primary/20">
          {buying ? (
            <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Preparing checkout...</span>
          ) : (
            <span className="flex items-center gap-2"><Zap className="h-4 w-4 fill-current" /> Buy Now</span>
          )}
        </Button>
        <WhatsAppProductButton product={product} />

        <div className="pt-1">
          {soldOut ? (
            <p className="text-center text-sm font-medium text-danger">Sold out</p>
          ) : needsChoice ? (
            <p className="text-center text-sm font-medium text-accent">Please select {listNames(missing)}</p>
          ) : comboUnavailable ? (
            <p className="text-center text-sm font-medium text-danger">This combination is unavailable</p>
          ) : (
            <p className="text-center text-sm font-medium text-green-600">In stock, ready to ship</p>
          )}
        </div>
      </div>

      {/* Made-to-order pieces change what the shopper has to do and what they
          can expect back, so this sits above the trust row, not in fine print. */}
      {product.isCustomisable && (
        <CustomisationNotice note={product.customisationNote} />
      )}

      <PaymentModesNote
        modes={product.paymentModes}
        advancePercent={product.advancePercent ?? null}
      />

      <TrustRow />

      {/* ── Sticky mobile buy bar — sits above the app's bottom tab bar ── */}
      {/* Portalled to <body>: an animated ancestor on this page carries a
          transform, which would otherwise become the containing block and make
          `fixed` scroll with the page. */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {!ctaVisible && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-x-0 bottom-[calc(3.75rem+var(--sa-bottom))] z-40 border-t border-border bg-background/95 px-4 py-2.5 backdrop-blur-xl md:hidden"
          >
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] text-muted-foreground">
                  {Object.values(selection).join(" · ") || product.name}
                </p>
                {/* The three siblings in this bar are all shrink-0, leaving
                    this column ~44px at 320px. A 5-digit total is one
                    unbreakable token, so without truncate it overlapped the
                    quantity stepper. */}
                <p className="truncate text-sm font-semibold leading-tight">
                  {formatINR(unitPrice * qty)}
                </p>
              </div>
              <QtyStepper qty={qty} max={variantStock} onChange={setQty} compact />
              <Button
                size="sm"
                variant="outline"
                onClick={onAdd}
                disabled={!canOrder || added}
                className="h-10 shrink-0 px-3 text-xs font-semibold"
              >
                {added ? <Check className="h-4 w-4" /> : "Add"}
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={onBuy}
                disabled={!canOrder || buying}
                className="h-10 shrink-0 px-4 text-xs font-semibold"
              >
                {buying ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buy Now"}
              </Button>
            </div>
          </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
}
