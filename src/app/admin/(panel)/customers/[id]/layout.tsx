import { notFound } from "next/navigation";
import { adminLink, getCustomer } from "@/lib/customers";
import { CustomerHeader } from "@/components/admin/customer-profile";
import { CustomerNav } from "@/components/admin/customer-nav";

export const dynamic = "force-dynamic";

/**
 * Admin → Customers → one person.
 *
 * The header and the section bar are a **layout**, not part of each page, for
 * one reason that matters: Next re-renders only the changed segment on a
 * navigation, so moving between Overview, Orders, Payments and Activity leaves
 * who-this-is and how-to-reach-them exactly where they were rather than
 * repainting the whole screen. It also means the identity is written once
 * instead of four times.
 *
 * The `id` is a base64url encoding of the resolved identity key, because a
 * customer has no table row to carry a real id. `getCustomer` matches it
 * against the canonical key first and then against every contact token in the
 * group, so an old link to somebody who has since registered still lands on
 * them rather than 404ing.
 *
 * `getCustomer` is React-cached, so this layout and the page it wraps resolve
 * the same person from one set of queries — and the four sections cannot end
 * up disagreeing about who they are describing.
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

export default async function CustomerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const now = await readClock();

  const customer = await getCustomer(id);
  // A genuinely unknown id, or a person whose last record was deleted. Both
  // are a 404, not an error — there is nothing here any more.
  if (!customer) notFound();

  return (
    <div className="min-w-0 space-y-3">
      <CustomerHeader customer={customer} now={now} />

      {/*
        Built from the id in the URL rather than from `customer.id`. They are
        usually the same string, but a link made before this person registered
        carries one of their other contact tokens — and the nav compares its
        hrefs against the live pathname to decide which tab is on, so a
        canonical id here would leave every tab looking inactive.
      */}
      <CustomerNav
        base={adminLink.customer(id)}
        counts={{
          orders: customer.orders.length,
          activity:
            customer.threads.length +
            customer.leads.length +
            customer.wishlist.length +
            customer.returns.length,
          attention:
            customer.stats.unreadMessages > 0 ||
            customer.stats.failedPayments > 0 ||
            customer.stats.stillDue > 0 ||
            customer.stats.openReturns > 0 ||
            customer.stats.openCartItems > 0,
        }}
      />

      {children}
    </div>
  );
}
