"use client";

import { AlertTriangle, FileText, Hand, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoTip } from "@/components/store/info-tip";
import { Segmented } from "@/components/admin/form-kit";
import { Badge } from "@/components/admin/order-ui";
import {
  COURIER_PREFERENCE_LABEL,
  DISPATCH_MODE_DETAIL,
  DISPATCH_MODE_LABEL,
  isCourierStrategy,
  type CourierChoice,
  type DispatchOnConfirm,
} from "@/lib/orders-pipeline";

/**
 * **The dispatch decision, made once.**
 *
 * The owner spelled out four ways an order can reach the courier. They are not
 * four modes — they are two questions, and this is both of them:
 *
 * - **Q1 `dispatchOnConfirm`** — how far a *confirmed* order goes on its own:
 *   do nothing / stage a free draft / book the AWB and charge the wallet.
 * - **Q2 `autoShipCourier`** — which courier an unattended booking uses, and
 *   only asked when Q1 is `book`. Cheapest, fastest, or one pinned carrier.
 *
 * Q2 is **absent** rather than disabled while Q1 is not `book`: a control that
 * cannot apply, shown greyed, still reads as a rule that is in force.
 *
 * ## Shape
 *
 * A `<div>`, and every control is `type="button"`. This mounts **inside** the
 * settings `<form>`, and a nested `<form>` is invalid HTML that browsers
 * silently drop — while a button with no explicit type defaults to `submit`
 * and would save the whole settings page on a click meant to pick a courier.
 *
 * It is fully controlled: it owns no state, performs no saving and imports no
 * server action. The settings form owns the draft, the dirty tracking and the
 * save — this is the pair of questions, nothing else. That is what keeps
 * `SiteSettings` at one writer per column (see CLAUDE.md, "SiteSettings has
 * three editors").
 *
 * A third axis is deliberately *not* here: NimbusPost can be switched off
 * entirely in Settings → Shipping, and when it is, nothing stages or books
 * whatever Q1 says. Pass `courierLive={false}` and this says so.
 */

const MODES: DispatchOnConfirm[] = ["off", "draft", "book"];

const MODE_ICON: Record<DispatchOnConfirm, React.ReactNode> = {
  off: <Hand className="h-4 w-4 shrink-0" aria-hidden />,
  draft: <FileText className="h-4 w-4 shrink-0" aria-hidden />,
  book: <Truck className="h-4 w-4 shrink-0" aria-hidden />,
};

const MODE_TIP: Record<DispatchOnConfirm, React.ReactNode> = {
  off: (
    <>
      Confirming emails the customer and nothing else — NimbusPost is not
      touched. Pick this if you pack in batches, or ship some orders yourself:
      every order waits on the orders screen with <b>Ship now</b> and{" "}
      <b>Send draft</b> next to it.
    </>
  ),
  draft: (
    <>
      The default, and the safe one. A <b>draft</b> is an unbooked order sitting
      in NimbusPost: no courier, no AWB, nothing charged, and you can delete it
      there. You still choose the courier and see the price before any money
      moves.
    </>
  ),
  book: (
    <>
      Confirming allocates the courier, generates the AWB and{" "}
      <b>takes the money out of your NimbusPost wallet</b>, with nobody looking
      at the address or the price first. Use it only once you trust the orders
      coming in.
    </>
  ),
};

/** The two strategies plus, when one is pinned, the pinned carrier itself. */
function courierOptions(value: CourierChoice) {
  const base = [
    { value: "cheapest" as CourierChoice, label: COURIER_PREFERENCE_LABEL.cheapest },
    { value: "fastest" as CourierChoice, label: COURIER_PREFERENCE_LABEL.fastest },
  ];
  return isCourierStrategy(value) ? base : [...base, { value, label: value }];
}

export type DispatchFieldsProps = {
  /** Q1 — how far a confirmed order goes on its own. */
  dispatchOnConfirm: DispatchOnConfirm;
  /** Q2 — "cheapest" | "fastest" | a pinned courier's name. */
  autoShipCourier: CourierChoice;
  onChangeDispatch: (value: DispatchOnConfirm) => void;
  onChangeCourier: (value: CourierChoice) => void;
  /**
   * NimbusPost is switched on in Settings → Shipping **and** configured in this
   * deployment. When false, the panel says nothing will stage or book whatever
   * Q1 is set to — which is true, and is the third axis the owner asked to be
   * kept honest.
   */
  courierLive?: boolean;
  /** Highlights the control the settings form counts as unsaved. */
  dirtyDispatch?: boolean;
  dirtyCourier?: boolean;
  className?: string;
};

/**
 * The controls alone, with no card around them — for a caller that already
 * draws its own section header.
 */
export function DispatchFields({
  dispatchOnConfirm,
  autoShipCourier,
  onChangeDispatch,
  onChangeCourier,
  courierLive = true,
  dirtyDispatch,
  dirtyCourier,
  className,
}: DispatchFieldsProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {/* ---- Q1 ---- */}
      <div
        role="radiogroup"
        aria-label="What confirming an order does with the courier"
        className={cn(
          "grid gap-1.5 rounded-lg border p-1.5 sm:grid-cols-3",
          dirtyDispatch ? "border-accent" : "border-border"
        )}
      >
        {MODES.map((mode) => {
          const on = mode === dispatchOnConfirm;
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChangeDispatch(mode)}
              className={cn(
                "flex min-h-11 cursor-pointer flex-col justify-center gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                on
                  ? mode === "book"
                    ? "border-orange-500/50 bg-orange-500/10"
                    : "border-accent bg-accent/10"
                  : "border-transparent hover:bg-muted/60"
              )}
            >
              {/* The label never wraps: `truncate` on the name and the badge
                  after it, rather than `ml-auto`, which in a 3-up grid pushes
                  the badge onto the title's line and breaks it in two. */}
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "shrink-0",
                    on ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {MODE_ICON[mode]}
                </span>
                <span className="truncate text-xs font-medium">
                  {DISPATCH_MODE_LABEL[mode]}
                </span>
              </span>
              <span className="text-[11px] leading-snug text-muted-foreground">
                {DISPATCH_MODE_DETAIL[mode]}
                {mode === "book" && (
                  <Badge tone="warn" className="ml-1 align-middle">
                    costs money
                  </Badge>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* One tip row rather than three paragraphs — the explanation belongs
          behind an (i), not in the body (see the InfoTip rule in CLAUDE.md). */}
      <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        What each one means:
        {MODES.map((mode) => (
          <InfoTip key={mode} term={DISPATCH_MODE_LABEL[mode]}>
            {MODE_TIP[mode]}
          </InfoTip>
        ))}
        <span className="sr-only">
          Three explanations, one for each choice above.
        </span>
      </p>

      {/* ---- Q2 — only when Q1 is "book" ---- */}
      {dispatchOnConfirm === "book" && (
        <div className="rounded-lg border border-border bg-muted/30 p-2.5">
          <p className="mb-1.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Which courier to book
            <InfoTip term="Courier preference">
              Cheapest picks the lowest total charge to your wallet. Fastest
              picks the shortest quoted transit time, which usually costs more;
              a courier that quotes no delivery estimate is never treated as the
              fast one. Pinning one carrier books that carrier — and falls back
              to the cheapest if it is not quoting for that parcel and pincode,
              rather than leaving the order unshipped.
            </InfoTip>
          </p>

          <Segmented<CourierChoice>
            ariaLabel="Courier preference"
            value={autoShipCourier}
            onChange={onChangeCourier}
            className={dirtyCourier ? "border-accent" : undefined}
            options={courierOptions(autoShipCourier)}
          />

          <label className="mt-2 block">
            <span className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Or pin one courier
              <InfoTip term="Pinned courier">
                The carrier&apos;s name exactly as NimbusPost quotes it on the
                Ship now screen — for example <b>Xpressbees Air</b>. Leave it
                empty to use cheapest or fastest instead.
              </InfoTip>
            </span>
            <input
              value={isCourierStrategy(autoShipCourier) ? "" : autoShipCourier}
              onChange={(e) => {
                const next = e.target.value.trim();
                onChangeCourier(next || "cheapest");
              }}
              placeholder="e.g. Xpressbees Air"
              className="input h-11 text-xs sm:h-9"
            />
          </label>
        </div>
      )}

      {!courierLive && (
        <p className="flex items-start gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            NimbusPost is switched off, so nothing is staged or booked whatever
            this is set to. Confirming still emails the customer.
          </span>
        </p>
      )}
    </div>
  );
}

export type DispatchSettingsProps = DispatchFieldsProps & {
  /**
   * A heading above the controls. Pass `null` when the caller already draws
   * one (a `Card` in the settings screen usually does).
   */
  title?: string | null;
};

/**
 * `DispatchFields` with a title and a state badge — the whole "what happens on
 * confirmation" block, ready to drop into a settings tab.
 */
export function DispatchSettings({
  title = "What happens on confirmation",
  ...fields
}: DispatchSettingsProps) {
  const mode = fields.dispatchOnConfirm;

  return (
    <div className="min-w-0 space-y-2">
      {title != null && (
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium">{title}</h3>
          <InfoTip term="What happens on confirmation">
            Confirming is the point an order stops being a request and becomes
            work. This is how far that goes on its own: nothing, a free unbooked
            draft in NimbusPost, or a booked AWB paid for out of your NimbusPost
            wallet. Whatever you choose, every order can still be dispatched by
            hand from the orders screen.
          </InfoTip>
          <Badge
            tone={mode === "book" ? "warn" : "neutral"}
            className="ml-auto"
            title={DISPATCH_MODE_DETAIL[mode]}
          >
            {DISPATCH_MODE_LABEL[mode]}
          </Badge>
        </div>
      )}

      <DispatchFields {...fields} />
    </div>
  );
}
