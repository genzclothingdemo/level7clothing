import { notFound } from "next/navigation";
import { getCustomer } from "@/lib/customers";
import { getAdminProductIndex } from "@/components/admin/product-index";
import { CustomerOrders } from "@/components/admin/customer-orders";

export const dynamic = "force-dynamic";

/**
 * Orders — this person's buying history, read as a history rather than as a
 * queue. Working an order (confirming, dispatching, refunding) is Admin →
 * Orders' job, and every order number here links straight to it.
 */
export default async function CustomerOrdersSection({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const customer = await getCustomer(id);
  if (!customer) notFound();

  // One query for every product this person has ever touched — order lines,
  // returns, carts and saves together. Not one per order. Still one query
  // after the switch from `getCustomerProducts`: the select is a column wider
  // (`images`), because every line now leads with its photo.
  const products = await getAdminProductIndex(customer);

  return <CustomerOrders customer={customer} products={products} />;
}
