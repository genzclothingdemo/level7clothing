import type { Metadata } from "next";

/**
 * Covers /account and every nested auth route (login, signup, forgot, reset),
 * all of which are client components that cannot declare their own metadata.
 *
 * Nested pages still override the title; only `robots` is inherited, which is
 * exactly what is wanted — none of these should ever appear in search.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return children;
}
