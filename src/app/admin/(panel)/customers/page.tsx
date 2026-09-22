import { UserRound } from "lucide-react";
import { InfoTip } from "@/components/store/info-tip";
import { CustomerFilters } from "@/components/admin/customer-filters";
import { CustomerTable } from "@/components/admin/customer-table";
import { AnonymousLeads } from "@/components/admin/customer-anonymous";
import {
  OrderPagination,
  parsePageParam,
} from "@/components/admin/order-pagination";
import {
  getCustomers,
  isCustomerSort,
  isCustomerStatus,
  searchCustomers,
  sortCustomers,
} from "@/lib/customers";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customers" };

/**
 * Admin → Customers.
 *
 * The page is thin on purpose: it reads the URL, asks `lib/customers` who
 * exists, and renders. Every rule about *who counts as one person* lives in
 * that module — duplicating any of it here is what would let the list and the
 * detail page quietly disagree about the same shopper.
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
    status?: string;
    sort?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const now = await readClock();

  const { customers, anonymous } = await getCustomers();

  const q = sp.q?.trim() ?? "";
  const status = sp.status && isCustomerStatus(sp.status) ? sp.status : null;
  const sort = sp.sort && isCustomerSort(sp.sort) ? sp.sort : "recent";

  // Search first, then count: the chips show how many of the *matches* are in
  // each state, which is what makes them useful while a query is active.
  const matching = q ? searchCustomers(customers, q) : customers;

  const counts: Record<string, number> = {
    all: matching.length,
    ordered: 0,
    registered: 0,
    interested: 0,
  };
  for (const c of matching) counts[c.status]++;

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

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="font-serif text-2xl">Customers</h1>
        <p className="text-sm text-muted-foreground">
          {filtered
            ? `${list.length} of ${customers.length} matching`
            : `${customers.length} ${customers.length === 1 ? "person" : "people"}`}
        </p>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        One record per person, assembled from accounts, orders, carts, chats,
        returns and wishlists.
        <InfoTip term="How a customer is worked out">
          There is no customer table. Records are matched on lowercased email,
          falling back to phone number, so a guest order and the account opened
          later with the same address are one person. Two registered accounts
          are never merged, even when they share a phone. Any row built from
          more than one source carries an &ldquo;(i)&rdquo; beside the name
          saying what was folded in and which contact detail linked them.
        </InfoTip>
      </p>

      <div className="mt-4">
        <CustomerFilters counts={counts} />
      </div>

      {visible.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-border p-10 text-center">
          <UserRound className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-serif text-lg">
            {filtered ? "Nobody matches" : "No customers yet"}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            {filtered
              ? "Try clearing the search, or widening the status filter."
              : "Anyone who signs up, orders, fills a cart or starts a chat appears here automatically."}
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

      <AnonymousLeads anonymous={anonymous} now={now} />
    </div>
  );
}
