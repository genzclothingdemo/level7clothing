"use server";

/**
 * The two cash-handling fees and the four verification switches — each group
 * written only by the action that owns it.
 *
 * ## Why this is its own action
 *
 * `SiteSettings` is written from exactly one screen but by **several actions**,
 * and that is deliberate: a column has one writer, and a writer only ever
 * receives the columns it owns. `updateSettings` (branding, payments toggles,
 * copy) does not accept these two, `updateReturnDefaults` owns the returns
 * policy, `updateOrderPipelineSettings` owns the confirmation pipeline — and
 * this owns `codFeeAmount` / `partialFeeAmount`.
 *
 * Merging them into `updateSettings` would have been one fewer file and the
 * exact trap CLAUDE.md records for `defaultReturnsInfo`: a payload that carries
 * a field it does not own round-trips a stale value, and two tabs open means a
 * silent lost update with no error anywhere. `settings-form.tsx` sends each
 * group **only when it is dirty**, so on most saves this action is not called
 * at all.
 *
 * It lives beside the page rather than in `app/actions/` because the page is
 * its only caller. Colocating a `'use server'` module in the route folder is
 * the documented Next pattern (`node_modules/next/dist/docs/01-app/02-guides/
 * server-actions.md`), and `admin/(panel)/returns/actions.ts` already does it.
 *
 * ## What the fees are
 *
 * Taking money at the door costs the store — NimbusPost charges for COD
 * collection, and a part-paid order still has a cash leg. These let the owner
 * pass a flat amount on. `0` means absorb it, which is the shipped default.
 * Checkout adds the fee as its own named line, and freezes it onto
 * `Order.paymentFee`, so a past order still adds up after the setting changes.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdminWrite } from "@/lib/auth";
import { AdminReadOnlyError } from "@/lib/temp-admin";

/**
 * Whole rupees, 0–5000.
 *
 * The ceiling is a typo guard, not a policy: a four-figure "handling fee" on a
 * ₹999 tee is a slipped keystroke, and a server action is a public endpoint
 * where the `max` on an input is only a courtesy. Bounded here as well as in
 * the browser for that reason.
 */
const fee = z.coerce
  .number()
  .int("Enter a whole number of rupees")
  .min(0)
  .max(5000, "Keep the fee under ₹5,000");

const feesSchema = z.object({
  codFeeAmount: fee,
  partialFeeAmount: fee,
});

export type PaymentFeesInput = z.input<typeof feesSchema>;
export type PaymentFeesSaved = z.output<typeof feesSchema>;

export async function updatePaymentFees(input: PaymentFeesInput) {
  // Routed through the one write gate rather than a bare "is anyone signed
  // in?" check — a view-only temporary admin is refused here exactly as they
  // are in `updateSettings`, and the refusal is recorded. Returned rather than
  // thrown, because this action's contract with the save bar is a result
  // object: a thrown error would reach the browser as an unexplained failure
  // instead of the sentence that says what happened.
  try {
    await requireAdminWrite("updatePaymentFees");
  } catch (err) {
    if (err instanceof AdminReadOnlyError) {
      return { ok: false as const, error: err.message };
    }
    return { ok: false as const, error: "Unauthorized" };
  }

  const parsed = feesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  try {
    await prisma.siteSettings.upsert({
      where: { id: "main" },
      update: data,
      // Every other column falls to its schema default — this action writes two
      // and only two.
      create: { id: "main", ...data },
    });
  } catch (err) {
    console.error("[settings] updatePaymentFees failed:", err);
    return { ok: false as const, error: "Could not save the fees — please try again." };
  }

  // Checkout reads these per request, so only the checkout-facing tree is
  // stale. The layout is untouched: no fee appears in the header or the footer.
  revalidatePath("/checkout");
  revalidatePath("/admin/settings");
  return { ok: true as const, settings: data };
}

/* ------------------------------------------------------------------ */
/*  Identity verification                                              */
/* ------------------------------------------------------------------ */

/**
 * The four switches that decide when the store asks for a one-time code.
 *
 * Its own action for the same reason as the fees above: `settingsSchema` in
 * `app/actions/admin.ts` does not declare these columns, and **Zod strips what
 * it does not declare without a word** — routing them through `updateSettings`
 * would return `ok`, show a green toast, and write nothing. That is the exact
 * failure CLAUDE.md records for `returnable`.
 *
 * All four are plain booleans with no interdependence, so there is nothing to
 * validate beyond their type. What they *mean* when a channel cannot deliver is
 * resolved in `lib/otp.ts` (`orderVerificationGate`, `verificationEnforcement`)
 * and printed on the card — never decided here, or the rule would exist in two
 * places and drift.
 */
const verificationSchema = z.object({
  requireSignupEmailOtp: z.boolean(),
  requireSignupPhoneOtp: z.boolean(),
  requireVerifiedEmailToOrder: z.boolean(),
  requireVerifiedPhoneToOrder: z.boolean(),
});

export type VerificationInput = z.input<typeof verificationSchema>;
export type VerificationSaved = z.output<typeof verificationSchema>;

export async function updateVerificationSettings(input: VerificationInput) {
  try {
    await requireAdminWrite("updateVerificationSettings");
  } catch (err) {
    if (err instanceof AdminReadOnlyError) {
      return { ok: false as const, error: err.message };
    }
    return { ok: false as const, error: "Unauthorized" };
  }

  const parsed = verificationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  try {
    await prisma.siteSettings.upsert({
      where: { id: "main" },
      update: data,
      create: { id: "main", ...data },
    });
  } catch (err) {
    console.error("[settings] updateVerificationSettings failed:", err);
    return {
      ok: false as const,
      error: "Could not save the verification settings — please try again.",
    };
  }

  // Both gates are read per request: signup by the account action, ordering by
  // `placeOrder`. Neither page is cached on these values, so the two paths that
  // *render* differently are the ones revalidated.
  revalidatePath("/checkout");
  revalidatePath("/account/signup");
  revalidatePath("/admin/settings");
  return { ok: true as const, settings: data };
}
