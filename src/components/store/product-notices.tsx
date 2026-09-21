"use client";

import { BadgeIndianRupee, Sparkles } from "lucide-react";
import { useSettings } from "@/context/settings";
import { InfoTip } from "@/components/store/info-tip";
import type { PaymentMode } from "@/lib/types";

/**
 * Plain-English label and explanation for each checkout mode.
 *
 * The stored values are jargon ("prepaid", "direct") and were never surfaced
 * on the product page at all, so a shopper only discovered how they could pay
 * at checkout — after choosing a size and filling in an address.
 */
const MODE_COPY: Record<PaymentMode, { label: string; help: string }> = {
  prepaid: {
    label: "Pay online",
    help: "Pay the full amount now by UPI, card or netbanking. Your order is confirmed immediately.",
  },
  cod: {
    label: "Cash on delivery",
    help: "Pay the courier in cash when the parcel arrives. Available on most pin codes.",
  },
  partial: {
    label: "Part now, rest on delivery",
    help: "Pay a small advance online to confirm the order, then the balance in cash when it arrives.",
  },
  direct: {
    label: "Arrange with us",
    help: "No online payment at checkout — we contact you to confirm the details and settle payment directly. Used for made-to-order pieces.",
  },
};

/**
 * Which of a product's payment modes are actually offered right now.
 *
 * A product can allow COD while the store has COD switched off globally;
 * showing it here would promise something checkout then refuses, so the master
 * switches in SiteSettings win.
 */
function useEnabledModes(modes: PaymentMode[]): PaymentMode[] {
  const s = useSettings();
  const master: Record<PaymentMode, boolean> = {
    prepaid: s.prepaidEnabled && s.razorpayEnabled,
    cod: s.codEnabled,
    partial: s.partialEnabled && s.razorpayEnabled,
    direct: s.directEnabled,
  };
  return modes.filter((m) => master[m]);
}

/**
 * "How you can pay" summary for the product page.
 *
 * Renders nothing when no mode survives the master switches — an empty box
 * saying nothing is worse than no box.
 */
export function PaymentModesNote({
  modes,
  advancePercent,
}: {
  modes: PaymentMode[];
  advancePercent: number | null;
}) {
  const enabled = useEnabledModes(modes?.length ? modes : ["prepaid", "cod"]);
  if (enabled.length === 0) return null;

  return (
    <section
      aria-label="Payment options"
      className="rounded-2xl border border-border p-4"
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <BadgeIndianRupee className="h-4 w-4 text-accent" aria-hidden="true" />
        How you can pay
      </h3>
      <ul className="mt-2.5 space-y-1.5">
        {enabled.map((mode) => {
          const { label, help } = MODE_COPY[mode];
          const detail =
            mode === "partial" && advancePercent
              ? `${help} The advance on this piece is ${advancePercent}%.`
              : help;
          return (
            <li
              key={mode}
              className="flex items-center gap-1.5 text-sm text-muted-foreground"
            >
              <span className="text-foreground">{label}</span>
              <InfoTip term={label}>{detail}</InfoTip>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Made-to-order callout.
 *
 * Deliberately accent-coloured rather than a muted aside: it changes what the
 * shopper has to do (send details) and what they can expect afterwards
 * (usually no returns), so it must not read as fine print.
 */
export function CustomisationNotice({
  note,
}: {
  note: string | null;
}) {
  return (
    <section
      aria-label="Made to order"
      className="rounded-2xl border border-accent/30 bg-accent/5 p-4"
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold text-accent">
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        Made to order for you
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {note?.trim()
          ? note
          : "This piece is produced once you order it, so it takes a little longer to dispatch."}
      </p>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        Personalised pieces usually can&rsquo;t be returned
        <InfoTip term="Returns on made-to-order pieces">
          Because it&rsquo;s made specifically for you, it can&rsquo;t be resold.
          You can still raise a request if it arrives damaged or isn&rsquo;t what
          you ordered — the return options on your order page will say what
          applies.
        </InfoTip>
      </p>
    </section>
  );
}
