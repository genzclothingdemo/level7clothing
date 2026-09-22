"use client";

/**
 * settings-sections — one component per tab of Admin → Settings.
 *
 * Each section edits `SettingsDraft` through a single `set()`. No section owns
 * state; the shell in `settings-form.tsx` does, which is why switching tabs
 * cannot lose an edit.
 *
 * ## The shape of a tab
 *
 * Three levels, applied everywhere, because this screen used to be one weight
 * of everything:
 *
 *   1. **On top, unfolded** — what the owner changes often. The announcement
 *      bar, the COD switch, when orders confirm themselves.
 *   2. **Behind a `SetOnce` fold** — what is decided once and then left. The
 *      logo, the studio address, the product-page accordion copy.
 *   3. **Behind an `(i)`** — every explanation longer than a label. Not a
 *      paragraph under the field, which is what made this a wall.
 *
 * The one exception is the Returns tab, which mounts the returns agent's
 * `ReturnPolicyCard` whole — it carries its own tree and its own Save.
 */

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  Banknote,
  BadgeIndianRupee,
  CreditCard,
  HandCoins,
  Loader2,
  Truck,
  Upload,
  X,
} from "lucide-react";
import { InfoTip } from "@/components/store/info-tip";
import { ExpandableText } from "@/components/store/expandable-text";
import { Card, Check, Segmented, SwitchRow } from "@/components/admin/form-kit";
import { Badge, Btn } from "@/components/admin/order-ui";
import {
  ReturnPolicyCard,
  type ReturnPolicyFacts,
  type ReturnPolicyValues,
} from "@/components/admin/return-policy-form";
import {
  AreaField,
  LinesField,
  ManagedElsewhere,
  ReadRow,
  SetOnce,
  TextField,
  type DraftKey,
  type SettingsDraft,
} from "@/components/admin/settings-ui";
import { formatINR } from "@/lib/utils";
import {
  CONFIRM_MODE_LABEL,
  COURIER_PREFERENCE_LABEL,
  isFullyUnattended,
  type AutoShipCourier,
  type OrderConfirmMode,
  type PipelineSettings,
} from "@/lib/orders-pipeline";
import type { PaymentMode } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Facts the server supplies                                          */
/* ------------------------------------------------------------------ */

/**
 * Everything the sections need that is not an editable column: the two
 * environment checks, the catalogue's payment coverage, and the return policy's
 * starting values for the card this screen now hosts.
 */
export type SettingsFacts = {
  /** Razorpay key pair present in the environment. */
  razorpayConfigured: boolean;
  /** NimbusPost key pair present in the environment. */
  nimbusConfigured: boolean;
  /** `SiteSettings.currency` — stored, and rendered by nothing. */
  currency: string;
  /** Active products, and how many of them allow each payment mode. */
  catalogue: { active: number; byMode: Record<PaymentMode, number> };
  /**
   * The return & refund policy as `ReturnPolicyCard` wants it. The card owns
   * its own draft and its own save (`updateReturnDefaults`), so these are a
   * starting point, not part of `SettingsDraft`.
   */
  returnPolicy: ReturnPolicyValues;
  returnFacts: ReturnPolicyFacts;
  /** Today, stamped on the server so the "closes on" preview cannot hydrate-drift. */
  todayISO: string;
};

export type SectionProps = {
  f: SettingsDraft;
  set: <K extends DraftKey>(key: K, value: SettingsDraft[K]) => void;
  /** True for a field that differs from the last saved value. */
  isDirty: (key: DraftKey) => boolean;
  facts: SettingsFacts;
};

/** True when any of these fields is unsaved — used to force a fold open. */
function anyDirty(isDirty: (k: DraftKey) => boolean, keys: DraftKey[]): boolean {
  return keys.some(isDirty);
}

/* ------------------------------------------------------------------ */
/*  1. Store — brand, contact, social                                  */
/* ------------------------------------------------------------------ */

export function StoreSection({ f, set, isDirty }: SectionProps) {
  const [uploading, setUploading] = useState(false);

  async function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok && data.url) {
        // Staged like any other edit — the upload is stored, but the column
        // is not written until Save, so the save bar stays truthful.
        set("logoUrl", data.url as string);
      } else {
        toast.error(data.error || "Upload failed");
      }
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  const socials = [f.instagram, f.facebook, f.whatsapp].filter((v) => v.trim());

  return (
    <div className="space-y-4">
      {/* ---- Weekly: the strip you change for a sale ---- */}
      <Card
        title="Announcement bar"
        tip="The thin strip above the header, on every page of the store. Leave it empty and the strip is not rendered at all — it is not hidden with CSS, so it costs nothing."
        aside={
          <Badge tone={f.announcement.trim() ? "accent" : "neutral"}>
            {f.announcement.trim() ? "Showing" : "Hidden"}
          </Badge>
        }
      >
        <TextField
          label="Message"
          maxLength={200}
          placeholder="Leave empty to hide the bar"
          value={f.announcement}
          dirty={isDirty("announcement")}
          onChange={(v) => set("announcement", v)}
          hint={`${f.announcement.length}/200 characters`}
        />
      </Card>

      {/* ---- Set once: identity ---- */}
      <SetOnce
        label="Brand identity"
        summary={f.brandName}
        dirty={anyDirty(isDirty, ["brandName", "tagline", "logoUrl"])}
      >
        <TextField
          label="Brand name"
          required
          maxLength={60}
          value={f.brandName}
          dirty={isDirty("brandName")}
          onChange={(v) => set("brandName", v)}
          tip="Used in the header, the browser tab, order emails, the sitemap and the home-screen app icon. Nothing is hardcoded — change it here and it changes everywhere."
        />
        <TextField
          label="Tagline"
          maxLength={120}
          value={f.tagline}
          dirty={isDirty("tagline")}
          onChange={(v) => set("tagline", v)}
          tip="Sits under the brand name in the footer and is the fallback description in search results and link previews."
        />

        <div className="min-w-0">
          <div className="label flex items-center gap-1">
            <span>Logo</span>
            <InfoTip term="Logo">
              A transparent PNG or SVG reads best — it sits on both the light
              and the dark header. With no logo the brand name is rendered as
              text, which is a perfectly good answer.
            </InfoTip>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {f.logoUrl ? (
              <div className="relative h-14 w-36 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
                <Image
                  src={f.logoUrl}
                  alt="Logo preview"
                  fill
                  sizes="144px"
                  className="object-contain p-1"
                />
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">
                No logo — the brand name is shown as text.
              </span>
            )}

            {/*
              Upload is a `<label>` wrapping a hidden file input rather than a
              button: a file picker can only be opened by a real input, and the
              label is what gives it a 44px target.
            */}
            <label
              className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-[11px] font-medium uppercase tracking-wider transition-colors sm:min-h-9 ${
                isDirty("logoUrl")
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border bg-card hover:bg-muted"
              }`}
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {f.logoUrl ? "Replace" : "Upload logo"}
              <input
                type="file"
                accept="image/*"
                onChange={onLogo}
                className="hidden"
                disabled={uploading}
              />
            </label>

            {/* A row of its own rather than a 20px dot on the preview — the
                overlay could never be a 44px target on a 56px-tall thumb. */}
            {f.logoUrl && (
              <Btn tone="ghost" onClick={() => set("logoUrl", "")}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                Remove
              </Btn>
            )}
          </div>
        </div>
      </SetOnce>

      {/* ---- Set once: how customers reach you ---- */}
      <SetOnce
        label="Contact details"
        summary={f.contactEmail}
        dirty={anyDirty(isDirty, [
          "contactEmail",
          "contactPhone",
          "whatsapp",
          "address",
        ])}
      >
        <p className="text-xs leading-relaxed text-muted-foreground">
          Published on the store — the contact page, the footer and order
          emails.
          <InfoTip term="Contact details">
            This is what a customer uses to reach you, so it is not the same
            thing as the address the courier collects from, and not the same
            thing as where your own alerts are sent (see the Email tab).
          </InfoTip>
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Contact email"
            type="email"
            inputMode="email"
            required
            value={f.contactEmail}
            dirty={isDirty("contactEmail")}
            onChange={(v) => set("contactEmail", v)}
            tip="Shown publicly and used as the reply-to on customer emails."
          />
          <TextField
            label="Contact phone"
            type="tel"
            inputMode="tel"
            maxLength={40}
            value={f.contactPhone}
            dirty={isDirty("contactPhone")}
            onChange={(v) => set("contactPhone", v)}
          />
          <TextField
            label="WhatsApp number"
            type="tel"
            inputMode="tel"
            maxLength={24}
            placeholder="+919000000000"
            value={f.whatsapp}
            dirty={isDirty("whatsapp")}
            onChange={(v) => set("whatsapp", v)}
            tip="With the country code and no spaces. It becomes a wa.me link, and a number without the country code opens an empty chat."
          />
          <TextField
            label="Studio address"
            maxLength={240}
            value={f.address}
            dirty={isDirty("address")}
            onChange={(v) => set("address", v)}
          />
        </div>
      </SetOnce>

      {/* ---- Set once: social ---- */}
      <SetOnce
        label="Social links"
        summary={
          socials.length === 0
            ? "None — icons hidden"
            : `${socials.length} link${socials.length === 1 ? "" : "s"}`
        }
        dirty={anyDirty(isDirty, ["instagram", "facebook"])}
      >
        <p className="text-xs leading-relaxed text-muted-foreground">
          Each link is rendered in the footer only when it is filled in, so an
          empty box removes the icon rather than leaving a dead link.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Instagram URL"
            type="url"
            inputMode="url"
            placeholder="https://instagram.com/…"
            value={f.instagram}
            dirty={isDirty("instagram")}
            onChange={(v) => set("instagram", v)}
          />
          <TextField
            label="Facebook URL"
            type="url"
            inputMode="url"
            placeholder="https://facebook.com/…"
            value={f.facebook}
            dirty={isDirty("facebook")}
            onChange={(v) => set("facebook", v)}
          />
        </div>
      </SetOnce>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  2. Orders — the pipeline, moved here from /admin/orders            */
/* ------------------------------------------------------------------ */

/**
 * The order pipeline **is a setting**, and it now lives with the settings.
 *
 * It used to be an editable panel above the orders list, on the argument that
 * an operator wondering why nothing confirmed itself should not have to go and
 * find another screen. In practice the owner went looking for it here twice and
 * it was not here. So the editor moved and `/admin/orders` keeps a one-line
 * read-only status that links back — the opposite arrangement, and the one that
 * matches where people actually look.
 */
const MODE_COPY: Record<OrderConfirmMode, { blurb: string; tip: string }> = {
  manual: {
    blurb: "Nothing confirms itself. Every order waits for you.",
    tip: "The safest setting, and the default. Orders land in Pending — including ones already paid in full online — and stay there until you press Confirm. Nothing is staged with the courier until then.",
  },
  byPayment: {
    blurb: "Decide per payment method, using the three switches below.",
    tip: "The usual middle ground: let money that has already arrived skip the queue, and keep a human on the ones where it has not. A payment that failed never confirms, whatever these switches say.",
  },
  auto: {
    blurb: "Every order confirms itself the moment it is placed.",
    tip: "Fastest, and the only mode where a cash-on-delivery order from a made-up name and address is accepted with nobody looking at it. Two guards still hold: a failed payment never confirms, and a prepaid or part-paid order waits until its payment actually verifies.",
  },
};

export function OrdersSection({ f, set, isDirty, facts }: SectionProps) {
  const pipeline: PipelineSettings = {
    orderConfirmMode: f.orderConfirmMode,
    autoConfirmPrepaid: f.autoConfirmPrepaid,
    autoConfirmPartial: f.autoConfirmPartial,
    autoConfirmCod: f.autoConfirmCod,
    autoShipOnConfirm: f.autoShipOnConfirm,
    autoShipCourier: f.autoShipCourier,
  };
  const unattended = isFullyUnattended(pipeline);
  const courierLive = f.nimbusEnabled && facts.nimbusConfigured;

  return (
    <div className="space-y-4">
      {/* ---- Weekly: when does an order confirm itself ---- */}
      <Card
        title="When orders confirm"
        tip="Confirming is the point an order stops being a request and becomes work: the customer is emailed and a free, unbooked draft is staged with NimbusPost. Until an order is confirmed, nothing reaches the courier."
        aside={
          <Badge tone={f.orderConfirmMode === "auto" ? "warn" : "neutral"}>
            {CONFIRM_MODE_LABEL[f.orderConfirmMode]}
          </Badge>
        }
      >
        <div className="space-y-1.5">
          {(["manual", "byPayment", "auto"] as OrderConfirmMode[]).map((mode) => (
            <ModeOption
              key={mode}
              mode={mode}
              checked={f.orderConfirmMode === mode}
              dirty={isDirty("orderConfirmMode")}
              onSelect={() => set("orderConfirmMode", mode)}
            />
          ))}
        </div>

        {/* Only meaningful under byPayment — absent rather than disabled, so a
            rule that cannot apply is never shown as one that is in force. */}
        {f.orderConfirmMode === "byPayment" && (
          <div className="rounded-lg border border-border bg-muted/30 p-2.5">
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
                checked={f.autoConfirmPrepaid}
                dirty={isDirty("autoConfirmPrepaid")}
                onChange={(v) => set("autoConfirmPrepaid", v)}
                tip="The money is already in your account and the address was good enough for the payment to clear. This is the safest one to automate."
              />
              <CheckRow
                label="Part-paid — advance online, balance on delivery"
                checked={f.autoConfirmPartial}
                dirty={isDirty("autoConfirmPartial")}
                onChange={(v) => set("autoConfirmPartial", v)}
                tip="An advance has been paid, which is what proves the customer wants the parcel. The courier still collects the balance at the door — only the balance, never the full total."
              />
              <CheckRow
                label="Cash on delivery — nothing paid yet"
                checked={f.autoConfirmCod}
                dirty={isDirty("autoConfirmCod")}
                onChange={(v) => set("autoConfirmCod", v)}
                tone={f.autoConfirmCod ? "warn" : undefined}
                tip="Nobody has paid anything. A fake name and address costs the store a forward and a return leg, which is why this is off by default and why most stores ring the customer first."
              />
            </div>
          </div>
        )}
      </Card>

      {/* ---- Weekly-ish: what confirming then does ---- */}
      <Card
        title="What happens on confirmation"
        tip="A draft is an unbooked order sitting in NimbusPost: no courier, no AWB and no charge. Booking allocates the courier, generates the AWB and takes the money out of your NimbusPost wallet."
        aside={
          <Badge tone={f.autoShipOnConfirm ? "warn" : "neutral"}>
            {f.autoShipOnConfirm ? "Books automatically" : "Draft only"}
          </Badge>
        }
      >
        <SwitchRow
          label="Book the shipment automatically"
          icon={<Truck className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
          detail={
            f.autoShipOnConfirm
              ? "Confirming books an AWB and charges your wallet."
              : "Confirming stages a draft and stops. You book it."
          }
          checked={f.autoShipOnConfirm}
          onChange={(v) => set("autoShipOnConfirm", v)}
          className={isDirty("autoShipOnConfirm") ? "border-accent" : undefined}
          tip="Off is the default and the recommended setting: every order is staged as a draft so you can check the address and the price before any money moves. On removes that check — the courier is allocated and your wallet charged with nobody looking."
        />

        {f.autoShipOnConfirm && (
          <div className="rounded-lg border border-border bg-muted/30 p-2.5">
            <p className="mb-1.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Which courier to book
              <InfoTip term="Courier preference">
                Cheapest picks the lowest total charge to your wallet. Fastest
                picks the shortest quoted transit time, which usually costs
                more. A courier that quotes no delivery estimate is never
                treated as the fast one.
              </InfoTip>
            </p>
            <Segmented<AutoShipCourier>
              ariaLabel="Courier preference"
              value={f.autoShipCourier}
              onChange={(v) => set("autoShipCourier", v)}
              className={isDirty("autoShipCourier") ? "border-accent" : undefined}
              options={[
                { value: "cheapest", label: COURIER_PREFERENCE_LABEL.cheapest },
                { value: "fastest", label: COURIER_PREFERENCE_LABEL.fastest },
              ]}
            />
          </div>
        )}

        {!courierLive && (
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            NimbusPost is{" "}
            {facts.nimbusConfigured
              ? "switched off in Shipping"
              : "not configured in this deployment"}
            , so nothing is staged or booked whatever this says. Confirming
            still emails the customer.
          </p>
        )}
      </Card>

      {/* ---- The combination that needs saying out loud ---- */}
      {unattended && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 p-2.5">
          <p className="flex items-start gap-1.5 text-xs font-medium text-danger">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>Automatic + book automatically = no human in the loop.</span>
          </p>
          <p className="mt-1 pl-5 text-xs leading-relaxed text-foreground">
            Every order placed on the store will confirm itself and book a real
            courier, charging your NimbusPost wallet, before you have seen it. A
            wrong address, a joke order or a cash-on-delivery order nobody
            intends to accept all go out the same way, and the only way to stop
            one is to cancel the shipment in NimbusPost before the courier
            collects.
          </p>
          <p className="mt-1 pl-5 text-xs leading-relaxed text-muted-foreground">
            If you want the speed without the exposure, keep{" "}
            <b className="text-foreground">Book the shipment automatically</b>{" "}
            off: orders still confirm themselves instantly, and each one waits
            as a free draft for one press of Ship now.
          </p>
        </div>
      )}
    </div>
  );
}

/** One radio in the mode group: label, one line of consequence, an (i). */
function ModeOption({
  mode,
  checked,
  dirty,
  onSelect,
}: {
  mode: OrderConfirmMode;
  checked: boolean;
  dirty: boolean;
  onSelect: () => void;
}) {
  const copy = MODE_COPY[mode];
  return (
    <div
      className={`flex min-h-11 items-start gap-1 rounded-lg border bg-card transition-colors ${
        checked
          ? dirty
            ? "border-accent bg-accent/10"
            : "border-accent bg-accent/5"
          : "border-border"
      }`}
    >
      {/* The label IS the target, so the whole row is tappable rather than a
          16px dot at the left edge. */}
      <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-start gap-2 p-2.5">
        <input
          type="radio"
          name="settings-order-confirm-mode"
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
  dirty,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  tip: string;
  tone?: "warn";
  dirty?: boolean;
}) {
  return (
    <div className="flex min-h-11 items-center gap-1">
      <Check checked={checked} onChange={onChange} label={label} />
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="min-h-11 min-w-0 flex-1 cursor-pointer rounded-sm text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        tabIndex={-1}
        aria-hidden="true"
      >
        <span
          className={[
            checked && tone === "warn" ? "text-orange-600 dark:text-orange-400" : "",
            dirty ? "font-medium text-accent" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {label}
        </span>
      </button>
      <InfoTip term={label}>{tip}</InfoTip>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  3. Payments                                                        */
/* ------------------------------------------------------------------ */

const METHOD_META: {
  mode: PaymentMode;
  key: "codEnabled" | "prepaidEnabled" | "partialEnabled" | "directEnabled";
  label: string;
  icon: React.ReactNode;
  needsGateway: boolean;
  tip: string;
}[] = [
  {
    mode: "prepaid",
    key: "prepaidEnabled",
    label: "Prepaid — pay online",
    icon: <CreditCard className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />,
    needsGateway: true,
    tip: "Paid in full before dispatch. The money has cleared before anything is packed, so this is the cheapest order you can take. Needs Razorpay on.",
  },
  {
    mode: "cod",
    key: "codEnabled",
    label: "Cash on delivery",
    icon: <Banknote className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />,
    needsGateway: false,
    tip: "The courier collects the full amount at the door. No gateway involved, so it keeps working with Razorpay off — and it is the only method that can cost you a forward and a return leg with nothing collected.",
  },
  {
    mode: "partial",
    key: "partialEnabled",
    label: "Advance + COD",
    icon: <HandCoins className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />,
    needsGateway: true,
    tip: "A percentage is paid online now and the balance to the courier. The advance is what commits a made-to-order piece to production. The per-product percentage is set in the product editor. Needs Razorpay on.",
  },
  {
    mode: "direct",
    key: "directEnabled",
    label: "Customised order — pay to owner",
    icon: <BadgeIndianRupee className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />,
    needsGateway: false,
    tip: "No online payment: the order is placed as a request and you arrange payment yourself. This is also the fallback checkout drops to when nothing else is available, so turning it off does not stop orders — it only removes the option from the list.",
  },
];

export function PaymentsSection({ f, set, isDirty, facts }: SectionProps) {
  const gatewayReady = f.razorpayEnabled && facts.razorpayConfigured;

  /** Mirrors `methodAvailability()` in actions/orders.ts. */
  const effective: Record<PaymentMode, boolean> = {
    prepaid: f.prepaidEnabled && gatewayReady,
    partial: f.partialEnabled && gatewayReady,
    cod: f.codEnabled,
    direct: f.directEnabled,
  };
  const liveCount = METHOD_META.filter((m) => effective[m.mode]).length;
  /** The one combination the server refuses — see `updateSettings`. */
  const allOff = METHOD_META.every((m) => !f[m.key]);

  return (
    <div className="space-y-4">
      {/* ---- Weekly: which methods are offered ---- */}
      <Card
        title="Checkout methods"
        tip="Three things have to agree before a method is offered: this switch, the gateway (for the two online methods), and the product's own allowed methods. A method is shown only where all three say yes — which is why a switch here can remove an option that every product in the catalogue allows."
        aside={
          <Badge tone={liveCount === 0 ? "danger" : liveCount === 1 ? "warn" : "neutral"}>
            {liveCount} live
          </Badge>
        }
      >
        <div className="space-y-2">
          {METHOD_META.map((m) => {
            const on = f[m.key];
            const live = effective[m.mode];
            const allow = facts.catalogue.byMode[m.mode];
            return (
              <SwitchRow
                key={m.mode}
                label={m.label}
                icon={m.icon}
                checked={on}
                onChange={(v) => set(m.key, v)}
                tip={m.tip}
                className={isDirty(m.key) ? "border-accent" : undefined}
                detail={
                  on && !live && m.needsGateway
                    ? "On here, but hidden — Razorpay is off."
                    : `${allow} of ${facts.catalogue.active} products allow it`
                }
              />
            );
          })}
        </div>

        {/*
          Two different failures, and they are not the same rule.

          All four switches off is refused by the server, so say so. Nothing
          *live* is a state the server accepts — four switches on with the
          gateway off leaves prepaid and partial hidden — and it deserves a
          warning rather than a block, because it is a legitimate way to run
          a made-to-order store.
        */}
        {allOff ? (
          <div className="rounded-lg border border-danger/40 bg-danger/10 p-2.5">
            <p className="flex items-start gap-1.5 text-xs font-medium text-danger">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>All four methods are off — this will not save.</span>
            </p>
            <p className="mt-1 pl-5 text-xs leading-relaxed text-muted-foreground">
              Turning everything off does not close checkout: it falls back to
              Customised order and every shopper places a pay-the-owner request
              instead. The server refuses the save rather than let that happen
              quietly.
            </p>
          </div>
        ) : (
          liveCount === 0 && (
            <div className="rounded-lg border border-orange-500/40 bg-orange-500/10 p-2.5">
              <p className="flex items-start gap-1.5 text-xs font-medium text-orange-600 dark:text-orange-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>Nothing is offered at checkout right now.</span>
              </p>
              <p className="mt-1 pl-5 text-xs leading-relaxed text-muted-foreground">
                The only methods still on need Razorpay, and Razorpay is
                {facts.razorpayConfigured ? " off" : " not configured"}. Every
                order will be placed as a Customised order until that changes.
              </p>
            </div>
          )
        )}

        <ExpandableText lines={2} contentClassName="text-xs leading-relaxed text-muted-foreground">
          <p>
            A product lists the methods it accepts in the product editor, and a
            product that lists none is treated as Prepaid + COD. Checkout offers
            the methods that <b>every</b> item in the basket allows, then hides
            any that are off here — so one item allowing only Prepaid removes
            COD from a basket of four. If that leaves nothing, the order becomes
            a Customised order. The counts above are per product, not per
            basket, so they are the ceiling rather than the promise.
          </p>
        </ExpandableText>
      </Card>

      {/* ---- Set once: the gateway ---- */}
      <SetOnce
        label="Razorpay gateway"
        summary={gatewayReady ? "Live" : facts.razorpayConfigured ? "Off" : "No keys"}
        dirty={isDirty("razorpayEnabled")}
      >
        <SwitchRow
          label="Accept online payments"
          checked={f.razorpayEnabled}
          onChange={(v) => set("razorpayEnabled", v)}
          detail={
            facts.razorpayConfigured
              ? f.razorpayEnabled
                ? "Customers can pay you online right now."
                : "Online methods are hidden at checkout."
              : "No Razorpay keys in this deployment — stays hidden either way."
          }
          className={isDirty("razorpayEnabled") ? "border-accent" : undefined}
          tip="The master switch for both online methods: with it off, Prepaid and Advance + COD disappear from checkout no matter what their own switches say. Turning it on does not open a test mode — the keys in the deployment are used as they are."
        />

        {!facts.razorpayConfigured && (
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            No <code className="font-mono text-[11px]">RAZORPAY_KEY_ID</code> /{" "}
            <code className="font-mono text-[11px]">RAZORPAY_KEY_SECRET</code> is
            set, so online methods stay hidden even with this switch on.
          </p>
        )}

        {f.razorpayEnabled && facts.razorpayConfigured && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 p-2.5">
            <p className="flex items-start gap-1.5 text-xs font-medium text-danger">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>Real money can move while this is on.</span>
            </p>
            <p className="mt-1 pl-5 text-xs leading-relaxed text-muted-foreground">
              Checkout uses whichever keys the deployment holds. If they are
              live keys, a customer paying is a real charge and a real refund to
              undo. Leave this off while you are demonstrating the store.
            </p>
          </div>
        )}
      </SetOnce>

      {/* ---- Fixed in code ---- */}
      <ManagedElsewhere
        title="Currency"
        why="SiteSettings.currency is a real column and nothing reads it — prices go through formatINR and the Razorpay order is created in INR, both hard-wired. It is listed here rather than given an input, because a control that changes nothing is worse than no control."
        note={
          <>
            Fixed in code, not a setting. Selling in a second currency means
            changing how prices are formatted and how the gateway order is
            created — not flipping a value here.
          </>
        }
      >
        <ReadRow label="Stored value" value={facts.currency} />
        <ReadRow label="Prices rendered in" value="INR (₹), fixed" tone="muted" />
        <ReadRow label="Gateway charges in" value="INR, fixed" tone="muted" />
      </ManagedElsewhere>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  4. Shipping & fulfilment                                           */
/* ------------------------------------------------------------------ */

export function ShippingSection({ f, set, isDirty, facts }: SectionProps) {
  const threshold = Number(f.freeShippingThreshold);
  const thresholdSet = f.freeShippingThreshold.trim() !== "" && threshold > 0;

  return (
    <div className="space-y-4">
      {/* ---- Weekly: the one number that changes for a promotion ---- */}
      <Card
        title="Shipping charges"
        tip="Each product carries its own shipping rule — Free, a fixed fee, or live NimbusPost rates — set in the product editor. This threshold sits on top of all of them: once the basket subtotal reaches it, shipping is zero whatever the products say."
      >
        <TextField
          label="Free shipping above"
          type="number"
          inputMode="numeric"
          placeholder="Leave empty for no threshold"
          value={f.freeShippingThreshold}
          dirty={isDirty("freeShippingThreshold")}
          onChange={(v) => set("freeShippingThreshold", v)}
          hint={
            thresholdSet
              ? `Baskets of ${formatINR(threshold)} or more ship free.`
              : "No threshold — every basket pays whatever its products charge."
          }
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Per-product shipping and parcel size live on each product, under{" "}
          <Link
            href="/admin/products"
            className="text-accent underline underline-offset-2"
          >
            Products
          </Link>
          {" → "}Shipping settings &amp; parcel size.
        </p>
      </Card>

      {/* ---- Set once: the courier integration ---- */}
      <SetOnce
        label="NimbusPost courier"
        summary={
          f.nimbusEnabled && facts.nimbusConfigured ? "Connected" : "Off"
        }
        dirty={isDirty("nimbusEnabled")}
      >
        <SwitchRow
          label="Automated shipping"
          icon={<Truck className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
          checked={f.nimbusEnabled}
          onChange={(v) => set("nimbusEnabled", v)}
          className={isDirty("nimbusEnabled") ? "border-accent" : undefined}
          detail={
            facts.nimbusConfigured
              ? f.nimbusEnabled
                ? "Drafts, AWBs and tracking sync from order cards."
                : "Order cards cannot reach the courier."
              : "No NimbusPost keys in this deployment."
          }
          tip="Switching this on does not book anything by itself. Confirmed orders are staged as unbooked drafts — free, no courier, no AWB — and a human presses Ship now. Whether that review gate applies is set on the Orders tab."
        />
        {!facts.nimbusConfigured && (
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            No <code className="font-mono text-[11px]">NIMBUSPOST_API_KEY</code> /{" "}
            <code className="font-mono text-[11px]">NIMBUSPOST_API_SECRET</code>{" "}
            is set, so every dispatch call is skipped regardless of this switch.
          </p>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          Whether a confirmed order is booked automatically or waits as a free
          draft is decided on the <b>Orders</b> tab.
        </p>
      </SetOnce>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  5. Returns & refunds                                               */
/* ------------------------------------------------------------------ */

/**
 * ════════════════════════════════════════════════════════════════════
 *  MOUNT POINT — the return & refund policy form
 * ════════════════════════════════════════════════════════════════════
 *
 * `ReturnPolicyCard` is owned by the returns/refunds work
 * (`src/components/admin/return-policy-form.tsx`) and is mounted here whole. It
 * carries its own draft, its own `Save` and its own writer
 * (`updateReturnDefaults` in `actions/returns.ts`), which is why these eleven
 * columns are deliberately **absent from `SettingsDraft`** — the shared save bar
 * must never be able to write a column this screen does not own.
 *
 * `/admin/returns?tab=policy` now shows `ReturnPolicySummary`, read-only, and
 * links here through `RETURN_POLICY_HREF` — which is `?tab=returns`, i.e. this
 * tab. If that constant and this tab key ever disagree the link lands on Store.
 */
export function ReturnsSection({ facts }: SectionProps) {
  return (
    <div className="space-y-4">
      <ReturnPolicyCard
        initial={facts.returnPolicy}
        facts={facts.returnFacts}
        todayISO={facts.todayISO}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  6. Storefront copy & product defaults                              */
/* ------------------------------------------------------------------ */

export function StorefrontSection({ f, set, isDirty }: SectionProps) {
  return (
    <div className="space-y-4">
      {/* ---- The most-rewritten copy on the store ---- */}
      <Card
        title="Home page hero"
        tip="The first screen a visitor sees. The headline is also the page's H1, so it is what search engines read as the subject of the site."
      >
        <TextField
          label="Hero headline"
          maxLength={120}
          value={f.heroHeadline}
          dirty={isDirty("heroHeadline")}
          onChange={(v) => set("heroHeadline", v)}
        />
        <AreaField
          label="Hero subtext"
          rows={3}
          maxLength={400}
          value={f.heroSubtext}
          dirty={isDirty("heroSubtext")}
          onChange={(v) => set("heroSubtext", v)}
          hint={`${f.heroSubtext.length}/400 characters`}
        />
      </Card>

      {/* ---- Set once ---- */}
      <SetOnce
        label="About text"
        summary={`${f.aboutText.length} characters`}
        dirty={isDirty("aboutText")}
      >
        <AreaField
          label="About text"
          rows={6}
          maxLength={2000}
          value={f.aboutText}
          dirty={isDirty("aboutText")}
          onChange={(v) => set("aboutText", v)}
          tip="Used on the About page and as the fallback description for link previews and search results when a page has none of its own."
          hint={`${f.aboutText.length}/2000 characters`}
        />
      </SetOnce>

      <SetOnce
        label="Product page info"
        summary="Materials & Care · Shipping & Delivery"
        dirty={anyDirty(isDirty, ["defaultMaterialsCare", "defaultShippingInfo"])}
      >
        <p className="text-xs leading-relaxed text-muted-foreground">
          The accordion under every product. Written once here and inherited by
          the whole catalogue; a product only needs its own version when it
          genuinely differs.
          <InfoTip term="Product page info">
            One line per bullet, and an empty box hides that section across the
            store. The accordion has five blocks — two are set here,{" "}
            <b>Product details</b> is each product&apos;s own description,{" "}
            <b>Customer reviews</b> is driven by approved reviews, and{" "}
            <b>Returns &amp; refunds</b> belongs to the Returns tab.
          </InfoTip>
        </p>
        <LinesField
          label="Materials & Care"
          value={f.defaultMaterialsCare}
          dirty={isDirty("defaultMaterialsCare")}
          onChange={(v) => set("defaultMaterialsCare", v)}
          tip="Fabric, wash and iron instructions. The most common thing a shopper opens before buying a tee."
        />
        <LinesField
          label="Shipping & Delivery"
          value={f.defaultShippingInfo}
          dirty={isDirty("defaultShippingInfo")}
          onChange={(v) => set("defaultShippingInfo", v)}
          tip="Dispatch time, tracking and COD availability as the customer reads them. This is copy, not a rule — it does not change what checkout actually charges."
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          <Link
            href="/admin/reviews"
            className="text-accent underline underline-offset-2"
          >
            Approved reviews
          </Link>{" "}
          drive the reviews block.
        </p>
      </SetOnce>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  7. Notifications & email                                           */
/* ------------------------------------------------------------------ */

export function EmailSection({ f, set, isDirty }: SectionProps) {
  const sameAsPublic =
    f.adminNotifyEmail.trim().toLowerCase() === f.contactEmail.trim().toLowerCase();

  return (
    <div className="space-y-4">
      <Card
        title="Your alerts"
        tip="Where the store writes to you — a new order, a new enquiry, a new interested customer. This address is never shown to a customer, which is why it is separate from the public contact email."
      >
        <TextField
          label="Send order & lead emails to"
          type="email"
          inputMode="email"
          required
          value={f.adminNotifyEmail}
          dirty={isDirty("adminNotifyEmail")}
          onChange={(v) => set("adminNotifyEmail", v)}
          hint={
            sameAsPublic
              ? "Same as your public contact email — your alerts and your customers share one inbox."
              : undefined
          }
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Customer-facing email — the order confirmation, the status update, the
          return decision — is sent through Resend and replies come back to your{" "}
          <b>contact email</b>, not this one.
        </p>
      </Card>

      <SetOnce label="Other channels" summary="Push · Newsletter">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Two more ways the store reaches people. Neither has a setting to
          configure — each one is a message you compose and send, so each has
          its own screen.
        </p>
        <div className="flex flex-wrap gap-2">
          <ChannelLink
            href="/admin/notifications"
            label="Push notifications"
            detail="Compose and broadcast"
          />
          <ChannelLink
            href="/admin/newsletter"
            label="Newsletter"
            detail="Subscriber list"
          />
        </div>
      </SetOnce>
    </div>
  );
}

/** A link styled as an admin button — used for the two send-only channels. */
function ChannelLink({
  href,
  label,
  detail,
}: {
  href: string;
  label: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 flex-col justify-center rounded-lg border border-border bg-card px-3 py-1.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <span className="text-[11px] font-medium uppercase tracking-wider">
        {label}
      </span>
      <span className="text-[10px] text-muted-foreground">{detail}</span>
    </Link>
  );
}
