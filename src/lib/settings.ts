import { cache } from "react";
import { prisma } from "./prisma";
import type { SettingsDTO } from "./types";

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
};

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
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
});
