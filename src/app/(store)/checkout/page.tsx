import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getUserSession } from "@/lib/user-auth";
import { CheckoutClient } from "@/components/store/checkout-client";

export const dynamic = "force-dynamic";
// noindex as well as the robots.txt disallow: the disallow stops the crawl,
// this stops indexing if the URL is ever reached from a link instead.
export const metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

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
