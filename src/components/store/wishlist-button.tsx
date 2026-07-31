"use client";

import { Heart } from "lucide-react";
import { useWishlist } from "@/context/wishlist";
import { cn } from "@/lib/utils";

export function WishlistButton({
  slug,
  name,
  variant = "overlay",
  className,
}: {
  slug: string;
  name: string;
  variant?: "overlay" | "inline";
  className?: string;
}) {
  const { has, toggle } = useWishlist();
  const saved = has(slug);

  return (
    <button
      type="button"
      onClick={(e) => {
        // Product cards wrap the image in a <Link> — don't navigate on save.
        e.preventDefault();
        e.stopPropagation();
        toggle(slug, name);
      }}
      aria-label={saved ? `Remove ${name} from wishlist` : `Save ${name} to wishlist`}
      aria-pressed={saved}
      title={saved ? "Saved — click to remove" : "Save for later"}
      className={cn(
        "grid place-items-center rounded-full transition-colors cursor-pointer",
        variant === "overlay"
          ? "h-8 w-8 bg-card/90 shadow-md backdrop-blur hover:bg-card"
          : "h-12 w-12 border border-border hover:bg-muted",
        className
      )}
    >
      <Heart
        className={cn(
          "transition-all",
          variant === "overlay" ? "h-4 w-4" : "h-5 w-5",
          saved ? "fill-accent text-accent scale-110" : "text-foreground/70"
        )}
      />
    </button>
  );
}
