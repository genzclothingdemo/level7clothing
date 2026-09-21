import { prisma } from "@/lib/prisma";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { isRazorpayConfigured } from "@/lib/razorpay";
import { isNimbusPostConfigured } from "@/lib/nimbuspost";
import { normaliseReturnReasons } from "@/lib/returns";
import { normalisePipelineSettings } from "@/lib/orders-pipeline";
import { SettingsForm } from "@/components/admin/settings-form";
import {
  DEFAULT_TAB,
  isTabKey,
  type SettingsDraft,
  type TabKey,
} from "@/components/admin/settings-ui";
import type { SettingsFacts } from "@/components/admin/settings-sections";
import type { PaymentMode } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

const PAYMENT_MODES: PaymentMode[] = ["prepaid", "cod", "partial", "direct"];

/**
 * The settings row, read whole.
 *
 * Not `getSettings()`: that DTO is the storefront's branding shape and stops
 * short of the returns, refund and pipeline columns. This screen renders those
 * read-only — it is the only screen that shows all of them at once — so it
 * needs the row itself.
 *
 * A failed read falls back to the same defaults the schema declares, so the
 * form still renders during a database blip. It just cannot save until the
 * database is back, which the action reports honestly.
 */
async function readRow() {
  return prisma.siteSettings
    .findUnique({ where: { id: "main" } })
    .catch(() => null);
}

/**
 * How much of the catalogue allows each payment method.
 *
 * The point is requirement 5's trap: a switch on this screen can remove an
 * option that every product in the store offers, and the admin has no way to
 * know that without these numbers. Counted over active products only —
 * a draft product's opinion does not affect a live checkout.
 *
 * `paymentModes` empty is counted as Prepaid + COD, matching the fallback in
 * `checkout-client.tsx` and `resolveAllowedModes`.
 */
async function readCatalogue(): Promise<SettingsFacts["catalogue"]> {
  const byMode = { prepaid: 0, cod: 0, partial: 0, direct: 0 } as Record<
    PaymentMode,
    number
  >;
  const rows = await prisma.product
    .findMany({ where: { isActive: true }, select: { paymentModes: true } })
    .catch(() => null);

  if (!rows) return { active: 0, byMode };

  for (const row of rows) {
    const modes = row.paymentModes.length
      ? row.paymentModes
      : ["prepaid", "cod"];
    for (const m of PAYMENT_MODES) if (modes.includes(m)) byMode[m] += 1;
  }
  return { active: rows.length, byMode };
}

function countBullets(text: string): number {
  return text.split("\n").filter((l) => l.trim()).length;
}

export default async function AdminSettings({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ tab: rawTab }, row, catalogue] = await Promise.all([
    searchParams,
    readRow(),
    readCatalogue(),
  ]);

  const tab: TabKey = isTabKey(rawTab) ? rawTab : DEFAULT_TAB;
  const d = DEFAULT_SETTINGS;

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
  };

  const facts: SettingsFacts = {
    razorpayConfigured: isRazorpayConfigured(),
    nimbusConfigured: isNimbusPostConfigured(),
    currency: row?.currency ?? d.currency,
    catalogue,
    returns: {
      returnsEnabled: row?.returnsEnabled ?? d.returnsEnabled,
      defaultReturnable: row?.defaultReturnable ?? d.defaultReturnable,
      returnWindowDays: row?.returnWindowDays ?? d.returnWindowDays,
      returnReasonCount: normaliseReturnReasons(row?.returnReasons).length,
      returnsInfoBullets: countBullets(
        row?.defaultReturnsInfo ?? d.defaultReturnsInfo
      ),
      refundFeePercent: row?.refundFeePercent ?? 0,
      refundFeeFlat: row?.refundFeeFlat ?? 0,
      partialAdvanceRefundable: row?.partialAdvanceRefundable ?? false,
      waiveRefundFeeOnOurFault: row?.waiveRefundFeeOnOurFault ?? true,
    },
    pipeline: normalisePipelineSettings(row),
  };

  return (
    <div>
      <h1 className="font-serif text-2xl sm:text-3xl">Branding &amp; settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Your brand, your contact details and how checkout behaves. Saved
        changes appear on the storefront immediately.
      </p>

      <div className="mt-5">
        <SettingsForm initial={initial} facts={facts} initialTab={tab} />
      </div>
    </div>
  );
}
