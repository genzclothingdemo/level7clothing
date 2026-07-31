"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ShoppingBag, Minus, Plus, Check, Zap, Loader2 } from "lucide-react";
import { useCart } from "@/context/cart";
import { useProductView } from "@/context/product-view";
import { Button } from "@/components/ui/button";
import { WhatsAppProductButton } from "@/components/store/product-actions";
import { SizeGuideModal } from "@/components/store/size-guide-modal";
import { WishlistButton } from "@/components/store/wishlist-button";
import { formatINR } from "@/lib/utils";
import {
  normalizeVariants,
  isChoiceEnabled,
  pruneSelection,
  effectiveVariant,
  minMatchingPrice,
  toSelectedOptions,
  getDefaultSelection,
} from "@/lib/variants";
import type { ProductDTO } from "@/lib/types";

export function ProductPurchase({ product }: { product: ProductDTO }) {
  const { addItem, buyNow, leadInfo } = useCart();
  const { selection, setSelection } = useProductView();

  const variants = useMemo(() => normalizeVariants(product), [product]);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [buying, setBuying] = useState(false);

  // Auto-set the first choice of each option group as default
  useEffect(() => {
    if (product.options && product.options.length > 0) {
      const def = getDefaultSelection(product.options, variants);
      setSelection(def);
    }
  }, [product, variants, setSelection]);

  const hasOptions = product.options.length > 0;
  const variant = effectiveVariant(product, selection);
  const minPrice = minMatchingPrice(product, selection);
  const unitPrice = variant ? variant.price : minPrice;

  const noVariantAvailable =
    variants.length > 0 && !variants.some((v) => v.available);
  const soldOut = product.stock <= 0 || noVariantAvailable;
  // With variants, a specific one must be pinned down before ordering.
  const needsChoice = variants.length > 0 && !variant;
  const canOrder = !soldOut && !needsChoice;

  function toggle(groupName: string, value: string) {
    // Already selected — do nothing (no deselection allowed).
    if (selection[groupName] === value) return;
    if (!isChoiceEnabled(variants, product.options, groupName, value, selection))
      return;
    // Set the choice, then drop any now-incompatible later options.
    setSelection(
      pruneSelection(variants, product.options, {
        ...selection,
        [groupName]: value,
      })
    );
  }

  function buildItem() {
    // Prefer the pinned variant's exact combo/photo/price.
    const combo = variant ? variant.combo : selection;
    return {
      productId: product.id,
      slug: product.slug,
      name: product.name,
      image: variant?.images[0] ?? product.images[0] ?? "",
      price: unitPrice,
      stock: product.stock,
      options: Object.keys(combo).length ? toSelectedOptions(combo) : undefined,
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
      {/* Options — checkbox-style boxes */}
      {product.options.map((group) => (
        <div key={group.name}>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium">
              {group.name}
              <span className="ml-2 font-normal text-muted-foreground">
                {selection[group.name] ?? "Any"}
              </span>
            </p>
            {/^size$/i.test(group.name) && (
              <SizeGuideModal category={product.category} />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {group.choices.map((choice) => {
              const isActive = selection[group.name] === choice.label;
              const enabled =
                isActive ||
                isChoiceEnabled(
                  variants,
                  product.options,
                  group.name,
                  choice.label,
                  selection
                );
              return (
                <motion.button
                  key={choice.label}
                  type="button"
                  disabled={!enabled}
                  whileTap={enabled ? { scale: 0.94 } : undefined}
                  onClick={() => toggle(group.name, choice.label)}
                  className={`relative flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm transition-colors ${
                    isActive
                      ? "border-accent bg-accent/10 text-foreground"
                      : enabled
                        ? "border-border hover:border-foreground/40"
                        : "cursor-not-allowed border-dashed border-border text-muted-foreground/50"
                  }`}
                  title={
                    !enabled ? "Not available in this combination" : undefined
                  }
                >
                  <span
                    className={`grid h-4 w-4 place-items-center rounded border ${
                      isActive
                        ? "border-accent bg-accent text-accent-foreground"
                        : "border-muted-foreground/40"
                    }`}
                  >
                    {isActive && <Check className="h-3 w-3" />}
                  </span>
                  <span className={!enabled ? "line-through" : ""}>
                    {choice.label}
                  </span>
                </motion.button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Live price — "From" until a single variant is pinned down */}
      {hasOptions && (
        <div className="flex items-baseline gap-2">
          <span className="text-sm text-muted-foreground">
            {variant ? "Your selection:" : "From"}
          </span>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={`${unitPrice}-${!!variant}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="text-xl font-semibold"
            >
              {formatINR(unitPrice)}
            </motion.span>
          </AnimatePresence>
        </div>
      )}

      {/* Quantity + Add / Buy */}
      {soldOut ? (
        <Button variant="outline" disabled className="w-full" size="lg">
          {noVariantAvailable ? "Out of stock" : "Sold out"}
        </Button>
      ) : (
        <div className="space-y-3">
          {needsChoice && (
            <p className="text-sm text-muted-foreground">
              Please choose an option to continue.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex h-12 items-center rounded-full border border-border">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="grid h-12 w-12 cursor-pointer place-items-center rounded-l-full hover:bg-muted"
                aria-label="Decrease quantity"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-10 text-center text-sm tabular-nums">{qty}</span>
              <button
                type="button"
                onClick={() => setQty((q) => Math.min(product.stock, q + 1))}
                className="grid h-12 w-12 cursor-pointer place-items-center rounded-r-full hover:bg-muted"
                aria-label="Increase quantity"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <Button
              onClick={onAdd}
              size="lg"
              className="min-w-[10rem] flex-1"
              disabled={needsChoice}
            >
              {added ? (
                <>
                  <Check className="h-4 w-4" /> Added
                </>
              ) : (
                <>
                  <ShoppingBag className="h-4 w-4" /> Add to cart
                </>
              )}
            </Button>
          </div>

          {/* Buy now + WhatsApp — always a single row */}
          <div className="flex items-center gap-2.5">
            <Button
              onClick={onBuy}
              variant="gold"
              size="lg"
              disabled={buying || needsChoice}
              className="flex-1 min-w-0"
            >
              {buying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
              Buy now · {formatINR(unitPrice * qty)}
            </Button>
            <WishlistButton
              slug={product.slug}
              name={product.name}
              variant="inline"
              className="shrink-0"
            />
            <WhatsAppProductButton
              product={product}
              variant="compact"
              options={toSelectedOptions(variant ? variant.combo : selection)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
