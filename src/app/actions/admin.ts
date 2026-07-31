"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAdminSession, hashPassword } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { sendOrderStatusEmail } from "@/lib/email";
import { isLeadStatus } from "@/lib/leads";
import { slugify } from "@/lib/utils";
import {
  createDraftForOrder,
  dispatchOrder,
  syncOrderFromNimbus,
} from "@/lib/fulfilment";

async function requireAdmin() {
  const session = await getAdminSession();
  if (!session) throw new Error("Unauthorized");
  return session;
}

function revalidateStore() {
  revalidatePath("/");
  revalidatePath("/shop");
  revalidatePath("/admin/products");
  revalidatePath("/admin");
}

async function ensureUniqueSlug(name: string, ignoreId?: string) {
  const base = slugify(name) || "product";
  let slug = base;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await prisma.product.findUnique({ where: { slug } });
    if (!existing || existing.id === ignoreId) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
}

const optionSchema = z.object({
  name: z.string().trim().min(1),
  choices: z
    .array(
      z.object({
        label: z.string().trim().min(1),
        priceDelta: z.coerce.number().int().default(0),
        image: z.string().trim().nullable().optional(),
      })
    )
    .min(1),
});

const variantPriceSchema = z.object({
  combo: z.record(z.string(), z.string()),
  price: z.coerce.number().int().nonnegative(),
});

const variantSchema = z.object({
  combo: z.record(z.string(), z.string()),
  price: z.coerce.number().int().nonnegative(),
  available: z.boolean().default(true),
  images: z.array(z.string()).default([]),
});

const PAYMENT_MODES = ["prepaid", "cod", "partial", "direct"] as const;

const productSchema = z.object({
  name: z.string().min(2),
  description: z.string().min(1),
  category: z.string().min(1),
  secondaryCategory: z.string().nullable().optional(),
  price: z.coerce.number().int().nonnegative(),
  compareAtPrice: z.coerce.number().int().nonnegative().nullable().optional(),
  stock: z.coerce.number().int().nonnegative(),
  tags: z.array(z.string()).default([]),
  images: z.array(z.string()).default([]),
  options: z.array(optionSchema).default([]),
  variantPrices: z.array(variantPriceSchema).default([]),
  variants: z.array(variantSchema).default([]),
  isFeatured: z.boolean().default(false),
  isActive: z.boolean().default(true),
  // Which checkout modes this product supports (subset of the 4 modes).
  paymentModes: z
    .array(z.enum(PAYMENT_MODES))
    .min(1, "Select at least one checkout mode")
    .default(["prepaid", "cod"]),
  // Advance % taken online when "partial" is chosen. Required when partial is enabled.
  advancePercent: z.coerce.number().int().min(1).max(99).nullable().optional(),
  // Optional parcel size for shipping (grams / cm) — overrides env defaults.
  weightGrams: z.coerce.number().int().positive().nullable().optional(),
  lengthCm: z.coerce.number().int().positive().nullable().optional(),
  breadthCm: z.coerce.number().int().positive().nullable().optional(),
  heightCm: z.coerce.number().int().positive().nullable().optional(),
  shippingType: z.string().default("free"),
  shippingFee: z.coerce.number().int().nonnegative().default(0),
  shippingMarkup: z.coerce.number().int().default(0),
});

export type ProductInput = z.input<typeof productSchema>;

export async function createProduct(input: ProductInput) {
  await requireAdmin();
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const data = parsed.data;
  const slug = await ensureUniqueSlug(data.name);

  const product = await prisma.product.create({
    data: {
      ...data,
      secondaryCategory: data.secondaryCategory || null,
      compareAtPrice: data.compareAtPrice || null,
      options: data.options,
      variantPrices: data.variantPrices,
      variants: data.variants,
      paymentModes: data.paymentModes,
      advancePercent: data.advancePercent ?? null,
      weightGrams: data.weightGrams ?? null,
      lengthCm: data.lengthCm ?? null,
      breadthCm: data.breadthCm ?? null,
      heightCm: data.heightCm ?? null,
      shippingType: data.shippingType,
      shippingFee: data.shippingFee,
      shippingMarkup: data.shippingMarkup,
      slug,
    },
  });
  revalidateStore();
  return { ok: true as const, id: product.id };
}

export async function updateProduct(id: string, input: ProductInput) {
  await requireAdmin();
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const data = parsed.data;
  const slug = await ensureUniqueSlug(data.name, id);

  await prisma.product.update({
    where: { id },
    data: {
      ...data,
      secondaryCategory: data.secondaryCategory || null,
      compareAtPrice: data.compareAtPrice || null,
      options: data.options,
      variantPrices: data.variantPrices,
      variants: data.variants,
      paymentModes: data.paymentModes,
      advancePercent: data.advancePercent ?? null,
      weightGrams: data.weightGrams ?? null,
      lengthCm: data.lengthCm ?? null,
      breadthCm: data.breadthCm ?? null,
      heightCm: data.heightCm ?? null,
      shippingType: data.shippingType,
      shippingFee: data.shippingFee,
      shippingMarkup: data.shippingMarkup,
      slug,
    },
  });
  revalidateStore();
  revalidatePath(`/product/${slug}`);
  return { ok: true as const };
}

export async function deleteProduct(id: string) {
  await requireAdmin();
  await prisma.product.delete({ where: { id } });
  revalidateStore();
  return { ok: true as const };
}

export async function setProductActive(id: string, isActive: boolean) {
  await requireAdmin();
  await prisma.product.update({ where: { id }, data: { isActive } });
  revalidateStore();
  return { ok: true as const };
}

// -------- Categories --------
const categorySchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  imageUrl: z.string().trim().nullable().optional(),
});

export type CategoryInput = z.input<typeof categorySchema>;

async function ensureUniqueCategorySlug(name: string, ignoreId?: string) {
  const base = slugify(name) || "category";
  let slug = base;
  let n = 1;
  while (true) {
    const existing = await prisma.category.findUnique({ where: { slug } });
    if (!existing || existing.id === ignoreId) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
}

export async function createCategory(input: CategoryInput) {
  await requireAdmin();
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const { name, imageUrl } = parsed.data;
  const slug = await ensureUniqueCategorySlug(name);

  try {
    const category = await prisma.category.create({
      data: {
        name,
        slug,
        imageUrl: imageUrl || null,
      },
    });
    revalidateStore();
    revalidatePath("/admin/categories");
    return { ok: true as const, id: category.id };
  } catch (err: any) {
    return { ok: false as const, error: err.message || "Failed to create category" };
  }
}

export async function updateCategory(id: string, input: CategoryInput) {
  await requireAdmin();
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const { name, imageUrl } = parsed.data;
  const slug = await ensureUniqueCategorySlug(name, id);

  try {
    await prisma.category.update({
      where: { id },
      data: {
        name,
        slug,
        imageUrl: imageUrl || null,
      },
    });
    revalidateStore();
    revalidatePath("/admin/categories");
    return { ok: true as const };
  } catch (err: any) {
    return { ok: false as const, error: err.message || "Failed to update category" };
  }
}

export async function deleteCategory(id: string) {
  await requireAdmin();
  try {
    await prisma.category.delete({ where: { id } });
    revalidateStore();
    revalidatePath("/admin/categories");
    return { ok: true as const };
  } catch (err: any) {
    return { ok: false as const, error: err.message || "Failed to delete category" };
  }
}


// -------- Settings (branding + contact) --------
const settingsSchema = z.object({
  brandName: z.string().min(1),
  tagline: z.string().default(""),
  logoUrl: z.string().nullable().optional(),
  heroHeadline: z.string().default(""),
  heroSubtext: z.string().default(""),
  aboutText: z.string().default(""),
  contactEmail: z.string().email(),
  contactPhone: z.string().default(""),
  whatsapp: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  instagram: z.string().nullable().optional(),
  facebook: z.string().nullable().optional(),
  adminNotifyEmail: z.string().email(),
  currency: z.string().default("INR"),
  freeShippingThreshold: z.coerce
    .number()
    .int()
    .nonnegative()
    .nullable()
    .optional(),
  // Per-method availability.
  codEnabled: z.boolean().default(true),
  prepaidEnabled: z.boolean().default(true),
  partialEnabled: z.boolean().default(true),
  directEnabled: z.boolean().default(true),
  // Integration master switches.
  razorpayEnabled: z.boolean().default(false),
  nimbusEnabled: z.boolean().default(false),
  announcement: z.string().nullable().optional(),
});

export type SettingsInput = z.input<typeof settingsSchema>;

export async function updateSettings(input: SettingsInput) {
  await requireAdmin();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  await prisma.siteSettings.upsert({
    where: { id: "main" },
    update: {
      ...data,
      freeShippingThreshold: data.freeShippingThreshold ?? null,
      razorpayEnabled: data.razorpayEnabled ?? false,
      nimbusEnabled: data.nimbusEnabled ?? false,
    },
    create: {
      id: "main",
      ...data,
      freeShippingThreshold: data.freeShippingThreshold ?? null,
      razorpayEnabled: data.razorpayEnabled ?? false,
      nimbusEnabled: data.nimbusEnabled ?? false,
    },
  });

  revalidatePath("/", "layout");
  return { ok: true as const };
}

// -------- Orders --------
const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "shipped",
  "delivered",
  "cancelled",
  "payment_failed",
] as const;

type StatusEntry = { status: string; note?: string; at: string };

export async function updateOrderStatus(
  id: string,
  status: string,
  note?: string
) {
  await requireAdmin();
  if (!ORDER_STATUSES.includes(status as (typeof ORDER_STATUSES)[number])) {
    return { ok: false as const, error: "Invalid status" };
  }

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return { ok: false as const, error: "Order not found" };

  const history = Array.isArray(order.statusHistory)
    ? (order.statusHistory as unknown as StatusEntry[])
    : [];
  const entry: StatusEntry = { status, at: new Date().toISOString() };
  const trimmed = note?.trim();
  if (trimmed) entry.note = trimmed;
  history.push(entry);

  await prisma.order.update({
    where: { id },
    data: {
      status,
      statusHistory: history as unknown as object[],
      ...(trimmed ? { note: trimmed } : {}),
    },
  });

  // Notify the customer of the new status.
  try {
    const settings = await getSettings();
    await sendOrderStatusEmail(settings, {
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      email: order.email,
      status,
      courier: order.courier,
      trackingNumber: order.trackingNumber,
      trackingUrl: order.trackingUrl,
    });
  } catch (err) {
    console.error("[admin] status email failed:", err);
  }

  revalidatePath("/admin/orders");
  revalidatePath("/admin");
  return { ok: true as const };
}

const trackingSchema = z.object({
  courier: z.string().trim().optional(),
  trackingNumber: z.string().trim().optional(),
  trackingUrl: z
    .string()
    .trim()
    .url("Enter a valid URL")
    .optional()
    .or(z.literal("")),
});

export async function updateOrderTracking(
  id: string,
  input: { courier?: string; trackingNumber?: string; trackingUrl?: string }
) {
  await requireAdmin();
  const parsed = trackingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const data = parsed.data;
  await prisma.order.update({
    where: { id },
    data: {
      courier: data.courier || null,
      trackingNumber: data.trackingNumber || null,
      trackingUrl: data.trackingUrl || null,
    },
  });
  revalidatePath("/admin/orders");
  return { ok: true as const };
}

export async function updatePaymentStatus(id: string, paymentStatus: string) {
  await requireAdmin();
  await prisma.order.update({ where: { id }, data: { paymentStatus } });
  revalidatePath("/admin/orders");
  return { ok: true as const };
}

export async function addOrderNote(id: string, note: string) {
  await requireAdmin();
  const trimmed = note.trim();
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return { ok: false as const, error: "Order not found" };

  const history = Array.isArray(order.statusHistory)
    ? (order.statusHistory as unknown as StatusEntry[])
    : [];
  if (trimmed) {
    history.push({
      status: order.status,
      note: `Note: ${trimmed}`,
      at: new Date().toISOString(),
    });
  }

  await prisma.order.update({
    where: { id },
    data: {
      note: trimmed || null,
      statusHistory: history as unknown as object[],
    },
  });

  revalidatePath("/admin/orders");
  revalidatePath("/admin");
  return { ok: true as const };
}

// Admin accepts a (COD/Direct) order: move pending → confirmed, email the
// customer, and stage a NimbusPost draft shipment for one-click dispatch.
export async function confirmOrder(id: string) {
  await requireAdmin();
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return { ok: false as const, error: "Order not found" };
  if (order.status !== "pending") {
    return { ok: false as const, error: `Order is already ${order.status}.` };
  }

  const history = Array.isArray(order.statusHistory)
    ? (order.statusHistory as unknown as StatusEntry[])
    : [];
  history.push({
    status: "confirmed",
    note: "Order accepted by admin",
    at: new Date().toISOString(),
  });

  await prisma.order.update({
    where: { id },
    data: { status: "confirmed", statusHistory: history as unknown as object[] },
  });

  // Notify the customer.
  try {
    const settings = await getSettings();
    await sendOrderStatusEmail(settings, {
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      email: order.email,
      status: "confirmed",
      courier: order.courier,
      trackingNumber: order.trackingNumber,
      trackingUrl: order.trackingUrl,
    });
  } catch (err) {
    console.error("[admin] confirm email failed:", err);
  }

  // Stage a draft shipment (best-effort; needs NimbusPost configured).
  const draft = await createDraftForOrder(id).catch((err) => {
    console.error("[admin] draft shipment failed:", err);
    return { ok: false as const, error: String(err?.message ?? err) };
  });

  revalidatePath("/admin/orders");
  revalidatePath("/admin");
  return { ok: true as const, draft };
}

// -------- Shipping (NimbusPost) --------
// One-click dispatch: generate the AWB (uses the staged draft if present).
/**
 * Books a staged draft. If nothing is staged yet it stages the draft and stops
 * — booking never happens on the same click, so the draft can be reviewed in
 * NimbusPost (or here) first.
 */
export async function shipOrderViaNimbus(id: string) {
  await requireAdmin();

  const result = await dispatchOrder(id);
  if (!result.ok) {
    console.error("[admin] dispatchOrder failed:", result.error);
    return { ok: false as const, error: result.error || "Failed to create shipment." };
  }

  // Draft staged only — no courier, no AWB, no wallet charge, nothing to email.
  if (result.outcome === "drafted") {
    revalidatePath("/admin/orders");
    revalidatePath("/admin");
    return {
      ok: true as const,
      outcome: "drafted" as const,
      nimbusOrderId: result.nimbusOrderId,
    };
  }

  // Notify the customer their order has shipped (with tracking).
  try {
    const [settings, order] = await Promise.all([
      getSettings(),
      prisma.order.findUnique({ where: { id } }),
    ]);
    if (order) {
      await sendOrderStatusEmail(settings, {
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        email: order.email,
        status: "shipped",
        courier: order.courier,
        trackingNumber: order.trackingNumber,
        trackingUrl: order.trackingUrl,
      });
    }
  } catch (err) {
    console.error("[admin] ship email failed:", err);
  }

  revalidatePath("/admin/orders");
  revalidatePath("/admin");
  return {
    ok: true as const,
    outcome: "booked" as const,
    awb: result.awb,
    courier: result.courier,
  };
}

/**
 * Pull in a booking made by a human in the NimbusPost dashboard, so the AWB,
 * courier and tracking link land in our database and the customer gets notified.
 */
export async function syncOrderFromNimbusAction(id: string) {
  await requireAdmin();

  const result = await syncOrderFromNimbus(id);
  if (!result.ok) return { ok: false as const, error: result.error };

  if (result.outcome === "not-booked") {
    return {
      ok: true as const,
      outcome: "not-booked" as const,
      orderStatus: result.orderStatus,
    };
  }

  try {
    const [settings, order] = await Promise.all([
      getSettings(),
      prisma.order.findUnique({ where: { id } }),
    ]);
    if (order) {
      await sendOrderStatusEmail(settings, {
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        email: order.email,
        status: "shipped",
        courier: order.courier,
        trackingNumber: order.trackingNumber,
        trackingUrl: order.trackingUrl,
      });
    }
  } catch (err) {
    console.error("[admin] sync ship email failed:", err);
  }

  revalidatePath("/admin/orders");
  revalidatePath("/admin");
  return {
    ok: true as const,
    outcome: "synced" as const,
    awb: result.awb,
    courier: result.courier,
  };
}

// -------- Cancel abandoned order & restore stock --------
export async function cancelAndRestoreStock(id: string) {
  await requireAdmin();

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return { ok: false as const, error: "Order not found" };
  if (order.status === "cancelled") {
    return { ok: false as const, error: "Order is already cancelled" };
  }
  if (order.paymentStatus === "paid") {
    return {
      ok: false as const,
      error: "Cannot cancel a fully paid order here. Change status manually.",
    };
  }

  const items = Array.isArray(order.items)
    ? (order.items as unknown as { productId: string; quantity: number }[])
    : [];

  const history = Array.isArray(order.statusHistory)
    ? (order.statusHistory as unknown as StatusEntry[])
    : [];
  history.push({
    status: "cancelled",
    note: "Cancelled by admin — stock restored",
    at: new Date().toISOString(),
  });

  await prisma.$transaction(async (tx) => {
    // Restore each product's stock.
    for (const item of items) {
      if (item.productId && item.quantity > 0) {
        await tx.product
          .update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          })
          .catch(() => {}); // ignore if product was deleted
      }
    }
    await tx.order.update({
      where: { id },
      data: {
        status: "cancelled",
        statusHistory: history as unknown as object[],
      },
    });
  });

  revalidatePath("/admin/orders");
  revalidatePath("/admin");
  return { ok: true as const };
}

// -------- Messages --------
export async function setMessageRead(id: string, isRead: boolean) {
  await requireAdmin();
  await prisma.message.update({ where: { id }, data: { isRead } });
  revalidatePath("/admin/messages");
  revalidatePath("/admin");
  return { ok: true as const };
}

export async function deleteMessage(id: string) {
  await requireAdmin();
  await prisma.message.delete({ where: { id } });
  revalidatePath("/admin/messages");
  return { ok: true as const };
}

// -------- Leads (interested customers) --------
export async function updateLeadStatus(id: string, status: string) {
  await requireAdmin();
  if (!isLeadStatus(status)) {
    return { ok: false as const, error: "Invalid status" };
  }
  await prisma.lead.update({ where: { id }, data: { status } });
  revalidatePath("/admin/leads");
  revalidatePath("/admin");
  return { ok: true as const };
}

export async function updateLeadNotes(id: string, notes: string) {
  await requireAdmin();
  await prisma.lead.update({
    where: { id },
    data: { notes: notes.trim() || null },
  });
  revalidatePath("/admin/leads");
  return { ok: true as const };
}

export async function deleteLead(id: string) {
  await requireAdmin();
  await prisma.lead.delete({ where: { id } });
  revalidatePath("/admin/leads");
  return { ok: true as const };
}

// -------- Admin password change --------
export async function changeAdminPassword(newPassword: string) {
  const session = await requireAdmin();
  if (newPassword.length < 6) {
    return { ok: false as const, error: "Password must be at least 6 characters" };
  }
  if (session.id === "env-admin") {
    return {
      ok: false as const,
      error:
        "You are logged in with env credentials. Seed the database to create a DB admin first.",
    };
  }
  await prisma.adminUser.update({
    where: { id: session.id },
    data: { passwordHash: await hashPassword(newPassword) },
  });
  return { ok: true as const };
}
