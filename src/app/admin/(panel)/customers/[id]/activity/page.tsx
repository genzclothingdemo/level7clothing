import { notFound } from "next/navigation";
import { getCustomer } from "@/lib/customers";
import { getAdminProductIndex } from "@/components/admin/product-index";
import {
  CustomerCart,
  CustomerChats,
  CustomerReturns,
  CustomerWishlist,
} from "@/components/admin/customer-activity";

export const dynamic = "force-dynamic";

/**
 * Activity — everything that is not an order or a payment.
 *
 * Cart first, deliberately. It is the only block here that describes something
 * that has not happened yet, and for anyone who has never bought it is the
 * entire record. Then chat (somebody may be waiting), then returns (somebody
 * definitely is), then the wishlist.
 */
export default async function CustomerActivitySection({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const customer = await getCustomer(id);
  if (!customer) notFound();

  // Same single query as before, one column wider: cart lines, returns and
  // saved items all lead with the product's photo now.
  const products = await getAdminProductIndex(customer);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <CustomerCart customer={customer} products={products} />
      <CustomerChats customer={customer} />
      <CustomerReturns customer={customer} products={products} />
      <CustomerWishlist customer={customer} products={products} />
    </div>
  );
}
