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
 * Printed paragraphs are down to one shape, `Callout`: a warning about the
 * configuration as it is right now, headline printed and why behind its `(i)`.
 * A "how it works" paragraph is an `Explainer` row that opens in place, and a
 * value another tab owns is a `SeeAlso` link, never a read-only copy. See the
 * header of `settings-ui.tsx` for which to reach for.
 *
 * The one exception is the Returns tab, which mounts the returns agent's
 * `ReturnPolicyCard` whole — it carries its own tree and its own Save.
 */

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUpRight,
  Banknote,
  CreditCard,
  HandCoins,
  KeyRound,
  Loader2,
  Mail,
  Save,
  Smartphone,
  Truck,
  Upload,
  X,
} from "lucide-react";
import { InfoTip } from "@/components/store/info-tip";
import { Card, Check, SwitchRow } from "@/components/admin/form-kit";
import { Badge, Btn } from "@/components/admin/order-ui";
import { DispatchSettings } from "@/components/admin/dispatch-settings";
import {
  ReturnPolicyCard,
  type ReturnPolicyFacts,
  type ReturnPolicyValues,
} from "@/components/admin/return-policy-form";
import { TempAdminPanel } from "@/components/admin/temp-admin-panel";
// Types only. `lib/temp-admin.ts` is `server-only`; a type import is erased at
// build time, so this file never gains a runtime edge into it.
import type { AdminMode, TempAdminRow } from "@/lib/temp-admin";
import {
  AreaField,
  Callout,
  Explainer,
  FixedRow,
  LinesField,
  ReadRow,
  SeeAlso,
  SetOnce,
  TextField,
  type DraftKey,
  type SettingsDraft,
} from "@/components/admin/settings-ui";
import { NotificationMatrixCard } from "@/components/admin/notification-matrix";
// Runtime values and types from the one module that is safe on both sides —
// it has no directive and no server imports, so the server page builds the
// matrix with it and this client component renders the result.
import {
  identityTone,
  type ChannelFact,
  type NotificationMatrix,
  type SendingIdentity,
} from "@/lib/notification-channels";
import type { TabKey } from "@/lib/settings-tabs";
import { cn, formatINR } from "@/lib/utils";
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

  /**
   * Whether a one-time code can be sent by text, from `smsGateway()`.
   *
   * An environment fact, like the two key-pair booleans above, and it is on
   * this type for the same reason: the two phone switches must be able to say
   * "not in force" **in the card where they are set**. A store owner who
   * switches on "confirm the mobile" and is told nothing has a rule they do not
   * have, and finds out from a customer who could not check out.
   */
  sms: { ready: boolean; detail: string };

  /* ---- Alerts tab ---- */
  /**
   * Everything the notification matrix needs, built on the server.
   *
   * **`matrix` is a view over `AutomationRule`, not a stored grid.** See the
   * header of `lib/notification-channels.ts`: a tick is that table's
   * `isActive` column, resolved back to a real rule by the action. Nothing
   * about the owner's choices is kept anywhere else, which is the only way the
   * screen and the engine can be guaranteed to agree.
   *
   * `channels` carries `supported` derived from `IMPLEMENTED_ACTIONS`, so the
   * disabled cells on screen and the refusals on the server are the same list.
   */
  notifications: {
    channels: ChannelFact[];
    matrix: NotificationMatrix;
    identity: SendingIdentity;
  };

  /* ---- Access tab ---- */
  /**
   * Everyone who can sign in besides the owner, with their state and the newest
   * lines of their activity. Never a password hash — the panel has no use for
   * one and a secret rendered into a page is a secret that can be read from it.
   */
  tempAdmins: TempAdminRow[];
  /**
   * The **viewer's own** mode, not a setting.
   *
   * It decides whether this screen's controls are offered, and nothing more:
   * the permission itself is `requireAdminWrite` on the server. Passing it down
   * is what lets the UI reflect the rule instead of being it.
   */
  viewerMode: AdminMode;
  /** Set when the viewer is themselves a temporary admin — they cannot act on their own row. */
  viewerTempAdminId: string | null;
};

export type SectionProps = {
  f: SettingsDraft;
  set: <K extends DraftKey>(key: K, value: SettingsDraft[K]) => void;
  /** True for a field that differs from the last saved value. */
  isDirty: (key: DraftKey) => boolean;
  facts: SettingsFacts;
  /**
   * Switch to another tab without navigating.
   *
   * A section that mirrors a setting owned by another tab needs a way to send
   * the owner there, and a `<Link href="?tab=…">` is a real navigation — this
   * form holds one unsaved draft across all seven tabs, so that is a way to
   * lose an edit. The shell passes its own `selectTab`, which is the same
   * `history.replaceState` the tab bar uses.
   */
  goTab: (tab: TabKey) => void;
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
 *
 * ## No mirror of the Alerts tab
 *
 * This tab used to end on a read-only card restating three values the Alerts
 * tab owns — the alert inbox, the sender address and how many alerts were on —
 * so "the pair could be read side by side". The owner's rule is the opposite:
 * a fact has one home and every other screen *links* to it, and a restated
 * value is read as duplication, not as help. The same-inbox warning that card
 * carried is printed on Alerts, beside the only input for that address. What
 * is left here is one row of links, which is also the only way into the
 * newsletter list from anywhere in the admin — so it must not go.
 */
export function StoreSection({ f, set, isDirty, goTab }: SectionProps) {
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
  const bullets = (s: string) => s.split("\n").filter((l) => l.trim()).length;
  const care = bullets(f.defaultMaterialsCare);
  const shipping = bullets(f.defaultShippingInfo);

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
        tip="Published on the store — the contact page, the footer and order emails — and the address customers' replies come back to. It is not the address the courier collects from, and not where your own alerts go: that inbox is on the Alerts tab. A social link is shown only when it is filled in, so an empty box removes the icon rather than leaving a dead link."
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
        summary={
          care === 0 && shipping === 0
            ? "Both hidden"
            : `${care ? `${care} care` : "Care hidden"} · ${
                shipping ? `${shipping} shipping` : "shipping hidden"
              }`
        }
        tip={
          <>
            The accordion under every product, written once here and inherited
            by the whole catalogue — a product only needs its own version when
            it genuinely differs. One line per bullet; an empty box hides that
            section everywhere. Of its five blocks, two are set here,{" "}
            <b>Product details</b> is each product&apos;s own description,{" "}
            <b>Customer reviews</b> come from approved reviews, and{" "}
            <b>Returns &amp; refunds</b> belongs to the Returns tab.
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

      {/* Redirection, not a mirror — see "No mirror of the Alerts tab" above.
          The first link is a tab jump (`goTab`), because a real navigation
          would remount this form and drop an unsaved edit. */}
      <SeeAlso
        title="Elsewhere"
        tip="Where the store writes to people lives on its own screens. Your own alert inbox, the address customer mail is sent from, and which events send at all are on the Alerts tab. Push messages and the newsletter are composed and sent from their own pages — neither has anything to configure here."
        links={[
          { label: "Alerts & sender", onJump: () => goTab("alerts") },
          { label: "Push notifications", href: "/admin/notifications" },
          { label: "Newsletter", href: "/admin/newsletter" },
        ]}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  1b. Verification — what the store asks people to prove             */
/* ------------------------------------------------------------------ */

const VERIFY_KEYS_LOCAL = [
  "requireSignupEmailOtp",
  "requireSignupPhoneOtp",
  "requireVerifiedEmailToOrder",
  "requireVerifiedPhoneToOrder",
] as const satisfies readonly DraftKey[];

/**
 * Four switches, two channels, two moments — and one printed warning.
 *
 * ## Why all four are in one fold
 *
 * They are one question asked twice: *does this store want a code before it
 * believes a contact detail, at signup and again at checkout?* Splitting the
 * order-time pair onto the Orders tab would put half an answer on each of two
 * screens, and neither could then state what the store actually asks for. The
 * summary line on the closed fold is the whole policy in a few words.
 *
 * ## The warning is printed, not behind an (i)
 *
 * There is no SMS gateway. A mobile switch left on with nothing to send it
 * with is the one state that silently means something other than what it says,
 * so it is stated in red, in this card, the moment it applies — the same
 * treatment the fully-unattended dispatch combination gets on the Orders tab,
 * and for the same reason: a warning behind an (i) is a warning nobody reads.
 *
 * What "not in force" actually means is decided once, in `lib/otp.ts`, and
 * this card only reports it. `orderVerificationGate` does not block an order on
 * a channel that cannot deliver — refusing every sale with no action the
 * shopper could take is not a gate, it is an outage.
 */
function VerificationFold({ f, set, isDirty, facts }: SectionProps) {
  const dirty = anyDirty(isDirty, [...VERIFY_KEYS_LOCAL]);
  const smsReady = facts.sms.ready;

  const asks = [
    f.requireSignupEmailOtp && "email at signup",
    f.requireSignupPhoneOtp && "mobile at signup",
    f.requireVerifiedEmailToOrder && "email before ordering",
    f.requireVerifiedPhoneToOrder && "mobile before ordering",
  ].filter((v): v is string => typeof v === "string");

  const phoneOn = f.requireSignupPhoneOtp || f.requireVerifiedPhoneToOrder;

  return (
    <SetOnce
      label="Confirming contact details"
      summary={
        asks.length === 0 ? (
          "Nothing is asked"
        ) : phoneOn && !smsReady ? (
          <span className="font-medium text-danger">
            {asks.length} asked · mobile cannot be sent
          </span>
        ) : (
          `Asks for ${asks.join(", ")}`
        )
      }
      tip="Whether the store makes people prove a contact detail with a six-digit code, and when. A code is sent the moment it is needed and expires in ten minutes. Both are off to begin with: every account that already exists was created without one, and switching these on never invalidates an account — it only asks for a code the next time that moment comes round."
      dirty={dirty}
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <p className="eyebrow text-muted-foreground">
            When someone creates an account
          </p>
          <SwitchRow
            label="Confirm the email address"
            checked={f.requireSignupEmailOtp}
            onChange={(v) => set("requireSignupEmailOtp", v)}
            icon={<Mail className="h-4 w-4 text-muted-foreground" />}
            detail={
              f.requireSignupEmailOtp
                ? "A code is emailed before the account is created."
                : "Anyone can sign up with any address."
            }
            tip="The account is not created until the code checks out, so nothing half-made is ever written. It also means a typo in an address is caught at the one moment the customer is still looking at it."
          />
          <SwitchRow
            label="Confirm the mobile number"
            checked={f.requireSignupPhoneOtp}
            onChange={(v) => set("requireSignupPhoneOtp", v)}
            icon={<Smartphone className="h-4 w-4 text-muted-foreground" />}
            detail={
              !f.requireSignupPhoneOtp
                ? "The number is saved but not confirmed."
                : smsReady
                  ? "A code is texted before the account is created."
                  : "Nothing to send it with — signup continues unconfirmed."
            }
            tip="The mobile number is the identity on this store, so confirming it is the strongest check available — once there is something to text with."
          />
        </div>

        <div className="space-y-1.5">
          <p className="eyebrow text-muted-foreground">
            Before an order can be placed
          </p>
          <SwitchRow
            label="Require a confirmed email"
            checked={f.requireVerifiedEmailToOrder}
            onChange={(v) => set("requireVerifiedEmailToOrder", v)}
            icon={<Mail className="h-4 w-4 text-muted-foreground" />}
            detail={
              f.requireVerifiedEmailToOrder
                ? "Checkout stops and offers a code. The basket is kept."
                : "No check at checkout."
            }
            tip="Checkout does not dead-end: the order is held, a panel appears above the button with the code in it, and the same button places the order a minute later. Existing customers are asked once, the first time they order after you switch this on."
          />
          <SwitchRow
            label="Require a confirmed mobile"
            checked={f.requireVerifiedPhoneToOrder}
            onChange={(v) => set("requireVerifiedPhoneToOrder", v)}
            icon={<Smartphone className="h-4 w-4 text-muted-foreground" />}
            detail={
              !f.requireVerifiedPhoneToOrder
                ? "No check at checkout."
                : smsReady
                  ? "Checkout stops and offers a code. The basket is kept."
                  : "Not in force — orders are not blocked."
            }
            tip="A code has to be sendable for this to mean anything. With no SMS gateway it is deliberately NOT enforced: blocking every order over a code that cannot be sent would close the store, and there would be nothing the customer could do about it."
          />
        </div>

        {/* The one state that means something other than what it says. */}
        {phoneOn && !smsReady && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 p-2.5">
            <p className="flex items-start gap-1.5 text-xs font-medium text-danger">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>Mobile codes cannot be sent.</span>
            </p>
            <p className="mt-1 pl-5 text-xs leading-relaxed text-foreground">
              {facts.sms.detail} Signup carries on and says the number is
              unconfirmed; checkout is not blocked. Switch these back off, or
              connect a gateway — the code path is already built for it.
            </p>
          </div>
        )}
      </div>
    </SetOnce>
  );
}

/* ------------------------------------------------------------------ */
/*  1c. Alerts — one home for every notification decision              */
/* ------------------------------------------------------------------ */

/**
 * Alerts — **the single screen for "who gets told what, and how".**
 *
 * This is what the owner asked for in one sentence: centralise the sending
 * settings, and let every other screen link here instead of growing its own
 * copy. Before it, one question was answered in four places — the address mail
 * comes from was in the environment and on no screen, the address alerts go to
 * was a fold on Store, whether a customer has to prove an address was another
 * fold on Store, and whether any given event sends at all was a table on
 * Admin → Automation.
 *
 * Three cards, in the order the question is actually asked:
 *
 *   1. **Can mail leave at all, and from where.** First, because none of the
 *      rest means anything if it cannot. CLAUDE.md records the cost of getting
 *      this wrong: an `EMAIL_FROM` on a gmail.com address made Resend reject
 *      every send with a 403 for weeks while the code path returned cleanly,
 *      so order confirmations, password resets and contact replies were all
 *      silently undeliverable. This card shows the live verdict, not a label.
 *   2. **The grid** — every event, every recipient, every channel.
 *   3. **What the store asks people to prove** — the four one-time-code
 *      switches, moved here whole from Store. A channel is only as good as the
 *      contact detail behind it, so the decision to confirm one belongs on the
 *      screen that decides what gets sent to it.
 *
 * **One writer per key, as everywhere else on this screen.** The grid writes
 * `AutomationRule.isActive` through its own action and saves as you tick; the
 * alert address goes through `updateSettings` and the four switches through
 * `updateVerificationSettings`, both on the shared save bar. `contactEmail` is
 * the Store tab's and is shown here read-only with a jump — a second input for
 * it is exactly the `defaultReturnsInfo` trap.
 */
export function AlertsSection({ f, set, isDirty, facts, goTab }: SectionProps) {
  return (
    <div className="space-y-4">
      <SendingIdentityCard
        f={f}
        set={set}
        isDirty={isDirty}
        facts={facts}
        goTab={goTab}
      />

      <NotificationMatrixCard
        matrix={facts.notifications.matrix}
        channels={facts.notifications.channels}
        // The UI reflecting the rule, never being it: every write routes
        // through `requireAdminWrite` on the server, which refuses and records
        // a view-only holder whatever the browser chooses to send.
        canWrite={facts.viewerMode === "full"}
      />

      <VerificationFold
        f={f}
        set={set}
        isDirty={isDirty}
        facts={facts}
        goTab={goTab}
      />
    </div>
  );
}

/**
 * Where mail comes from, whether it can actually get out, and where your own
 * copy lands.
 *
 * The badge is the whole point of the card: **it states the live verdict, not
 * a hopeful label.** "Rejected" here is the thing that would otherwise be
 * discovered weeks later by a customer who never got their order confirmation.
 *
 * The sender itself is read-only because it is an environment variable and not
 * a column — the same rule the Integrations tab applies to the Razorpay and
 * NimbusPost keys. There is no input, so there is nothing to leak, and no way
 * to change it here into something Resend would reject.
 */
function SendingIdentityCard({ f, set, isDirty, facts, goTab }: SectionProps) {
  const id = facts.notifications.identity;
  const tone = identityTone(id);
  const sameAsPublic =
    f.adminNotifyEmail.trim().toLowerCase() === f.contactEmail.trim().toLowerCase();

  const badge =
    tone === "bad"
      ? { tone: "danger" as const, label: "Not delivering" }
      : tone === "warn"
        ? { tone: "warn" as const, label: "Test sender" }
        : { tone: "success" as const, label: "Sending" };

  return (
    <Card
      title="How mail leaves this store"
      tip="The one place the sending identity is stated. Who mail is from is set in the deployment's environment and shown here read-only; where replies land is your public contact email on the Store tab; where your own alerts land is the one field on this card. Resend only accepts a sender on a domain you have verified in your Resend account — a sender it will not accept is refused with a 403 and the store carries on as if it sent, which is why the verdict is printed rather than assumed."
      aside={<Badge tone={badge.tone}>{badge.label}</Badge>}
    >
      <dl className="space-y-1.5">
        <ReadRow
          label="Sent from"
          value={
            <span className="break-all font-mono text-[11px]">{id.from}</span>
          }
          tip="`EMAIL_FROM` in the deployment's environment. Not editable on any screen — it is a deployment setting, and an input for it here would be a way to break every send from a browser."
        />
        <ReadRow
          label="Resend key"
          value={id.hasApiKey ? "Set" : "Missing"}
          tone={id.hasApiKey ? undefined : "warn"}
          tip="Whether `RESEND_API_KEY` is present. The value is never rendered — a screen that prints a send key is a screen that leaks it into a screenshot. With no key nothing is sent at all; each message is skipped with a line in the log."
        />
        <ReadRow
          label="Replies go to"
          value={f.contactEmail || "Not set"}
          tip="Your public contact email, from the Store tab. It is what a customer replies to, and what the store tells people to write to."
        />
        {id.lastSent && (
          <ReadRow label="Last sent" value={id.lastSent} tone="muted" />
        )}
        {id.failedCount > 0 && (
          <ReadRow
            label="Failed"
            value={`${id.failedCount} in the queue`}
            tone="warn"
            tip={id.lastFailedError ?? undefined}
          />
        )}
        {!id.lastSent && id.failedCount === 0 && (
          <ReadRow
            label="Last sent"
            value="Nothing yet"
            tone="muted"
            tip="No rule has sent anything from this store since the queue was last cleared. That is normal for a new store, and a warning sign for a busy one."
          />
        )}
      </dl>

      {/* Printed, not behind an (i). A sender nobody can verify is the one
          state that silently means something other than what it says, and
          CLAUDE.md records that it went unnoticed for weeks. Same treatment as
          the unattended-dispatch warning on Orders. */}
      {tone !== "ok" && (
        <div
          className={cn(
            "rounded-lg border p-2.5",
            tone === "bad"
              ? "border-danger/40 bg-danger/10"
              : "border-orange-500/40 bg-orange-500/10"
          )}
        >
          <p
            className={cn(
              "flex items-start gap-1.5 text-xs font-medium",
              tone === "bad" ? "text-danger" : "text-orange-600 dark:text-orange-400"
            )}
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              {tone === "bad"
                ? "Mail is not reaching anybody."
                : "This is a test sender."}
            </span>
          </p>
          <p className="mt-1 pl-5 text-xs leading-relaxed text-foreground">
            {id.advice}
          </p>
        </div>
      )}

      {/* The one editable field on this card. Its writer is `updateSettings`,
          exactly as it was on Store — the move is which tab draws it, not
          which action owns it. */}
      <TextField
        label="Send my own alerts to"
        type="email"
        inputMode="email"
        required
        value={f.adminNotifyEmail}
        dirty={isDirty("adminNotifyEmail")}
        onChange={(v) => set("adminNotifyEmail", v)}
        tip="Where the store writes to you — a new order, a new enquiry, someone waiting in chat. Never shown to a customer, which is the whole reason it is separate from your public contact email."
        hint={
          sameAsPublic ? (
            <>
              Same as your public contact email, so your alerts and your
              customers share one inbox.{" "}
              <button
                type="button"
                onClick={() => goTab("store")}
                className="cursor-pointer text-accent underline-offset-2 hover:underline"
              >
                Change the public one on Store
              </button>
              .
            </>
          ) : undefined
        }
      />
    </Card>
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
    // Not "the three switches below": they only exist once this is picked,
    // so the sentence pointed at nothing while it was being chosen.
    blurb: "Paid orders can confirm themselves — you pick which methods.",
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
        <Callout
          tone="danger"
          term="No human in the loop"
          title="No human in the loop — every order confirms itself and books a paid AWB before you see it."
          tip={
            <>
              A wrong address, a joke order or a cash-on-delivery order nobody
              intends to accept all go out the same way, charged to your
              NimbusPost wallet, and the only way to stop one is to cancel the
              shipment in NimbusPost before the courier collects. For the speed
              without the exposure, set confirmation to <b>Stage a draft</b>:
              orders still confirm instantly, and each waits as a free draft for
              one press of Ship now.
            </>
          }
        />
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

export function PaymentsSection({ f, set, isDirty, facts, goTab }: SectionProps) {
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

  // The closed fold's one line: every number in it, so it never has to be
  // opened just to be read.
  const feeSummary =
    codFee === 0 && partialFee === 0
      ? "No cash fees"
      : [
          codFee > 0 && `COD +${formatINR(codFee)}`,
          partialFee > 0 && `part-pay +${formatINR(partialFee)}`,
        ]
          .filter(Boolean)
          .join(" · ");
  const shippingSummary = thresholdSet
    ? `free shipping over ${formatINR(threshold)}`
    : "no free-shipping threshold";

  return (
    <div className="space-y-4">
      {/* ---- Weekly: which methods are offered ---- */}
      <Card
        title="How customers can pay"
        tip="A method is offered at checkout only when three things agree: its switch here, Razorpay (for the two online methods), and every product in the basket. The line under each switch is how many active products allow it."
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
          <Callout
            tone="danger"
            title="All three are off — this will not save."
            tip="There is no fallback method. Checkout would have nothing to offer, every order would be refused, and the shop would look broken rather than closed. Leave at least one on, or take the products offline instead."
          />
        ) : (
          liveCount === 0 && (
            <Callout
              tone="warn"
              title="Nobody can check out right now."
              tip={`The methods still switched on all need Razorpay, and Razorpay is ${
                facts.razorpayConfigured ? "switched off" : "not configured"
              }. Until that changes, checkout has nothing to offer.`}
            >
              <button
                type="button"
                onClick={() => goTab("integrations")}
                className="cursor-pointer font-medium text-accent underline-offset-2 hover:underline"
              >
                Open Integrations
              </button>
            </Callout>
          )
        )}

        <Explainer label="How checkout decides">
          <p>
            A product lists the methods it accepts in the product editor; one
            that lists none is treated as Prepaid + COD. Checkout offers only
            the methods <b>every</b> item in the basket allows, then hides any
            switched off here — so one item that allows only Prepaid removes COD
            from a basket of four. If nothing is left, checkout says so and the
            order cannot be placed.
          </p>
          <p>
            The counts are per product, not per basket, so they are the ceiling
            rather than the promise.
          </p>
        </Explainer>
      </Card>

      {/* ---- Set once: what checkout adds to the basket ----
          Folded because it is decided once and then left, and the summary
          carries every number in it, so the closed row already answers "are we
          charging for cash?". `dirty` re-opens it on a tab switch, so an
          unsaved fee is never hidden behind a fold the save bar is promising
          to write. */}
      <SetOnce
        label="Checkout charges"
        summary={`${feeSummary} · ${shippingSummary}`}
        tip="What checkout adds or takes away after the products are priced: a flat fee for handling cash, and a basket total above which shipping is free. Each is shown to the customer as its own line — a total that moves with no word for why is what makes people abandon a basket."
        dirty={anyDirty(isDirty, [
          "codFeeAmount",
          "partialFeeAmount",
          "freeShippingThreshold",
        ])}
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
              : "Empty — every basket pays whatever its products charge."
          }
        />

        <Explainer label="How the fees behave">
          <p>
            Paying online in full never carries a fee — there is no cash to
            collect. A fee is frozen onto the order when it is placed, so
            changing these numbers never rewrites what a past customer paid.
          </p>
          <p>
            It is <b>not refunded</b> on a return: the courier&apos;s collection
            charge was paid whatever happened to the goods.
          </p>
        </Explainer>

        <Link
          href="/admin/products"
          className="inline-flex min-h-11 items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-accent transition-colors hover:text-foreground sm:min-h-8"
        >
          Per-product shipping rules
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </SetOnce>

      {/* ---- Fixed in code ----
          One line, not a card: a value nobody can edit should not carry the
          weight of the switches above it. */}
      <FixedRow
        label="Currency"
        value={
          facts.currency === "INR"
            ? "INR (₹) · fixed"
            : `INR (₹) · fixed — stored “${facts.currency}” is ignored`
        }
        tone={facts.currency === "INR" ? undefined : "warn"}
        tip="Prices are formatted in INR and the Razorpay order is created in INR, both in code. SiteSettings.currency is stored but nothing reads it, so it is shown rather than given an input — a control that changes nothing is worse than no control. Selling in a second currency is a code change, not a setting."
      />
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
          <Callout
            tone="danger"
            title="Real money can move while this is on."
            tip="Checkout uses whichever keys the deployment holds. If they are live keys, a customer paying is a real charge and a real refund to undo. Leave this off while you are demonstrating the store."
          />
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
            to the wrong pickup address, so it is worth stating. Where it is
            set used to be a second row; it is one clause of the (i) now. */}
        <dl className="rounded-lg border border-border bg-muted/40 px-3 py-2">
          <ReadRow
            label="Pickup warehouse"
            value={facts.nimbusWarehouse || "Not set — the primary one is used"}
            tip="NIMBUSPOST_WAREHOUSE_NAME, set in the deployment's environment like the keys — changing it is a redeploy, not a save here. It is matched against the warehouses on your NimbusPost account by name, display name or code; a name that matches nothing falls back to your primary warehouse with a warning rather than failing the booking."
          />
        </dl>
      </Card>
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
 *
 * Configured is one quiet line — it is the normal state and needs no reading —
 * with the variable names and the "never shown here" rule behind its `(i)`.
 * That rule used to be a paragraph of its own at the foot of the tab. Missing
 * is a warning, and prints the two names, because they are what to act on.
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
  if (!configured) {
    return (
      <Callout
        tone="warn"
        title={`No key pair in this deployment — ${what} is skipped whatever the switch says.`}
        term="No key pair"
        tip="The keys are environment variables, not settings. Add both where the deployment's environment is managed and redeploy; this screen only ever reads whether they are there."
      >
        Set <code className="font-mono text-[11px]">{names[0]}</code> and{" "}
        <code className="font-mono text-[11px]">{names[1]}</code>.
      </Callout>
    );
  }

  return (
    <p className="flex min-h-8 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
      <KeyRound className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
      <span className="font-medium text-foreground">Key pair set</span>
      in the deployment
      <InfoTip term="Keys">
        <code className="font-mono text-[11px]">{names[0]}</code> and{" "}
        <code className="font-mono text-[11px]">{names[1]}</code> are
        environment variables. This screen checks only that both are present —
        the values never reach the browser, and there is no field to type one
        into. To rotate a key, change it where it is set and redeploy.
      </InfoTip>
    </p>
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
 *
 * ## The one thing said around it
 *
 * Every other tab saves through the sticky bar, which appears the moment a
 * field changes. This one never shows it — the card is its own writer — and
 * its **Save policy** button is at the very end of the longest tab on the
 * screen. An owner who changes the window and waits for the bar waits forever.
 * So the tab opens on one line saying how it saves, with a jump to the button.
 * Nothing inside the card is touched from here.
 */
export function ReturnsSection({ facts }: SectionProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  function jumpToSave() {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // The card ends on its Save row, so aligning the card's end with the
    // viewport's puts the button on screen without reaching inside it.
    cardRef.current?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "end",
    });
  }

  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
        <Save className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          Saved on its own with <b className="font-medium text-foreground">Save policy</b>, not the bar other tabs use.
        </span>
        <button
          type="button"
          onClick={jumpToSave}
          className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-sm text-[11px] font-medium uppercase tracking-wider text-accent transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Go to Save
          <ArrowDown className="h-3 w-3" aria-hidden="true" />
        </button>
      </p>

      <div ref={cardRef} className="scroll-mb-4">
        <ReturnPolicyCard
          initial={facts.returnPolicy}
          facts={facts.returnFacts}
          todayISO={facts.todayISO}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  6. Access — temporary admins                                       */
/* ------------------------------------------------------------------ */

/**
 * ════════════════════════════════════════════════════════════════════
 *  MOUNT POINT — temporary admins and their activity
 * ════════════════════════════════════════════════════════════════════
 *
 * `TempAdminPanel` carries its own state and its own writers
 * (`app/actions/temp-admin.ts`), exactly as `ReturnPolicyCard` does above, so
 * none of these columns are part of `SettingsDraft` and the shared save bar can
 * never write them. There is nothing here for it to save: every control on the
 * panel acts immediately and says so.
 */
export function AccessSection({ facts }: SectionProps) {
  return (
    <TempAdminPanel
      admins={facts.tempAdmins}
      viewerMode={facts.viewerMode}
      viewerTempAdminId={facts.viewerTempAdminId}
      todayISO={facts.todayISO}
    />
  );
}
