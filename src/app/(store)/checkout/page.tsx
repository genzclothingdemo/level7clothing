import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getUserSession } from "@/lib/user-auth";
import { CheckoutClient } from "@/components/store/checkout-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Checkout" };

export default async function CheckoutPage() {
  // Login is required to confirm an order.
  const session = await getUserSession();
  if (!session) redirect("/account/login?next=/checkout");

  const user = await prisma.user
    .findUnique({ where: { id: session.id } })
    .catch(() => null);

  if (!user) redirect("/account/login?next=/checkout");

  return (
    <CheckoutClient
      user={{
        name: user.name,
        email: user.email,
        phone: user.phone,
        address: user.address,
        city: user.city,
        state: user.state,
        pincode: user.pincode,
      }}
    />
  );
}
