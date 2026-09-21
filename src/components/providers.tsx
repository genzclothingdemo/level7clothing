"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { CartProvider } from "@/context/cart";
import { WishlistProvider } from "@/context/wishlist";
import { SettingsProvider, type ClientSettings } from "@/context/settings";

export function Providers({
  settings,
  initialLead,
  wishlist,
  children,
}: {
  settings: ClientSettings;
  initialLead?: { name: string; phone: string } | null;
  /**
   * Server-rendered wishlist for a signed-in customer, so their saved hearts
   * are correct on first paint rather than popping in after a fetch.
   */
  wishlist?: { signedIn: boolean; slugs: string[] };
  children: React.ReactNode;
}) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
    >
      <SettingsProvider value={settings}>
        <CartProvider initialLead={initialLead}>
          {/* WishlistProvider was missing from the tree entirely, so every
              `useWishlist()` call threw — which took out the whole /wishlist
              page, not just the save button. */}
          <WishlistProvider
            signedIn={wishlist?.signedIn ?? false}
            initialSlugs={wishlist?.slugs ?? []}
          >
            {children}
          </WishlistProvider>
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: "var(--card)",
                color: "var(--foreground)",
                border: "1px solid var(--border)",
              },
            }}
          />
        </CartProvider>
      </SettingsProvider>
    </ThemeProvider>
  );
}
