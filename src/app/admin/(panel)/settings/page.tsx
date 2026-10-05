import { prisma } from "@/lib/prisma";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { isRazorpayConfigured } from "@/lib/razorpay";
import { isNimbusPostConfigured } from "@/lib/nimbuspost";
import { normaliseReturnReasons } from "@/lib/returns";
import { dispatchModeOf, normalisePipelineSettings } from "@/lib/orders-pipeline";
import { getAdminSession } from "@/lib/auth";
import { listTempAdmins } from "@/lib/temp-admin";
import { smsGateway } from "@/lib/otp";
import { emailHealth } from "@/lib/email";
import { pushReach } from "@/lib/push-dispatch";
import {
  IMPLEMENTED_ACTIONS,
  SYSTEM_RULES,
  describeConditions,
  readConditions,
  triggerLabel,
} from "@/lib/automation";
import {
  SMS_UNAVAILABLE,
  buildNotificationMatrix,
  composeFallbackLabel,
  orderedChannels,
  whatsappGateway,
  type ChannelFact,
  type RuleRow,
} from "@/lib/notification-channels";
import { InfoTip } from "@/components/store/info-tip";
import { SettingsForm } from "@/components/admin/settings-form";
// Runtime values come from lib/, NOT from settings-ui — that file is
// "use client", so importing `isTabKey` from it makes this server component
// call a client reference, which throws at render. Types are erased at build
// time, so importing those from the client module is harmless.
import { resolveTab, type TabKey } from "@/lib/settings-tabs";
import type { SettingsDraft } from "@/components/admin/settings-ui";
import type { SettingsFacts } from "@/components/admin/settings-sections";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

/**
 * The three modes checkout can offer, for the catalogue coverage counts.
 *
 * "direct" is absent: it is no longer offered anywhere, so counting how many
 * products allow it would put a number on this screen that describes nothing.
 */
const PAYMENT_MODES = ["prepaid", "cod", "partial"] as const;

type CountedMode = (typeof PAYMENT_MODES)[number];

/**
 * The settings row, read whole.
 *
 * Not `getSettings()`: that DTO is the storefront's branding shape and stops
 * short of the returns, refund and pipeline columns. This screen is now the
 * single home for all three — the order pipeline moved in from `/admin/orders`
 * and the return policy from `/admin/returns` — so it needs the row itself.
 *
 * A failed read falls back to the same defaults the schema declares, so the
 * form still renders during a database blip. It just cannot save until the
 * database is back, which the actions report honestly.
 */
async function readRow() {
  return prisma.siteSettings
    .findUnique({ where: { id: "main" } })
    .catch(() => null);
}

/**
 * How much of the catalogue allows each payment method, and how it answers
 * "returnable?".
 *
 * The payment counts exist because a switch on this screen can remove an option
 * that every product in the store offers, and the admin has no way to know that
 * without these numbers. Counted over active products only — a draft product's
 * opinion does not affect a live checkout.
 *
 * `paymentModes` empty is counted as Prepaid + COD, matching the fallback in
 * `checkout-client.tsx` and `resolveAllowedModes`.
 *
 * `returnable` is deliberately counted over the WHOLE catalogue, not just
 * active products: a draft product inherits the store default too, and the
 * split is there to say what changing that default would actually do.
 */
async function readCatalogue(): Promise<{
  catalogue: SettingsFacts["catalogue"];
  returnableSplit: { inherit: number; yes: number; no: number; total: number };
}> {
  const byMode = { prepaid: 0, cod: 0, partial: 0 } as Record<CountedMode, number>;
  const empty = { inherit: 0, yes: 0, no: 0, total: 0 };

  const rows = await prisma.product
    .findMany({ select: { paymentModes: true, isActive: true, returnable: true } })
    .catch(() => null);

  if (!rows) return { catalogue: { active: 0, byMode }, returnableSplit: empty };

  const split = { ...empty, total: rows.length };
  let active = 0;

  for (const row of rows) {
    if (row.returnable == null) split.inherit += 1;
    else if (row.returnable) split.yes += 1;
    else split.no += 1;

    if (!row.isActive) continue;
    active += 1;
    const modes = row.paymentModes.length ? row.paymentModes : ["prepaid", "cod"];
    for (const m of PAYMENT_MODES) if (modes.includes(m)) byMode[m] += 1;
  }

  return { catalogue: { active, byMode }, returnableSplit: split };
}

/**
 * "2 days ago", computed on the server.
 *
 * Deliberately not done in the browser: a relative time computed at render and
 * again at hydration is a mismatch, and `toLocaleDateString` picks up the
 * viewer's locale and timezone. The Alerts card receives a finished string.
 */
function ago(date: Date | null | undefined): string | null {
  if (!date) return null;
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Everything the Alerts tab needs — the live sending state, what each channel
 * can currently do, and the grid itself.
 *
 * **The grid is a view over `AutomationRule` and is built here, once.** The
 * catalogue (`SYSTEM_RULES`) and the live rows are both read on the server and
 * folded together by `buildNotificationMatrix`; the client is handed a plain
 * object. That split is not stylistic — `lib/automation.ts`, `lib/email.ts`
 * and `lib/push-dispatch.ts` are all `server-only`, and the matrix has to be
 * rendered by a client component because it is a grid of checkboxes.
 *
 * `supported` comes from `IMPLEMENTED_ACTIONS`, which is also what
 * `deliverJob` cancels an unknown action against and what the write action
 * refuses on — one list, so a channel can never be tickable and unsendable.
 * `healthy` is a separate, softer question: configured *right now*. A missing
 * Resend key is a warning on screen, not a locked checkbox, because an owner
 * setting rules up before they buy a domain is doing nothing wrong.
 */
async function readNotificationFacts(): Promise<SettingsFacts["notifications"]> {
  const health = emailHealth();

  const [rules, reach, lastSentJob, lastFailedJob, failedCount] = await Promise.all([
    prisma.automationRule
      .findMany({
        select: {
          id: true,
          name: true,
          trigger: true,
          conditions: true,
          action: true,
          recipient: true,
          delayMinutes: true,
          isActive: true,
          templateId: true,
        },
      })
      .catch(() => []),
    pushReach().catch(() => ({
      configured: false,
      totalDevices: 0,
      reachableDevices: 0,
      adminEmail: "",
      adminDevices: 0,
    })),
    // `AutomationJob` is the only record of a send that survives a deploy —
    // `lib/email.ts`'s own last-send memory dies with the instance, so a
    // screen that only read that would say "nothing yet" after every deploy.
    prisma.automationJob
      .findFirst({
        where: { status: "sent" },
        orderBy: { sentAt: "desc" },
        select: { sentAt: true, rule: { select: { name: true } } },
      })
      .catch(() => null),
    prisma.automationJob
      .findFirst({
        where: { status: "failed" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, error: true, rule: { select: { name: true } } },
      })
      .catch(() => null),
    prisma.automationJob.count({ where: { status: "failed" } }).catch(() => 0),
  ]);

  const supports = (key: string) =>
    (IMPLEMENTED_ACTIONS as readonly string[]).includes(key);

  const sms = smsGateway();
  const whatsapp = whatsappGateway();

  const detailFor: Record<string, { healthy: boolean; detail: string }> = {
    email: {
      healthy: health.hasApiKey && health.verdict !== "unverifiable",
      detail:
        health.hasApiKey && health.verdict !== "unverifiable"
          ? `Sent from ${health.fromDomain}.`
          : health.advice,
    },
    push: {
      healthy: reach.configured,
      detail: !reach.configured
        ? "Notification keys are not set on this deployment, so nothing can be sent to a phone."
        : reach.reachableDevices === 0
          ? "No customer has installed the store to a phone yet, so these are queued and skipped with a reason rather than failing."
          : `${reach.reachableDevices} signed-in device${
              reach.reachableDevices === 1 ? "" : "s"
            } can be reached${
              reach.adminDevices === 0 ? " — none of them yours" : ""
            }.`,
    },
    // The in-app bell has no gateway, no permission prompt and no address —
    // it is a row in this database waiting to be looked at, so it is healthy
    // whenever it is supported at all.
    inapp: {
      healthy: true,
      detail:
        "Waits in the notification bell until they look. Nothing to configure and nothing that can reject it.",
    },
    // `smsGateway()` decides; this screen words it. Its own sentence is about
    // one-time codes, which is the wrong subject next to "tell the customer
    // their order shipped".
    sms: { healthy: sms.ready, detail: sms.ready ? sms.detail : SMS_UNAVAILABLE },
    whatsapp: { healthy: whatsapp.ready, detail: whatsapp.detail },
  };

  // The columns: the named vocabulary, plus everything this store has actually
  // got. `IMPLEMENTED_ACTIONS` belongs to the delivery engine and grows — a
  // hard-coded column list would have hidden every live `inapp` rule behind a
  // screen claiming to show the whole posture.
  const channels: ChannelFact[] = orderedChannels([
    ...IMPLEMENTED_ACTIONS,
    ...rules.map((r) => r.action),
  ]).map((key) => ({
    channel: key,
    supported: supports(key),
    healthy: detailFor[key]?.healthy ?? false,
    detail:
      detailFor[key]?.detail ??
      (supports(key)
        ? ""
        : "This channel is not something this store can send yet."),
  }));

  const ruleRows: RuleRow[] = rules.map((r) => ({
    id: r.id,
    name: r.name,
    trigger: r.trigger,
    // Normalised through the engine's own reader, so a blank condition means
    // "any" here exactly as it does when the rule fires.
    conditions: readConditions(r.conditions),
    action: r.action,
    recipient: r.recipient,
    delayMinutes: r.delayMinutes,
    isActive: r.isActive,
    hasTemplate: r.templateId !== null,
  }));

  return {
    channels,
    matrix: buildNotificationMatrix({
      catalogue: SYSTEM_RULES,
      rules: ruleRows,
      facts: channels,
      labelFor: (trigger, conditions) =>
        composeFallbackLabel(
          triggerLabel(trigger),
          describeConditions(trigger, conditions)
        ),
    }),
    identity: {
      hasApiKey: health.hasApiKey,
      from: health.from,
      fromAddress: health.fromAddress,
      fromDomain: health.fromDomain,
      verdict: health.verdict,
      advice: health.advice,
      lastSent: lastSentJob
        ? `${ago(lastSentJob.sentAt)} · ${lastSentJob.rule.name}`
        : null,
      lastFailed: lastFailedJob
        ? `${ago(lastFailedJob.createdAt)} · ${lastFailedJob.rule.name}`
        : null,
      lastFailedError: lastFailedJob?.error ?? null,
      failedCount,
    },
  };
}

export default async function AdminSettings({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const [
    { tab: rawTab },
    row,
    { catalogue, returnableSplit },
    tempAdmins,
    viewer,
    notifications,
  ] = await Promise.all([
      searchParams,
      readRow(),
      readCatalogue(),
      // Read on every load of this screen, not only when the Access tab is
      // open: `SettingsForm` holds one draft across all six tabs and mounts
      // whichever is selected, so a section that had to fetch its own data
      // would either suspend on a tab switch or not exist until one. It is
      // three queries against tables that hold a handful of rows.
      listTempAdmins(),
      // The panel layout has already established there is a session; this reads
      // it again only to learn the viewer's own mode, and `getAdminSession` is
      // memoised per request so it is not a second round trip.
      getAdminSession(),
      // Read on every load for the same reason as the temp admins above: one
      // draft, seven tabs, and the section that is not mounted still has to be
      // able to mount without suspending.
      readNotificationFacts(),
    ]);

  // `resolveTab` and not a bare `isTabKey` check: `?tab=storefront` and
  // `?tab=email` are retired keys that now open Store, and that has to be a
  // stated redirect rather than a fall-through to whichever tab happens to be
  // the default. Anything unrecognised still lands on the default.
  const tab: TabKey = resolveTab(rawTab);
  const d = DEFAULT_SETTINGS;
  // Narrowed once, so the six pipeline columns arrive as their real unions
  // rather than as the plain `String` the schema stores them in.
  const pipeline = normalisePipelineSettings(row);

  // Nullable columns are handed over as "" so the client's dirty comparison is
  // an exact string compare — see the note on SettingsDraft.
  const initial: SettingsDraft = {
    brandName: row?.brandName ?? d.brandName,
    tagline: row?.tagline ?? d.tagline,
    logoUrl: row?.logoUrl ?? "",
    announcement: row?.announcement ?? "",
    heroHeadline: row?.heroHeadline ?? d.heroHeadline,
    heroSubtext: row?.heroSubtext ?? d.heroSubtext,
    aboutText: row?.aboutText ?? d.aboutText,
    contactEmail: row?.contactEmail ?? d.contactEmail,
    contactPhone: row?.contactPhone ?? d.contactPhone,
    whatsapp: row?.whatsapp ?? "",
    address: row?.address ?? "",
    instagram: row?.instagram ?? "",
    facebook: row?.facebook ?? "",
    adminNotifyEmail: row?.adminNotifyEmail ?? d.adminNotifyEmail,
    freeShippingThreshold:
      row?.freeShippingThreshold == null ? "" : String(row.freeShippingThreshold),
    codEnabled: row?.codEnabled ?? d.codEnabled,
    prepaidEnabled: row?.prepaidEnabled ?? d.prepaidEnabled,
    partialEnabled: row?.partialEnabled ?? d.partialEnabled,
    // `directEnabled` is deliberately absent from the draft: the mode is gone
    // from checkout, so there is nothing to edit. `settings-form` pins the
    // column to `false` on every save.
    codFeeAmount: String(row?.codFeeAmount ?? 0),
    partialFeeAmount: String(row?.partialFeeAmount ?? 0),
    razorpayEnabled: row?.razorpayEnabled ?? d.razorpayEnabled,
    nimbusEnabled: row?.nimbusEnabled ?? d.nimbusEnabled,
    defaultMaterialsCare: row?.defaultMaterialsCare ?? d.defaultMaterialsCare,
    defaultShippingInfo: row?.defaultShippingInfo ?? d.defaultShippingInfo,

    // The four verification switches. Their own writer
    // (`updateVerificationSettings`), so they are seeded here and never routed
    // through `updateSettings`, which does not declare them.
    requireSignupEmailOtp: row?.requireSignupEmailOtp ?? false,
    requireSignupPhoneOtp: row?.requireSignupPhoneOtp ?? false,
    requireVerifiedEmailToOrder: row?.requireVerifiedEmailToOrder ?? false,
    requireVerifiedPhoneToOrder: row?.requireVerifiedPhoneToOrder ?? false,

    // Listed rather than spread. `PipelineSettings` still carries the legacy
    // `autoShipOnConfirm` boolean, which this draft deliberately does not —
    // the enum is the one editable copy of that decision, and `dispatchModeOf`
    // is what resolves it for a row written before the column existed.
    orderConfirmMode: pipeline.orderConfirmMode,
    autoConfirmPrepaid: pipeline.autoConfirmPrepaid,
    autoConfirmPartial: pipeline.autoConfirmPartial,
    autoConfirmCod: pipeline.autoConfirmCod,
    dispatchOnConfirm: dispatchModeOf(pipeline),
    autoShipCourier: pipeline.autoShipCourier,
  };

  const facts: SettingsFacts = {
    // Booleans, never the values. Both helpers read `process.env` on the server
    // and answer "is a key pair present?" — the keys themselves have no path to
    // the browser, which is the strongest version of "never render a secret":
    // there is nothing to render.
    razorpayConfigured: isRazorpayConfigured(),
    nimbusConfigured: isNimbusPostConfigured(),
    // A warehouse label, not a credential — and the usual cause of a booking
    // collecting from the wrong address, so it is worth stating plainly.
    nimbusWarehouse: process.env.NIMBUSPOST_WAREHOUSE_NAME?.trim() ?? "",
    currency: row?.currency ?? d.currency,
    catalogue,
    // The return policy's starting values. `ReturnPolicyCard` owns the draft
    // and the save from here on — these columns are deliberately NOT part of
    // `SettingsDraft`, so the shared save bar can never write them.
    returnPolicy: {
      returnsEnabled: row?.returnsEnabled ?? d.returnsEnabled,
      defaultReturnable: row?.defaultReturnable ?? d.defaultReturnable,
      returnWindowDays: row?.returnWindowDays ?? d.returnWindowDays,
      returnReasons: normaliseReturnReasons(row?.returnReasons),
      returnPolicyNote: row?.returnPolicyNote ?? "",
      // The four refund-fee columns are gone from the editable surface: a
      // return is a full refund of the goods, fixed in `computeRefund`. Only
      // the wording is still a setting.
      refundPolicyNote: row?.refundPolicyNote ?? "",
      defaultReturnsInfo: row?.defaultReturnsInfo ?? d.defaultReturnsInfo,
    },
    returnFacts: {
      partialEnabled: row?.partialEnabled ?? d.partialEnabled,
      returnableSplit,
    },
    // Stamped on the server so the policy card's "closes on" preview cannot
    // differ between the server render and hydration.
    todayISO: new Date().toISOString(),

    // Whether a one-time code can actually be sent by text, and the sentence
    // that explains it if not. Read on the server because the answer is an
    // environment fact; printed beside the two phone switches because a switch
    // that cannot be honoured has to say so where it is set, not at the till.
    sms: smsGateway(),

    // The Alerts tab, whole: the live sending state, what each channel can do
    // today, and the grid of which events tell whom. The grid is a **view over
    // `AutomationRule`** — see `readNotificationFacts` above and the header of
    // `lib/notification-channels.ts`.
    notifications,

    tempAdmins,
    // Defaults to the narrower mode if the session somehow read back empty.
    // This only decides what the UI offers — the server refuses a write from a
    // view-only holder regardless — so erring towards "offer nothing" is free.
    viewerMode: viewer?.mode ?? "readonly",
    viewerTempAdminId: viewer?.tempAdminId ?? null,
  };

  return (
    <div>
      {/* The paragraph that used to sit here said the same thing the tab
          blurbs below now say one at a time, which made it the second-longest
          string on a screen whose whole problem was length. It is behind the
          (i), where the rest of this screen's explanation lives. */}
      <h1 className="flex flex-wrap items-center gap-1.5 font-serif text-2xl sm:text-3xl">
        Branding &amp; settings
        <InfoTip term="Branding & settings">
          Everything the store is configured by, in one place — your brand, how
          checkout behaves, what happens to an order automatically, and your
          return policy. Each tab names what it is for. Most tabs share one Save
          bar, which appears the moment something changes and lists every field
          it will write; Returns has its own Save policy button, and the Alerts
          grid and Access act the moment you press. Saved changes reach the
          storefront immediately.
        </InfoTip>
      </h1>

      <div className="mt-4">
        <SettingsForm initial={initial} facts={facts} initialTab={tab} />
      </div>
    </div>
  );
}
