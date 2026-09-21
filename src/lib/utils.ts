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
  // L7-<base36 time><2 random chars> — human friendly, hard to collide.
  //
  // The prefix was `AV-` (Artvelle, the unrelated resin store this codebase
  // was copied from) — an upstream regression that CLAUDE.md explicitly rules
  // out. Orders placed while it was wrong keep their `AV-` numbers: a customer
  // has that reference in their confirmation email, so rewriting history would
  // break the one string they can quote at support.
  //
  // Nothing parses the prefix — it is display and search only — so the two
  // coexist safely.
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 4).toUpperCase();
  return `L7-${t}${r}`;
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

