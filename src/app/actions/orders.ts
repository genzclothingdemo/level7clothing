"use server";

import { z } from "zod";
import type { Order } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { sendOrderEmails } from "@/lib/email";
import { getUserSession, setUserCookie } from "@/lib/user-auth";

import { priceForSelection, repairSelection, imagesForSelection } from "@/lib/variants";
import { comboKey } from "@/lib/options";
import { orderNumber } from "@/lib/utils";
import type { Attribute, SellableVariant } from "@/lib/types";
import {
  createRazorpayOrder,
  isRazorpayConfigured,
  razorpayPublicKey,
  verifyRazorpaySignature,
} from "@/lib/razorpay";
import {
  autoConfirmOrder,
  getPipelineSettings,
  runConfirmationPipeline,
} from "@/lib/fulfilment";
import { shouldAutoConfirm } from "@/lib/orders-pipeline";
import { calculateShippingRate } from "@/lib/nimbuspost";
import { isCouponClaimError, redeemCoupon, validateCoupon } from "@/lib/coupons";

import type {
  ProductOption,
  VariantPrice,
  Variant,
  PaymentMode,
} from "@/lib/types";

// Maps the stored paymentMethod label ↔ the product's PaymentMode.
const METHOD_TO_MODE: Record<string, PaymentMode> = {
  Razorpay: "prepaid",
  COD: "cod",
  Partial: "partial",
  Direct: "direct",
};

type MethodAvailability = {
  prepaid: boolean;
  cod: boolean;
  partial: boolean;
  direct: boolean;
};

/** Which modes are usable for this cart = intersection of products, then globals. */
function resolveAllowedModes(
  products: { paymentModes: string[] }[],
  avail: MethodAvailability
): PaymentMode[] {
  const all: PaymentMode[] = ["prepaid", "cod", "partial", "direct"];
  let modes = all.filter((m) =>
    products.every((p) =>
      (p.paymentModes?.length ? p.paymentModes : ["prepaid", "cod"]).includes(m)
    )
  );
  modes = modes.filter((m) => avail[m]);
  // Never leave the cart with no way to check out.
  return modes.length ? modes : ["direct"];
}

/** Global (store-wide) availability of each method, combining toggles + config. */
function methodAvailability(
  settings: {
    codEnabled: boolean;
    prepaidEnabled: boolean;
    partialEnabled: boolean;
    directEnabled: boolean;
    razorpayEnabled: boolean;
  }
): MethodAvailability {
  const razorpay = settings.razorpayEnabled && isRazorpayConfigured();
  return {
    prepaid: settings.prepaidEnabled && razorpay,
    partial: settings.partialEnabled && razorpay,
    cod: settings.codEnabled,
    direct: settings.directEnabled,
  };
}

const inputSchema = z.object({
  customerName: z.string().min(2, "Please enter your name"),
  email: z.string().email("Enter a valid email"),
  phone: z.string().min(6, "Enter a valid phone number"),
  address: z.string().min(4, "Enter your address"),
  city: z.string().min(2, "Enter your city"),
  state: z.string().min(2, "Enter your state"),
  pincode: z.string().min(4, "Enter your pincode"),
  note: z.string().optional(),
  paymentMethod: z.enum(["COD", "Razorpay", "Partial", "Direct"]).default("COD"),
  visitorId: z.string().optional(),
  couponCode: z.string().optional(),
  items: z
    .array(
      z.object({
        productId: z.string(),
        quantity: z.number().int().positive(),
        note: z.string().optional(),
        options: z
          .array(z.object({ name: z.string(), value: z.string() }))
          .optional(),
      })
    )
    .min(1, "Your cart is empty"),
});

export type PlaceOrderInput = z.input<typeof inputSchema>;

export async function placeOrder(input: PlaceOrderInput) {
  // Login is required to confirm an order (browsing/cart stays open to guests).
  const user = await getUserSession();
  if (!user) {
    return {
      ok: false as const,
      error: "Please log in to confirm your order.",
      requiresLogin: true as const,
    };
  }
  // Active shopper — refresh the login cookie so it keeps sliding forward.
  await setUserCookie(user).catch(() => {});

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  // Load authoritative product data (never trust client prices).
  const ids = data.items.map((i) => i.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: ids }, isActive: true },
  });

  // Cart problems are the shopper's to fix, so they come back as a message
  // rather than a thrown error the checkout page can only show as "something
  // went wrong".
  let cartError: string | null = null;
  const fail = (message: string) => {
    cartError ??= message;
    return null;
  };

  const lineItems = data.items.map((i) => {
    const p = products.find((pr) => pr.id === i.productId);
    if (!p) return fail("A product in your cart is no longer available.");
    // Recompute the unit price from the product's real option prices.
    const attributes = (p.attributes as any) as Attribute[] || [];
    const sellableVariants = (p.sellableVariants as any) as SellableVariant[] || [];
    
    // Clean and validate selection
    const rawSelection = Object.fromEntries((i.options || []).map(o => [o.name, o.value]));
    const cleanSelection = repairSelection(attributes, rawSelection);
    
    // Check if they answered everything
    const unanswered = attributes.filter((a: Attribute) => !cleanSelection[a.name]).map((a: Attribute) => a.name);
    if (unanswered.length > 0) {
      return fail(`Please choose ${unanswered.join(" and ")} for "${p.name}" before checking out.`);
    }

    const key = comboKey(cleanSelection);
    const variant = sellableVariants.find((v: SellableVariant) => v.id === key);
    
    if (variant && !variant.available) {
      return fail(`The combination you picked for “${p.name}” is out of stock.`);
    }

    const unitPrice = variant?.price ?? p.price;
    const image = variant?.images?.[0] ?? p.images?.[0] ?? "";
    const cleanOptions = Object.entries(cleanSelection).map(([name, value]) => ({ name, value }));

    return {
      productId: p.id,
      name: p.name,
      image,
      price: unitPrice,
      quantity: i.quantity,
      options: cleanOptions,
      note: i.note ?? "",
    };
  });

  // Stop before any stock is reserved or any payment is started.
  if (cartError) return { ok: false as const, error: cartError };
  const validItems = lineItems.filter((i) => i !== null);

  const subtotal = validItems.reduce((n, i) => n + i.price * i.quantity, 0);

  const settings = await getSettings();
  const mode = METHOD_TO_MODE[data.paymentMethod] ?? "cod";

  const isFreeThreshold = settings.freeShippingThreshold != null && subtotal >= settings.freeShippingThreshold;
  let shipping = 0;

  if (!isFreeThreshold) {
    let nimbusWeight = 0;
    let nimbusLength = 0;
    let nimbusBreadth = 0;
    let nimbusHeight = 0;
    let nimbusMarkupTotal = 0;
    let hasNimbusProducts = false;
    const byId = new Map(products.map((p) => [p.id, p]));

    for (const i of validItems) {
      const p = byId.get(i.productId);
      if (!p) continue;
      const type = (p as any).shippingType || "nimbus";
      
      if (type === "fixed") {
        shipping += ((p as any).shippingFee || 0) * i.quantity;
      } else if (type === "nimbus") {
        hasNimbusProducts = true;
        nimbusMarkupTotal += ((p as any).shippingMarkup || 0) * i.quantity;
        if (p.weightGrams) nimbusWeight += p.weightGrams * i.quantity;
        if (p.lengthCm) nimbusLength = Math.max(nimbusLength, p.lengthCm);
        if (p.breadthCm) nimbusBreadth = Math.max(nimbusBreadth, p.breadthCm);
        if (p.heightCm) nimbusHeight = Math.max(nimbusHeight, p.heightCm);
      }
    }

    if (hasNimbusProducts) {
      const rate = await calculateShippingRate({
        destinationPincode: data.pincode,
        weightGrams: nimbusWeight,
        lengthCm: nimbusLength,
        breadthCm: nimbusBreadth,
        heightCm: nimbusHeight,
        paymentType: mode === "cod" ? "cod" : "prepaid",
        orderValueRupees: subtotal,
      });
      if (rate !== null) {
        shipping += rate + nimbusMarkupTotal;
      }
    }
  }
  
  // ---- Re-validate the coupon, now, against this cart. ----
  //
  // A discount proved when the shopper typed the code is not evidence it is
  // still valid: the window can have closed, the last use can have been taken,
  // and the cart itself can have changed since. So the code goes through the
  // same `validateCoupon` the /api/store/coupons/validate route uses — same
  // rules, same rounding, same answer — against the prices we just recomputed
  // from the database.
  //
  // A refusal fails the order rather than quietly dropping the discount: the
  // total the shopper is about to authorise would otherwise be higher than the
  // one on screen.
  let discountTotal = 0;
  let appliedCoupon: {
    id: string;
    code: string;
    usageLimit: number | null;
    perUserLimit: number | null;
  } | null = null;

  if (data.couponCode?.trim()) {
    const verdict = await validateCoupon({
      code: data.couponCode,
      lines: validItems.map((i) => ({
        productId: i.productId,
        price: i.price,
        quantity: i.quantity,
      })),
      userId: user.id,
      email: data.email,
    });

    if (!verdict.ok) {
      return {
        ok: false as const,
        error: `${verdict.message} Please remove the code and try again.`,
      };
    }

    discountTotal = verdict.discount;
    appliedCoupon = {
      id: verdict.couponId,
      code: verdict.code,
      usageLimit: verdict.usageLimit,
      perUserLimit: verdict.perUserLimit,
    };
  }

  const total = Math.max(0, subtotal + shipping - discountTotal);

  // ---- Resolve the chosen mode against the product rules + global toggles. ----
  const allowedModes = resolveAllowedModes(products, methodAvailability(settings));
  if (!allowedModes.includes(mode)) {
    return {
      ok: false as const,
      error: "That payment option isn't available for these items. Please pick another.",
    };
  }

  // Advance (partial) = sum of each line's advancePercent of its line total.
  const productById = new Map(products.map((p) => [p.id, p]));
  let advance = 0;
  if (mode === "partial") {
    for (const li of validItems) {
      const pct = productById.get(li.productId)?.advancePercent ?? 0;
      advance += Math.round((li.price * li.quantity * pct) / 100);
    }
    advance = Math.min(Math.max(advance, 0), total);
    if (advance <= 0) {
      return {
        ok: false as const,
        error: "Partial payment isn't configured for these items. Please choose another option.",
      };
    }
  }

  // What we charge online now vs. what remains for delivery.
  const onlineCharge = mode === "prepaid" ? total : mode === "partial" ? advance : 0;
  const balanceDue = total - onlineCharge; // prepaid→0, partial→remainder, cod/direct→total
  const needsPayment = onlineCharge > 0;

  const number = orderNumber();

  // Denormalised so Admin → Orders can badge and filter made-to-order baskets
  // without re-reading the catalogue for every row. The per-item flags are
  // still read live in the admin, so this only has to be right at checkout.
  const needsCustomisation = validItems.some(
    (i) => productById.get(i.productId)?.isCustomisable === true
  );

  // `redeemCoupon` throws when it loses the race for the last use, which rolls
  // the whole transaction back — no order row, no decremented stock.
  let order: Order;
  try {
    order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          orderNumber: number,
          userId: user.id,
          customerName: data.customerName,
          email: data.email,
          phone: data.phone,
          address: data.address,
          city: data.city,
          state: data.state,
          pincode: data.pincode,
          note: data.note,
          paymentMethod: data.paymentMethod,
          items: validItems,
          subtotal,
          shipping,
          discountTotal,
          couponCode: appliedCoupon?.code,
          total,
          amountPaid: 0,
          balanceDue,
          needsCustomisation,
          statusHistory: [
            { status: "pending", note: "Order placed", at: new Date().toISOString() },
          ],
        },
      });

      // Reduce stock (reserves it while an online payment is completed).
      for (const i of validItems) {
        await tx.product.update({
          where: { id: i.productId },
          data: { stock: { decrement: i.quantity } },
        });
      }

      // Take the use and write the redemption row in this same transaction, so
      // the global count, the per-person history and the order either all
      // exist or none of them do.
      if (appliedCoupon) {
        await redeemCoupon(tx, {
          couponId: appliedCoupon.id,
          amount: discountTotal,
          usageLimit: appliedCoupon.usageLimit,
          perUserLimit: appliedCoupon.perUserLimit,
          orderId: created.id,
          userId: user.id,
          email: data.email,
        });
      }

      return created;
    });
  } catch (err) {
    if (isCouponClaimError(err)) {
      return { ok: false as const, error: err.message };
    }
    throw err;
  }

  // Mark this visitor's leads as ordered.
  if (data.visitorId) {
    await prisma.lead
      .updateMany({
        where: { visitorId: data.visitorId, status: { notIn: ["ordered", "lost"] } },
        data: { status: "ordered" },
      })
      .catch(() => {});
  }

  // Remember this shipping address on the account so it prefills next time.
  await prisma.user
    .update({
      where: { id: user.id },
      data: {
        phone: data.phone,
        address: data.address,
        city: data.city,
        state: data.state,
        pincode: data.pincode,
      },
    })
    .catch(() => {});

  // ---- Online (prepaid / partial): create a Razorpay order for the browser. ----
  // Confirmation emails are deferred until the payment is verified.
  if (needsPayment) {
    try {
      const rzp = await createRazorpayOrder({
        amountInRupees: onlineCharge,
        receipt: order.orderNumber,
        notes: { orderNumber: order.orderNumber, mode },
      });
      await prisma.order.update({
        where: { id: order.id },
        data: { razorpayOrderId: rzp.id },
      });
      return {
        ok: true as const,
        orderNumber: order.orderNumber,
        payment: {
          provider: "razorpay" as const,
          orderId: rzp.id,
          amount: rzp.amount, // paise
          currency: rzp.currency,
          keyId: razorpayPublicKey(),
          name: settings.brandName,
          prefill: {
            name: order.customerName,
            email: order.email,
            contact: order.phone,
          },
        },
      };
    } catch (err) {
      console.error("[orders] razorpay order failed:", err);
      // Roll the reserved stock back and remove the just-created order so we
      // don't leave a dangling unpaid order with depleted stock.
      //
      // The coupon use is given back here too. `CouponRedemption.orderId` is a
      // plain column, not a relation, so deleting the order would otherwise
      // leave the redemption row and the incremented `usedCount` behind — a
      // shopper whose payment window failed to open would have burned their
      // one allowed use on nothing.
      await prisma
        .$transaction(async (tx) => {
          for (const i of validItems) {
            await tx.product.update({
              where: { id: i.productId },
              data: { stock: { increment: i.quantity } },
            });
          }
          if (appliedCoupon) {
            const { count } = await tx.couponRedemption.deleteMany({
              where: { couponId: appliedCoupon.id, orderId: order.id },
            });
            if (count > 0) {
              await tx.coupon.update({
                where: { id: appliedCoupon.id },
                data: { usedCount: { decrement: count } },
              });
            }
          }
          await tx.order.delete({ where: { id: order.id } });
        })
        .catch(() => {});
      return {
        ok: false as const,
        error: "Could not start the payment. Please try again or use another option.",
      };
    }
  }

  // ---- COD / Direct: email, then let the pipeline decide. ----
  //
  // Nothing is confirmed here by hand. `autoConfirmOrder` applies the store's
  // `orderConfirmMode` (see lib/orders-pipeline.ts) and, when it does confirm,
  // stages the NimbusPost draft — or books it, if the admin has switched
  // auto-ship on. On the shipped defaults (`manual`) this leaves the order
  // pending for a human, which is what the Orders screen is for.
  try {
    await sendOrderEmails(settings, {
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      email: order.email,
      phone: order.phone,
      address: order.address,
      city: order.city,
      state: order.state,
      pincode: order.pincode,
      items: validItems,
      subtotal,
      shipping,
      total,
      paymentMethod: order.paymentMethod,
      note: order.note,
    });
  } catch (err) {
    console.error("[orders] email failed:", err);
  }

  // Best-effort: a pipeline problem must never fail an order the customer has
  // already placed. Anything that goes wrong is recorded on the order.
  await autoConfirmOrder(order.id).catch((err) =>
    console.error("[orders] auto-confirm failed:", err)
  );

  return { ok: true as const, orderNumber: order.orderNumber };
}

// ---------------------------------------------------------------------------
// Checkout context: the payment options + advance rules for a cart, resolved
// against product settings and the global toggles. Called by the checkout page.
// ---------------------------------------------------------------------------
export async function getCheckoutContext(productIds: string[]) {
  const ids = Array.from(new Set(productIds)).filter(Boolean);
  const [settings, products] = await Promise.all([
    getSettings(),
    ids.length
      ? prisma.product.findMany({
          where: { id: { in: ids } },
          select: { id: true, paymentModes: true, advancePercent: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    methods: methodAvailability(settings),
    products: products.map((p) => ({
      id: p.id,
      paymentModes: (p.paymentModes?.length
        ? p.paymentModes
        : ["prepaid", "cod"]) as PaymentMode[],
      advancePercent: p.advancePercent,
    })),
  };
}

// ---------------------------------------------------------------------------
// Verify a Razorpay payment after Checkout returns success in the browser.
// This is the authoritative step: we only mark an order paid here, server-side,
// after the signature checks out — never trust the client's word alone.
// ---------------------------------------------------------------------------
const verifySchema = z.object({
  orderNumber: z.string().min(3),
  razorpayOrderId: z.string().min(3),
  razorpayPaymentId: z.string().min(3),
  razorpaySignature: z.string().min(3),
});

export type VerifyPaymentInput = z.input<typeof verifySchema>;

export async function verifyRazorpayPayment(input: VerifyPaymentInput) {
  const user = await getUserSession();
  if (!user) {
    return { ok: false as const, error: "Please log in again." };
  }

  const parsed = verifySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  const order = await prisma.order.findUnique({
    where: { orderNumber: data.orderNumber },
  });
  if (!order || order.userId !== user.id) {
    return { ok: false as const, error: "Order not found." };
  }
  if (order.paymentStatus === "paid" || order.paymentStatus === "partial") {
    return { ok: true as const, orderNumber: order.orderNumber };
  }
  if (order.razorpayOrderId !== data.razorpayOrderId) {
    return { ok: false as const, error: "Payment does not match this order." };
  }

  const valid = verifyRazorpaySignature({
    orderId: data.razorpayOrderId,
    paymentId: data.razorpayPaymentId,
    signature: data.razorpaySignature,
  });
  if (!valid) {
    await prisma.order
      .update({ where: { id: order.id }, data: { paymentStatus: "failed" } })
      .catch(() => {});
    return { ok: false as const, error: "Payment verification failed." };
  }

  // amountPaid is whatever we charged online (full for prepaid, advance for
  // partial). balanceDue was fixed at order creation; a remaining balance means
  // this was a partial (advance) payment.
  const amountPaid = Math.max(0, order.total - order.balanceDue);
  const isPartial = order.balanceDue > 0;
  const paymentStatus = isPartial ? "partial" : "paid";

  // Whether a verified payment also *confirms* the order is the store's
  // decision, not this function's — it used to be hard-coded to "confirmed",
  // which made Admin → Orders' confirmation mode a lie for every prepaid
  // order. The same pure rule the checkout path uses decides it here, now
  // that the real post-payment status is known.
  const pipeline = await getPipelineSettings();
  const decision = shouldAutoConfirm(
    { paymentMethod: order.paymentMethod, paymentStatus },
    pipeline
  );

  const paidNote = isPartial
    ? `Advance received (Razorpay) — balance ₹${order.balanceDue} on delivery.`
    : "Payment received (Razorpay).";

  const history = Array.isArray(order.statusHistory)
    ? (order.statusHistory as unknown as { status: string; note?: string; at: string }[])
    : [];
  history.push({
    status: decision.confirm ? "confirmed" : order.status,
    note: decision.confirm
      ? `${paidNote} Order confirmed automatically.`
      : `${paidNote} ${decision.reason}`,
    at: new Date().toISOString(),
  });

  await prisma.order.update({
    where: { id: order.id },
    data: {
      paymentStatus,
      amountPaid,
      // Payment and confirmation are separate facts. The money is recorded
      // either way; only the status waits.
      ...(decision.confirm ? { status: "confirmed" } : {}),
      razorpayPaymentId: data.razorpayPaymentId,
      statusHistory: history as unknown as object[],
    },
  });

  // Confirmed → stage the draft (or book it, when auto-ship is on). Not
  // confirmed → nothing is staged, because "order confirmed ⇒ draft staged"
  // is the contract, and a draft for an order nobody has accepted is clutter
  // the admin has to clean out of NimbusPost by hand.
  if (decision.confirm) {
    await runConfirmationPipeline(order.id).catch((err) =>
      console.error("[orders] draft shipment failed:", err)
    );
  }

  // Now that the order is paid, send the confirmation emails.
  try {
    const settings = await getSettings();
    await sendOrderEmails(settings, {
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      email: order.email,
      phone: order.phone,
      address: order.address,
      city: order.city,
      state: order.state,
      pincode: order.pincode,
      items: order.items as unknown as {
        name: string;
        quantity: number;
        price: number;
      }[],
      subtotal: order.subtotal,
      shipping: order.shipping,
      total: order.total,
      paymentMethod: order.paymentMethod,
      note: order.note,
    });
  } catch (err) {
    console.error("[orders] paid-email failed:", err);
  }

  return { ok: true as const, orderNumber: order.orderNumber };
}
