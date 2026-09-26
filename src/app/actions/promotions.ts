"use server";

/**
 * Writes for the promotions editor.
 *
 * Two traps from CLAUDE.md are designed out rather than guarded against:
 *
 * 1. **"Zod strips anything not in the schema — silently."** The column list
 *    is written once, in `toRow()`, and `createPromotion` and `updatePromotion`
 *    both use it. There is no second place a field can be forgotten, which is
 *    the failure mode that made the Returns control save nothing.
 * 2. **An optional value must collapse to `null`, not `undefined`.** An
 *    `undefined` in a Prisma `update` means "leave this column alone", so
 *    clearing a CTA or an end date by emptying the field would silently do
 *    nothing. Every optional field here resolves to an explicit `null`.
 *
 * The date parser is the shared one from `@/lib/coupons`: an admin setting up
 * a sale will type the same window into a coupon and a promotion, and "31 Oct
 * 23:59" has to mean the same instant in both. IST is a fixed +05:30 with no
 * DST, so a `datetime-local` value converts exactly.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdminWrite } from "@/lib/auth";
import { AdminReadOnlyError } from "@/lib/temp-admin";
import { fromStoreDateTimeInput } from "@/lib/coupons";
import { PROMOTION_KINDS, type PromotionKind } from "@/lib/promotions";

async function requireAdmin(what: string) {
  const session = await requireAdminWrite(what);
  return session;
}

export type PromotionActionResult = { success: boolean; error?: string };

/**
 * The promotion appears in the store layout, so it is on every storefront
 * route. `"layout"` invalidates that layout and everything under it — a
 * page-level revalidate would leave the promotion stale everywhere else.
 */
function revalidateEverywhere() {
  revalidatePath("/", "layout");
  revalidatePath("/admin/promotions");
}

/* ------------------------------------------------------------------ */
/*  Validation                                                         */
/* ------------------------------------------------------------------ */

/**
 * A CTA destination the store is willing to render into an `href`.
 *
 * Site-relative paths and http(s) only. `//evil.example` is rejected
 * explicitly: it looks relative and is not — the browser reads it as
 * protocol-relative and leaves the site. Everything else (`javascript:`,
 * `data:`) fails the protocol check.
 */
function isSafeHref(value: string): boolean {
  if (value.startsWith("//")) return false;
  if (value.startsWith("/")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Blank, whitespace-only and absent all mean the same thing: not set. */
const optionalText = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => {
    const s = (v ?? "").trim();
    return s ? s : null;
  });

const promotionInput = z
  .object({
    // The caps are the house style, not a database limit. This store's voice
    // is editorial; a promotion that needs 300 characters is a landing page.
    title: z
      .string()
      .trim()
      .min(2, "Give the offer a title")
      .max(60, "Keep the title under 60 characters — it has to fit a phone's banner"),
    body: z
      .string()
      .trim()
      .min(2, "Add a line explaining the offer")
      .max(160, "Keep the detail under 160 characters"),
    ctaLabel: optionalText,
    ctaHref: optionalText,
    // Refined against the shared constant rather than a second literal union,
    // so adding a surface means touching one list. The predicate narrows the
    // parsed type to `PromotionKind`.
    kind: z
      .string()
      .refine(
        (v): v is PromotionKind => (PROMOTION_KINDS as readonly string[]).includes(v),
        { message: "Pick where this promotion appears." }
      ),
    isActive: z.boolean(),
    startsAt: optionalText,
    endsAt: optionalText,
    priority: z.coerce
      .number()
      .int("Priority has to be a whole number")
      .min(0, "Priority can't be negative")
      .max(100, "Priority tops out at 100"),
    dismissDays: z.coerce
      .number()
      .int("Use a whole number of days")
      .min(0, "Use 0 for 'this visit only'")
      .max(365, "A year is the longest a dismissal can stick"),
  })
  .superRefine((v, ctx) => {
    // A button with no destination does nothing; a destination with no label
    // is invisible. Both or neither.
    if (v.ctaLabel && !v.ctaHref) {
      ctx.addIssue({
        code: "custom",
        path: ["ctaHref"],
        message: "A button needs somewhere to go.",
      });
    }
    if (v.ctaHref && !v.ctaLabel) {
      ctx.addIssue({
        code: "custom",
        path: ["ctaLabel"],
        message: "A link needs a label, or nobody can see it.",
      });
    }
    if (v.ctaHref && !isSafeHref(v.ctaHref)) {
      ctx.addIssue({
        code: "custom",
        path: ["ctaHref"],
        message:
          "Use a path on this store (starting with /) or a full https:// address.",
      });
    }

    const starts = fromStoreDateTimeInput(v.startsAt);
    const ends = fromStoreDateTimeInput(v.endsAt);
    if (v.startsAt && !starts) {
      ctx.addIssue({ code: "custom", path: ["startsAt"], message: "That start date isn't valid." });
    }
    if (v.endsAt && !ends) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "That end date isn't valid." });
    }
    // A window that can never contain an instant is a promotion that will
    // never show, with nothing on screen to say why.
    if (starts && ends && ends.getTime() <= starts.getTime()) {
      ctx.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "The end of the window has to come after its start.",
      });
    }
  });

type ParsedPromotion = z.output<typeof promotionInput>;

function read(formData: FormData) {
  return {
    title: String(formData.get("title") ?? ""),
    body: String(formData.get("body") ?? ""),
    ctaLabel: formData.get("ctaLabel"),
    ctaHref: formData.get("ctaHref"),
    kind: String(formData.get("kind") ?? "banner"),
    isActive: formData.get("isActive") === "true",
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
    priority: formData.get("priority"),
    dismissDays: formData.get("dismissDays"),
  };
}

/**
 * The single column list. Both writers use it, so a new field cannot be added
 * to one and forgotten in the other.
 */
function toRow(v: ParsedPromotion) {
  return {
    title: v.title,
    body: v.body,
    // Explicit `null`, never `undefined` — see note 2 in the header.
    ctaLabel: v.ctaLabel,
    ctaHref: v.ctaHref,
    kind: v.kind,
    isActive: v.isActive,
    startsAt: fromStoreDateTimeInput(v.startsAt),
    endsAt: fromStoreDateTimeInput(v.endsAt),
    priority: v.priority,
    dismissDays: v.dismissDays,
  };
}

/** Turns a validation failure into the one line the admin needs to read. */
function explain(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "Check the fields and try again.";
  }
  if (error instanceof AdminReadOnlyError) return error.message;
  if (error instanceof Error && error.message === "Unauthorized") {
    return "Your session expired. Sign in again.";
  }
  console.error("[promotions] write failed:", error);
  return "Couldn't save the promotion. Please try again.";
}

/* ------------------------------------------------------------------ */
/*  Writes                                                             */
/* ------------------------------------------------------------------ */

export async function createPromotion(
  formData: FormData
): Promise<PromotionActionResult> {
  try {
    await requireAdmin("createPromotion");
    const parsed = promotionInput.parse(read(formData));
    await prisma.promotion.create({ data: toRow(parsed) });
    revalidateEverywhere();
    return { success: true };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}

export async function updatePromotion(
  id: string,
  formData: FormData
): Promise<PromotionActionResult> {
  try {
    await requireAdmin("updatePromotion");
    const parsed = promotionInput.parse(read(formData));
    await prisma.promotion.update({ where: { id }, data: toRow(parsed) });
    revalidateEverywhere();
    return { success: true };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}

/**
 * The list's pause switch — the one edit worth making without opening a form,
 * and the fastest way to take a promotion off the store.
 */
export async function setPromotionActive(
  id: string,
  isActive: boolean
): Promise<PromotionActionResult> {
  try {
    await requireAdmin("setPromotionActive");
    await prisma.promotion.update({ where: { id }, data: { isActive } });
    revalidateEverywhere();
    return { success: true };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}

export async function deletePromotion(id: string): Promise<PromotionActionResult> {
  try {
    await requireAdmin("deletePromotion");
    await prisma.promotion.delete({ where: { id } });
    revalidateEverywhere();
    return { success: true };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}
