"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronDown,
  Loader2,
  Settings2,
  Truck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoTip } from "@/components/store/info-tip";
import { Check, Segmented, SwitchRow } from "@/components/admin/form-kit";
import { Badge, Btn } from "@/components/admin/order-ui";
import {
  CONFIRM_MODE_LABEL,
  COURIER_PREFERENCE_LABEL,
  isFullyUnattended,
  type AutoShipCourier,
  type OrderConfirmMode,
  type PipelineSettings,
} from "@/lib/orders-pipeline";
import { updateOrderPipelineSettings } from "@/app/actions/admin";

/**
 * The order pipeline's settings, on the Orders screen rather than in
 * Admin → Settings.
 *
 * They belong next to the list they govern: an operator looking at a column of
 * pending orders and wondering why nothing confirmed itself should not have to
 * go and find another page to answer that. Branding lives in Settings; how the
 * queue behaves lives here.
 *
 * Collapsed by default, but the *current* behaviour is always on screen in the
 * header — a hidden automation setting is how a store ends up shipping things
 * nobody meant to ship.
 */

const MODE_COPY: Record<
  OrderConfirmMode,
  { blurb: string; tip: string }
> = {
  manual: {
    blurb: "Nothing confirms itself. Every order waits for you.",
    tip:
      "The safest setting, and the default. Orders land in Pending — including ones already paid in full online — and stay there until you press Confirm. Nothing is staged with the courier until then.",
  },
  byPayment: {
    blurb: "Decide per payment method, using the three switches below.",
    tip:
      "The usual middle ground: let money that has already arrived skip the queue, and keep a human on the ones where it has not. A payment that failed never confirms, whatever these switches say.",
  },
  auto: {
    blurb: "Every order confirms itself the moment it is placed.",
    tip:
      "Fastest, and the only mode where a cash-on-delivery order from a made-up name and address is accepted with nobody looking at it. Two guards still hold: a failed payment never confirms, and a prepaid or part-paid order waits until its payment actually verifies.",
  },
};

export function OrderPipelinePanel({ settings }: { settings: PipelineSettings }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  // `saved` is the last value known to be in the database; `form` is what the
  // admin is editing. Comparing the two is what makes "unsaved" honest.
  const [saved, setSaved] = useState<PipelineSettings>(settings);
  const [form, setForm] = useState<PipelineSettings>(settings);
  const radioName = useId();

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const unattended = isFullyUnattended(form);

  function set<K extends keyof PipelineSettings>(key: K, value: PipelineSettings[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function save() {
    start(async () => {
      const res = await updateOrderPipelineSettings(form);
      if (!res.ok) {
        toast.error(res.error || "Could not save");
        return;
      }
      setSaved(res.settings);
      setForm(res.settings);
      toast.success("Automation saved");
      router.refresh();
    });
  }

  function reset() {
    setForm(saved);
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      {/* ---- Header: always says what the pipeline is doing right now ---- */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
      >
        <Settings2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Order automation</span>
          <span className="mt-1 flex flex-wrap items-center gap-1">
            <Badge tone={saved.orderConfirmMode === "auto" ? "warn" : "neutral"}>
              Confirm: {CONFIRM_MODE_LABEL[saved.orderConfirmMode]}
            </Badge>
            <Badge tone={saved.autoShipOnConfirm ? "warn" : "neutral"}>
              <Truck className="h-2.5 w-2.5" aria-hidden />
              {saved.autoShipOnConfirm
                ? `Books ${COURIER_PREFERENCE_LABEL[saved.autoShipCourier].toLowerCase()} automatically`
                : "Draft only"}
            </Badge>
            {isFullyUnattended(saved) && (
              <Badge tone="danger">
                <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
                No human in the loop
              </Badge>
            )}
            {dirty && <Badge tone="accent">Unsaved changes</Badge>}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </button>

      {/* Conditionally rendered, never hidden with a transform — see the
          "Modal pattern" note in CLAUDE.md. */}
      {open && (
        <div className="space-y-4 border-t border-border bg-muted/20 p-3">
          {/* ---- 1. Confirmation mode ---- */}
          <fieldset className="min-w-0">
            <legend className="mb-1.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              When does an order confirm itself?
              <InfoTip term="Confirming an order">
                Confirming is the point an order stops being a request and
                becomes work: the customer is emailed and the shipment is
                staged with NimbusPost. Until an order is confirmed, nothing
                reaches the courier.
              </InfoTip>
            </legend>

            <div className="space-y-1.5">
              {(["manual", "byPayment", "auto"] as OrderConfirmMode[]).map((mode) => (
                <ModeOption
                  key={mode}
                  name={radioName}
                  mode={mode}
                  checked={form.orderConfirmMode === mode}
                  onSelect={() => set("orderConfirmMode", mode)}
                />
              ))}
            </div>
          </fieldset>

          {/* ---- 2. Per-method flags: only meaningful under byPayment ---- */}
          {form.orderConfirmMode === "byPayment" && (
            <div className="rounded-lg border border-border bg-card p-2.5">
              <p className="mb-1.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Which payment methods confirm themselves
                <InfoTip term="Per-method confirmation">
                  Ticked means that kind of order skips the queue. Prepaid and
                  part-paid orders only confirm once their payment has actually
                  verified, so an abandoned checkout never slips through.
                </InfoTip>
              </p>

              <div className="space-y-0.5">
                <CheckRow
                  label="Prepaid — paid in full online"
                  checked={form.autoConfirmPrepaid}
                  onChange={(v) => set("autoConfirmPrepaid", v)}
                  tip="The money is already in your account and the address was good enough for the payment to clear. This is the safest one to automate."
                />
                <CheckRow
                  label="Part-paid — advance online, balance on delivery"
                  checked={form.autoConfirmPartial}
                  onChange={(v) => set("autoConfirmPartial", v)}
                  tip="An advance has been paid, which is what proves the customer wants the parcel. The courier still collects the balance at the door — only the balance, never the full total."
                />
                <CheckRow
                  label="Cash on delivery — nothing paid yet"
                  checked={form.autoConfirmCod}
                  onChange={(v) => set("autoConfirmCod", v)}
                  tone={form.autoConfirmCod ? "warn" : undefined}
                  tip="Nobody has paid anything. A fake name and address costs the store a forward and a return leg, which is why this is off by default and why most stores ring the customer first."
                />
              </div>
            </div>
          )}

          {/* ---- 3. Shipment ---- */}
          <div className="rounded-lg border border-border bg-card p-2.5">
            <p className="mb-1.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              What happens when an order is confirmed
              <InfoTip term="Draft vs booked">
                A draft is an unbooked order sitting in NimbusPost: no courier,
                no AWB and no charge. Booking allocates the courier, generates
                the AWB and takes the money out of your NimbusPost wallet.
              </InfoTip>
            </p>

            <SwitchRow
              tone="bare"
              label="Book the shipment automatically"
              detail={
                form.autoShipOnConfirm
                  ? "Confirming books an AWB and charges your wallet."
                  : "Confirming stages a draft and stops. You book it."
              }
              checked={form.autoShipOnConfirm}
              onChange={(v) => set("autoShipOnConfirm", v)}
              tip="Off is the default and the recommended setting: every order is staged as a draft so you can check the address and the price before any money moves. On removes that check — the courier is allocated and your wallet charged with nobody looking."
            />

            {form.autoShipOnConfirm && (
              <div className="mt-2 border-t border-border pt-2">
                <p className="mb-1.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Which courier to book
                  <InfoTip term="Courier preference">
                    Cheapest picks the lowest total charge to your wallet.
                    Fastest picks the shortest quoted transit time, which
                    usually costs more. A courier that quotes no delivery
                    estimate is never treated as the fast one.
                  </InfoTip>
                </p>
                <Segmented<AutoShipCourier>
                  ariaLabel="Courier preference"
                  value={form.autoShipCourier}
                  onChange={(v) => set("autoShipCourier", v)}
                  options={[
                    { value: "cheapest", label: COURIER_PREFERENCE_LABEL.cheapest },
                    { value: "fastest", label: COURIER_PREFERENCE_LABEL.fastest },
                  ]}
                />
              </div>
            )}
          </div>

          {/* ---- 4. The combination that needs saying out loud ---- */}
          {unattended && (
            <div className="rounded-lg border border-danger/40 bg-danger/10 p-2.5">
              <p className="flex items-start gap-1.5 text-xs font-medium text-danger">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  Automatic + book automatically = no human in the loop.
                </span>
              </p>
              <p className="mt-1 pl-5 text-xs leading-relaxed text-foreground">
                Every order placed on the store will confirm itself and book a
                real courier, charging your NimbusPost wallet, before you have
                seen it. A wrong address, a joke order or a cash-on-delivery
                order nobody intends to accept all go out the same way, and the
                only way to stop one is to cancel the shipment in NimbusPost
                before the courier collects.
              </p>
              <p className="mt-1 pl-5 text-xs leading-relaxed text-muted-foreground">
                If you want the speed without the exposure, keep{" "}
                <b className="text-foreground">Book automatically</b> off: orders
                still confirm themselves instantly, and each one waits as a free
                draft for one press of Book.
              </p>
            </div>
          )}

          {/* ---- Save ---- */}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
            {dirty && (
              <p className="mr-auto text-[11px] text-muted-foreground">
                Not saved yet — nothing changes until you press Save.
              </p>
            )}
            <Btn tone="ghost" onClick={reset} disabled={!dirty || pending}>
              Reset
            </Btn>
            <Btn tone="solid" onClick={save} disabled={!dirty || pending}>
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save automation
            </Btn>
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Pieces                                                             */
/* ------------------------------------------------------------------ */

/** One radio in the mode group: label, one line of consequence, an (i). */
function ModeOption({
  name,
  mode,
  checked,
  onSelect,
}: {
  name: string;
  mode: OrderConfirmMode;
  checked: boolean;
  onSelect: () => void;
}) {
  const copy = MODE_COPY[mode];
  return (
    <div
      className={cn(
        "flex min-h-11 items-start gap-1 rounded-lg border bg-card transition-colors",
        checked ? "border-accent bg-accent/5" : "border-border"
      )}
    >
      {/* The label IS the target, so the whole row is tappable rather than a
          16px dot at the left edge. */}
      <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-start gap-2 p-2.5">
        <input
          type="radio"
          name={name}
          checked={checked}
          onChange={onSelect}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--accent)]"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium leading-tight">
            {CONFIRM_MODE_LABEL[mode]}
            {mode === "manual" && (
              <span className="ml-1.5 text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
                recommended
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            {copy.blurb}
          </span>
        </span>
      </label>
      <span className="grid h-11 w-9 shrink-0 place-items-center">
        <InfoTip term={CONFIRM_MODE_LABEL[mode]}>{copy.tip}</InfoTip>
      </span>
    </div>
  );
}

/** A real checkbox in a 44px hit area, with the row as its visible label. */
function CheckRow({
  label,
  checked,
  onChange,
  tip,
  tone,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  tip: string;
  tone?: "warn";
}) {
  return (
    <div className="flex min-h-11 items-center gap-1">
      <Check checked={checked} onChange={onChange} label={label} />
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="min-h-11 min-w-0 flex-1 cursor-pointer rounded-sm text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        tabIndex={-1}
        aria-hidden="true"
      >
        <span
          className={cn(
            checked && tone === "warn" && "text-orange-600 dark:text-orange-400"
          )}
        >
          {label}
        </span>
      </button>
      <InfoTip term={label}>{tip}</InfoTip>
    </div>
  );
}
