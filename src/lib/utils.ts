import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatINR(rupees: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(rupees);
}

export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function orderNumber(): string {
  // AV-<base36 time><2 random chars> — human friendly, hard to collide
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 4).toUpperCase();
  return `AV-${t}${r}`;
}

/**
 * Normalise an Indian phone number to E.164-ish digits for wa.me links.
 * 10 digits → prefixed with 91; keeps existing country codes; strips symbols.
 */
export function normalisePhone(phone: string): string {
  let digits = (phone || "").replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.replace(/^0+/, "");
  if (digits.length === 10) digits = `91${digits}`;
  return digits;
}

/** Build a click-to-send WhatsApp link with a pre-filled message. */
export function whatsappLink(phone: string, message: string): string {
  const to = normalisePhone(phone);
  return `https://wa.me/${to}?text=${encodeURIComponent(message)}`;
}

/** Encode a gallery path (folder names contain spaces → %20). */
export const galleryImg = (path: string) =>
  encodeURI(`/products/gallery/${path}`);

