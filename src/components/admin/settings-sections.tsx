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
  CreditCard,
  HandCoins,
  KeyRound,
  Loader2,
  Truck,
  Upload,
  X,
} from "lucide-react";
import { InfoTip } from "@/components/store/info-tip";
import { ExpandableText } from "@/components/store/expandable-text";
import { Card, Check, SwitchRow } from "@/components/admin/form-kit";
import { Badge, Btn } from "@/components/admin/order-ui";
import { DispatchSettings } from "@/components/admin/dispatch-settings";
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
  DISPATCH_MODE_LABEL,
  isFullyUnattended,
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
  /**
   * Razorpay key pair present in the environment. A **boolean and nothing
   * else** — the values themselves must never cross to the browser, so the
   * server answers "is it configured?" rather than handing over what it found.
   */
  razorpayConfigured: boolean;
  /** NimbusPost key pair present in the environment. Same rule. */
  nimbusConfigured: boolean;
  /**
   * `NIMBUSPOST_WAREHOUSE_NAME` — the pickup warehouse's label in the
   * NimbusPost dashboard. Not a secret (it is a name, not a credential), and
   * worth showing: a mismatch here is the commonest reason a booking collects
   * from the wrong address.
   */
  nimbusWarehouse: string;
  /** `SiteSettings.currency` — stored, and rendered by nothing. */
  currency: string;
  /**
   * Active products, and how many of them allow each **offerable** payment
   * mode. `"direct"` is not counted: nothing offers it, so a count would
   * describe something that cannot happen.
   */
  catalogue: {
    active: number;
    byMode: Record<Exclude<PaymentMode, "direct">, number>;
  };
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
/*  1. Store — brand, copy, contact                                    */
/* ------------------------------------------------------------------ */

/**
 * Store, Storefront and Email, merged.
 *
 * They were three tabs and are now one, because they were never three errands.
 * "What is the shop called", "what does the home page say" and "where do my
 * alerts go" are the same sitting-down, and two of the fields only make sense
 * next to each other: the public contact email and the private alert address
 * exist as a pair, and the entire point of the second is that it is not the
 * first. Reading them on two different tabs is what made that impossible to
 * check at a glance.
 *
 * Every control came across. The shape is the same three levels the rest of
 * this screen uses, which is what keeps one tab from becoming a wall:
 *
 *   **Open** — the announcement bar and the hero. The two things rewritten for
 *   a sale, and the only two here that change more than once a year.
 *   **Folded** — five `SetOnce` groups: identity, contact & social, about copy,
 *   product-page copy, alerts. Each is one closed row with a live summary.
 *   **Behind an (i)** — every explanation longer than its label.
 *
 * Contact and Social were two folds and are now one: both answer "how do people
 * reach you", both are published in the footer, and neither was more than four
 * fields. Nothing else was regrouped — a fold that merges two unlike things to
 * save a row is how a summary stops being able to tell the truth.
 */
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
  const sameAsPublic =
    f.adminNotifyEmail.trim().toLowerCase() === f.contactEmail.trim().toLowerCase();

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

      {/* ---- Weekly: the first screen a visitor sees ----
          Open rather than folded, and second rather than fifth: after the
          announcement strip it is the most-rewritten copy on the store, and
          its headline is the home page's H1 — the line search engines read as
          the subject of the whole site. */}
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

      {/* ---- Set once: identity ---- */}
      <SetOnce
        label="Brand identity"
        summary={f.brandName}
        tip="The name, the line under it and the mark. Nothing here is hardcoded anywhere in the store — the header, the browser tab, order emails, the sitemap and the home-screen app icon all read these three values."
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

      {/* ---- Set once: how customers reach you ----
          Contact and Social were two folds. They are one because they answer
          one question — how does a person get hold of you — and both are
          published in the same footer. */}
      <SetOnce
        label="Contact & social"
        summary={
          socials.length === 0
            ? `${f.contactEmail} · no social links`
            : `${f.contactEmail} · ${socials.length} social link${socials.length === 1 ? "" : "s"}`
        }
        tip="Published on the store — the contact page, the footer and order emails. This is what a customer uses to reach you, so it is not the address the courier collects from, and not where your own alerts are sent (that is Your alerts, further down this tab). Each social link is rendered only when it is filled in, so an empty box removes the icon rather than leaving a dead link."
        dirty={anyDirty(isDirty, [
          "contactEmail",
          "contactPhone",
          "whatsapp",
          "address",
          "instagram",
          "facebook",
        ])}
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

      {/* ---- Set once: the long copy (was the Storefront tab) ---- */}
      <SetOnce
        label="About text"
        summary={`${f.aboutText.length} characters`}
        tip="Used on the About page and as the fallback description for link previews and search results when a page has none of its own."
        dirty={isDirty("aboutText")}
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
      </SetOnce>

      <SetOnce
        label="Product page info"
        summary="Materials & Care · Shipping & Delivery"
        tip={
          <>
            The accordion under every product, written once here and inherited
            by the whole catalogue — a product only needs its own version when
            it genuinely differs. One line per bullet, and an empty box hides
            that section across the store. The accordion has five blocks: two
            are set here, <b>Product details</b> is each product&apos;s own
            description, <b>Customer reviews</b> is driven by approved reviews,
            and <b>Returns &amp; refunds</b> belongs to the Returns tab.
          </>
        }
        dirty={anyDirty(isDirty, ["defaultMaterialsCare", "defaultShippingInfo"])}
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
      </SetOnce>

      {/* ---- Set once: where the store writes to YOU (was the Email tab) ----
          Deliberately the last fold and deliberately on this tab: it is one
          address, it is set once, and its whole meaning is "not the contact
          email six rows above". The summary says which of the two it is, so
          the commonest mistake — both pointing at one inbox — is visible
          without opening the fold. */}
      <SetOnce
        label="Your alerts"
        summary={
          sameAsPublic
            ? `${f.adminNotifyEmail} — same as public`
            : f.adminNotifyEmail
        }
        tip="Where the store writes to you — a new order, a new enquiry, a new interested customer. This address is never shown to a customer, which is why it is separate from the public contact email above. Customer-facing email (the order confirmation, the status update, the return decision) goes out through Resend and replies come back to your contact email, not to this one."
        dirty={isDirty("adminNotifyEmail")}
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

        <div className="min-w-0">
          <div className="label flex items-center gap-1">
            <span>Other channels</span>
            <InfoTip term="Other channels">
              Two more ways the store reaches people. Neither has a setting to
              configure — each one is a message you compose and send, so each
              has its own screen.
            </InfoTip>
          </div>
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
    dispatchOnConfirm: f.dispatchOnConfirm,
    // Derived, never edited: the draft holds Q1 once, as the enum, and the
    // action writes both columns from it. Carried here only because
    // `PipelineSettings` still declares it for callers that have not migrated.
    autoShipOnConfirm: f.dispatchOnConfirm === "book",
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

      {/*
       * ════════════════════════════════════════════════════════════════════
       *  MOUNTED — the dispatch-on-confirmation control
       * ════════════════════════════════════════════════════════════════════
       *
       * `DispatchSettings` is owned by the dispatch work
       * (`src/components/admin/dispatch-settings.tsx`) and replaced the
       * "Book the shipment automatically" switch that used to sit here. That
       * boolean could only say draft (false) or book (true); the enum it
       * carries adds the third answer the owner actually wanted — leave the
       * courier alone entirely — and lets a carrier be pinned by name.
       *
       * It is **fully controlled**: no state, no save, no server action. This
       * form still owns the draft, the dirty tracking and the one write, so
       * `SiteSettings` keeps one writer per column. It renders a `<div>` whose
       * controls are all `type="button"`, so nesting it in this form cannot
       * submit anything.
       *
       * `title={null}` because the `Card` already draws the heading, the (i)
       * and the state badge — its own header would be a second one.
       */}
      <Card
        title="What happens on confirmation"
        tip="Confirming is the point an order stops being a request and becomes work. This is how far that goes on its own: nothing at all, a free unbooked draft in NimbusPost, or a booked AWB paid for out of your NimbusPost wallet. Whatever you choose, every order can still be dispatched by hand from the orders screen."
        aside={
          <Badge tone={f.dispatchOnConfirm === "book" ? "warn" : "neutral"}>
            {DISPATCH_MODE_LABEL[f.dispatchOnConfirm]}
          </Badge>
        }
      >
        <DispatchSettings
          title={null}
          dispatchOnConfirm={f.dispatchOnConfirm}
          autoShipCourier={f.autoShipCourier}
          onChangeDispatch={(v) => set("dispatchOnConfirm", v)}
          onChangeCourier={(v) => set("autoShipCourier", v)}
          courierLive={courierLive}
          dirtyDispatch={isDirty("dispatchOnConfirm")}
          dirtyCourier={isDirty("autoShipCourier")}
        />
      </Card>

      {/* ---- The combination that needs saying out loud ----
          This one stays printed. It is not standing explanation: it appears
          only in the single configuration that spends real money with nobody
          looking, and a warning behind an (i) is a warning nobody reads. */}
      {unattended && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 p-2.5">
          <p className="flex items-start gap-1.5 text-xs font-medium text-danger">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>Automatic + book the AWB = no human in the loop.</span>
          </p>
          <p className="mt-1 pl-5 text-xs leading-relaxed text-foreground">
            Every order confirms itself and books a real courier, charging your
            NimbusPost wallet, before you have seen it.
            <InfoTip term="No human in the loop">
              A wrong address, a joke order or a cash-on-delivery order nobody
              intends to accept all go out the same way, and the only way to
              stop one is to cancel the shipment in NimbusPost before the
              courier collects. If you want the speed without the exposure, set
              confirmation to <b>Stage a draft</b>: orders still confirm
              themselves instantly, and each one waits as a free draft for one
              press of Ship now.
            </InfoTip>
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
/*  3. Payments & charges                                              */
/* ------------------------------------------------------------------ */

/**
 * **Three modes, two instruments.**
 *
 * The instruments are cash and online-through-Razorpay; the three modes are the
 * only useful arrangements of them — all online, all cash, or one of each. A
 * fourth used to sit here, "Customised order — pay to owner", and it has been
 * removed from checkout entirely. It was never a way of paying: it was a way of
 * deferring the question, and it was also the mode checkout silently fell back
 * to when nothing else was available, which meant switching every real method
 * off did not close checkout at all.
 *
 * That is why the "all off" warning below is phrased the way it is. There is no
 * fallback now. Nothing available means nothing is offered, the shopper is told
 * so, and the server refuses the order rather than reinterpreting it.
 */
const METHOD_META: {
  mode: Exclude<PaymentMode, "direct">;
  key: "codEnabled" | "prepaidEnabled" | "partialEnabled";
  label: string;
  icon: React.ReactNode;
  needsGateway: boolean;
  tip: string;
}[] = [
  {
    mode: "prepaid",
    key: "prepaidEnabled",
    label: "Pay online in full",
    icon: <CreditCard className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />,
    needsGateway: true,
    tip: "Paid in full before dispatch. The money has cleared before anything is packed, so this is the cheapest order you can take — and the only one with no cash-handling cost. Needs Razorpay on.",
  },
  {
    mode: "partial",
    key: "partialEnabled",
    label: "Part now, rest on delivery",
    icon: <HandCoins className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />,
    needsGateway: true,
    tip: "A percentage online now, the balance to the courier. The advance is what commits a made-to-order piece and covers you if the parcel is refused — which is why it is never refunded. The percentage is per product, in the product editor. Needs Razorpay on.",
  },
  {
    mode: "cod",
    key: "codEnabled",
    label: "Cash on delivery",
    icon: <Banknote className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />,
    needsGateway: false,
    tip: "The courier collects the full amount at the door. No gateway involved, so it keeps working with Razorpay off — and it is the only method that can cost you a forward and a return leg with nothing collected.",
  },
];

export function PaymentsSection({ f, set, isDirty, facts }: SectionProps) {
  const gatewayReady = f.razorpayEnabled && facts.razorpayConfigured;

  /** Mirrors `methodAvailability()` in actions/orders.ts. */
  const effective: Record<string, boolean> = {
    prepaid: f.prepaidEnabled && gatewayReady,
    partial: f.partialEnabled && gatewayReady,
    cod: f.codEnabled,
  };
  const liveCount = METHOD_META.filter((m) => effective[m.mode]).length;
  /** The one combination the save refuses — see `settings-form.tsx`. */
  const allOff = METHOD_META.every((m) => !f[m.key]);

  const codFee = Number(f.codFeeAmount) || 0;
  const partialFee = Number(f.partialFeeAmount) || 0;
  const threshold = Number(f.freeShippingThreshold);
  const thresholdSet = f.freeShippingThreshold.trim() !== "" && threshold > 0;

  return (
    <div className="space-y-4">
      {/* ---- Weekly: which methods are offered ---- */}
      <Card
        title="How customers can pay"
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

          All three switches off is refused on save, so say so. Nothing *live*
          is a state the save accepts — three switches on with the gateway off
          leaves only cash — and it deserves a warning rather than a block.
        */}
        {allOff ? (
          <div className="rounded-lg border border-danger/40 bg-danger/10 p-2.5">
            <p className="flex items-start gap-1.5 text-xs font-medium text-danger">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>All three methods are off — this will not save.</span>
            </p>
            <p className="mt-1 pl-5 text-xs leading-relaxed text-muted-foreground">
              There is no fourth option to fall back to. Checkout would have
              nothing to offer, every order would be refused, and the shop would
              look broken rather than closed. Leave at least one on, or take the
              products offline.
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
                {facts.razorpayConfigured ? " off" : " not configured"} — see the
                Integrations tab. Until that changes, nobody can check out.
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
            COD from a basket of four. If that leaves nothing, checkout says so
            and the order cannot be placed. The counts above are per product, not
            per basket, so they are the ceiling rather than the promise.
          </p>
        </ExpandableText>
      </Card>

      {/* ---- Weekly: what checkout adds to the basket ---- */}
      <Card
        title="What checkout adds"
        tip="Two charges that move the total after the products are priced. The cash-handling fees add, the free-shipping threshold takes away. Both are shown to the customer as their own line — a total that moves with no word for why is what makes people abandon a basket."
        aside={
          <Badge tone={codFee > 0 || partialFee > 0 ? "accent" : "neutral"}>
            {codFee > 0 || partialFee > 0 ? "Fees on" : "Absorbed"}
          </Badge>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Cash on delivery fee"
            type="number"
            inputMode="numeric"
            placeholder="0"
            value={f.codFeeAmount}
            dirty={isDirty("codFeeAmount")}
            onChange={(v) => set("codFeeAmount", v)}
            tip="Added to a cash-on-delivery order and collected at the door with the rest. NimbusPost charges you for collecting cash, so this is how you pass that on. 0 means you absorb it."
            hint={
              codFee > 0
                ? `${formatINR(codFee)} added to every COD order.`
                : "You absorb the collection charge."
            }
          />
          <TextField
            label="Part-payment fee"
            type="number"
            inputMode="numeric"
            placeholder="0"
            value={f.partialFeeAmount}
            dirty={isDirty("partialFeeAmount")}
            onChange={(v) => set("partialFeeAmount", v)}
            tip="Added to a part-paid order. There is still a cash leg at the door, so there is still a collection charge — usually smaller than a full COD one, because less cash is being handled. 0 means you absorb it."
            hint={
              partialFee > 0
                ? `${formatINR(partialFee)} added, collected with the balance.`
                : "You absorb the collection charge."
            }
          />
        </div>

        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          Paying online in full never carries a fee — there is no cash to
          collect. Whatever is charged is frozen onto the order, so changing
          these numbers never rewrites what a past customer paid, and it is{" "}
          <b>not refunded</b> on a return: the courier&apos;s charge was paid
          whatever happened to the goods.
        </p>

        <TextField
          label="Free shipping above"
          type="number"
          inputMode="numeric"
          placeholder="Leave empty for no threshold"
          value={f.freeShippingThreshold}
          dirty={isDirty("freeShippingThreshold")}
          onChange={(v) => set("freeShippingThreshold", v)}
          tip="Each product carries its own shipping rule — Free, a fixed fee, or live NimbusPost rates — set in the product editor. This threshold sits on top of all of them: once the basket subtotal reaches it, shipping is zero whatever the products say. It does not touch the cash-handling fees above."
          hint={
            thresholdSet
              ? `Baskets of ${formatINR(threshold)} or more ship free.`
              : "No threshold — every basket pays whatever its products charge."
          }
        />
        <Link
          href="/admin/products"
          className="inline-flex min-h-8 items-center text-[11px] font-medium uppercase tracking-wider text-accent transition-colors hover:text-foreground"
        >
          Per-product shipping rules
        </Link>
      </Card>

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
/*  4. Integrations — the two outside services                         */
/* ------------------------------------------------------------------ */

/**
 * Razorpay and NimbusPost in one place.
 *
 * They were in two: the gateway was folded into Payments and the courier had a
 * tab of its own called "Shipping" that held nothing else worth a tab. But they
 * are the same kind of thing and they fail the same way — a master switch in
 * the database, a key pair in the environment, and a store that looks fine
 * until the moment it needs the service. Asking "is the courier connected?" and
 * "is the gateway connected?" should not be two different errands.
 *
 * ## Secrets are never rendered
 *
 * The keys are environment variables, and this screen shows only **whether**
 * each pair is present — `isRazorpayConfigured()` / `isNimbusPostConfigured()`
 * return a boolean and nothing else crosses to the browser. There is
 * deliberately no input to edit them: a value that can be typed into a page can
 * be read back out of it, and a rotated key belongs in the deployment's
 * environment, where it is already encrypted at rest.
 */
export function IntegrationsSection({ f, set, isDirty, facts }: SectionProps) {
  const gatewayLive = f.razorpayEnabled && facts.razorpayConfigured;
  const courierLive = f.nimbusEnabled && facts.nimbusConfigured;

  return (
    <div className="space-y-4">
      <Card
        title="Razorpay — online payments"
        tip="The master switch for both online methods. With it off, paying online in full and part-paying both disappear from checkout no matter what their own switches say. Turning it on does not open a test mode — the keys the deployment holds are used as they are."
        aside={
          <Badge tone={gatewayLive ? "accent" : "neutral"}>
            {gatewayLive ? "Live" : facts.razorpayConfigured ? "Off" : "No keys"}
          </Badge>
        }
      >
        <SwitchRow
          label="Accept online payments"
          icon={<CreditCard className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
          checked={f.razorpayEnabled}
          onChange={(v) => set("razorpayEnabled", v)}
          className={isDirty("razorpayEnabled") ? "border-accent" : undefined}
          detail={
            facts.razorpayConfigured
              ? f.razorpayEnabled
                ? "Customers can pay you online right now."
                : "Online methods are hidden at checkout."
              : "No Razorpay keys in this deployment — stays hidden either way."
          }
          tip="Switching this on makes the two online methods available; whether each is actually offered is still its own switch on the Payments tab."
        />

        <KeyStatus
          configured={facts.razorpayConfigured}
          names={["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"]}
          what="online payments"
        />

        {gatewayLive && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 p-2.5">
            <p className="flex items-start gap-1.5 text-xs font-medium text-danger">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>Real money can move while this is on.</span>
            </p>
            <p className="mt-1 pl-5 text-xs leading-relaxed text-muted-foreground">
              Checkout uses whichever keys the deployment holds. If they are live
              keys, a customer paying is a real charge and a real refund to undo.
              Leave this off while you are demonstrating the store.
            </p>
          </div>
        )}
      </Card>

      <Card
        title="NimbusPost — courier"
        tip="The connection itself: with it off, no order and no return pickup can reach the courier at all. Whether a confirmed order is booked automatically or waits as a free draft is a separate decision, and it is on the Orders tab."
        aside={
          <Badge tone={courierLive ? "accent" : "neutral"}>
            {courierLive ? "Connected" : facts.nimbusConfigured ? "Off" : "No keys"}
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
          tip="Switching this on does not book anything by itself. Confirmed orders are staged as unbooked drafts — free, no courier, no AWB — and a human presses Ship now. Whether that review gate applies is set on the Orders tab."
        />

        <KeyStatus
          configured={facts.nimbusConfigured}
          names={["NIMBUSPOST_API_KEY", "NIMBUSPOST_API_SECRET"]}
          what="every dispatch call"
        />

        {/* The warehouse name is not a secret — it is a label in the NimbusPost
            dashboard — and it is the single most common reason a booking goes
            to the wrong pickup address, so it is worth stating. */}
        <dl className="space-y-1.5 rounded-lg border border-border bg-muted/40 p-3">
          <ReadRow
            label="Pickup warehouse"
            value={facts.nimbusWarehouse || "Not set — the primary one is used"}
            tip="NIMBUSPOST_WAREHOUSE_NAME, matched against the warehouses on your NimbusPost account by name, display name or code. A name that matches nothing falls back to your primary warehouse with a warning rather than failing the booking."
          />
          <ReadRow
            label="Set in"
            value="Deployment environment"
            tone="muted"
            tip="Like the key pair, this is an environment variable rather than a setting — changing it is a deployment change, not a save on this screen."
          />
        </dl>
      </Card>

      <p className="rounded-2xl border border-dashed border-border bg-muted/20 p-4 text-xs leading-relaxed text-muted-foreground">
        <b className="text-foreground">Keys are never shown here.</b> Both key
        pairs live in the deployment&apos;s environment variables, and this
        screen reads only whether they are present — the values never reach the
        browser and there is no field to type one into. To rotate a key, change
        it where it is set and redeploy; nothing on this page needs to change.
      </p>
    </div>
  );
}

/**
 * Whether a key pair is configured — and never what it is.
 *
 * Deliberately binary. A masked value ("rzp_live_••••3f2a") looks more helpful
 * and is worse: the prefix alone says which account and which mode, it invites
 * the question "can I edit it here?", and it is one careless change away from
 * being unmasked. Present or absent is the whole question this screen needs to
 * answer.
 */
function KeyStatus({
  configured,
  names,
  what,
}: {
  configured: boolean;
  names: [string, string];
  what: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-xs ${
        configured ? "border-border bg-muted/40" : "border-orange-500/40 bg-orange-500/10"
      }`}
    >
      {configured ? (
        <KeyRound className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
      ) : (
        <AlertTriangle
          className="h-3.5 w-3.5 shrink-0 text-orange-600 dark:text-orange-400"
          aria-hidden
        />
      )}
      <span className="font-medium">
        {configured ? "Key pair configured" : "No key pair"}
      </span>
      <span className="min-w-0 text-muted-foreground">
        {configured ? (
          <>
            Set as{" "}
            <code className="font-mono text-[11px]">{names[0]}</code> and{" "}
            <code className="font-mono text-[11px]">{names[1]}</code> — values
            are not readable from this screen.
          </>
        ) : (
          <>
            Set <code className="font-mono text-[11px]">{names[0]}</code> and{" "}
            <code className="font-mono text-[11px]">{names[1]}</code> in the
            deployment, or {what} is skipped whatever the switch says.
          </>
        )}
      </span>
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
        tip="Used on the About page and as the fallback description for link previews and search results when a page has none of its own."
        dirty={isDirty("aboutText")}
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
      </SetOnce>

      <SetOnce
        label="Product page info"
        summary="Materials & Care · Shipping & Delivery"
        tip={
          <>
            The accordion under every product, written once here and inherited
            by the whole catalogue — a product only needs its own version when
            it genuinely differs. One line per bullet, and an empty box hides
            that section across the store. The accordion has five blocks: two
            are set here, <b>Product details</b> is each product&apos;s own
            description, <b>Customer reviews</b> is driven by approved reviews,
            and <b>Returns &amp; refunds</b> belongs to the Returns tab.
          </>
        }
        dirty={anyDirty(isDirty, ["defaultMaterialsCare", "defaultShippingInfo"])}
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
        tip="Where the store writes to you — a new order, a new enquiry, a new interested customer. This address is never shown to a customer, which is why it is separate from the public contact email. Customer-facing email (the order confirmation, the status update, the return decision) goes out through Resend and replies come back to your contact email on the Store tab, not to this one."
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
      </Card>

      <SetOnce
        label="Other channels"
        summary="Push · Newsletter"
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
