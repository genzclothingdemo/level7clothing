"use client";

import { createContext, useContext } from "react";
import type { SettingsDTO } from "@/lib/types";

/**
 * The client-visible slice of the store settings. The product-page default copy
 * is resolved on the server (see resolveProductInfo) and never read from a client
 * component, so it's excluded here rather than serialised into the RSC payload of
 * every page.
 */
export type ClientSettings = Omit<
  SettingsDTO,
  "defaultMaterialsCare" | "defaultShippingInfo" | "defaultReturnsInfo"
>;

const SettingsContext = createContext<ClientSettings | null>(null);

export function SettingsProvider({
  value,
  children,
}: {
  value: ClientSettings;
  children: React.ReactNode;
}) {
  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): ClientSettings {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
