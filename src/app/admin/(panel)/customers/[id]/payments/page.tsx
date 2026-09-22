import { notFound } from "next/navigation";
import { getCustomer } from "@/lib/customers";
import { CustomerPayments } from "@/components/admin/customer-payments";

export const dynamic = "force-dynamic";

/**
 * Payments — what was taken online, what the courier should have collected,
 * what is still owed, and every attempt that failed.
 *
 * Failed attempts are given their own block rather than a badge on an order
 * card. They are the one thing on this whole record that is worth acting on
 * today: the shopper picked the pieces, entered an address and did not get
 * through the gateway.
 */
export default async function CustomerPaymentsSection({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const customer = await getCustomer(id);
  if (!customer) notFound();

  return <CustomerPayments customer={customer} />;
}
