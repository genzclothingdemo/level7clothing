/**
 * Customers — the one place a *person* is assembled out of the six tables they
 * are scattered across.
 *
 * There is no `Customer` table, and deliberately so. A shopper can touch this
 * store as a `User`, as a guest `Order` with no `userId`, as a `Lead` who only
 * ever filled a cart, as a `ChatThread`, as a `ReturnRequest` hanging off an
 * order, and as `WishlistItem` rows. Adding a table would mean writing to it
 * from six places and living with the drift. Instead the record is *derived*,
 * here, once, and every screen reads it from this module.
 *
 * ── The identity rule ────────────────────────────────────────────────────────
 *
 * Every row contributes contact **tokens**:
 *
 *   `e:<lowercased email>`   `p:<digits, normalised to E.164-ish>`
 *
 * 1. Tokens that appear **together on one row** are joined — that is what makes
 *    a guest order and a later account with the same email one person, and what
 *    catches an email-less lead whose phone matches an order.
 * 2. A row carrying a `userId` is joined to that **account's** tokens, so an
 *    order placed from a signed-in session belongs to the account even when the
 *    shipping email differs from the login email. The account is the strongest
 *    identity there is.
 * 3. **Two registered accounts are never merged**, even when they share a phone
 *    (families do share one). The phone link is dropped rather than the two
 *    people being welded together; the account that claimed the number first —
 *    by `createdAt` — keeps it.
 * 4. The group's **canonical key** is its account email, else its lowest email,
 *    else its lowest phone. `id` is that key, base64url-encoded, because a URL
 *    is the only handle a table-less record can have.
 * 5. Lookup by `id` matches **any** token in the group, not just the canonical
 *    key — so a bookmarked link to a phone-only customer still resolves after
 *    they register and the key becomes their email.
 *
 * Rows with neither a usable email nor a usable phone (an anonymous cart lead,
 * a guest chat that never left a name) identify nobody and are counted, not
 * invented into customers. `getCustomers()` reports how many were skipped.
 *
 * ── Why it all happens in memory ─────────────────────────────────────────────
 *
 * Six `findMany` calls run in parallel and the grouping is done here. This
 * store has tens of customers and hundreds of orders, so the whole working set
 * is a few hundred kilobytes; the alternative — a query per customer — would be
 * an N+1 over a database that is one network hop away from the function and
 * pinned to `connection_limit=1`, i.e. N serialised round trips. If the store
 * ever reaches tens of thousands of people, page the *orders* query in SQL and
 * resolve one page at a time; the rule above does not change.
 */

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { fuzzyFilter } from "@/lib/search";
import { OPEN_RETURN_STATUSES } from "@/lib/returns";
import { formatINR, normalisePhone } from "@/lib/utils";
import type { BadgeTone } from "@/components/admin/order-ui";

/* ------------------------------------------------------------------ */
/*  Customer or guest                                                  */
/* ------------------------------------------------------------------ */

/**
 * The owner's split: *"customer me 2 part rakho — actual customer jisne login
 * kiya hai (iska id hai), and one is just interested type jo mini login se
 * contact diye … if guest do login then merge it to customer, remove from
 * guest"*.
 *
 * So there are exactly two groups, and the line between them is one question:
 * **is there a `User` row?**
 *
 * ── Why this is a presentation split and not a second identity rule ──────────
 *
 * This is the whole point of putting it here. `kind` is read off
 * `accounts.length` on a record the merge has already produced — it is not a
 * second pass over the tables and it never asks its own questions about email
 * or phone. That is what makes the owner's last sentence true *for free*:
 *
 *   a guest gives their email at add-to-cart  → a `Lead` with that email
 *   → no `User` → one record, `kind: "guest"`
 *
 *   that person signs up with the same email  → a `User` with that email
 *   → the token rule joins them into **one** bucket (rule 1 at the top of this
 *     file) → that bucket now has an account → `kind: "customer"`
 *
 * Nothing moves them; there was never a second row to move. The guest list is
 * `records.filter(r => r.kind === "guest")`, so they leave it in the same read
 * that puts them in the other one. Had this been a "guests = leads without a
 * matching user" query, the two lists would have had two different ideas of
 * who a person is, and the totals would have drifted the first time somebody
 * signed up with a differently-cased address.
 *
 * `splitCustomers()` below is the only partition. Both lists, both counts and
 * both empty states come from it.
 */
export const CUSTOMER_KINDS = ["customer", "guest"] as const;

export type CustomerKind = (typeof CUSTOMER_KINDS)[number];

export function isCustomerKind(v: string): v is CustomerKind {
  return (CUSTOMER_KINDS as readonly string[]).includes(v);
}

export const CUSTOMER_KIND_LABEL: Record<CustomerKind, string> = {
  customer: "Customers",
  guest: "Guests",
};

export const CUSTOMER_KIND_HELP: Record<CustomerKind, string> = {
  customer:
    "Has an account on the store. Anything they did before signing up — guest orders, carts, chats — is folded into the same record, matched on email then phone.",
  guest:
    "No account. We know them only from a contact detail they left: the mini sign-up at add-to-cart, a guest checkout, or a chat. The moment they sign up with the same email or phone they move to Customers and take their history with them.",
};

/** The one partition. Every count and every list on the screen uses it. */
export function splitCustomers(records: CustomerRecord[]): {
  customers: CustomerRecord[];
  guests: CustomerRecord[];
} {
  const customers: CustomerRecord[] = [];
  const guests: CustomerRecord[] = [];
  for (const r of records) (r.kind === "customer" ? customers : guests).push(r);
  return { customers, guests };
}

/* ------------------------------------------------------------------ */
/*  Status                                                             */
/* ------------------------------------------------------------------ */

/**
 * Derived on every read, never stored. A column would need writing from
 * checkout, signup, the lead capture and the chat resolver, and would be wrong
 * the moment any one of them was missed.
 *
 * Status is finer than `kind` and the two are not redundant: inside Customers
 * it separates the ones who have bought from the ones who only registered, and
 * inside Guests it separates a guest who checked out from one who only ever
 * filled a cart. Note that `registered` can only appear under Customers and
 * `interested` only under Guests — `ordered` is the one that appears in both,
 * which is exactly why the split is worth having.
 */
export const CUSTOMER_STATUSES = ["ordered", "registered", "interested"] as const;

export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export function isCustomerStatus(v: string): v is CustomerStatus {
  return (CUSTOMER_STATUSES as readonly string[]).includes(v);
}

export const CUSTOMER_STATUS_LABEL: Record<CustomerStatus, string> = {
  ordered: "Ordered",
  registered: "Registered",
  interested: "Interested",
};

export const CUSTOMER_STATUS_TONE: Record<CustomerStatus, BadgeTone> = {
  ordered: "success",
  registered: "info",
  interested: "accent",
};

export const CUSTOMER_STATUS_HELP: Record<CustomerStatus, string> = {
  ordered: "Has placed at least one order, signed in or as a guest.",
  registered: "Has an account on the store but has never ordered.",
  interested: "Known only from a cart, a chat or a saved item — no account, no order.",
};

/* ------------------------------------------------------------------ */
/*  Sorting                                                            */
/* ------------------------------------------------------------------ */

export const CUSTOMER_SORTS = [
  { value: "recent", label: "Last activity" },
  { value: "spend", label: "Total spend" },
  { value: "orders", label: "Order count" },
] as const;

export type CustomerSort = (typeof CUSTOMER_SORTS)[number]["value"];

export function isCustomerSort(v: string): v is CustomerSort {
  return CUSTOMER_SORTS.some((s) => s.value === v);
}

/* ------------------------------------------------------------------ */
/*  Shapes                                                             */
/* ------------------------------------------------------------------ */

export type CustomerAccount = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  createdAt: Date;
};

/** One line of an order, as the order recorded it at the time of purchase. */
export type CustomerOrderItem = {
  productId: string | null;
  name: string;
  quantity: number;
  price: number;
  options: { name: string; value: string }[];
};

export type CustomerOrder = {
  id: string;
  orderNumber: string;
  /** True when the order carries no `userId` — placed without signing in. */
  isGuest: boolean;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  subtotal: number;
  shipping: number;
  discountTotal: number;
  couponCode: string | null;
  total: number;
  amountPaid: number;
  balanceDue: number;
  items: CustomerOrderItem[];
  itemCount: number;
  customerName: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  pincode: string;
  createdAt: Date;
};

export type CustomerLead = {
  id: string;
  productId: string | null;
  productName: string;
  quantity: number;
  price: number | null;
  status: string;
  notes: string | null;
  createdAt: Date;
};

export type CustomerThread = {
  id: string;
  /** True when the thread is attached to the account rather than a cookie. */
  claimed: boolean;
  lastMessage: string | null;
  lastMessageAt: Date;
  adminUnread: number;
  isClosed: boolean;
};

export type CustomerReturn = {
  id: string;
  requestNumber: string;
  orderNumber: string;
  productId: string | null;
  productName: string;
  variantLabel: string | null;
  quantity: number;
  unitPrice: number;
  reason: string;
  status: string;
  refundAmount: number | null;
  createdAt: Date;
};

export type CustomerWish = {
  id: string;
  slug: string;
  createdAt: Date;
};

/**
 * Everything computable from the rows above, and nothing else. No churn score,
 * no predicted value, no "engagement" — the data cannot support them.
 */
export type CustomerStats = {
  /** Every order, cancelled ones included. */
  orderCount: number;
  /** Orders that actually count as business — cancelled ones excluded. */
  countedOrders: number;
  cancelledCount: number;
  /** Sum of `total` over non-cancelled orders. */
  lifetimeSpend: number;
  cancelledValue: number;
  /** lifetimeSpend / countedOrders, rounded. Zero when nothing counts. */
  averageOrderValue: number;
  /** Σ `amountPaid` — money that reached Razorpay. */
  paidOnline: number;
  /** Σ `balanceDue` on delivered orders — the courier's cash, inferred. */
  collectedOnDelivery: number;
  /** Σ `balanceDue` on orders still in flight. */
  stillDue: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
  /** Newest timestamp across every source, including the account itself. */
  lastActivityAt: Date;
  preferredPaymentMethod: string | null;
  preferredPaymentCount: number;

  /* -- things that want doing about this person ------------------------- */

  /**
   * Orders whose payment attempt failed.
   *
   * Counted and surfaced rather than hidden: a failed payment is a shopper who
   * chose the pieces, reached the gateway and did not get through. That is the
   * warmest lead the store has, and it is invisible if the only place it
   * appears is a grey badge on the fourth order card.
   *
   * Cancelled orders are NOT excluded here, unlike every money figure — an
   * order usually ends up cancelled *because* the payment failed, so dropping
   * them would delete the entire signal.
   */
  failedPayments: number;
  /** Σ `total` over those orders — the size of the sale that nearly happened. */
  failedValue: number;
  /** Return requests still being worked: pending, approved, picked up, received. */
  openReturns: number;
  /** Σ `adminUnread` — messages from this person nobody has answered. */
  unreadMessages: number;
  /**
   * Cart leads still open — `interested` or `contacted`. This is the closest
   * thing the store has to "what is in their cart right now"; `ordered` and
   * `lost` are closed and drop out.
   */
  openCartItems: number;
  /** Σ price × quantity over those open leads, skipping ones with no price. */
  openCartValue: number;
};

export type CustomerRecord = {
  /** base64url of `key` — the URL handle for a record with no table row. */
  id: string;
  /** `e:<email>` or `p:<digits>`. */
  key: string;
  /** Every contact token that resolved into this person. */
  tokens: string[];
  name: string | null;
  /** Never blank — falls back through email, phone, then a placeholder. */
  displayName: string;
  email: string | null;
  emails: string[];
  phone: string | null;
  phones: string[];
  /**
   * Customer (has a `User`) or guest (does not). Read off `accounts.length`
   * after the merge — see `CUSTOMER_KINDS` for why it is derived here rather
   * than asked again by whoever is drawing a list.
   */
  kind: CustomerKind;
  status: CustomerStatus;
  accounts: CustomerAccount[];
  orders: CustomerOrder[];
  leads: CustomerLead[];
  threads: CustomerThread[];
  returns: CustomerReturn[];
  wishlist: CustomerWish[];
  /** Order numbers, so a search for one lands on the person who placed it. */
  orderNumbers: string[];
  /** Which tables fed this record — "Account", "2 guest orders", … */
  sourceParts: string[];
  /** Those parts joined: "Account + 2 guest orders". */
  sourceLabel: string;
  /** Last known city/state, from the newest order or the account. */
  location: string | null;
  stats: CustomerStats;
};

/**
 * A cart lead that named nobody. Carried out of the resolver rather than just
 * counted, so the list's "6 records left out" footnote can say *what* was left
 * out and link each one at the product it was about — the only handle those
 * rows have.
 */
export type AnonymousLead = {
  id: string;
  productId: string | null;
  productName: string;
  quantity: number;
  price: number | null;
  status: string;
  createdAt: Date;
};

export type CustomerDirectory = {
  customers: CustomerRecord[];
  /** Rows that identify nobody — no usable email and no usable phone. */
  anonymous: {
    leads: number;
    threads: number;
    /** The newest few of those leads, so the footnote is actionable. */
    leadRows: AnonymousLead[];
  };
};

/* ------------------------------------------------------------------ */
/*  Tokens                                                             */
/* ------------------------------------------------------------------ */

const EMAIL = "e:";
const PHONE = "p:";

function emailToken(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  // A bare `@` check, not a validator: this is matching what two rows have in
  // common, not deciding whether anyone can be emailed.
  if (!v || !v.includes("@")) return null;
  return EMAIL + v;
}

function phoneToken(raw: string | null | undefined): string | null {
  const digits = normalisePhone(raw ?? "");
  // A bare Indian mobile is 10 digits and `normalisePhone` prefixes 91 → 12.
  // Anything shorter is a typo or a placeholder, and merging strangers on "0"
  // would be far worse than missing a link.
  if (digits.length < 10 || digits.length > 15) return null;
  return PHONE + digits;
}

const tokenValue = (token: string) => token.slice(2);

/* ------------------------------------------------------------------ */
/*  Union–find over contact tokens                                     */
/* ------------------------------------------------------------------ */

/**
 * Disjoint sets with one extra rule: a set may be *claimed* by an account, and
 * two claimed sets never merge. That is the only thing standing between a
 * shared household phone number and two separate people becoming one record.
 */
class Identities {
  private parent = new Map<string, string>();
  /** Root → the account email that owns it. */
  private claim = new Map<string, string>();

  add(token: string): string {
    if (!this.parent.has(token)) this.parent.set(token, token);
    return token;
  }

  has(token: string): boolean {
    return this.parent.has(token);
  }

  find(token: string): string {
    this.add(token);
    let root = token;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // Path compression — one pass, so repeated lookups stay flat.
    let walk = token;
    while (this.parent.get(walk) !== root) {
      const next = this.parent.get(walk)!;
      this.parent.set(walk, root);
      walk = next;
    }
    return root;
  }

  /** Mark this token's set as belonging to a registered account. */
  claimFor(token: string, accountEmail: string): void {
    const root = this.find(token);
    if (!this.claim.has(root)) this.claim.set(root, accountEmail);
  }

  /** Join two tokens. Returns false when the account rule blocked the merge. */
  union(a: string, b: string): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return true;

    const ca = this.claim.get(ra);
    const cb = this.claim.get(rb);
    if (ca && cb && ca !== cb) return false;

    // A claimed root always survives, so an account's canonical set never
    // disappears under an anonymous one. Otherwise pick deterministically.
    const [keep, drop] = ca ? [ra, rb] : cb ? [rb, ra] : ra < rb ? [ra, rb] : [rb, ra];
    this.parent.set(drop, keep);
    const dropped = this.claim.get(drop);
    if (dropped && !this.claim.has(keep)) this.claim.set(keep, dropped);
    this.claim.delete(drop);
    return true;
  }

  /** Join every token a single row carries. */
  join(tokens: (string | null)[]): string | null {
    const real = tokens.filter((t): t is string => !!t);
    if (real.length === 0) return null;
    for (let i = 1; i < real.length; i++) this.union(real[0], real[i]);
    return this.find(real[0]);
  }

  /** The first token of the row that still resolves, i.e. its group. */
  groupOf(tokens: (string | null)[]): string | null {
    for (const t of tokens) if (t) return this.find(t);
    return null;
  }

  tokens(): string[] {
    return [...this.parent.keys()];
  }
}

/* ------------------------------------------------------------------ */
/*  Ids                                                                */
/* ------------------------------------------------------------------ */

/**
 * base64url rather than the raw key: `e:a+b@x.com` survives a path segment
 * only by luck, and `+` in particular is a live grenade. Both pages that
 * decode it run on the Node runtime, so `Buffer` is available.
 */
export function encodeCustomerId(key: string): string {
  return Buffer.from(key, "utf8").toString("base64url");
}

export function decodeCustomerId(id: string): string | null {
  try {
    const key = Buffer.from(id, "base64url").toString("utf8");
    // base64url decoding never throws on garbage, it just produces garbage.
    return key.startsWith(EMAIL) || key.startsWith(PHONE) ? key : null;
  } catch {
    return null;
  }
}

/**
 * The customer link for a row that only knows its own contact details — used
 * by Admin → Interested customers, which has a `Lead` and no directory.
 *
 * The token it builds may not be the group's canonical key (the person may
 * also have an account under a different address), but `getCustomer()` matches
 * on any token in the group, so the link resolves either way.
 */
export function customerIdForContact(contact: {
  email?: string | null;
  phone?: string | null;
}): string | null {
  const token = emailToken(contact.email) ?? phoneToken(contact.phone);
  return token ? encodeCustomerId(token) : null;
}

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function newest(...dates: (Date | null | undefined)[]): Date | null {
  let best: Date | null = null;
  for (const d of dates) {
    if (!d) continue;
    if (!best || d.getTime() > best.getTime()) best = d;
  }
  return best;
}

function parseItems(raw: unknown): CustomerOrderItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const it = (entry ?? {}) as {
      productId?: unknown;
      name?: unknown;
      quantity?: unknown;
      price?: unknown;
      options?: unknown;
    };
    return {
      productId: typeof it.productId === "string" ? it.productId : null,
      name: typeof it.name === "string" ? it.name : "Item",
      quantity: typeof it.quantity === "number" ? it.quantity : 1,
      price: typeof it.price === "number" ? it.price : 0,
      options: Array.isArray(it.options)
        ? (it.options as { name?: unknown; value?: unknown }[])
            .filter((o) => typeof o?.name === "string" && typeof o?.value === "string")
            .map((o) => ({ name: String(o.name), value: String(o.value) }))
        : [],
    };
  });
}

/** Cancelled orders are history, not business — every money figure skips them. */
const isCancelled = (status: string) => status === "cancelled";

/* ------------------------------------------------------------------ */
/*  The resolver                                                       */
/* ------------------------------------------------------------------ */

type Bucket = {
  root: string;
  accounts: CustomerAccount[];
  orders: CustomerOrder[];
  leads: CustomerLead[];
  threads: CustomerThread[];
  returns: CustomerReturn[];
  wishlist: CustomerWish[];
  names: string[];
};

function bucket(map: Map<string, Bucket>, root: string): Bucket {
  let b = map.get(root);
  if (!b) {
    b = {
      root,
      accounts: [],
      orders: [],
      leads: [],
      threads: [],
      returns: [],
      wishlist: [],
      names: [],
    };
    map.set(root, b);
  }
  return b;
}

/**
 * Read every table a person can appear in and fold them into one record each.
 *
 * A failed query degrades to an empty list rather than taking the screen down:
 * a customer list missing its chat threads is still worth looking at, and the
 * admin panel is where you go *when* something is broken.
 *
 * Wrapped in React `cache()` for per-request dedup — the detail page's
 * `generateMetadata` and its body would otherwise each run the same six
 * queries, which on this store is twelve serialised round trips for one page.
 */
export const getCustomers = cache(async (): Promise<CustomerDirectory> => {
  const [users, orders, leads, threads, returns, wishlist] = await Promise.all([
    prisma.user
      .findMany({
        // Oldest first: when two accounts contend for one phone number, the
        // account that existed first keeps it, and that has to be stable.
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          address: true,
          city: true,
          state: true,
          pincode: true,
          createdAt: true,
        },
      })
      .catch(() => []),
    prisma.order
      .findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          orderNumber: true,
          userId: true,
          customerName: true,
          email: true,
          phone: true,
          city: true,
          state: true,
          pincode: true,
          items: true,
          subtotal: true,
          shipping: true,
          discountTotal: true,
          couponCode: true,
          total: true,
          amountPaid: true,
          balanceDue: true,
          paymentMethod: true,
          paymentStatus: true,
          status: true,
          createdAt: true,
        },
      })
      .catch(() => []),
    prisma.lead
      .findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          productId: true,
          productName: true,
          quantity: true,
          price: true,
          email: true,
          name: true,
          phone: true,
          status: true,
          notes: true,
          createdAt: true,
        },
      })
      .catch(() => []),
    prisma.chatThread
      .findMany({
        orderBy: { lastMessageAt: "desc" },
        select: {
          id: true,
          userId: true,
          name: true,
          email: true,
          phone: true,
          lastMessage: true,
          lastMessageAt: true,
          adminUnread: true,
          isClosed: true,
        },
      })
      .catch(() => []),
    prisma.returnRequest
      .findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          requestNumber: true,
          orderId: true,
          productId: true,
          productName: true,
          variantLabel: true,
          quantity: true,
          unitPrice: true,
          reason: true,
          status: true,
          refundAmount: true,
          createdAt: true,
          order: {
            select: { orderNumber: true, userId: true, email: true, phone: true },
          },
        },
      })
      .catch(() => []),
    prisma.wishlistItem
      .findMany({
        orderBy: { createdAt: "desc" },
        select: { id: true, userId: true, slug: true, createdAt: true },
      })
      .catch(() => []),
  ]);

  /* -- pass 1: build the identity graph ---------------------------------- */

  const ids = new Identities();

  // Accounts first, so every other row can be pulled onto an account rather
  // than the account being pulled onto a stray guest record.
  const userTokens = new Map<string, string>(); // userId → its email token
  for (const u of users) {
    const et = emailToken(u.email);
    if (!et) continue; // `User.email` is required and unique; belt and braces.
    ids.add(et);
    ids.claimFor(et, tokenValue(et));
    userTokens.set(u.id, et);
    // The account's own phone joins its email — blocked only if another
    // account already claimed that number.
    const pt = phoneToken(u.phone);
    if (pt) ids.union(et, pt);
  }

  /** A row's tokens, with its account's email token first when it has one. */
  const rowTokens = (row: {
    userId?: string | null;
    email?: string | null;
    phone?: string | null;
  }): (string | null)[] => {
    const account = row.userId ? userTokens.get(row.userId) ?? null : null;
    return [account, emailToken(row.email), phoneToken(row.phone)];
  };

  for (const o of orders) ids.join(rowTokens(o));
  for (const l of leads) ids.join(rowTokens(l));
  for (const t of threads) ids.join(rowTokens(t));
  for (const r of returns) ids.join(rowTokens(r.order));
  // Wishlist rows carry no contact of their own — they are an account's, or
  // they are nobody's. The account token is already in the graph.

  /* -- pass 2: drop every row into its group ----------------------------- */

  const buckets = new Map<string, Bucket>();
  const anonymous = { leads: 0, threads: 0, leadRows: [] as AnonymousLead[] };
  /** Enough to show the shape of what was skipped without listing 300 rows. */
  const ANON_LEADS_SHOWN = 12;

  for (const u of users) {
    const et = userTokens.get(u.id);
    if (!et) continue;
    const b = bucket(buckets, ids.find(et));
    b.accounts.push({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      address: u.address,
      city: u.city,
      state: u.state,
      pincode: u.pincode,
      createdAt: u.createdAt,
    });
    if (u.name.trim()) b.names.push(u.name.trim());
  }

  /** orderId → group, so a return reaches the same person as its order. */
  const orderGroup = new Map<string, string>();
  const orderNumberById = new Map<string, string>();

  for (const o of orders) {
    const root = ids.groupOf(rowTokens(o));
    // An order always has an email and a phone column, but both can be blank
    // on a hand-created row. Nothing to attach it to, so it is not a customer.
    if (!root) continue;
    orderGroup.set(o.id, root);
    orderNumberById.set(o.id, o.orderNumber);
    const items = parseItems(o.items);
    const b = bucket(buckets, root);
    b.orders.push({
      id: o.id,
      orderNumber: o.orderNumber,
      isGuest: !o.userId,
      status: o.status,
      paymentMethod: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      subtotal: o.subtotal,
      shipping: o.shipping,
      discountTotal: o.discountTotal,
      couponCode: o.couponCode,
      total: o.total,
      amountPaid: o.amountPaid,
      balanceDue: o.balanceDue,
      items,
      itemCount: items.reduce((n, i) => n + i.quantity, 0),
      customerName: o.customerName,
      email: o.email,
      phone: o.phone,
      city: o.city,
      state: o.state,
      pincode: o.pincode,
      createdAt: o.createdAt,
    });
    if (o.customerName.trim()) b.names.push(o.customerName.trim());
  }

  for (const l of leads) {
    const root = ids.groupOf(rowTokens(l));
    if (!root) {
      anonymous.leads++;
      // Newest first already, so the first N are the freshest.
      if (anonymous.leadRows.length < ANON_LEADS_SHOWN) {
        anonymous.leadRows.push({
          id: l.id,
          productId: l.productId,
          productName: l.productName,
          quantity: l.quantity,
          price: l.price,
          status: l.status,
          createdAt: l.createdAt,
        });
      }
      continue;
    }
    const b = bucket(buckets, root);
    b.leads.push({
      id: l.id,
      productId: l.productId,
      productName: l.productName,
      quantity: l.quantity,
      price: l.price,
      status: l.status,
      notes: l.notes,
      createdAt: l.createdAt,
    });
    if (l.name?.trim()) b.names.push(l.name.trim());
  }

  for (const t of threads) {
    const root = ids.groupOf(rowTokens(t));
    if (!root) {
      anonymous.threads++;
      continue;
    }
    const b = bucket(buckets, root);
    b.threads.push({
      id: t.id,
      claimed: !!t.userId,
      lastMessage: t.lastMessage,
      lastMessageAt: t.lastMessageAt,
      adminUnread: t.adminUnread,
      isClosed: t.isClosed,
    });
    if (t.name?.trim()) b.names.push(t.name.trim());
  }

  for (const r of returns) {
    // Prefer the group its order already landed in — identical by construction,
    // and it keeps a return with its order even if the order's contact is odd.
    const root = orderGroup.get(r.orderId) ?? ids.groupOf(rowTokens(r.order));
    if (!root) continue;
    bucket(buckets, root).returns.push({
      id: r.id,
      requestNumber: r.requestNumber,
      orderNumber: r.order.orderNumber,
      productId: r.productId,
      productName: r.productName,
      variantLabel: r.variantLabel,
      quantity: r.quantity,
      unitPrice: r.unitPrice,
      reason: r.reason,
      status: r.status,
      refundAmount: r.refundAmount,
      createdAt: r.createdAt,
    });
  }

  for (const w of wishlist) {
    const et = userTokens.get(w.userId);
    if (!et) continue;
    bucket(buckets, ids.find(et)).wishlist.push({
      id: w.id,
      slug: w.slug,
      createdAt: w.createdAt,
    });
  }

  /* -- pass 3: group the tokens themselves, then build the records ------- */

  const tokensByRoot = new Map<string, string[]>();
  for (const t of ids.tokens()) {
    const root = ids.find(t);
    const list = tokensByRoot.get(root);
    if (list) list.push(t);
    else tokensByRoot.set(root, [t]);
  }

  const customers: CustomerRecord[] = [];
  for (const b of buckets.values()) {
    customers.push(buildRecord(b, tokensByRoot.get(b.root) ?? [b.root]));
  }

  // Default order: whoever did something most recently is at the top.
  customers.sort(
    (a, b) => b.stats.lastActivityAt.getTime() - a.stats.lastActivityAt.getTime()
  );

  return { customers, anonymous };
});

function buildRecord(b: Bucket, tokens: string[]): CustomerRecord {
  const accounts = [...b.accounts].sort(
    (x, y) => x.createdAt.getTime() - y.createdAt.getTime()
  );
  // Both lists are already newest-first from their queries.
  const orders = b.orders;
  const newestOrder = orders[0] ?? null;

  const emails = [...new Set(tokens.filter((t) => t.startsWith(EMAIL)).map(tokenValue))].sort();
  const phones = [...new Set(tokens.filter((t) => t.startsWith(PHONE)).map(tokenValue))].sort();

  // The account wins every contact field it has; after that the freshest
  // order, because that is the address a parcel actually went to.
  const primaryEmail =
    accounts[0]?.email.toLowerCase() ??
    emailToken(newestOrder?.email)?.slice(2) ??
    emails[0] ??
    null;
  const primaryPhone =
    phoneToken(accounts[0]?.phone)?.slice(2) ??
    phoneToken(newestOrder?.phone)?.slice(2) ??
    phones[0] ??
    null;

  const key = primaryEmail
    ? EMAIL + primaryEmail
    : emails[0]
      ? EMAIL + emails[0]
      : PHONE + (primaryPhone ?? phones[0] ?? "unknown");

  const name = accounts[0]?.name?.trim() || b.names[0] || null;

  /* -- money ------------------------------------------------------------- */

  const live = orders.filter((o) => !isCancelled(o.status));
  const cancelled = orders.filter((o) => isCancelled(o.status));
  const lifetimeSpend = live.reduce((n, o) => n + o.total, 0);
  const paidOnline = live.reduce((n, o) => n + o.amountPaid, 0);
  // `balanceDue` says what is left to collect; only the delivery scan says the
  // courier actually took it. Anything not yet delivered is still outstanding.
  const collectedOnDelivery = live
    .filter((o) => o.status === "delivered")
    .reduce((n, o) => n + o.balanceDue, 0);
  const stillDue = live
    .filter((o) => o.status !== "delivered")
    .reduce((n, o) => n + o.balanceDue, 0);

  // Most-used payment method; a tie goes to the one used most recently, which
  // is simply the first one encountered in a newest-first list.
  const methodCount = new Map<string, number>();
  for (const o of live) {
    methodCount.set(o.paymentMethod, (methodCount.get(o.paymentMethod) ?? 0) + 1);
  }
  let preferredPaymentMethod: string | null = null;
  let preferredPaymentCount = 0;
  for (const [method, count] of methodCount) {
    if (count > preferredPaymentCount) {
      preferredPaymentMethod = method;
      preferredPaymentCount = count;
    }
  }

  /* -- what wants doing -------------------------------------------------- */

  // Deliberately over ALL orders, not `live`: a failed payment very often ends
  // as a cancelled order, so filtering cancellations out here would throw away
  // exactly the rows this is meant to find.
  const failed = orders.filter((o) => o.paymentStatus === "failed");
  const openReturns = b.returns.filter((r) =>
    (OPEN_RETURN_STATUSES as readonly string[]).includes(r.status)
  ).length;
  const unreadMessages = b.threads.reduce((n, t) => n + t.adminUnread, 0);
  const openCart = b.leads.filter(
    (l) => l.status === "interested" || l.status === "contacted"
  );

  const orderDates = orders.map((o) => o.createdAt);
  const firstOrderAt = orderDates.length
    ? new Date(Math.min(...orderDates.map((d) => d.getTime())))
    : null;
  const lastOrderAt = orderDates.length
    ? new Date(Math.max(...orderDates.map((d) => d.getTime())))
    : null;

  const lastActivityAt =
    newest(
      lastOrderAt,
      b.leads[0]?.createdAt,
      b.threads[0]?.lastMessageAt,
      b.returns[0]?.createdAt,
      b.wishlist[0]?.createdAt,
      accounts[0]?.createdAt
    ) ?? new Date(0);

  /* -- provenance -------------------------------------------------------- */

  const guestOrders = orders.filter((o) => o.isGuest).length;
  const accountOrders = orders.length - guestOrders;
  const sourceParts: string[] = [];
  if (accounts.length) {
    sourceParts.push(accounts.length === 1 ? "Account" : `${accounts.length} accounts`);
  }
  if (accountOrders) sourceParts.push(plural(accountOrders, "account order"));
  if (guestOrders) sourceParts.push(plural(guestOrders, "guest order"));
  if (b.leads.length) sourceParts.push(plural(b.leads.length, "cart lead"));
  if (b.threads.length) sourceParts.push(plural(b.threads.length, "chat"));
  if (b.returns.length) sourceParts.push(plural(b.returns.length, "return"));
  if (b.wishlist.length) sourceParts.push(plural(b.wishlist.length, "wishlist save"));

  // One question, asked once, of the merged record. Everything downstream —
  // the two lists, their counts, their empty states — reads this and never
  // looks at the tables again.
  const kind: CustomerKind = accounts.length ? "customer" : "guest";

  const status: CustomerStatus = orders.length
    ? "ordered"
    : accounts.length
      ? "registered"
      : "interested";

  const locationBits = newestOrder
    ? [newestOrder.city, newestOrder.state]
    : [accounts[0]?.city, accounts[0]?.state];
  const location = locationBits.filter(Boolean).join(", ") || null;

  return {
    id: encodeCustomerId(key),
    key,
    tokens,
    name,
    displayName: name ?? primaryEmail ?? primaryPhone ?? "Unidentified shopper",
    email: primaryEmail,
    emails,
    phone: primaryPhone,
    phones,
    kind,
    status,
    accounts,
    orders,
    leads: b.leads,
    threads: b.threads,
    returns: b.returns,
    wishlist: b.wishlist,
    orderNumbers: orders.map((o) => o.orderNumber),
    sourceParts,
    sourceLabel: sourceParts.join(" + "),
    location,
    stats: {
      orderCount: orders.length,
      countedOrders: live.length,
      cancelledCount: cancelled.length,
      lifetimeSpend,
      cancelledValue: cancelled.reduce((n, o) => n + o.total, 0),
      averageOrderValue: live.length ? Math.round(lifetimeSpend / live.length) : 0,
      paidOnline,
      collectedOnDelivery,
      stillDue,
      firstOrderAt,
      lastOrderAt,
      lastActivityAt,
      preferredPaymentMethod,
      preferredPaymentCount,
      failedPayments: failed.length,
      failedValue: failed.reduce((n, o) => n + o.total, 0),
      openReturns,
      unreadMessages,
      openCartItems: openCart.reduce((n, l) => n + l.quantity, 0),
      openCartValue: openCart.reduce(
        (n, l) => n + (l.price != null ? l.price * l.quantity : 0),
        0
      ),
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Lookup                                                             */
/* ------------------------------------------------------------------ */

/**
 * One customer by URL id.
 *
 * Deliberately re-resolves the whole directory rather than querying the person
 * directly: the merge rule is what defines who they *are*, so a detail page
 * built from a narrower query could legitimately disagree with the list. At
 * this store's size the difference is one set of six parallel queries.
 *
 * Matches the canonical key first, then any token in the group — see rule 5 at
 * the top of this file.
 */
export const getCustomer = cache(
  async (id: string): Promise<CustomerRecord | null> => {
    const key = decodeCustomerId(id);
    if (!key) return null;

    const { customers } = await getCustomers();
    return (
      customers.find((c) => c.key === key) ??
      customers.find((c) => c.tokens.includes(key)) ??
      null
    );
  }
);

/* ------------------------------------------------------------------ */
/*  Product links                                                      */
/* ------------------------------------------------------------------ */

export type CustomerProduct = {
  id: string;
  slug: string;
  name: string;
  price: number;
  isActive: boolean;
};

/**
 * Every product this person has touched, in ONE query.
 *
 * Order lines and returns hold a `productId`; the wishlist holds a `slug`
 * (deliberately — see the model comment). Both are resolved here so the detail
 * page can turn each of them into a link to the product editor, and so a piece
 * deleted since can be shown as gone rather than as a dead link.
 */
export async function getCustomerProducts(
  customer: CustomerRecord
): Promise<{ byId: Map<string, CustomerProduct>; bySlug: Map<string, CustomerProduct> }> {
  const idSet = new Set<string>();
  for (const o of customer.orders) {
    for (const i of o.items) if (i.productId) idSet.add(i.productId);
  }
  for (const r of customer.returns) if (r.productId) idSet.add(r.productId);
  for (const l of customer.leads) if (l.productId) idSet.add(l.productId);

  const slugSet = new Set(customer.wishlist.map((w) => w.slug));

  const byId = new Map<string, CustomerProduct>();
  const bySlug = new Map<string, CustomerProduct>();
  if (idSet.size === 0 && slugSet.size === 0) return { byId, bySlug };

  const rows = await prisma.product
    .findMany({
      where: {
        OR: [{ id: { in: [...idSet] } }, { slug: { in: [...slugSet] } }],
      },
      select: { id: true, slug: true, name: true, price: true, isActive: true },
    })
    .catch(() => [] as CustomerProduct[]);

  for (const p of rows) {
    byId.set(p.id, p);
    bySlug.set(p.slug, p);
  }
  return { byId, bySlug };
}

/**
 * The resolved product lookup, named so the three sections that take it share
 * one type rather than one of them owning it and the others importing across.
 */
export type CustomerProductIndex = Awaited<
  ReturnType<typeof getCustomerProducts>
>;

/* ------------------------------------------------------------------ */
/*  List shaping                                                       */
/* ------------------------------------------------------------------ */

/**
 * Typo-tolerant search over the whole record — name, every email and phone the
 * person has used, and their order numbers, so "L7-XYZ" (or a legacy "AV-XYZ") finds the buyer.
 */
export function searchCustomers(
  customers: CustomerRecord[],
  query: string
): CustomerRecord[] {
  return fuzzyFilter(customers, query, [
    { name: "displayName", weight: 0.3 },
    { name: "name", weight: 0.2 },
    { name: "emails", weight: 0.2 },
    { name: "phones", weight: 0.15 },
    { name: "orderNumbers", weight: 0.1 },
    { name: "location", weight: 0.05 },
  ]);
}

export function sortCustomers(
  customers: CustomerRecord[],
  sort: CustomerSort
): CustomerRecord[] {
  const out = [...customers];
  if (sort === "spend") {
    out.sort((a, b) => b.stats.lifetimeSpend - a.stats.lifetimeSpend);
  } else if (sort === "orders") {
    out.sort(
      (a, b) =>
        b.stats.orderCount - a.stats.orderCount ||
        b.stats.lifetimeSpend - a.stats.lifetimeSpend
    );
  } else {
    out.sort(
      (a, b) => b.stats.lastActivityAt.getTime() - a.stats.lastActivityAt.getTime()
    );
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Cross-links                                                        */
/* ------------------------------------------------------------------ */

/**
 * Where each thing on a customer page goes. Kept together so "no dead ends"
 * is one list to check rather than a grep across two pages.
 *
 * Orders and returns have no detail route of their own — both screens are a
 * single filtered list — so they are linked by their searchable reference.
 * Returns default to the open queue, hence the explicit `status=all`.
 */
export const adminLink = {
  order: (orderNumber: string) =>
    `/admin/orders?q=${encodeURIComponent(orderNumber)}`,
  /** Every order matching a contact detail — the orders screen searches both. */
  orderSearch: (emailOrPhone: string) =>
    `/admin/orders?q=${encodeURIComponent(emailOrPhone)}`,
  product: (productId: string) => `/admin/products/${productId}/edit`,
  return: (requestNumber: string) =>
    `/admin/returns?status=all&q=${encodeURIComponent(requestNumber)}`,
  /** The chat inbox has no per-thread route; it opens on the thread list. */
  chat: () => `/admin/messages`,
  lead: (contact: string) => `/admin/leads?q=${encodeURIComponent(contact)}`,
  coupon: (code: string) => `/admin/coupons?q=${encodeURIComponent(code)}`,

  /**
   * The customer's own four sections.
   *
   * Real routes rather than `?tab=`, so a section is a link somebody can paste
   * into a message, the browser's back button steps through sections, and Next
   * re-renders only the section when you switch — the header and the identity
   * block above it are a layout and stay put.
   */
  customer: (id: string) => `/admin/customers/${encodeURIComponent(id)}`,
  customerOrders: (id: string) =>
    `/admin/customers/${encodeURIComponent(id)}/orders`,
  customerPayments: (id: string) =>
    `/admin/customers/${encodeURIComponent(id)}/payments`,
  customerActivity: (id: string) =>
    `/admin/customers/${encodeURIComponent(id)}/activity`,
} as const;

/* ------------------------------------------------------------------ */
/*  Timeline                                                           */
/* ------------------------------------------------------------------ */

export type CustomerEventKind =
  | "account"
  | "order"
  | "payment_failed"
  | "return"
  | "chat"
  | "cart"
  | "wishlist";

/**
 * One thing that happened, from whichever table it happened in.
 *
 * Structured rather than pre-written prose: the caller decides the wording and
 * the icon, this decides what counts as an event and when it happened. `href`
 * is the screen that owns it — never null for anything with a home, which is
 * how "no dead ends" survives a new event kind being added here.
 */
export type CustomerEvent = {
  id: string;
  kind: CustomerEventKind;
  at: Date;
  /** The thing itself — an order number, a product name, a message. */
  subject: string;
  /** Money involved, where the event has any. */
  amount: number | null;
  href: string | null;
};

/**
 * Every source folded into one stream, newest first.
 *
 * This is the only view that answers "what has this person been doing" without
 * the reader stitching five lists together by date in their head. It restates
 * nothing: each entry is a link to the section or screen that holds the detail.
 */
export function customerTimeline(customer: CustomerRecord): CustomerEvent[] {
  const events: CustomerEvent[] = [];

  for (const o of customer.orders) {
    events.push({
      id: `order-${o.id}`,
      kind: o.paymentStatus === "failed" ? "payment_failed" : "order",
      at: o.createdAt,
      subject: o.orderNumber,
      amount: o.total,
      href: adminLink.order(o.orderNumber),
    });
  }
  for (const r of customer.returns) {
    events.push({
      id: `return-${r.id}`,
      kind: "return",
      at: r.createdAt,
      subject: r.requestNumber,
      amount: r.refundAmount ?? r.unitPrice * r.quantity,
      href: adminLink.return(r.requestNumber),
    });
  }
  for (const t of customer.threads) {
    events.push({
      id: `chat-${t.id}`,
      kind: "chat",
      at: t.lastMessageAt,
      subject: t.lastMessage ?? "Started a chat",
      amount: null,
      href: adminLink.chat(),
    });
  }
  for (const l of customer.leads) {
    events.push({
      id: `lead-${l.id}`,
      kind: "cart",
      at: l.createdAt,
      subject: l.productName,
      amount: l.price != null ? l.price * l.quantity : null,
      // A cart entry for a product that has since been deleted still has
      // somewhere to go: the Activity section, which holds the entry itself.
      href: l.productId
        ? adminLink.product(l.productId)
        : adminLink.customerActivity(customer.id),
    });
  }
  for (const w of customer.wishlist) {
    events.push({
      id: `wish-${w.id}`,
      kind: "wishlist",
      at: w.createdAt,
      // The wishlist stores a slug, not a product id (see the model comment),
      // and resolving slugs to names costs a query this view does not make.
      // Activity does make it, so that is where this points — and the slug is
      // at least the honest value rather than an invented title.
      subject: w.slug,
      amount: null,
      href: adminLink.customerActivity(customer.id),
    });
  }
  for (const a of customer.accounts) {
    events.push({
      id: `account-${a.id}`,
      kind: "account",
      at: a.createdAt,
      subject: a.email,
      amount: null,
      href: null,
    });
  }

  return events.sort((x, y) => y.at.getTime() - x.at.getTime());
}

/* ------------------------------------------------------------------ */
/*  Signals — the only things that ask for an action                   */
/* ------------------------------------------------------------------ */

export type CustomerSignalKind = "unread" | "failed" | "due" | "return" | "cart";

/**
 * Something about this person that wants doing, ready to render.
 *
 * Derived here rather than in the two screens that show it, so the list's
 * badges and the detail page's strip can never disagree about whether someone
 * needs chasing. Every signal carries a destination: a flag you cannot act on
 * is decoration.
 */
export type CustomerSignal = {
  kind: CustomerSignalKind;
  /** Short and already formatted — "₹10 due", "2 unread". */
  label: string;
  tone: BadgeTone;
  /** The sentence behind it, for a `title` or a tip. */
  help: string;
  href: string;
};

/**
 * Ordered by how much a human is waiting on the answer: an unanswered message
 * first, then a payment that failed (a sale still within reach), then money
 * owed, then an open return, then a cart nobody has followed up.
 */
export function customerSignals(c: CustomerRecord): CustomerSignal[] {
  const s = c.stats;
  const out: CustomerSignal[] = [];

  if (s.unreadMessages > 0) {
    out.push({
      kind: "unread",
      label: `${s.unreadMessages} unread`,
      tone: "accent",
      help: `${s.unreadMessages} chat message${s.unreadMessages === 1 ? "" : "s"} nobody has replied to.`,
      href: adminLink.chat(),
    });
  }
  if (s.failedPayments > 0) {
    out.push({
      kind: "failed",
      label: `${s.failedPayments} payment failed`,
      tone: "danger",
      help: `${s.failedPayments} order${s.failedPayments === 1 ? "" : "s"} worth ${formatINR(s.failedValue)} reached the gateway and did not go through. Worth a nudge.`,
      href: adminLink.customerPayments(c.id),
    });
  }
  if (s.stillDue > 0) {
    out.push({
      kind: "due",
      label: `${formatINR(s.stillDue)} due`,
      tone: "warn",
      help: `${formatINR(s.stillDue)} outstanding on orders that have not been delivered yet.`,
      href: adminLink.customerPayments(c.id),
    });
  }
  if (s.openReturns > 0) {
    out.push({
      kind: "return",
      label: `${s.openReturns} return open`,
      tone: "warn",
      help: `${s.openReturns} return request${s.openReturns === 1 ? "" : "s"} still being worked.`,
      href: adminLink.customerActivity(c.id),
    });
  }
  if (s.openCartItems > 0) {
    out.push({
      kind: "cart",
      label: `${s.openCartItems} in cart`,
      tone: "info",
      help:
        s.openCartValue > 0
          ? `${s.openCartItems} item${s.openCartItems === 1 ? "" : "s"} worth ${formatINR(s.openCartValue)} left in a cart and never ordered.`
          : `${s.openCartItems} item${s.openCartItems === 1 ? "" : "s"} left in a cart and never ordered.`,
      href: adminLink.customerActivity(c.id),
    });
  }

  return out;
}
