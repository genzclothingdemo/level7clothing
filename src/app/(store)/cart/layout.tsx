import type { Metadata } from "next";

/**
 * The cart page is a client component, so it cannot export `metadata` itself.
 * This layout exists purely to attach it.
 *
 * `noindex` because a cart is per-shopper and has no standalone value in search
 * results. robots.txt also disallows /cart; the directive here is the backstop
 * for crawlers that reach the URL from a link rather than a crawl.
 */
export const metadata: Metadata = {
  title: "Your cart",
  robots: { index: false, follow: true },
};

export default function CartLayout({ children }: { children: React.ReactNode }) {
  return children;
}
