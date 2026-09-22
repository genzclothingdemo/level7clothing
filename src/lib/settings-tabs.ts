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
/**
 * Every tab states, in one printed line, what it is for.
 *
 * `blurb` is a **purpose**, not a description of the controls: an owner
 * arriving at Settings is not asking "what fields are on this tab", they are
 * asking "which tab do I open to stop offering cash on delivery". Seven such
 * lines are the whole table of contents, which is what was missing — the tab
 * bar gave seven nouns and no way to choose between them.
 *
 * `guide` is the long version, and it is never printed: the panel heading wears
 * it behind an `(i)`, the same rule as everywhere else on this screen.
 */
export const TABS = [
  {
    key: "store",
    label: "Store",
    heading: "Brand, contact & social",
    blurb: "Your name, logo and how customers reach you",
    guide:
      "Identity and contact details. Everything here is read from the database at render time — the brand name in the header, the browser tab, order emails, the sitemap and the home-screen icon all come from this tab, and none of it is hardcoded anywhere. The announcement bar is on top because it is the one thing here that changes for a sale; the rest is set once.",
  },
  {
    key: "orders",
    label: "Orders",
    heading: "Order automation",
    blurb: "What happens to an order without you",
    guide:
      "Two decisions, in order: when a new order stops being a request and becomes work (confirmation), and how far a confirmed order then travels towards the courier on its own. Both default to the cautious answer — a human confirms, and nothing charges your courier wallet unattended. This is the tab people go hunting for, which is why it is second.",
  },
  {
    key: "payments",
    label: "Payments",
    heading: "Payments",
    blurb: "How customers are allowed to pay",
    guide:
      "Which methods checkout offers, and whether the online gateway is live at all. A method appears only when three things agree: its switch here, the gateway (for the two online methods) and the product's own allowed methods. Turning all four off is refused by the server — it would not close checkout, it would silently turn every order into a pay-the-owner request.",
  },
  {
    key: "shipping",
    label: "Shipping",
    heading: "Shipping & fulfilment",
    blurb: "What delivery costs, and who carries it",
    guide:
      "The store-wide free-shipping threshold and the NimbusPost connection. Per-product shipping rules and parcel dimensions are not here — they live on each product, because a hoodie and a tee are different parcels. Whether a confirmed order reaches the courier by itself is the Orders tab, not this one.",
  },
  {
    key: "returns",
    label: "Returns",
    heading: "Returns & refunds",
    blurb: "Whether pieces can come back, and on what terms",
    guide:
      "The return window, the reasons a customer may pick, and how a refund is worked out. This is the one owner of those columns: Admin → Returns shows the same policy read-only and links here. Everything on this tab has its own Save, separate from the bar at the foot of the screen.",
  },
  {
    key: "storefront",
    label: "Storefront",
    heading: "Storefront copy & product defaults",
    blurb: "The words on the home and product pages",
    guide:
      "Copy, not rules. The hero is the first screen a visitor sees and its headline is the page's H1, so it is also what search engines read as the subject of the site. The product-page accordion text set here is inherited by the whole catalogue; a product only needs its own version when it genuinely differs.",
  },
  {
    key: "email",
    label: "Email",
    heading: "Notifications & email",
    blurb: "Where the store writes to you",
    guide:
      "Your own alerts — a new order, an enquiry, an interested customer. Deliberately separate from the public contact email, which is what customers see and where their replies land. Push notifications and the newsletter are not settings but messages you compose, so each has its own screen.",
  },
] as const;

export type TabKey = (typeof TABS)[number]["key"];

export type SettingsTab = (typeof TABS)[number];

export const DEFAULT_TAB: TabKey = "store";

export function isTabKey(v: string | undefined): v is TabKey {
  return TABS.some((t) => t.key === v);
}

/** The whole row for a tab. Never `undefined` — `TabKey` guarantees a hit. */
export function tabMeta(key: TabKey): SettingsTab {
  return TABS.find((t) => t.key === key) ?? TABS[0];
}
