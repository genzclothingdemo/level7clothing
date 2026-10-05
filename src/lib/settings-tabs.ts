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
 * schema, and the pairs merged:
 *
 *   Brand + Contact          → **Store**  (who you are)
 *   Copy + Product defaults  → **Store**  (what it says)
 *   Your own alert address   → **Alerts** (where it writes to you)
 *
 * and the order is by how often the owner touches them. **Store** stays first
 * because the sidebar calls this screen "Branding & settings" and landing
 * somewhere else would not match the door you came through; **Orders** is
 * second, because it is the one people go hunting for.
 *
 * ## Store, Storefront and Email are one tab
 *
 * They were three, and the split never survived contact with the errand. All
 * three answer the same question — *what is this shop called and what does it
 * say* — and the owner asked for them folded together. Concretely: the brand
 * name and the hero headline are both "the words at the top of the home page".
 *
 * Nothing was dropped. Every control moved across, and the set-once ones are
 * behind the same `SetOnce` folds they already used, so the merged tab is five
 * closed rows and two open cards rather than three tabs' worth of fields.
 *
 * `TAB_ALIASES` keeps the two retired `?tab=` values working — see below.
 *
 * ## …and the alert address then moved out again, on purpose
 *
 * The admin alert address sat here because it only makes sense read next to
 * the public contact email. It is now edited on **Alerts**, where the rest of
 * the sending identity lives, and there is exactly one input for it — a second
 * editable copy of a column is how `defaultReturnsInfo` lost an update
 * silently. Store used to keep a read-only copy of it (and of the sender and
 * the alert count) "so the pair could be read side by side"; that copy is gone
 * too. The owner reads a restated value as duplication, so Store *links* to
 * Alerts instead, and the same-inbox warning lives on Alerts beside the input.
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
    blurb: "The shop's name, what it says, and how people reach you",
    guide:
      "Everything here is read from the database when a page renders — the brand name in the header, the browser tab, order emails, the sitemap and the home-screen icon all come from this tab, and none of it is hardcoded. The announcement bar and the hero are open because they change for a sale; the rest is set once and folded, with a summary on each closed row. The contact email is the public one: printed in the footer, and the address customers' replies come back to. Your own alert inbox is not on this tab — it is on Alerts.",
  },
  {
    key: "orders",
    label: "Orders",
    heading: "Order automation",
    blurb: "What happens to a new order without you",
    guide:
      "Two decisions, in order: when a new order stops being a request and becomes work (confirmation), and how far a confirmed order then travels towards the courier on its own. Both default to the cautious answer — a human confirms, and nothing charges your courier wallet unattended. Every order can still be confirmed and dispatched by hand from the orders screen, whatever is set here.",
  },
  {
    // Third, between the two tabs it is about. Everything here used to be in
    // four places — the OTP switches on Store, the alert address on Store, the
    // sending identity nowhere at all, and the on/off for every message on
    // Admin → Automation — which is why the owner asked for it centralised.
    key: "alerts",
    label: "Alerts",
    heading: "Alerts & notifications",
    blurb: "Who gets told what, and how it reaches them",
    guide:
      "One grid: every event this store can announce, who it goes to, and which channel carries it. A tick here is the same rule Admin → Automation lists — this is the short way to switch one on or off, and that screen is where its wording and timing live. Above the grid is everything about sending itself: the address mail comes from, whether that domain can actually deliver, where replies land, and where your own alerts go. Underneath it are the codes the store asks people for before it trusts an address or a number, because a channel is only as good as the contact detail behind it.",
  },
  {
    key: "payments",
    label: "Payments",
    heading: "Payments & charges",
    blurb: "How customers pay, and what checkout adds",
    guide:
      "Three ways to pay — cash on delivery, part now and the rest on delivery, or the whole thing online — and the charges that sit on top of the basket. A method appears at checkout only when its switch here, Razorpay (for the two online methods) and the products in the basket all agree. Turning the last one off is refused: checkout would have nothing to offer, and there is no fallback mode for it to drop into.",
  },
  {
    key: "integrations",
    label: "Integrations",
    heading: "Connected services",
    blurb: "Razorpay and NimbusPost, and whether each is live",
    guide:
      "Razorpay takes the money and NimbusPost carries the parcel. Each has a master switch here and a key pair in the deployment's environment: the switch decides whether the store uses the service, the keys decide whether it can. Keys are never shown on this screen — only whether they are present — because a secret rendered into a page is a secret that can be read from it.",
  },
  {
    key: "returns",
    label: "Returns",
    heading: "Returns & refunds",
    blurb: "Whether pieces can come back, and on what terms",
    guide:
      "The return window, the reasons a customer may pick, and how a refund is worked out. This tab is the one owner of those settings — Admin → Returns shows the same policy read-only and links here — and it saves on its own, with the Save policy button at the end, not with the bar the other tabs share.",
  },
  {
    // The key IS the `?tab=` value and is deliberately `add_admin` rather than
    // `access`: it is what the brief named, and a tab key is a URL people
    // bookmark. Last in the row because it is the tab opened least — once when
    // someone is hired, once when they leave.
    key: "add_admin",
    label: "Access",
    // Names the log as well as the people: the owner asked where the log of a
    // temporary admin shows, on a tab whose heading only mentioned admins.
    heading: "Access & activity",
    blurb: "Who else can sign in, and everything they did",
    guide:
      "Give someone their own sign-in to this admin, for as long as you want them to have it. View only lets them open every screen and change nothing — the server enforces that on every save, not by hiding buttons, so it holds even for someone who knows how the site is built. Full access is the same as your own. Switch someone off or delete them and they stop on their very next click. Every sign-in, saved change and refused attempt they make is written to the Activity log on this tab; deleting a person deletes their lines with them.",
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
