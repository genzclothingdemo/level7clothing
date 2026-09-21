import Link from "next/link";
import { UserRound } from "lucide-react";
import { InfoTip } from "@/components/store/info-tip";
import { CustomerFilters } from "@/components/admin/customer-filters";
import { CustomerTable } from "@/components/admin/customer-table";
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
  searchParams: Promise<{ q?: string; status?: string; sort?: string }>;
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

  const filtered = !!q || !!status;
  const anonymousTotal = anonymous.leads + anonymous.threads;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="font-serif text-3xl">Customers</h1>
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
          later with the same address are one person — the row says which
          sources fed it. Two registered accounts are never merged, even when
          they share a phone.
        </InfoTip>
      </p>

      <div className="mt-4">
        <CustomerFilters counts={counts} />
      </div>

      {list.length === 0 ? (
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
          <CustomerTable customers={list} now={now} />
        </div>
      )}

      {anonymousTotal > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {anonymousTotal} record{anonymousTotal === 1 ? "" : "s"} left out —{" "}
          {anonymous.leads > 0 && (
            <>
              <Link href="/admin/leads" className="underline hover:text-accent">
                {anonymous.leads} cart lead{anonymous.leads === 1 ? "" : "s"}
              </Link>
              {anonymous.threads > 0 ? " and " : ""}
            </>
          )}
          {anonymous.threads > 0 && (
            <Link href="/admin/messages" className="underline hover:text-accent">
              {anonymous.threads} chat{anonymous.threads === 1 ? "" : "s"}
            </Link>
          )}{" "}
          with no email and no phone number. There is nothing to match them on,
          so they are counted rather than invented into people.
        </p>
      )}
    </div>
  );
}
