import { UserRound, UserSearch } from "lucide-react";
import { InfoTip } from "@/components/store/info-tip";
import { CustomerFilters } from "@/components/admin/customer-filters";
import { CustomerTable } from "@/components/admin/customer-table";
import { AnonymousLeads } from "@/components/admin/customer-anonymous";
import {
  OrderPagination,
  parsePageParam,
} from "@/components/admin/order-pagination";
import {
  CUSTOMER_KIND_LABEL,
  getCustomers,
  isCustomerKind,
  isCustomerSort,
  isCustomerStatus,
  searchCustomers,
  sortCustomers,
  splitCustomers,
  type CustomerKind,
  type CustomerStatus,
} from "@/lib/customers";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customers" };

/**
 * Admin → Customers, in two parts.
 *
 * The page is thin on purpose: it reads the URL, asks `lib/customers` who
 * exists, splits that answer in two and renders. Every rule about *who counts
 * as one person* — and which half they land in — lives in that module.
 * Duplicating any of it here is what would let the two lists quietly disagree
 * about the same shopper.
 *
 * The split itself is `splitCustomers()`, which partitions on a `kind` the
 * merge already worked out. It is deliberately not "guests = leads with no
 * matching user": that would be a second identity rule, and the day somebody
 * signed up with `Jay@…` having ordered as `jay@…` they would appear in both
 * lists. Here they cannot, because there is only ever one record.
 */

/**
 * 25 rows — about one screen of the desktop table.
 *
 * Paged in memory rather than in SQL, and that is forced rather than lazy: a
 * customer is assembled from six tables by a rule that can merge two rows into
 * one person, so the row count is only known after the merge has run. A
 * `skip`/`take` on any single table would page the wrong thing. The saving is
 * still real and it is the one that matters here — each `CustomerRecord`
 * carries its whole order, lead, chat, return and wishlist history, so before
 * this the page serialised every one of those arrays for every customer into
 * the RSC payload in order to render six columns.
 */
const PAGE_SIZE = 25;

/**
 * Which statuses can occur in each half.
 *
 * Not a filter — a fact about the data. `registered` means "account, never
 * ordered", which cannot happen without an account; `interested` means "no
 * account, never ordered", which cannot happen with one. Offering the chip
 * anyway would give the reader a control that is permanently zero.
 */
const STATUSES_FOR: Record<CustomerKind, readonly CustomerStatus[]> = {
  customer: ["ordered", "registered"],
  guest: ["ordered", "interested"],
};

/**
 * Wall clock for the "3 days ago" column. Read through an async boundary
 * rather than calling `Date.now()` in the render body — the page is
 * force-dynamic so the value is genuinely per-request, but a bare impure call
 * in a component body is the pattern the purity rule rejects.
 */
async function readClock(): Promise<number> {
  return Date.now();
}

export default async function AdminCustomers({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    group?: string;
    status?: string;
    sort?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const now = await readClock();

  const { customers: everyone, anonymous } = await getCustomers();

  // The one partition. Both counts and both lists come from it, so the chips
  // and the table can never be describing different populations.
  const split = splitCustomers(everyone);

  const group: CustomerKind =
    sp.group && isCustomerKind(sp.group) ? sp.group : "customer";
  const population = group === "guest" ? split.guests : split.customers;

  const q = sp.q?.trim() ?? "";
  const sort = sp.sort && isCustomerSort(sp.sort) ? sp.sort : "recent";

  // A status left over from the other half is dropped rather than applied —
  // `?group=guest&status=registered` can match nobody by definition, and an
  // empty screen reads as "you have no guests".
  const allowed = STATUSES_FOR[group];
  const status =
    sp.status && isCustomerStatus(sp.status) && allowed.includes(sp.status)
      ? sp.status
      : null;

  // Search first, then count: the chips show how many of the *matches* are in
  // each state, which is what makes them useful while a query is active.
  const matching = q ? searchCustomers(population, q) : population;

  const counts: Record<string, number> = { all: matching.length };
  for (const s of allowed) counts[s] = 0;
  for (const c of matching) counts[c.status] = (counts[c.status] ?? 0) + 1;

  // The counts on the split itself always reflect the search, not the group —
  // otherwise switching to Guests with a query running shows a number that
  // does not match the list you land on.
  const kindCounts: Record<CustomerKind, number> = {
    customer: q ? searchCustomers(split.customers, q).length : split.customers.length,
    guest: q ? searchCustomers(split.guests, q).length : split.guests.length,
  };

  // The sort is always applied, including with a query running. Fuse ranks by
  // relevance, but the sort control is an explicit instruction and a list that
  // ignores it reads as broken.
  const list = sortCustomers(
    status ? matching.filter((c) => c.status === status) : matching,
    sort
  );

  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  // Clamped, so a stale `?page=9` left over from a wider filter lands on the
  // last page of results rather than on a blank screen that reads as "nobody".
  const page = Math.min(parsePageParam(sp.page), totalPages);
  const visible = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const filtered = !!q || !!status;
  const isGuests = group === "guest";

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="font-serif text-2xl">Customers</h1>
        <p className="text-sm text-muted-foreground">
          {filtered
            ? `${list.length} of ${population.length} matching`
            : `${split.customers.length} with an account · ${split.guests.length} guest${
                split.guests.length === 1 ? "" : "s"
              }`}
        </p>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Two lists, one rule. Everyone is assembled from accounts, orders, carts,
        chats, returns and wishlists first, and only then split by whether they
        have an account.
        <InfoTip term="How a customer is worked out">
          There is no customer table. Records are matched on lowercased email,
          falling back to phone number, so a guest order and the account opened
          later with the same address are one person. Two registered accounts
          are never merged, even when they share a phone. Any row built from
          more than one source carries an &ldquo;(i)&rdquo; beside the name
          saying what was folded in and which contact detail linked them.
          <br />
          <br />
          Because the split reads that finished record, a guest who signs up
          does not get copied anywhere: their one record simply gains an
          account, so they leave Guests and appear under Customers with
          everything they did before still attached.
        </InfoTip>
      </p>

      <div className="mt-4">
        <CustomerFilters
          counts={counts}
          kindCounts={kindCounts}
          statuses={allowed}
        />
      </div>

      {visible.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-border p-10 text-center">
          {isGuests ? (
            <UserSearch className="mx-auto h-8 w-8 text-muted-foreground" />
          ) : (
            <UserRound className="mx-auto h-8 w-8 text-muted-foreground" />
          )}
          <p className="mt-3 font-serif text-lg">
            {filtered
              ? "Nobody matches"
              : isGuests
                ? "No guests right now"
                : "No customers yet"}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            {filtered
              ? "Try clearing the search, or widening the status filter."
              : isGuests
                ? "Anyone who leaves a phone number or email at add-to-cart, checks out without signing in, or starts a chat appears here — until they open an account."
                : "Anyone who signs up appears here automatically, with whatever they did as a guest folded in."}
          </p>
        </div>
      ) : (
        <div className="mt-3">
          <CustomerTable customers={visible} now={now} />
          <OrderPagination
            page={page}
            totalPages={totalPages}
            total={list.length}
            pageSize={PAGE_SIZE}
            params={sp}
            basePath="/admin/customers"
          />
        </div>
      )}

      {/* Only under Guests: a contact-less cart lead is the extreme case of a
          guest, and it has nothing to do with the people who have accounts.
          Showing it under Customers was always a non-sequitur. */}
      {isGuests && <AnonymousLeads anonymous={anonymous} now={now} />}

      {!isGuests && split.guests.length > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          {split.guests.length} more{" "}
          {split.guests.length === 1 ? "person has" : "people have"} left a
          contact detail without opening an account — see{" "}
          <a
            href="/admin/customers?group=guest"
            className="underline hover:text-accent"
          >
            {CUSTOMER_KIND_LABEL.guest.toLowerCase()}
          </a>
          .
        </p>
      )}
    </div>
  );
}
