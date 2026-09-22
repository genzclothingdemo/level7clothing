import { notFound } from "next/navigation";
import { getCustomer } from "@/lib/customers";
import {
  CustomerAttention,
  CustomerIdentity,
  CustomerTimeline,
  CustomerValue,
} from "@/components/admin/customer-profile";

export const dynamic = "force-dynamic";

/**
 * Overview — the first impression.
 *
 * Four things, in the order somebody reads them: **what needs doing**, **what
 * they are worth**, **who they are**, **what they have been doing**. Each one
 * hands off rather than expanding: the orders themselves are one tab away, the
 * money split another, the carts and chats a third.
 *
 * The header and the section bar come from the layout, so nothing on this page
 * repeats the name, the status or the contact buttons.
 */

async function readClock(): Promise<number> {
  return Date.now();
}

export default async function CustomerOverview({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const now = await readClock();

  // Resolved again rather than handed down from the layout: a layout cannot
  // pass props to its children. `getCustomer` is React-cached, so this is the
  // same object the header used, from the same six queries.
  const customer = await getCustomer(id);
  if (!customer) notFound();

  return (
    <div className="space-y-3">
      <CustomerAttention customer={customer} />
      <CustomerValue customer={customer} />
      <div className="grid gap-3 lg:grid-cols-2">
        <CustomerIdentity customer={customer} />
        <CustomerTimeline customer={customer} now={now} />
      </div>
    </div>
  );
}
