import Link from "next/link";
import { ExternalLink, Undo2 } from "lucide-react";
import { formatINR } from "@/lib/utils";
import { Disclosure } from "@/components/store/disclosure";
import { formatReturnDate } from "@/lib/returns";
import type { RtoOrder } from "@/lib/nimbus-returns";

/**
 * Orders the courier is carrying back because delivery failed (RTO).
 *
 * **Why this is on the returns screen.** An RTO is not a customer-raised
 * return — there is no `ReturnRequest`, nobody asked for anything — but it ends
 * identically: stock arriving back on the shelf, and on a prepaid order money
 * the customer is owed. Until now nothing in the app said so. `mapNimbusStatus`
 * turns `rto delivered` into the order status `cancelled`, which emails the
 * customer that their order was cancelled and leaves no hint that a parcel is
 * in the building or that a refund is due.
 *
 * So it lives here, where someone is already looking for goods coming back,
 * rather than inventing a screen for it.
 *
 * Collapsed by default and absent entirely when there are none: this is a rare
 * event, and a permanent empty panel above the working queue would be noise on
 * every single visit.
 */
export function ReturnRto({ orders }: { orders: RtoOrder[] }) {
  if (orders.length === 0) return null;

  const owed = orders.filter((o) => o.owesRefund && !o.hasReturn);

  return (
    <div className="mt-4 rounded-xl border border-accent/40 bg-accent/5 p-3">
      <Disclosure
        label="Coming back to you (RTO)"
        icon={<Undo2 className="h-3.5 w-3.5" />}
        summary={
          <span className="text-muted-foreground">
            {orders.length} order{orders.length === 1 ? "" : "s"}
            {owed.length > 0 && (
              <span className="text-danger"> · {owed.length} may owe a refund</span>
            )}
          </span>
        }
      >
        <p className="mt-2 text-xs text-muted-foreground">
          Delivery failed and the courier is returning these to you. They are not
          return requests — nobody raised one — so nothing here is automatic. A
          completed RTO shows as a <b>cancelled</b> order, because there is no RTO
          order status; check each prepaid one for a refund.
        </p>

        <div className="mt-2 space-y-1.5">
          {orders.map((o) => (
            <div
              key={o.id}
              className="rounded-lg border border-border bg-card px-2.5 py-2 text-xs"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Link
                  href={`/admin/orders?q=${encodeURIComponent(o.orderNumber)}`}
                  className="inline-flex items-center gap-1 font-mono font-medium hover:text-accent"
                >
                  {o.orderNumber}
                  <ExternalLink className="h-3 w-3" />
                </Link>
                <span className="text-muted-foreground">{o.customerName}</span>
                {o.owesRefund ? (
                  <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-medium text-danger">
                    paid {formatINR(o.amountPaid)} online
                  </span>
                ) : (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    nothing collected
                  </span>
                )}
                {o.hasReturn && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    return already raised
                  </span>
                )}
              </div>
              <p className="mt-0.5 break-words text-[11px] text-muted-foreground">
                {o.deliveryStatus}
                {o.deliveryStatusAt ? ` · ${formatReturnDate(o.deliveryStatusAt)}` : ""}
                {o.courier ? ` · ${o.courier}` : ""}
                {o.trackingNumber ? ` · AWB ${o.trackingNumber}` : ""}
              </p>
            </div>
          ))}
        </div>
      </Disclosure>
    </div>
  );
}
