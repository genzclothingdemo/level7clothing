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

  const addresses = await prisma.address
    .findMany({
      where: { userId: user.id },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    })
    .catch(() => []);

  const defaultAddress = addresses.find((a) => a.isDefault) ?? addresses[0];

  return (
    <CheckoutClient
      user={{
        // Prefill from the default saved address when there is one, otherwise
        // fall back to the legacy single address on the user record.
        name: defaultAddress?.fullName ?? user.name,
        email: user.email,
        phone: defaultAddress?.phone ?? user.phone,
        address: defaultAddress?.address ?? user.address,
        city: defaultAddress?.city ?? user.city,
        state: defaultAddress?.state ?? user.state,
        pincode: defaultAddress?.pincode ?? user.pincode,
      }}
      savedAddresses={addresses.map((a) => ({
        id: a.id,
        label: a.label,
        fullName: a.fullName,
        phone: a.phone,
        address: a.address,
        city: a.city,
        state: a.state,
        pincode: a.pincode,
        isDefault: a.isDefault,
      }))}
    />
  );
}
