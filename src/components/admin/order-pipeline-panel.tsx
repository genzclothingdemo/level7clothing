import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Settings2, Truck } from "lucide-react";
import { InfoTip } from "@/components/store/info-tip";
import { Badge } from "@/components/admin/order-ui";
import {
  CONFIRM_MODE_LABEL,
  COURIER_PREFERENCE_LABEL,
  isFullyUnattended,
  type PipelineSettings,
} from "@/lib/orders-pipeline";

/**
 * What the pipeline is doing right now, in one read-only line above the queue.
 *
 * **This used to be the editor.** The argument for putting it here was that an
 * operator staring at a column of pending orders and wondering why nothing
 * confirmed itself should not have to go and find another screen. The argument
 * lost: the owner went looking for auto-confirm in Admin → Settings twice, and
 * it was not there. So the controls moved to **Settings → Orders**, which is
 * where people look for settings, and what stays here is the answer to the
 * question this strip was really being asked — *what is it set to?* — plus one
 * link to change it.
 *
 * It keeps the important half of the old design: the current behaviour is
 * always on screen, never behind a fold. A hidden automation setting is how a
 * store ends up shipping things nobody meant to ship.
 *
 * A **server component**, deliberately: there is no state left, so this ships
 * no JavaScript. `Badge`, `InfoTip` and `Link` are client components being
 * *rendered* from the server, which is the ordinary pattern — the trap is
 * *calling* a function exported by a `"use client"` module, and passing an icon
 * *component* rather than an element. Neither happens here.
 */

/** One place, so the strip and Settings can never point at different tabs. */
export const ORDER_AUTOMATION_HREF = "/admin/settings?tab=orders";

export function OrderPipelinePanel({ settings }: { settings: PipelineSettings }) {
  const unattended = isFullyUnattended(settings);

  return (
    <section className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-lg border border-border bg-card px-3 py-2">
      <Settings2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />

      <span className="text-xs font-medium">Order automation</span>
      <InfoTip term="Order automation">
        Whether an order confirms itself, and what confirming then does with the
        courier. Confirming emails the customer and stages a free, unbooked
        draft in NimbusPost; booking allocates the courier, generates the AWB
        and charges your NimbusPost wallet. Both are set in Settings → Orders.
      </InfoTip>

      <span className="flex flex-wrap items-center gap-1">
        <Badge tone={settings.orderConfirmMode === "auto" ? "warn" : "neutral"}>
          Auto-confirm: {CONFIRM_MODE_LABEL[settings.orderConfirmMode].toLowerCase()}
        </Badge>
        <Badge tone={settings.autoShipOnConfirm ? "warn" : "neutral"}>
          <Truck className="h-2.5 w-2.5" aria-hidden />
          {settings.autoShipOnConfirm
            ? `Books ${COURIER_PREFERENCE_LABEL[settings.autoShipCourier].toLowerCase()} automatically`
            : "Draft only"}
        </Badge>
        {unattended && (
          <Badge tone="danger" title="Every order confirms itself and books a real courier before you have seen it.">
            <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
            No human in the loop
          </Badge>
        )}
      </span>

      <Link
        href={ORDER_AUTOMATION_HREF}
        className="ml-auto inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg text-[11px] font-medium uppercase tracking-wider text-accent transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:min-h-9"
      >
        Change in settings
        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </section>
  );
}
