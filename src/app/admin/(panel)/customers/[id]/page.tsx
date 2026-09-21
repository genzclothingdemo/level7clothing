import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCustomer, getCustomerProducts } from "@/lib/customers";
import {
  CustomerStatusBadge,
  SourceLine,
  formatAgo,
  formatDayTime,
} from "@/components/admin/customer-ui";
import {
  CustomerAnalytics,
  CustomerContact,
  CustomerPayments,
} from "@/components/admin/customer-profile";
import {
  CustomerChats,
  CustomerLeads,
  CustomerOrders,
  CustomerReturns,
  CustomerWishlist,
} from "@/components/admin/customer-activity";

export const dynamic = "force-dynamic";

/**
 * Admin → Customers → one person.
 *
 * The `id` is a base64url encoding of the resolved identity key, because a
 * customer has no table row to carry a real id. `getCustomer` matches it
 * against the canonical key first and then against every contact token in the
 * group, so an old link to someone who has since registered still lands on
 * them rather than 404ing.
 */

async function readClock(): Promise<number> {
  return Date.now();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const customer = await getCustomer(id);
  return { title: customer ? customer.displayName : "Customer" };
}

export default async function AdminCustomerDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const now = await readClock();

  const customer = await getCustomer(id);
  // A genuinely unknown id, or a person whose last record was deleted. Both
  // are a 404, not an error — there is nothing here any more.
  if (!customer) notFound();

  const products = await getCustomerProducts(customer);

  return (
    <div className="min-w-0">
      <Link
        href="/admin/customers"
        className="inline-flex min-h-11 items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> All customers
      </Link>

      <header className="mt-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="min-w-0 break-words font-serif text-2xl sm:text-3xl">
            {customer.displayName}
          </h1>
          <CustomerStatusBadge status={customer.status} withTip />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <SourceLine parts={customer.sourceParts} withTip />
          <span aria-hidden="true">·</span>
          <span title={formatDayTime(customer.stats.lastActivityAt)}>
            last seen {formatAgo(customer.stats.lastActivityAt, now)}
          </span>
        </div>
      </header>

      <div className="mt-4">
        <CustomerAnalytics customer={customer} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <CustomerContact customer={customer} />
        <CustomerPayments customer={customer} />
      </div>

      <div className="mt-3">
        <CustomerOrders customer={customer} products={products} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <CustomerReturns customer={customer} products={products} />
        <CustomerChats customer={customer} />
        <CustomerWishlist customer={customer} products={products} />
        <CustomerLeads customer={customer} products={products} />
      </div>
    </div>
  );
}
