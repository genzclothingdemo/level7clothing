import Image from "next/image";
import Link from "next/link";
import { Eye, SlidersHorizontal, ArrowRight } from "lucide-react";
import { formatINR } from "@/lib/utils";
import type { ProductDTO } from "@/lib/types";
import { ButtonLink } from "@/components/ui/button";
import { AddToCartButton } from "./add-to-cart";
import { BuyNowButton, WhatsAppProductButton } from "./product-actions";
import { WishlistButton } from "./wishlist-button";
import { LinkPendingOverlay, LinkPendingDot } from "./link-pending";

export function ProductCard({ product }: { product: ProductDTO }) {
  const discount =
    product.compareAtPrice && product.compareAtPrice > product.price
      ? Math.round(
          ((product.compareAtPrice - product.price) / product.compareAtPrice) *
            100
        )
      : 0;

  return (
    <div className="group flex flex-col">
      <div className="relative">
      {/* Wishlist sits outside the Link so saving never navigates. */}
      <div className="absolute right-2 top-2 z-10 sm:right-3 sm:top-3">
        <WishlistButton slug={product.slug} name={product.name} />
      </div>
      <Link
        href={`/product/${product.slug}`}
        className="card-lift relative block aspect-[4/5] overflow-hidden rounded-lg bg-muted"
      >
        {product.images[0] ? (
          <>
            <Image
              src={product.images[0]}
              alt={product.name}
              fill
              sizes="(max-width: 768px) 50vw, 25vw"
              className="object-cover transition-transform duration-700 ease-out group-hover:scale-110"
            />
            {/* Crossfade to the second photo on hover (if one exists) */}
            {product.images[1] && (
              <Image
                src={product.images[1]}
                alt={`${product.name} — alternate view`}
                fill
                sizes="(max-width: 768px) 50vw, 25vw"
                className="object-cover opacity-0 transition-all duration-700 ease-out group-hover:scale-110 group-hover:opacity-100"
              />
            )}
            {/* Soft sheen on hover */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
          </>
        ) : (
          <div className="absolute inset-0 grid place-items-center text-muted-foreground text-sm">
            No image
          </div>
        )}

        {discount > 0 && (
          <span className="absolute left-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-accent-foreground shadow-md sm:left-3 sm:top-3 sm:px-2.5 sm:py-1 sm:text-xs">
            −{discount}%
          </span>
        )}
        {product.stock <= 0 && (
          <span className="absolute left-2 bottom-2 rounded-full bg-foreground/85 px-2 py-0.5 text-[10px] font-medium text-background backdrop-blur sm:left-3 sm:bottom-3 sm:px-2.5 sm:py-1 sm:text-xs">
            Sold out
          </span>
        )}
        {product.stock > 0 && product.stock <= 5 && (
          <span className="absolute left-2 bottom-2 rounded-full bg-card/90 px-2 py-0.5 text-[10px] font-medium text-danger shadow-sm backdrop-blur sm:left-3 sm:bottom-3 sm:px-2.5 sm:py-1 sm:text-[11px]">
            Only {product.stock} left
          </span>
        )}

        {/* Quick view pill slides up on hover (pointer devices only) */}
        <span className="absolute inset-x-3 bottom-3 hidden translate-y-3 items-center justify-center gap-1.5 rounded-full bg-card/90 py-2 text-xs font-medium opacity-0 shadow-lg backdrop-blur transition-all duration-500 group-hover:translate-y-0 group-hover:opacity-100 sm:flex">
          <Eye className="h-3.5 w-3.5" /> Quick view
        </span>

        {/* Acknowledges the click immediately while the page is fetched. */}
        <LinkPendingOverlay />
      </Link>
      </div>

      <div className="mt-2.5 flex flex-1 flex-col sm:mt-4">
        <p className="truncate text-[10px] uppercase tracking-widest gold-text sm:text-[11px]">
          {product.category}
        </p>
        <Link
          href={`/product/${product.slug}`}
          className="mt-0.5 line-clamp-2 font-serif text-sm leading-snug transition-colors hover:text-accent sm:mt-1 sm:text-lg"
        >
          {product.name}
          <LinkPendingDot />
        </Link>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 sm:mt-2">
          <span className="text-sm font-semibold sm:text-base">
            {formatINR(product.price)}
          </span>
          {discount > 0 && (
            <span className="text-xs text-muted-foreground line-through sm:text-sm">
              {formatINR(product.compareAtPrice!)}
            </span>
          )}
        </div>

        {/* Compact single action on mobile; full controls on larger screens */}
        <div className="mt-2.5 sm:mt-4">
          {product.options.length > 0 ? (
            <>
              <ButtonLink
                href={`/product/${product.slug}`}
                variant="outline"
                size="sm"
                className="w-full sm:hidden"
              >
                <SlidersHorizontal className="h-4 w-4" /> Options
              </ButtonLink>
              <div className="hidden gap-2 sm:flex">
                <ButtonLink
                  href={`/product/${product.slug}`}
                  variant="outline"
                  className="flex-1"
                >
                  <SlidersHorizontal className="h-4 w-4" /> Choose options
                  <ArrowRight className="h-4 w-4" />
                </ButtonLink>
                <WhatsAppProductButton product={product} variant="icon" />
              </div>
            </>
          ) : (
            <>
              <AddToCartButton
                product={product}
                size="sm"
                compact
                className="w-full sm:hidden"
              />
              <div className="hidden space-y-2 sm:block">
                <div className="flex gap-2">
                  <AddToCartButton product={product} className="flex-1" />
                  <WhatsAppProductButton product={product} variant="icon" />
                </div>
                <BuyNowButton product={product} className="w-full" />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
