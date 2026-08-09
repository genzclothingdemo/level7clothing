"use client";

import { useState } from "react";
import { Zap, Loader2 } from "lucide-react";
import { useCart } from "@/context/cart";
import { useSettings } from "@/context/settings";
import { Button } from "@/components/ui/button";
import { formatINR, whatsappLink, cn } from "@/lib/utils";
import type { ProductDTO, SelectedOption } from "@/lib/types";

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.297-.497.1-.198.05-.371-.025-.52-.074-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  );
}

/** Product-specific WhatsApp enquiry — not a generic message. */
export function WhatsAppProductButton({
  product,
  variant = "icon",
  options,
  className,
}: {
  product: ProductDTO;
  variant?: "icon" | "full" | "compact";
  options?: SelectedOption[];
  className?: string;
}) {
  const settings = useSettings();
  if (!settings.whatsapp) return null;

  const open = () => {
    const link = `${window.location.origin}/product/${product.slug}`;
    const optLines = (options ?? []).map((o) => `${o.name}: ${o.value}`);
    const msg = [
      `Hi ${settings.brandName}! I'm interested in this piece:`,
      ``,
      `✨ *${product.name}*`,
      ...optLines,
      `Price: ${formatINR(product.price)}`,
      `Category: ${product.category}`,
      link,
      ``,
      `Is it available? I'd love to know more.`,
    ].join("\n");
    window.open(whatsappLink(settings.whatsapp!, msg), "_blank");
  };

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={open}
        aria-label={`Ask about ${product.name} on WhatsApp`}
        title="Ask on WhatsApp"
        className={cn(
          "grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[#25D366]/40 text-[#1da851] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#25D366] hover:text-white hover:shadow-lg hover:shadow-[#25D366]/30 cursor-pointer",
          className
        )}
      >
        <WhatsAppIcon className="h-[18px] w-[18px]" />
      </button>
    );
  }

  // compact — slim outlined pill; designed to sit beside Buy Now in one row
  if (variant === "compact") {
    return (
      <button
        type="button"
        onClick={open}
        aria-label={`Ask about ${product.name} on WhatsApp`}
        className={cn(
          "inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full border border-[#25D366]/50 px-5 text-sm font-medium text-[#1da851] transition-all duration-200",
          "hover:border-[#25D366] hover:bg-[#25D366]/8 hover:shadow-sm hover:-translate-y-0.5",
          "active:scale-[0.97]",
          className
        )}
      >
        <WhatsAppIcon className="h-4 w-4 shrink-0" />
        <span>WhatsApp</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      className={cn(
        "btn-shine inline-flex h-13 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-[#25D366] px-7 text-base font-medium text-white transition-all duration-200 hover:-translate-y-0.5 hover:opacity-95",
        className
      )}
    >
      <WhatsAppIcon className="h-5 w-5" />
      Ask about this piece on WhatsApp
    </button>
  );
}

/** Buy Now — adds the item and continues straight to checkout. */
export function BuyNowButton({
  product,
  qty = 1,
  size = "md",
  showPrice = false,
  className,
}: {
  product: ProductDTO;
  qty?: number;
  size?: "sm" | "md" | "lg";
  showPrice?: boolean;
  className?: string;
}) {
  const { buyNow, leadInfo } = useCart();
  const [loading, setLoading] = useState(false);
  if (product.stock <= 0) return null;

  function go() {
    // Only show the spinner when we'll navigate immediately (contact known);
    // otherwise the mini sign-up modal opens first.
    if (leadInfo) setLoading(true);
    buyNow(
      {
        productId: product.id,
        slug: product.slug,
        name: product.name,
        image: product.images[0] ?? "",
        price: product.price,
        stock: product.stock,
      },
      qty
    );
  }

  return (
    <Button
      type="button"
      variant="gold"
      size={size}
      onClick={go}
      disabled={loading}
      className={className}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Zap className="h-4 w-4" />
      )}
      Buy now{showPrice ? ` · ${formatINR(product.price * qty)}` : ""}
    </Button>
  );
}
