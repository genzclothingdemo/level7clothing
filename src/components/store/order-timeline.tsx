import { Check, Package, Truck, Home, Clock, XCircle, AlertTriangle, MessageSquare } from "lucide-react";

const FLOW = [
  { key: "pending", label: "Order placed", icon: Clock },
  { key: "confirmed", label: "Confirmed", icon: Package },
  { key: "shipped", label: "Shipped", icon: Truck },
  { key: "delivered", label: "Delivered", icon: Home },
] as const;

export type StatusEntry = { status: string; note?: string; at: string };

export function OrderTimeline({
  status,
  history,
  deliveryStatus,
  note,
}: {
  status: string;
  history?: StatusEntry[];
  deliveryStatus?: string | null;
  note?: string | null;
}) {
  // ── Payment Failed status view ──
  if (status === "payment_failed") {
    const at = history?.find((h) => h.status === "payment_failed")?.at;
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/5 p-4">
          <AlertTriangle className="h-6 w-6 shrink-0 text-danger mt-0.5" />
          <div>
            <p className="font-medium text-danger">Payment Failed</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The payment for this order was not completed.
              {at && ` · ${new Date(at).toLocaleString("en-IN")}`}
            </p>
          </div>
        </div>

        {note && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs">
            <p className="font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" /> Note from Level7 Clothing:
            </p>
            <p className="mt-1 text-foreground/80">{note}</p>
          </div>
        )}
      </div>
    );
  }

  // ── Cancelled status view ──
  if (status === "cancelled") {
    const at = history?.find((h) => h.status === "cancelled")?.at;
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-lg border border-danger/30 bg-danger/5 p-4">
          <XCircle className="h-6 w-6 shrink-0 text-danger" />
          <div>
            <p className="font-medium text-danger">Order cancelled</p>
            {at && (
              <p className="text-xs text-muted-foreground">
                {new Date(at).toLocaleString("en-IN")}
              </p>
            )}
          </div>
        </div>

        {note && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs">
            <p className="font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" /> Note from Level7 Clothing:
            </p>
            <p className="mt-1 text-foreground/80">{note}</p>
          </div>
        )}
      </div>
    );
  }

  const currentIndex = FLOW.findIndex((s) => s.key === status);
  const activeIndex = currentIndex === -1 ? 0 : currentIndex;

  // Map status -> timestamp from history (last occurrence wins).
  const stampFor = (key: string) => {
    const entry = [...(history ?? [])].reverse().find((h) => h.status === key);
    return entry?.at;
  };

  return (
    <div className="space-y-4">
      <ol className="relative">
        {FLOW.map((step, i) => {
          const done = i <= activeIndex;
          const isCurrent = i === activeIndex;
          const Icon = done && !isCurrent ? Check : step.icon;
          const at = stampFor(step.key);
          const last = i === FLOW.length - 1;
          return (
            <li key={step.key} className="flex gap-4 pb-6 last:pb-0">
              <div className="flex flex-col items-center">
                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 transition-colors ${
                    done
                      ? "border-accent bg-accent text-accent-foreground"
                      : "border-border bg-card text-muted-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                {!last && (
                  <span
                    className={`mt-1 w-0.5 flex-1 ${
                      i < activeIndex ? "bg-accent" : "bg-border"
                    }`}
                  />
                )}
              </div>
              <div className="pt-1.5">
                <p
                  className={`text-sm font-medium ${
                    done ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {step.label}
                  {isCurrent && (
                    <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-normal text-accent">
                      Current
                    </span>
                  )}
                </p>
                {/* Live courier status from NimbusPost (shown on the Shipped step). */}
                {step.key === "shipped" &&
                  status === "shipped" &&
                  deliveryStatus && (
                    <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-0.5 text-xs text-accent">
                      <Truck className="h-3 w-3" /> {deliveryStatus}
                    </p>
                  )}
                {at && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {new Date(at).toLocaleString("en-IN")}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* ── Admin Note / Comment display ── */}
      {note && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs">
          <p className="font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" /> Note from Level7 Clothing:
          </p>
          <p className="mt-1 text-foreground/90 leading-relaxed">{note}</p>
        </div>
      )}
    </div>
  );
}
