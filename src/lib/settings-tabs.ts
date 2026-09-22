/**
 * The Settings tab list, shared by the server page and the client form.
 *
 * This lives in `lib/` and NOT in `settings-ui.tsx` because that file is
 * `"use client"`. Everything exported from a client module becomes a client
 * reference, so calling `isTabKey()` from the server page threw:
 *
 *   "Attempted to call isTabKey() from the server but isTabKey is on the
 *    client. It's not possible to invoke a client function from the server."
 *
 * That took out /admin/settings in production. A plain module with no
 * directive can be imported from both sides, which is what a shared constant
 * and a type guard actually need.
 *
 * Grouped by errand rather than by schema column order: "rename the brand",
 * "change the COD switch" and "rewrite the hero" are three different jobs and
 * should not be three scroll positions in one form.
 */
export const TABS = [
  { key: "brand", label: "Brand", heading: "Brand & identity" },
  { key: "contact", label: "Contact", heading: "Contact & social" },
  { key: "copy", label: "Copy", heading: "Storefront copy" },
  { key: "payments", label: "Payments", heading: "Payments" },
  { key: "shipping", label: "Shipping", heading: "Shipping & fulfilment" },
  { key: "product", label: "Products", heading: "Product defaults" },
  { key: "email", label: "Email", heading: "Notifications & email" },
] as const;

export type TabKey = (typeof TABS)[number]["key"];

export const DEFAULT_TAB: TabKey = "brand";

export function isTabKey(v: string | undefined): v is TabKey {
  return TABS.some((t) => t.key === v);
}
