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
 * ## Why these five
 *
 * Settings is now the **single home for settings** — the order pipeline and the
 * return policy both moved in from the screens that used to own them, because
 * the owner went looking for auto-confirm here twice and it was on the Orders
 * page. That would have made nine tabs, and nine tabs on a 375px screen is a
 * swipe, not a menu. So they are grouped by the errand instead of by the
 * schema, and the pairs merged:
 *
 *   Brand + Contact          → **Store**  (who you are)
 *   Copy + Product defaults  → **Store**  (what it says)
 *   Your own alert address   → **Store**  (where it writes to you)
 *
 * and the order is by how often the owner touches them. **Store** stays first
 * because the sidebar calls this screen "Branding & settings" and landing
 * somewhere else would not match the door you came through; **Orders** is
 * second, because it is the one people go hunting for.
 *
 * ## Store, Storefront and Email are one tab
 *
 * They were three, and the split never survived contact with the errand. All
 * three answer the same question — *what is this shop called, what does it say,
 * and where does it write* — and the owner asked for them folded together.
 * Concretely: the brand name and the hero headline are both "the words at the
 * top of the home page", and the public contact email (Store) and the admin
 * alert address (Email) are two fields that only make sense read side by side,
 * because the whole point of the second one is that it is *not* the first.
 * Being on different tabs is what made that hard to check.
 *
 * Nothing was dropped. Every control moved across, and the set-once ones are
 * behind the same `SetOnce` folds they already used, so the merged tab is five
 * closed rows and two open cards rather than three tabs' worth of fields.
 *
 * `TAB_ALIASES` keeps the two retired `?tab=` values working — see below.
 *
 * ## Shipping is gone, and Integrations replaced it
 *
 * There used to be a **Shipping** tab. By the end it held two controls: a
 * free-shipping threshold and the NimbusPost master switch. Everything that
 * makes a parcel a parcel — the per-product rule, the weight, the box — lives
 * on the product, and whether a confirmed order reaches the courier is the
 * Orders tab. A tab with one number and one switch, neither of which is about
 * the same thing as the other, is a tab you open by mistake.
 *
 * So the switch moved to **Integrations**, beside Razorpay, where it belongs:
 * both are outside services with a master switch and a key pair, and the owner
 * asking "is the courier connected?" is asking the same question as "is the
 * gateway connected?". The threshold moved to **Payments**, because free
 * shipping over ₹X is a checkout charge — the mirror image of the cash-handling
 * fee it now sits next to. One adds to the basket, one takes away.
 *
 * Integrations shows **whether** a key pair is configured and never the value.
 * The keys are environment variables and are not editable here at all, which is
 * the strongest form of that rule: there is no input to leak from.
 *
 * Inside each tab the same rule applies one level down: what changes weekly is
 * on top, what is set once is behind a `Disclosure`, and every long explanation
 * is behind an `(i)` rather than in a paragraph.
 *
 * A tab key IS its `?tab=` value, so removing or renaming one breaks every
 * bookmark holding the old string. `resolveTab()` is the single answer to that:
 * live key → itself, retired key → `TAB_ALIASES`, anything else → `DEFAULT_TAB`.
 * A stale bookmark opens a real tab rather than an empty panel, and never 404s.
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
    heading: "Brand, copy & contact",
    blurb: "What the shop is called, what it says, and where it writes",
    guide:
      "Identity, the words on the storefront, and the two email addresses. Everything here is read from the database at render time — the brand name in the header, the browser tab, order emails, the sitemap and the home-screen icon all come from this tab, and none of it is hardcoded anywhere. The announcement bar and the hero are on top because they are what changes for a sale; the rest is set once and folded away. The two addresses are deliberately together: the contact email is public and is where customers reply, the alert address is private and is where the store writes to you.",
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
    heading: "Payments & charges",
    blurb: "How customers pay, and what checkout adds",
    guide:
      "Three ways to pay — cash on delivery, part now and the rest on delivery, or the whole thing online — and the charges that sit on top of the basket. A method appears at checkout only when its switch here, the gateway (for the two that need it) and the product's own allowed methods all agree. Turning the last one off is refused: checkout would have nothing to offer, and there is no fallback mode for it to drop into.",
  },
  {
    key: "integrations",
    label: "Integrations",
    heading: "Connected services",
    blurb: "The two outside services, and whether they are live",
    guide:
      "Razorpay takes the money and NimbusPost carries the parcel. Each has a master switch here and a key pair set in the deployment's environment; the switch decides whether the store uses the service, the keys decide whether it can. Keys are never shown on this screen — only whether they are present — because a secret rendered into a page is a secret that can be read from the page.",
  },
  {
    key: "returns",
    label: "Returns",
    heading: "Returns & refunds",
    blurb: "Whether pieces can come back, and on what terms",
    guide:
      "The return window, the reasons a customer may pick, and how a refund is worked out. This is the one owner of those columns: Admin → Returns shows the same policy read-only and links here. Everything on this tab has its own Save, separate from the bar at the foot of the screen.",
  },
] as const;

export type TabKey = (typeof TABS)[number]["key"];

export type SettingsTab = (typeof TABS)[number];

export const DEFAULT_TAB: TabKey = "store";

/**
 * Retired `?tab=` values, and where they went.
 *
 * `storefront` and `email` were folded into `store`. Both would already have
 * landed there by accident — `isTabKey` rejects them and `DEFAULT_TAB` catches
 * the rejection — but "by accident" is a fallback that breaks silently the day
 * someone reorders `TABS` and the default stops being `store`. Stating the
 * redirect makes it a decision instead: a bookmark saved at Storefront opens
 * the tab that now holds the storefront copy, and it keeps doing so whatever
 * happens to the default.
 *
 * `brand`, `copy`, `contact`, `product` and `shipping` are deliberately NOT
 * here. Those were renamed or dismantled long enough ago that nothing points
 * at them, and an alias for a value nobody holds is a row to maintain forever.
 * They fall through to `DEFAULT_TAB`, which is the right answer for a stale
 * bookmark whose section no longer exists in any form.
 */
export const TAB_ALIASES: Readonly<Record<string, TabKey>> = {
  storefront: "store",
  email: "store",
};

export function isTabKey(v: string | undefined): v is TabKey {
  return TABS.some((t) => t.key === v);
}

/**
 * Any `?tab=` value → the tab to open. Never throws, never 404s.
 *
 * Three cases, in order: a live key opens itself, a retired key opens whatever
 * absorbed it, and anything else — a typo, a deleted section, a hand-edited URL
 * — opens the default. The server page and the client form both call this, so
 * the first paint and the tab state can never disagree about where a stale link
 * lands.
 */
export function resolveTab(v: string | null | undefined): TabKey {
  if (isTabKey(v ?? undefined)) return v as TabKey;
  return (v && TAB_ALIASES[v]) || DEFAULT_TAB;
}

/** The whole row for a tab. Never `undefined` — `TabKey` guarantees a hit. */
export function tabMeta(key: TabKey): SettingsTab {
  return TABS.find((t) => t.key === key) ?? TABS[0];
}
