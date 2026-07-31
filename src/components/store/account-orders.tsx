"use client";

import { useState } from "react";
import { ChevronDown, Package, ExternalLink } from "lucide-react";
import { formatINR } from "@/lib/utils";
import { OrderTimeline, type StatusEntry } from "./order-timeline";
import { ReturnRequest, type ExistingRequest } from "./return-request";

export type AccountOrder = {
  id: string;
  orderNumber: string;
  status: string;
  total: number;
  subtotal: number;
  shipping: number;
  discountTotal?: number;
  couponCode?: string | null;
  paymentMethod: string;
  paymentStatus: string;
  createdAt: string;
  courier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  deliveryStatus: string | null;
  items: {
    name: string;
    quantity: number;
    price: number;
    options?: { name: string; value: string }[];
  }[];
  statusHistory: StatusEntry[];
  returnRequest?: ExistingRequest | null;
  address: string;
  city: string;
  state: string;
  pincode: string;
  note?: string | null;
};

const statusColor: Record<string, string> = {
  pending: "bg-accent/15 text-accent",
  confirmed: "bg-blue-500/15 text-blue-500",
  shipped: "bg-purple-500/15 text-purple-500",
  delivered: "bg-success/15 text-success",
  cancelled: "bg-danger/15 text-danger",
  payment_failed: "bg-rose-500/15 text-rose-500 border border-rose-500/30",
};

export function AccountOrders({ orders }: { orders: AccountOrder[] }) {
  const [openId, setOpenId] = useState<string | null>(orders[0]?.id ?? null);

  if (orders.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-12 text-center">
        <Package className="mx-auto h-10 w-10 text-muted-foreground" />
        <p className="mt-4 font-serif text-xl">No orders yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          When you place an order, you can track it here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {orders.map((o) => {
        const open = openId === o.id;
        return (
          <div
            key={o.id}
            className="overflow-hidden rounded-lg border border-border bg-card"
          >
            <button
              onClick={() => setOpenId(open ? null : o.id)}
              className="flex w-full items-center gap-4 px-5 py-4 text-left"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{o.orderNumber}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs capitalize ${
                      statusColor[o.status] ?? "bg-muted"
                    }`}
                  >
                    {o.status}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {new Date(o.createdAt).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}{" "}
                  · {o.items.length} item{o.items.length === 1 ? "" : "s"}
                </p>
              </div>
              <span className="text-right font-medium">
                {formatINR(o.total)}
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                  open ? "rotate-180" : ""
                }`}
              />
            </button>

            {open && (
              <div className="border-t border-border px-5 py-5">
                <div className="grid gap-8 md:grid-cols-2">
                  {/* Tracking timeline */}
                  <div>
                    <h4 className="mb-4 text-xs uppercase tracking-wider text-muted-foreground">
                      Tracking
                    </h4>
                    <OrderTimeline
                      status={o.status}
                      history={o.statusHistory}
                      deliveryStatus={o.deliveryStatus}
                      note={o.note}
                    />
                    {(o.courier || o.trackingNumber || o.trackingUrl) && (
                      <div className="mt-4 rounded-lg bg-muted p-4 text-sm">
                        {o.courier && (
                          <p>
                            <span className="text-muted-foreground">
                              Courier:{" "}
                            </span>
                            {o.courier}
                          </p>
                        )}
                        {o.trackingNumber && (
                          <p className="mt-1">
                            <span className="text-muted-foreground">
                              Tracking no:{" "}
                            </span>
                            <span className="font-medium">
                              {o.trackingNumber}
                            </span>
                          </p>
                        )}
                        {o.trackingUrl && (
                          <a
                            href={o.trackingUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex items-center gap-1.5 text-accent hover:underline"
                          >
                            Track shipment <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Items + summary */}
                  <div>
                    <h4 className="mb-4 text-xs uppercase tracking-wider text-muted-foreground">
                      Items
                    </h4>
                    <ul className="space-y-1 text-sm">
                      {o.items.map((it, i) => (
                        <li key={i} className="flex justify-between">
                          <span>
                            {it.name} × {it.quantity}
                            {it.options && it.options.length > 0 && (
                              <span className="block text-xs text-muted-foreground">
                                {it.options
                                  .map((op) => `${op.name}: ${op.value}`)
                                  .join(" · ")}
                              </span>
                            )}
                          </span>
                          <span>{formatINR(it.price * it.quantity)}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 space-y-1 border-t border-border pt-2 text-sm">
                      <div className="flex justify-between text-muted-foreground">
                        <span>Subtotal</span>
                        <span>{formatINR(o.subtotal)}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Shipping</span>
                        <span>
                          {o.shipping === 0 ? "Free" : formatINR(o.shipping)}
                        </span>
                      </div>
                      {o.discountTotal ? (
                        <div className="flex justify-between text-success">
                          <span>Discount {o.couponCode ? `(${o.couponCode})` : ""}</span>
                          <span>-{formatINR(o.discountTotal)}</span>
                        </div>
                      ) : null}
                      <div className="flex justify-between font-medium">
                        <span>Total</span>
                        <span>{formatINR(o.total)}</span>
                      </div>
                    </div>
                    <div className="mt-4 rounded-lg bg-muted p-4 text-sm text-muted-foreground">
                      <p className="font-medium text-foreground">
                        Delivery address
                      </p>
                      <p className="mt-1">
                        {o.address}, {o.city}, {o.state} - {o.pincode}
                      </p>
                      <p className="mt-2">
                        Payment: {o.paymentMethod}
                        {o.paymentStatus === "paid" ? " · Paid" : ""}
                      </p>
                    </div>

                    <ReturnRequest
                      orderId={o.id}
                      orderStatus={o.status}
                      existing={o.returnRequest}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
