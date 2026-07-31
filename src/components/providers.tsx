"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { CartProvider } from "@/context/cart";
import { SettingsProvider } from "@/context/settings";
import { WishlistProvider } from "@/context/wishlist";
import type { SettingsDTO } from "@/lib/types";

export function Providers({
  settings,
  initialLead,
  children,
}: {
  settings: SettingsDTO;
  initialLead?: { name: string; phone: string } | null;
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
          <WishlistProvider>
            {children}
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
          </WishlistProvider>
        </CartProvider>
      </SettingsProvider>
    </ThemeProvider>
  );
}
