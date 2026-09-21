"use client";

/**
 * settings-sections — one component per tab of Admin → Settings.
 *
 * Each section edits `SettingsDraft` through a single `set()` and renders the
 * read-only mirrors that belong beside it. No section owns state; the shell in
 * `settings-form.tsx` does, which is why switching tabs cannot lose an edit.
 *
 * Where a column is written by another screen it appears here through
 * `ManagedElsewhere` — value visible, no input, one link to its owner.
 */

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  BadgeIndianRupee,
  Banknote,
  CreditCard,
  HandCoins,
  Loader2,
  Truck,
  Upload,
  X,
} from "lucide-react";
import { InfoTip } from "@/components/store/info-tip";
import { ExpandableText } from "@/components/store/expandable-text";
import { Card, SwitchRow } from "@/components/admin/form-kit";
import { Badge, Btn } from "@/components/admin/order-ui";
import {
  AreaField,
  LinesField,
  ManagedElsewhere,
  ReadRow,
  TextField,
  type DraftKey,
  type SettingsDraft,
} from "@/components/admin/settings-ui";
import { formatINR } from "@/lib/utils";
import {
  CONFIRM_MODE_LABEL,
  COURIER_PREFERENCE_LABEL,
  isFullyUnattended,
  type PipelineSettings,
} from "@/lib/orders-pipeline";
import type { PaymentMode } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Facts the server supplies                                          */
/* ------------------------------------------------------------------ */

/**
 * Everything the sections need that is not an editable column: the two
 * environment checks, the catalogue's payment coverage, and the current value
 * of every column another screen owns.
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
  /** Owned by Admin → Returns → Return policy. */
  returns: {
    returnsEnabled: boolean;
    defaultReturnable: boolean;
    returnWindowDays: number;
    returnReasonCount: number;
    returnsInfoBullets: number;
    refundFeePercent: number;
    refundFeeFlat: number;
    partialAdvanceRefundable: boolean;
    waiveRefundFeeOnOurFault: boolean;
  };
  /** Owned by Admin → Orders → Order automation. */
  pipeline: PipelineSettings;
};

export type SectionProps = {
  f: SettingsDraft;
  set: <K extends DraftKey>(key: K, value: SettingsDraft[K]) => void;
  /** True for a field that differs from the last saved value. */
  isDirty: (key: DraftKey) => boolean;
  facts: SettingsFacts;
};

const RETURNS_HREF = "/admin/returns?tab=policy";
const ORDERS_HREF = "/admin/orders";

/* ------------------------------------------------------------------ */
/*  1. Brand & identity                                                */
/* ------------------------------------------------------------------ */

export function BrandSection({ f, set, isDirty }: SectionProps) {
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

  return (
    <div className="space-y-4">
      <Card
        title="Brand"
        tip="The name and strapline used in the header, the browser tab, order emails, the sitemap and the home-screen app icon. Nothing is hardcoded — change it here and it changes everywhere."
      >
        <TextField
          label="Brand name"
          required
          maxLength={60}
          value={f.brandName}
          dirty={isDirty("brandName")}
          onChange={(v) => set("brandName", v)}
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
      </Card>

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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  2. Contact & social                                                */
/* ------------------------------------------------------------------ */

export function ContactSection({ f, set, isDirty }: SectionProps) {
  return (
    <div className="space-y-4">
      <Card
        title="Contact"
        tip="Published on the store — the contact page, the footer and the order emails. This is what a customer uses to reach you, so it is not the same thing as the address the courier collects from."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Contact email"
            type="email"
            inputMode="email"
            required
            value={f.contactEmail}
            dirty={isDirty("contactEmail")}
            onChange={(v) => set("contactEmail", v)}
            tip="Shown publicly and used as the reply-to on customer emails. Admin alerts go somewhere else — see the Email tab."
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
      </Card>

      <Card
        title="Social"
        tip="Each link is rendered in the footer only when it is filled in, so an empty box removes the icon rather than leaving a dead link."
      >
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
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  3. Storefront copy                                                 */
/* ------------------------------------------------------------------ */

export function CopySection({ f, set, isDirty }: SectionProps) {
  return (
    <div className="space-y-4">
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

      <Card
        title="About"
        tip="Used on the About page and as the fallback description for link previews and search results when a page has none of its own."
      >
        <AreaField
          label="About text"
          rows={6}
          maxLength={2000}
          value={f.aboutText}
          dirty={isDirty("aboutText")}
          onChange={(v) => set("aboutText", v)}
          hint={`${f.aboutText.length}/2000 characters`}
        />
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  4. Payments                                                        */
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
  const r = facts.returns;
  const fee =
    r.refundFeePercent === 0 && r.refundFeeFlat === 0
      ? "Full refund, no deduction"
      : [
          r.refundFeePercent > 0 ? `${r.refundFeePercent}%` : null,
          r.refundFeeFlat > 0 ? formatINR(r.refundFeeFlat) : null,
        ]
          .filter(Boolean)
          .join(" + ");

  return (
    <div className="space-y-4">
      {/* ---- Gateway ---- */}
      <Card
        title="Razorpay"
        tip="The payment gateway. It is the master switch for both online methods: with it off, Prepaid and Advance + COD disappear from checkout no matter what their own switches say."
        aside={
          <Badge tone={gatewayReady ? "accent" : "neutral"}>
            {gatewayReady ? "Live" : "Off"}
          </Badge>
        }
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
          tip="Turning this on does not open a test mode. The keys in the deployment are used as they are, and if they are live keys the next customer to check out moves real money."
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
      </Card>

      {/* ---- Methods ---- */}
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

      {/* ---- Mirrors ---- */}
      <ManagedElsewhere
        title="Refunds"
        href={RETURNS_HREF}
        where="Returns → Return policy"
        why="What a refund deducts is decided with the rest of the return policy, on the screen where refunds are actually approved. A second copy here could disagree with the one that does the arithmetic."
      >
        <ReadRow label="Deduction on a refund" value={fee} />
        <ReadRow
          label="Advance on a part-paid order"
          value={r.partialAdvanceRefundable ? "Refunded" : "Not refunded"}
        />
        <ReadRow
          label="Fee when the fault is ours"
          value={r.waiveRefundFeeOnOurFault ? "Waived" : "Still charged"}
          tone={r.waiveRefundFeeOnOurFault ? undefined : "warn"}
        />
      </ManagedElsewhere>

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
/*  5. Shipping & fulfilment                                           */
/* ------------------------------------------------------------------ */

export function ShippingSection({ f, set, isDirty, facts }: SectionProps) {
  const threshold = Number(f.freeShippingThreshold);
  const thresholdSet = f.freeShippingThreshold.trim() !== "" && threshold > 0;
  const p = facts.pipeline;

  return (
    <div className="space-y-4">
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
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
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

      <Card
        title="NimbusPost"
        tip="The courier integration. Off, nothing is ever sent to NimbusPost and orders are dispatched by hand — a courier outage then cannot touch your checkout."
        aside={
          <Badge tone={f.nimbusEnabled && facts.nimbusConfigured ? "accent" : "neutral"}>
            {f.nimbusEnabled && facts.nimbusConfigured ? "Connected" : "Off"}
          </Badge>
        }
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
          tip="Switching this on does not book anything by itself. Confirmed orders are staged as unbooked drafts — free, no courier, no AWB — and a human presses Book. That review gate is set on the Orders screen."
        />
        {!facts.nimbusConfigured && (
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            No <code className="font-mono text-[11px]">NIMBUSPOST_API_KEY</code> /{" "}
            <code className="font-mono text-[11px]">NIMBUSPOST_API_SECRET</code>{" "}
            is set, so every dispatch call is skipped regardless of this switch.
          </p>
        )}
      </Card>

      <ManagedElsewhere
        title="Order automation"
        href={ORDERS_HREF}
        where="Orders → Order automation"
        why="Confirming and booking are operational decisions taken while looking at the queue they act on, so they live above that queue rather than in branding. Booking also spends real money from the courier wallet."
      >
        <ReadRow
          label="Orders confirm"
          value={CONFIRM_MODE_LABEL[p.orderConfirmMode]}
          tone={p.orderConfirmMode === "auto" ? "warn" : undefined}
        />
        {p.orderConfirmMode === "byPayment" && (
          <ReadRow
            label="Confirms itself"
            value={
              [
                p.autoConfirmPrepaid ? "Prepaid" : null,
                p.autoConfirmPartial ? "Part-paid" : null,
                p.autoConfirmCod ? "COD" : null,
              ]
                .filter(Boolean)
                .join(", ") || "Nothing"
            }
            tone={p.autoConfirmCod ? "warn" : undefined}
          />
        )}
        <ReadRow
          label="On confirmation"
          value={
            p.autoShipOnConfirm
              ? `Books ${COURIER_PREFERENCE_LABEL[p.autoShipCourier].toLowerCase()} automatically`
              : "Stages a free draft, you book it"
          }
          tone={p.autoShipOnConfirm ? "warn" : undefined}
        />
        {isFullyUnattended(p) && (
          <ReadRow label="Review gate" value="No human in the loop" tone="warn" />
        )}
      </ManagedElsewhere>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  6. Product defaults                                                */
/* ------------------------------------------------------------------ */

export function ProductSection({ f, set, isDirty, facts }: SectionProps) {
  const r = facts.returns;
  return (
    <div className="space-y-4">
      <Card
        title="Product page info"
        tip="The accordion under every product. Written once here and inherited by the whole catalogue; a product only needs its own version when it genuinely differs. One line per bullet, and an empty box hides that section across the store."
      >
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

        <ExpandableText lines={2} contentClassName="text-xs leading-relaxed text-muted-foreground">
          <p>
            The accordion has five blocks. Two are set here. <b>Product
            details</b> is each product&apos;s own description, <b>Customer
            reviews</b> is driven by{" "}
            <Link href="/admin/reviews" className="text-accent underline underline-offset-2">
              approved reviews
            </Link>
            , and <b>Returns &amp; refunds</b> belongs to the return policy —
            see below.
          </p>
        </ExpandableText>
      </Card>

      <ManagedElsewhere
        title="Returns"
        href={RETURNS_HREF}
        where="Returns → Return policy"
        why="One screen owns returns end to end — the switch, the window, the accepted reasons and the customer-facing copy — so the rule the storefront enforces and the words it shows can never disagree."
      >
        <ReadRow
          label="Returns"
          value={r.returnsEnabled ? "Accepted" : "Switched off"}
          tone={r.returnsEnabled ? undefined : "warn"}
        />
        <ReadRow label="Window" value={`${r.returnWindowDays} days after delivery`} />
        <ReadRow
          label="Catalogue default"
          value={r.defaultReturnable ? "Returnable" : "Not returnable"}
          tip="Applies to every product that has not set its own answer. A made-to-order piece overrides it."
        />
        <ReadRow label="Reasons offered" value={`${r.returnReasonCount}`} />
        <ReadRow
          label="Returns & refunds block"
          value={
            r.returnsInfoBullets === 0
              ? "Empty — hidden on product pages"
              : `${r.returnsInfoBullets} bullet${r.returnsInfoBullets === 1 ? "" : "s"}`
          }
          tone={r.returnsInfoBullets === 0 ? "warn" : undefined}
        />
      </ManagedElsewhere>
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
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          Customer-facing email — the order confirmation, the status update, the
          return decision — is sent through Resend and replies come back to your{" "}
          <b>contact email</b>, not this one.
        </p>
      </Card>

      <Card
        title="Other channels"
        tip="Two more ways the store reaches people. Neither has a setting to configure — each one is a message you compose and send, so each has its own screen."
      >
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
      </Card>
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
