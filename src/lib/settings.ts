import { cache } from "react";
import { prisma } from "./prisma";
import type { SettingsDTO } from "./types";

/**
 * Fallback branding, used only when the SiteSettings row cannot be read (a DB
 * outage during a build, or a fresh database). The live values come from
 * Admin → Settings. Keep these in step with the @default(...) values on the
 * SiteSettings model in prisma/schema.prisma.
 */
export const DEFAULT_SETTINGS: SettingsDTO = {
  brandName: "Level7 Clothing",
  tagline: "Premium GenZ Graphic Tees",
  logoUrl: null,
  heroHeadline: "Wear the statement.",
  heroSubtext:
    "Premium oversized tees and drop-shoulder hoodies — quality and design that enhance your everyday.",
  aboutText:
    "Level7 Clothing is a contemporary apparel brand focused on quality and design. We curate graphic tees and hoodies that enhance your everyday.",
  contactEmail: "hello@level7clothing.example",
  contactPhone: "+91 90000 00000",
  whatsapp: "+919000000000",
  address: "Level7 Clothing, India",
  instagram: "https://instagram.com",
  facebook: "",
  adminNotifyEmail: "admin@level7clothing.example",
  currency: "INR",
  freeShippingThreshold: null,
  codEnabled: true,
  prepaidEnabled: true,
  partialEnabled: true,
  directEnabled: true,
  razorpayEnabled: false,
  nimbusEnabled: false,
  announcement: "Join the club — exclusive deals and early access to new drops",
  defaultMaterialsCare: [
    "Premium heavyweight cotton, pre-shrunk and bio-washed",
    "Machine wash cold, inside out, with like colours",
    "Do not bleach or tumble dry — hang to dry",
    "Warm iron on the reverse; never iron directly on the print",
  ].join("\n"),
  defaultShippingInfo: [
    "Free shipping across India on every order",
    "Dispatched in 1–2 working days, tracking shared on dispatch",
    "Cash on Delivery available on eligible pin codes",
  ].join("\n"),
  defaultReturnsInfo: [
    "7-day easy returns on unworn items with tags attached.",
    "Wrong size? Exchange it once, free of charge.",
    "Approved refunds go back to the original payment method within 5–7 working days.",
  ].join("\n"),
  returnsEnabled: true,
  defaultReturnable: true,
  returnWindowDays: 7,
};

/**
 * Resolve the product page's info blocks: a product's own copy wins, otherwise
 * the store-wide default. A blank result means "hide this section" — that's how
 * an admin switches a block off store-wide (clear it in Product defaults).
 *
 * Single source of truth for the rule, so the product page, any future PDP
 * variant and the admin preview can't drift apart.
 */
export function resolveProductInfo(
  product: {
    materialsCare?: string | null;
    shippingInfo?: string | null;
    returnsInfo?: string | null;
  },
  settings: Pick<
    SettingsDTO,
    "defaultMaterialsCare" | "defaultShippingInfo" | "defaultReturnsInfo"
  >
): { materialsCare: string; shippingInfo: string; returnsInfo: string } {
  // Only `null` inherits. An empty string is a deliberate per-product "hide
  // this section", which is why this isn't a `||` chain.
  const pick = (own: string | null | undefined, fallback: string) =>
    (own ?? fallback).trim();
  return {
    materialsCare: pick(product.materialsCare, settings.defaultMaterialsCare),
    shippingInfo: pick(product.shippingInfo, settings.defaultShippingInfo),
    returnsInfo: pick(product.returnsInfo, settings.defaultReturnsInfo),
  };
}

/**
 * Load site settings. Falls back to defaults if the DB is unavailable so the
 * storefront still renders (e.g. during first build before DB is configured).
 */
export const getSettings = cache(async (): Promise<SettingsDTO> => {
  try {
    const row = await prisma.siteSettings.findUnique({ where: { id: "main" } });
    if (!row) return DEFAULT_SETTINGS;
    return {
      brandName: row.brandName,
      tagline: row.tagline,
      logoUrl: row.logoUrl,
      heroHeadline: row.heroHeadline,
      heroSubtext: row.heroSubtext,
      aboutText: row.aboutText,
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone,
      whatsapp: row.whatsapp,
      address: row.address,
      instagram: row.instagram,
      facebook: row.facebook,
      adminNotifyEmail: row.adminNotifyEmail,
      currency: row.currency,
      freeShippingThreshold: row.freeShippingThreshold,
      codEnabled: row.codEnabled,
      prepaidEnabled: row.prepaidEnabled,
      partialEnabled: row.partialEnabled,
      directEnabled: row.directEnabled,
      razorpayEnabled: row.razorpayEnabled,
      nimbusEnabled: row.nimbusEnabled,
      announcement: row.announcement,
      defaultMaterialsCare: row.defaultMaterialsCare,
      defaultShippingInfo: row.defaultShippingInfo,
      defaultReturnsInfo: row.defaultReturnsInfo,
      returnsEnabled: row.returnsEnabled,
      defaultReturnable: row.defaultReturnable,
      returnWindowDays: row.returnWindowDays,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
});
