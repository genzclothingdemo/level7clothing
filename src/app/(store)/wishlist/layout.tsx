import type { Metadata } from "next";

/**
 * Wishlist is a client component and cannot export `metadata`.
 *
 * This route was previously the one private surface with neither a robots.txt
 * rule nor a meta directive, so it inherited `index: true` from the root
 * layout and was fully indexable.
 */
export const metadata: Metadata = {
  title: "Your wishlist",
  robots: { index: false, follow: true },
};

export default function WishlistLayout({ children }: { children: React.ReactNode }) {
  return children;
}
