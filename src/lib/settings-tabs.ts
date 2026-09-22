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
 * ## Why these seven
 *
 * Settings is now the **single home for settings** — the order pipeline and the
 * return policy both moved in from the screens that used to own them, because
 * the owner went looking for auto-confirm here twice and it was on the Orders
 * page. That would have made nine tabs, and nine tabs on a 375px screen is a
 * swipe, not a menu. So they are grouped by the errand instead of by the
 * schema, and two pairs merged:
 *
 *   Brand + Contact          → **Store**       (who you are)
 *   Copy + Product defaults  → **Storefront**  (what it says)
 *
 * and the order is by how often the owner touches them. **Store** stays first
 * because the sidebar calls this screen "Branding & settings" and landing
 * somewhere else would not match the door you came through; **Orders** is
 * second, because it is the one people go hunting for.
 *
 * Inside each tab the same rule applies one level down: what changes weekly is
 * on top, what is set once is behind a `Disclosure`, and every long explanation
 * is behind an `(i)` rather than in a paragraph.
 *
 * Renaming `brand`/`copy`/`contact`/`product` changes their `?tab=` values.
 * `isTabKey` rejects the old ones and `DEFAULT_TAB` catches them, so a stale
 * bookmark opens Store rather than an empty panel.
 */
export const TABS = [
  { key: "store", label: "Store", heading: "Brand, contact & social" },
  { key: "orders", label: "Orders", heading: "Order automation" },
  { key: "payments", label: "Payments", heading: "Payments" },
  { key: "shipping", label: "Shipping", heading: "Shipping & fulfilment" },
  { key: "returns", label: "Returns", heading: "Returns & refunds" },
  {
    key: "storefront",
    label: "Storefront",
    heading: "Storefront copy & product defaults",
  },
  { key: "email", label: "Email", heading: "Notifications & email" },
] as const;

export type TabKey = (typeof TABS)[number]["key"];

export const DEFAULT_TAB: TabKey = "store";

export function isTabKey(v: string | undefined): v is TabKey {
  return TABS.some((t) => t.key === v);
}
