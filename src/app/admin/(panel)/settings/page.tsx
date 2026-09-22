import { prisma } from "@/lib/prisma";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { isRazorpayConfigured } from "@/lib/razorpay";
import { isNimbusPostConfigured } from "@/lib/nimbuspost";
import { DEFAULT_REFUND_SETTINGS, normaliseReturnReasons } from "@/lib/returns";
import { dispatchModeOf, normalisePipelineSettings } from "@/lib/orders-pipeline";
import { InfoTip } from "@/components/store/info-tip";
import { SettingsForm } from "@/components/admin/settings-form";
// Runtime values come from lib/, NOT from settings-ui — that file is
// "use client", so importing `isTabKey` from it makes this server component
// call a client reference, which throws at render. Types are erased at build
// time, so importing those from the client module is harmless.
import { DEFAULT_TAB, isTabKey, type TabKey } from "@/lib/settings-tabs";
import type { SettingsDraft } from "@/components/admin/settings-ui";
import type { SettingsFacts } from "@/components/admin/settings-sections";
import type { PaymentMode } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

const PAYMENT_MODES: PaymentMode[] = ["prepaid", "cod", "partial", "direct"];

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
  const byMode = { prepaid: 0, cod: 0, partial: 0, direct: 0 } as Record<
    PaymentMode,
    number
  >;
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

export default async function AdminSettings({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ tab: rawTab }, row, { catalogue, returnableSplit }] = await Promise.all([
    searchParams,
    readRow(),
    readCatalogue(),
  ]);

  const tab: TabKey = isTabKey(rawTab) ? rawTab : DEFAULT_TAB;
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
    directEnabled: row?.directEnabled ?? d.directEnabled,
    razorpayEnabled: row?.razorpayEnabled ?? d.razorpayEnabled,
    nimbusEnabled: row?.nimbusEnabled ?? d.nimbusEnabled,
    defaultMaterialsCare: row?.defaultMaterialsCare ?? d.defaultMaterialsCare,
    defaultShippingInfo: row?.defaultShippingInfo ?? d.defaultShippingInfo,

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
    razorpayConfigured: isRazorpayConfigured(),
    nimbusConfigured: isNimbusPostConfigured(),
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
      refundFeePercent:
        row?.refundFeePercent ?? DEFAULT_REFUND_SETTINGS.refundFeePercent,
      refundFeeFlat: row?.refundFeeFlat ?? DEFAULT_REFUND_SETTINGS.refundFeeFlat,
      partialAdvanceRefundable:
        row?.partialAdvanceRefundable ??
        DEFAULT_REFUND_SETTINGS.partialAdvanceRefundable,
      waiveRefundFeeOnOurFault:
        row?.waiveRefundFeeOnOurFault ??
        DEFAULT_REFUND_SETTINGS.waiveRefundFeeOnOurFault,
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
  };

  return (
    <div>
      {/* The paragraph that used to sit here said the same thing the seven tab
          blurbs below now say one at a time, which made it the second-longest
          string on a screen whose whole problem was length. It is behind the
          (i), where the rest of this screen's explanation lives. */}
      <h1 className="flex flex-wrap items-center gap-1.5 font-serif text-2xl sm:text-3xl">
        Branding &amp; settings
        <InfoTip term="Branding & settings">
          Everything the store is configured by, in one place — your brand, how
          checkout behaves, what happens to an order automatically, and your
          return policy. Each tab names what it is for. Nothing is written until
          you press Save, and the bar that appears lists every field that will
          change. Saved changes reach the storefront immediately.
        </InfoTip>
      </h1>

      <div className="mt-4">
        <SettingsForm initial={initial} facts={facts} initialTab={tab} />
      </div>
    </div>
  );
}
