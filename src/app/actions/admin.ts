"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAdminSession, hashPassword } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { sendOrderStatusEmail } from "@/lib/email";
import { isLeadStatus } from "@/lib/leads";
import { slugify } from "@/lib/utils";
import { deriveVariantModel } from "@/lib/variants";
import {
  chooseCourierForOrder,
  createDraftForOrder,
  dispatchOrder,
  getCourierOptionsForOrder,
  syncAllOpenOrders,
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

// Keep optionSchema loose for backward compatibility or simple options if any
const optionSchema = z.any();
const attributeSchema = z.any();
const propertyDependenciesSchema = z.any();
const rulesSchema = z.any();
const sellableVariantSchema = z.any();
const variantSchema = z.any();
const variantPriceSchema = z.any();

const PAYMENT_MODES = ["prepaid", "cod", "partial", "direct"] as const;

const productSchema = z.object({
  name: z.string().min(2),
  description: z.string().min(1),
  category: z.string().min(1),
  secondaryCategory: z.string().nullable().optional(),
  // Group inside the primary category. Null = a one-off shown on the category page.
  subcategoryId: z.string().nullable().optional(),
  price: z.coerce.number().int().nonnegative(),
  compareAtPrice: z.coerce.number().int().nonnegative().nullable().optional(),
  stock: z.coerce.number().int().nonnegative(),
  tags: z.array(z.string()).default([]),
  images: z.array(z.string()).default([]),
  options: z.any().optional(),
  attributes: z.any().optional(),
  propertyModules: z.any().optional(),
  rules: z.any().optional(),
  sellableVariants: z.any().optional(),
  variantPrices: z.any().optional(),
  variants: z.any().optional(),
  // Clean preview/gallery/common media split from the editor's Media tab:
  // { previews: Record<visualValue,string>, galleries: Record<visualValue,string[]>, common: string[] }.
  media: z.any().optional(),
  isFeatured: z.boolean().default(false),
  isActive: z.boolean().default(true),
  // Made-to-order / personalised piece, plus what the buyer has to supply.
  // The note is only meaningful while `isCustomisable` is true — the editor
  // sends null for it otherwise, so a switched-off product can't keep asking
  // the storefront for details nobody is collecting.
  isCustomisable: z.boolean().default(false),
  customisationNote: z.string().nullable().optional(),
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
  // Per-product overrides for the info accordion. `null` = inherit the store
  // default (see resolveProductInfo); a string replaces it for this product.
  materialsCare: z.string().nullable().optional(),
  // Returns override. `null` = inherit SiteSettings.defaultReturnable.
  //
  // This key was missing entirely, so zod stripped it from every payload and
  // neither writer below set the column — the admin's Returns control has
  // never actually saved. resolveReturnPolicy() reads this field, so a piece
  // marked non-returnable was still being offered for return.
  returnable: z.boolean().nullable().optional(),
  // Social/video links for the product page's "Video previews" rail. Rows with
  // no url are dropped by the editor; the url is checked here so a typo can't
  // reach the storefront as a dead card.
  videos: z
    .array(
      z.object({
        title: z.string().trim().max(120).default(""),
        url: z.string().trim().url("Enter a valid video URL"),
      })
    )
    .max(12, "Up to 12 video links per product")
    .optional(),
  shippingInfo: z.string().nullable().optional(),
  returnsInfo: z.string().nullable().optional(),
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
  const { attributes, sellableVariants } = deriveVariantModel({
    options: data.options,
    variants: (data as { variants?: unknown }).variants,
    price: data.price,
    stock: data.stock,
  });

  // `media` only drives syncProductImages below — it is NOT a Product column,
  // so it must never reach prisma (spreading it makes the whole create/update
  // throw PrismaClientValidationError and the save silently fails).
  const { media: _media, ...productData } = data;

  const product = await prisma.product.create({
    data: {
      ...productData,
      secondaryCategory: data.secondaryCategory || null,
      subcategoryId: data.subcategoryId || null,
      compareAtPrice: data.compareAtPrice || null,
      options: data.options ?? [],
      attributes,
      propertyModules: data.propertyModules ?? {},
      rules: data.rules ?? {},
      sellableVariants,
      variantPrices: data.variantPrices ?? [],
      variants: data.variants ?? [],
      paymentModes: data.paymentModes,
      advancePercent: data.advancePercent ?? null,
      weightGrams: data.weightGrams ?? null,
      lengthCm: data.lengthCm ?? null,
      breadthCm: data.breadthCm ?? null,
      heightCm: data.heightCm ?? null,
      shippingType: data.shippingType,
      shippingFee: data.shippingFee,
      shippingMarkup: data.shippingMarkup,
      isCustomisable: data.isCustomisable,
      customisationNote: data.customisationNote ?? null,
      // `undefined` would leave the column at its previous value on update, so
      // collapse it to null — the "inherit the store default" state.
      // null = inherit SiteSettings.defaultReturnable.
      returnable: data.returnable ?? null,
      materialsCare: data.materialsCare ?? null,
      shippingInfo: data.shippingInfo ?? null,
      returnsInfo: data.returnsInfo ?? null,
      videos: data.videos ?? [],
      slug,
    },
  });

  await syncProductImages(product.id, data);

  revalidateStore();
  return { ok: true as const, id: product.id };
}

/**
 * Persist ProductImage rows from the editor's clean preview/gallery/common media
 * split (`data.media`), and upsert a Media row for every referenced url.
 *
 * Row contract (matches the storefront reader):
 *  - Each visual variant value V is a value of the product's image-driving option
 *    (Product.propertyModules.images[0], e.g. "Pink"). The editor already keys
 *    `media.galleries` / `media.previews` on those values, so we use their keys
 *    directly rather than assuming any particular option:
 *      preview → slot="preview", variantValue=V, sortOrder=0 (when a preview exists)
 *      gallery → slot="gallery", variantValue=V, sortOrder=0..n
 *  - Common gallery → slot="common", variantValue=null, sortOrder=0..n
 *  - Deduped to respect @@unique([productId, mediaId, variantValue]).
 * When no media split is present, product-level images fall back to slot="common".
 */
async function syncProductImages(productId: string, data: z.infer<typeof productSchema>) {
  const media = (data as { media?: unknown }).media as
    | { previews?: Record<string, string>; galleries?: Record<string, string[]>; common?: string[] }
    | undefined;
  // The editor always sends a media object, but it's empty for products without
  // visual variants — in that case fall back to writing the flat image list.
  const hasMediaContent =
    !!media &&
    ((media.common?.length ?? 0) > 0 ||
      Object.values(media.galleries ?? {}).some((a) => (a?.length ?? 0) > 0) ||
      Object.keys(media.previews ?? {}).length > 0);

  // 1) Ensure a Media row exists for every referenced url.
  const urls = new Set<string>();
  data.images.forEach((img) => img && urls.add(img));
  if (media) {
    Object.values(media.previews ?? {}).forEach((u) => u && urls.add(u));
    Object.values(media.galleries ?? {}).forEach((arr) =>
      (arr ?? []).forEach((u) => u && urls.add(u))
    );
    (media.common ?? []).forEach((u) => u && urls.add(u));
  }
  ((data as any).variants || []).forEach((v: any) =>
    (v.images || []).forEach((img: any) => img && urls.add(img))
  );

  for (const url of Array.from(urls)) {
    if (!url) continue;
    const file = url.split("/").pop() || url;
    await prisma.media.upsert({
      where: { url },
      update: {},
      create: { url, file, source: "repo" },
    });
  }

  // Map url → mediaId so we don't re-query per row.
  const mediaRows = await prisma.media.findMany({
    where: { url: { in: Array.from(urls).filter(Boolean) } },
    select: { id: true, url: true },
  });
  const idByUrl = new Map(mediaRows.map((m) => [m.url, m.id]));

  // 2) Rebuild the relations.
  await prisma.productImage.deleteMany({ where: { productId } });

  // Build the desired rows, deduped by (variantValue, mediaId) so the
  // @@unique constraint is never violated (a preview that also appears in its
  // gallery is kept once, as the preview).
  type Row = { mediaId: string; variantValue: string | null; slot: string; sortOrder: number };
  const rows: Row[] = [];
  const seen = new Set<string>(); // key = `${variantValue ?? ""}::${mediaId}`
  const push = (mediaId: string, variantValue: string | null, slot: string, sortOrder: number) => {
    const key = `${variantValue ?? ""}::${mediaId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    rows.push({ mediaId, variantValue, slot, sortOrder });
    return true;
  };

  if (hasMediaContent && media) {
    const galleries = media.galleries ?? {};
    const previews = media.previews ?? {};
    // Every visual value that has a gallery and/or a preview.
    const values = new Set<string>([
      ...Object.keys(galleries),
      ...Object.keys(previews),
    ]);
    for (const val of values) {
      const preview = previews[val];
      if (preview) {
        const id = idByUrl.get(preview);
        if (id) push(id, val, "preview", 0);
      }
      let gs = 0;
      for (const url of galleries[val] ?? []) {
        const id = idByUrl.get(url);
        if (!id) continue;
        if (push(id, val, "gallery", gs)) gs += 1;
      }
    }
    // Common gallery — shown for every variant.
    let cs = 0;
    for (const url of media.common ?? []) {
      const id = idByUrl.get(url);
      if (!id) continue;
      if (push(id, null, "common", cs)) cs += 1;
    }
  } else {
    // No clean media split — treat product images as common.
    let cs = 0;
    for (const url of data.images) {
      const id = idByUrl.get(url);
      if (!id) continue;
      if (push(id, null, "common", cs)) cs += 1;
    }
  }

  for (const row of rows) {
    try {
      await prisma.productImage.create({ data: { productId, ...row } });
    } catch {
      /* duplicate / race — skip */
    }
  }
}

export async function updateProduct(id: string, input: ProductInput) {
  await requireAdmin();
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const data = parsed.data;
  const slug = await ensureUniqueSlug(data.name, id);
  const { attributes, sellableVariants } = deriveVariantModel({
    options: data.options,
    variants: (data as { variants?: unknown }).variants,
    price: data.price,
    stock: data.stock,
  });

  // See createProduct: `media` is for syncProductImages only, never prisma.
  const { media: _media, ...productData } = data;

  await prisma.product.update({
    where: { id },
    data: {
      ...productData,
      secondaryCategory: data.secondaryCategory || null,
      subcategoryId: data.subcategoryId || null,
      compareAtPrice: data.compareAtPrice || null,
      options: data.options ?? [],
      attributes,
      propertyModules: data.propertyModules ?? {},
      rules: data.rules ?? {},
      sellableVariants,
      variantPrices: data.variantPrices ?? [],
      variants: data.variants ?? [],
      paymentModes: data.paymentModes,
      advancePercent: data.advancePercent ?? null,
      weightGrams: data.weightGrams ?? null,
      lengthCm: data.lengthCm ?? null,
      breadthCm: data.breadthCm ?? null,
      heightCm: data.heightCm ?? null,
      shippingType: data.shippingType,
      shippingFee: data.shippingFee,
      isCustomisable: data.isCustomisable,
      // Explicit, not left to the `...productData` spread: an `undefined` here
      // would leave the previous note on the row after the product stopped
      // being made-to-order.
      customisationNote: data.customisationNote ?? null,
      // null = inherit SiteSettings.defaultReturnable.
      returnable: data.returnable ?? null,
      materialsCare: data.materialsCare ?? null,
      shippingInfo: data.shippingInfo ?? null,
      returnsInfo: data.returnsInfo ?? null,
      videos: data.videos ?? [],
      slug,
    },
  });

  await syncProductImages(id, data);

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

// -------- Subcategories --------
// A subcategory is the group a shopper sees in place of its products
// ("Oversized Tees"), with the real products listed one level down.
const subcategorySchema = z.object({
  categoryId: z.string().min(1, "Pick a category"),
  name: z.string().trim().min(1, "Name is required"),
  // 1–2 cover photos; empty means "borrow from the products inside".
  images: z.array(z.string().trim()).max(2, "At most 2 photos").default([]),
  // Manual price range. Both blank = computed live from the products inside.
  priceMin: z.coerce.number().int().nonnegative().nullable().optional(),
  priceMax: z.coerce.number().int().nonnegative().nullable().optional(),
  isActive: z.boolean().default(true),
});

export type SubcategoryInput = z.input<typeof subcategorySchema>;

async function ensureUniqueSubcategorySlug(
  categoryId: string,
  name: string,
  ignoreId?: string
) {
  const base = slugify(name) || "group";
  let slug = base;
  let n = 1;
  while (true) {
    const existing = await prisma.subcategory.findUnique({
      where: { categoryId_slug: { categoryId, slug } },
    });
    if (!existing || existing.id === ignoreId) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
}

function revalidateSubcategories(categoryId: string) {
  revalidateStore();
  revalidatePath("/admin/categories");
  revalidatePath(`/admin/categories/${categoryId}`);
}

export async function createSubcategory(input: SubcategoryInput) {
  await requireAdmin();
  const parsed = subcategorySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const data = parsed.data;
  if (
    data.priceMin != null &&
    data.priceMax != null &&
    data.priceMin > data.priceMax
  ) {
    return { ok: false as const, error: "Lowest price cannot exceed highest price" };
  }
  const slug = await ensureUniqueSubcategorySlug(data.categoryId, data.name);

  try {
    const sub = await prisma.subcategory.create({
      data: {
        categoryId: data.categoryId,
        name: data.name,
        slug,
        images: data.images.filter(Boolean),
        priceMin: data.priceMin ?? null,
        priceMax: data.priceMax ?? null,
        isActive: data.isActive,
      },
    });
    revalidateSubcategories(data.categoryId);
    return { ok: true as const, id: sub.id };
  } catch (err: any) {
    return {
      ok: false as const,
      error: err.message || "Failed to create subcategory",
    };
  }
}

export async function updateSubcategory(id: string, input: SubcategoryInput) {
  await requireAdmin();
  const parsed = subcategorySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const data = parsed.data;
  if (
    data.priceMin != null &&
    data.priceMax != null &&
    data.priceMin > data.priceMax
  ) {
    return { ok: false as const, error: "Lowest price cannot exceed highest price" };
  }
  const slug = await ensureUniqueSubcategorySlug(
    data.categoryId,
    data.name,
    id
  );

  try {
    await prisma.subcategory.update({
      where: { id },
      data: {
        categoryId: data.categoryId,
        name: data.name,
        slug,
        images: data.images.filter(Boolean),
        priceMin: data.priceMin ?? null,
        priceMax: data.priceMax ?? null,
        isActive: data.isActive,
      },
    });
    revalidateSubcategories(data.categoryId);
    return { ok: true as const };
  } catch (err: any) {
    return {
      ok: false as const,
      error: err.message || "Failed to update subcategory",
    };
  }
}

/** Products inside are not deleted — they fall back to sitting on the category page. */
export async function deleteSubcategory(id: string) {
  await requireAdmin();
  try {
    const sub = await prisma.subcategory.delete({ where: { id } });
    revalidateSubcategories(sub.categoryId);
    return { ok: true as const };
  } catch (err: any) {
    return {
      ok: false as const,
      error: err.message || "Failed to delete subcategory",
    };
  }
}

/** Move a product in or out of a group (null = show it on the category page). */
export async function setProductSubcategory(
  productId: string,
  subcategoryId: string | null
) {
  await requireAdmin();
  try {
    const product = await prisma.product.update({
      where: { id: productId },
      data: { subcategoryId },
      select: { slug: true, subcategoryId: true },
    });
    revalidateStore();
    revalidatePath("/admin/categories");
    revalidatePath(`/product/${product.slug}`);
    return { ok: true as const };
  } catch (err: any) {
    return {
      ok: false as const,
      error: err.message || "Failed to move product",
    };
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
  // Store-wide product-page copy. Every product inherits these unless it
  // overrides them; blank hides that section on every product page.
  defaultMaterialsCare: z.string().default(""),
  defaultShippingInfo: z.string().default(""),
  defaultReturnsInfo: z.string().default(""),
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

type StatusEntry = {
  status: string;
  note?: string;
  at: string;
  /**
   * Marks a note the admin deliberately wrote for the customer. The rest of
   * the history is internal — NimbusPost draft/AWB chatter, courier scans,
   * "cancelled by admin" — so the storefront shows flagged entries only.
   */
  forCustomer?: boolean;
};

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
  if (trimmed) {
    entry.note = trimmed;
    // The admin types this in a field labelled "message with this update", so
    // it is written for the customer and shown on their order page.
    entry.forCustomer = true;
  }
  history.push(entry);

  // The return window is counted from `deliveryStatusAt`. Only the NimbusPost
  // sync used to set it, so an order marked delivered by hand had none — and
  // `returnWindow()` then fell back to the order date, quietly measuring the
  // window from PURCHASE instead of delivery (often already expired). Stamp it
  // here, and clear it when an order moves back out of "delivered" so a stale
  // date can't keep a window open on an undelivered order.
  const deliveryTouch =
    status === "delivered"
      ? order.deliveryStatusAt
        ? {} // a real courier scan already dated it — don't overwrite
        : { deliveryStatusAt: new Date() }
      : order.deliveryStatusAt && order.status === "delivered"
        ? { deliveryStatusAt: null }
        : {};

  await prisma.order.update({
    where: { id },
    data: {
      status,
      statusHistory: history as unknown as object[],
      ...deliveryTouch,
      // The message stays in the history entry above. It deliberately does NOT
      // overwrite `note`, which is the private internal note, nor
      // `customerNote`, which is the standing message the admin manages
      // separately in Admin → Orders → Notes.
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

/**
 * The **internal** note on an order. Staff only — it is never rendered on the
 * storefront, so it must also stay out of `statusHistory`, which the
 * customer's order page reads.
 */
export async function addOrderNote(id: string, note: string) {
  await requireAdmin();
  const trimmed = note.trim();
  const order = await prisma.order.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!order) return { ok: false as const, error: "Order not found" };

  await prisma.order.update({
    where: { id },
    data: { note: trimmed || null },
  });

  revalidatePath("/admin/orders");
  revalidatePath("/admin");
  return { ok: true as const };
}

/**
 * The message the customer sees on their order page, in a highlighted callout.
 * Kept apart from `note` so an internal remark can never be published by
 * accident — the two are edited in separate fields and stored in separate
 * columns.
 */
export async function setCustomerNote(id: string, note: string) {
  await requireAdmin();
  const trimmed = note.trim();
  const order = await prisma.order.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!order) return { ok: false as const, error: "Order not found" };

  await prisma.order.update({
    where: { id },
    data: { customerNote: trimmed || null },
  });

  // The customer's order page is force-dynamic, so it picks this up on its
  // next request without a revalidate.
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
    courierMismatch: result.courierMismatch ?? null,
  };
}

/** Couriers that will carry this order, with rates, for the admin to review. */
export async function getCourierOptionsAction(orderId: string) {
  await requireAdmin();
  return getCourierOptionsForOrder(orderId);
}

/** Remember which courier the admin picked; used when the draft is booked. */
export async function chooseCourierAction(
  orderId: string,
  courierId: string | null,
  courierName: string | null
) {
  await requireAdmin();
  await chooseCourierForOrder(orderId, courierId, courierName);
  revalidatePath("/admin/orders");
  return { ok: true as const };
}

/** Run the automatic sync now, for every order still in flight. */
export async function syncAllOrdersAction() {
  await requireAdmin();
  const result = await syncAllOpenOrders();
  revalidatePath("/admin/orders");
  revalidatePath("/admin");
  return result;
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
    revalidatePath("/admin/orders");
    return {
      ok: true as const,
      outcome: "not-booked" as const,
      orderStatus: result.orderStatus,
    };
  }

  // Already booked — this was a tracking refresh. refreshTracking has already
  // emailed the customer if the order actually moved, so don't send again.
  if (result.outcome === "tracked") {
    revalidatePath("/admin/orders");
    revalidatePath("/admin");
    return {
      ok: true as const,
      outcome: "tracked" as const,
      awb: result.awb,
      deliveryStatus: result.deliveryStatus,
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

// -------- Media Library Smart Tagging --------
export async function searchProductsAction(query: string) {
  await requireAdmin();
  if (!query || query.length < 2) return [];

  const products = await prisma.product.findMany({
    where: {
      name: { contains: query, mode: "insensitive" }
    },
    select: {
      id: true,
      name: true,
      category: true,
      subcategory: {
        select: {
          name: true
        }
      },
      options: true
    },
    take: 10
  });

  return products.map(p => ({
    id: p.id,
    name: p.name,
    category: p.category,
    subcategoryName: p.subcategory?.name || null,
    options: p.options as { name: string; choices: { label: string }[] }[] | null
  }));
}
