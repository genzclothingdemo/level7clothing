"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth";
import { fromStoreDateTimeInput, normaliseCode } from "@/lib/coupons";

/**
 * Writes for the coupon editor.
 *
 * The form is the only place a coupon's rules are authored, so the checks that
 * stop an unusable coupon reaching the table live here rather than in the
 * client: a percentage over 100, an end before its start, a cap on a flat
 * coupon. The engine in `@/lib/coupons` is defensive about all of them anyway —
 * this is about telling the admin, not about safety.
 */

async function requireAdmin() {
  const session = await getAdminSession();
  if (!session) throw new Error("Unauthorized");
  return session;
}

export type CouponActionResult = { success: boolean; error?: string };

/**
 * An optional ceiling or threshold. Blank means "no limit", and so does a
 * typed `0` — clearing a field by typing zero is what people actually do, and
 * a zero cap or a zero minimum would mean nothing anyway. A negative is a
 * mistake and is reported rather than absorbed.
 */
const optionalLimit = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (!s) return null;
    const n = Number(s);
    if (!Number.isFinite(n)) return NaN;
    return Math.floor(n) === 0 ? null : Math.floor(n);
  })
  .refine((n) => n === null || (!Number.isNaN(n) && n > 0), {
    message: "Limits and thresholds have to be whole numbers above zero",
  })
  .transform((n) => n as number | null);

const couponInput = z
  .object({
    code: z
      .string()
      .trim()
      .min(3, "A code needs at least 3 characters")
      .max(32, "Keep the code under 32 characters")
      // Shoppers type these by hand and read them off a story or a flyer, so
      // anything that needs a shift key or gets auto-corrected is out.
      .regex(/^[A-Za-z0-9_-]+$/, "Use letters, numbers, hyphens and underscores only"),
    discountAmount: z.coerce
      .number()
      .int("Use a whole number")
      .positive("The discount has to be more than zero"),
    isPercentage: z.boolean(),
    isActive: z.boolean(),
    productIds: z.array(z.string()).default([]),
    usageLimit: optionalLimit,
    perUserLimit: optionalLimit,
    minSpend: optionalLimit,
    maxDiscount: optionalLimit,
    startsAt: z.string().optional().nullable(),
    expiresAt: z.string().optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.isPercentage && v.discountAmount > 100) {
      ctx.addIssue({
        code: "custom",
        path: ["discountAmount"],
        message: "A percentage can't be more than 100",
      });
    }
    const starts = fromStoreDateTimeInput(v.startsAt);
    const ends = fromStoreDateTimeInput(v.expiresAt);
    if (starts && ends && ends.getTime() <= starts.getTime()) {
      ctx.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "The end of the window has to come after its start",
      });
    }
  });

type ParsedCoupon = z.output<typeof couponInput>;

function read(formData: FormData) {
  return {
    code: String(formData.get("code") ?? ""),
    discountAmount: formData.get("discountAmount"),
    isPercentage: formData.get("isPercentage") === "true",
    isActive: formData.get("isActive") === "true",
    productIds: formData.getAll("productIds").map(String).filter(Boolean),
    usageLimit: formData.get("usageLimit"),
    perUserLimit: formData.get("perUserLimit"),
    minSpend: formData.get("minSpend"),
    maxDiscount: formData.get("maxDiscount"),
    startsAt: formData.get("startsAt"),
    expiresAt: formData.get("expiresAt"),
  };
}

function toRow(v: ParsedCoupon) {
  return {
    code: normaliseCode(v.code),
    discountAmount: v.discountAmount,
    isPercentage: v.isPercentage,
    isActive: v.isActive,
    productIds: v.productIds,
    usageLimit: v.usageLimit,
    perUserLimit: v.perUserLimit,
    minSpend: v.minSpend,
    // Kept even when the coupon is flat, so switching a coupon to percentage
    // and back doesn't silently lose the cap the admin typed.
    maxDiscount: v.maxDiscount,
    startsAt: fromStoreDateTimeInput(v.startsAt),
    expiresAt: fromStoreDateTimeInput(v.expiresAt),
  };
}

/** Turns a validation failure or a duplicate code into one readable line. */
function explain(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "Check the fields and try again.";
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return "A coupon with that code already exists.";
  }
  if (error instanceof Error && error.message === "Unauthorized") {
    return "Your session expired. Sign in again.";
  }
  console.error("[coupons] write failed:", error);
  return "Couldn't save the coupon. Please try again.";
}

export async function createCoupon(formData: FormData): Promise<CouponActionResult> {
  try {
    await requireAdmin();
    const parsed = couponInput.parse(read(formData));
    await prisma.coupon.create({ data: toRow(parsed) });
    revalidatePath("/admin/coupons");
    return { success: true };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}

export async function updateCoupon(
  id: string,
  formData: FormData
): Promise<CouponActionResult> {
  try {
    await requireAdmin();
    const parsed = couponInput.parse(read(formData));
    // `usedCount` is never written from the form — it belongs to the
    // redemption ledger, and editing it would let the admin hand out a used-up
    // code again without any record of having done so.
    await prisma.coupon.update({ where: { id }, data: toRow(parsed) });
    revalidatePath("/admin/coupons");
    return { success: true };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}

/** The list's pause switch — the one edit worth making without opening a form. */
export async function setCouponActive(
  id: string,
  isActive: boolean
): Promise<CouponActionResult> {
  try {
    await requireAdmin();
    await prisma.coupon.update({ where: { id }, data: { isActive } });
    revalidatePath("/admin/coupons");
    return { success: true };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}

export async function deleteCoupon(id: string): Promise<CouponActionResult> {
  try {
    await requireAdmin();
    // Redemptions cascade with the coupon, so a code that has been used should
    // be switched off rather than deleted — deleting it takes the record of
    // who redeemed it with it. The confirm in the UI says so.
    await prisma.coupon.delete({ where: { id } });
    revalidatePath("/admin/coupons");
    return { success: true };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}
