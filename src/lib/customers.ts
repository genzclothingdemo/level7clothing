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
import { normalisePhone } from "@/lib/utils";
import type { BadgeTone } from "@/components/admin/order-ui";

/* ------------------------------------------------------------------ */
/*  Status                                                             */
/* ------------------------------------------------------------------ */

/**
 * Derived on every read, never stored. A column would need writing from
 * checkout, signup, the lead capture and the chat resolver, and would be wrong
 * the moment any one of them was missed.
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

export type CustomerDirectory = {
  customers: CustomerRecord[];
  /** Rows that identify nobody — no usable email and no usable phone. */
  anonymous: { leads: number; threads: number };
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
  const anonymous = { leads: 0, threads: 0 };

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

/* ------------------------------------------------------------------ */
/*  List shaping                                                       */
/* ------------------------------------------------------------------ */

/**
 * Typo-tolerant search over the whole record — name, every email and phone the
 * person has used, and their order numbers, so "AV-XYZ" finds the buyer.
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
  customer: (id: string) => `/admin/customers/${id}`,
} as const;
