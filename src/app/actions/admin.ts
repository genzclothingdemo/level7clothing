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
  cancelDraftForOrder,
  chooseCourierForOrder,
  createDraftForOrder,
  dispatchOrder,
  getCourierOptionsForOrder,
  runConfirmationPipeline,
  shipOrderNow,
  syncAllOpenOrders,
  syncOrderFromNimbus,
  type ConfirmationPipelineResult,
} from "@/lib/fulfilment";
import {
  bulkEligibilityFor,
  dispatchModeOf,
  normalisePipelineSettings,
} from "@/lib/orders-pipeline";
import {
  BULK_ORDER_ACTIONS,
  type BulkRowResult,
} from "@/components/admin/order-types";

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


/* ------------------------------------------------------------------ */
/*  Settings (Admin → Branding & settings)                             */
/* ------------------------------------------------------------------ */

/**
 * The columns Admin → Settings owns. Deliberately **not** every column on
 * `SiteSettings`:
 *
 * - The returns/refund policy (`returnsEnabled`, `defaultReturnable`,
 *   `returnWindowDays`, `returnReasons`, `returnPolicyNote`,
 *   `defaultReturnsInfo`, and the five refund columns) is written by
 *   `updateReturnDefaults` in `actions/returns.ts`.
 * - The six order-pipeline columns are written by
 *   `updateOrderPipelineSettings` below.
 *
 * Both groups are now *edited on the Settings screen* — the return policy as a
 * mounted `ReturnPolicyCard`, the pipeline through its own action — but neither
 * goes through this payload, and that is the point. A field must have exactly
 * one writer: `defaultReturnsInfo` used to be echoed back through here
 * "unchanged", which is a lost update waiting to happen the moment two tabs are
 * open. Sharing a screen is not the same as sharing a writer.
 *
 * `currency` is also absent: nothing renders it (`formatINR` and the Razorpay
 * order are both hard-wired to INR), so there is no editor for it and this
 * action must not accept one from the browser either.
 *
 * Every bound is repeated here rather than left to the browser. A server
 * action is a public endpoint reachable by id — the `maxLength` on an input
 * is a courtesy, this is the rule.
 */

/** Empty string ⇒ `null`, i.e. "not set". Trimmed first so " " counts as empty. */
const optionalText = (max: number) =>
  z
    .string()
    .max(max, `Keep this under ${max} characters`)
    .trim()
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

/**
 * A link the storefront will render in an `href`. Absolute http(s) or a
 * site-relative path — never `javascript:` or `data:`.
 */
const optionalUrl = (label: string) =>
  optionalText(500).refine(
    (v) => v === null || /^(https?:\/\/|\/)/i.test(v),
    `${label} must start with https:// or /`
  );

const settingsSchema = z.object({
  // ---- Brand & identity ----
  brandName: z.string().trim().min(1, "Brand name is required").max(60),
  tagline: z.string().trim().max(120).default(""),
  logoUrl: optionalUrl("Logo URL"),
  announcement: optionalText(200),

  // ---- Storefront copy ----
  heroHeadline: z.string().trim().max(120).default(""),
  heroSubtext: z.string().trim().max(400).default(""),
  aboutText: z.string().trim().max(2000).default(""),

  // ---- Contact & social ----
  contactEmail: z.string().trim().email("Contact email is not a valid address"),
  contactPhone: z.string().trim().max(40).default(""),
  whatsapp: optionalText(24).refine(
    (v) => v === null || /^[+\d][\d\s()-]*$/.test(v),
    "WhatsApp number can only contain digits, spaces, +, - and ()"
  ),
  address: optionalText(240),
  instagram: optionalUrl("Instagram URL"),
  facebook: optionalUrl("Facebook URL"),

  // ---- Notifications ----
  adminNotifyEmail: z
    .string()
    .trim()
    .email("Notification email is not a valid address"),

  // ---- Shipping ----
  freeShippingThreshold: z.coerce
    .number()
    .int("Free shipping threshold must be a whole number of rupees")
    .nonnegative()
    .max(1_000_000)
    .nullable()
    .optional(),

  // ---- Payments: per-method availability ----
  codEnabled: z.boolean().default(true),
  prepaidEnabled: z.boolean().default(true),
  partialEnabled: z.boolean().default(true),
  directEnabled: z.boolean().default(true),

  // ---- Integration master switches ----
  razorpayEnabled: z.boolean().default(false),
  nimbusEnabled: z.boolean().default(false),

  // ---- Product defaults ----
  // Store-wide product-page copy. Every product inherits these unless it
  // overrides them; blank hides that section on every product page.
  // `defaultReturnsInfo` is the third block and is owned by Returns.
  defaultMaterialsCare: z.string().max(4000).default(""),
  defaultShippingInfo: z.string().max(4000).default(""),
});

export type SettingsInput = z.input<typeof settingsSchema>;
/** Exactly what was written, so the form can rebase its "unsaved" baseline. */
export type SettingsSaved = z.output<typeof settingsSchema> & {
  freeShippingThreshold: number | null;
};

/** Field → the label the admin actually sees, so an error names the control. */
const SETTINGS_FIELD_LABEL: Record<string, string> = {
  brandName: "Brand name",
  tagline: "Tagline",
  logoUrl: "Logo",
  announcement: "Announcement bar",
  heroHeadline: "Hero headline",
  heroSubtext: "Hero subtext",
  aboutText: "About text",
  contactEmail: "Contact email",
  contactPhone: "Contact phone",
  whatsapp: "WhatsApp number",
  address: "Studio address",
  instagram: "Instagram URL",
  facebook: "Facebook URL",
  adminNotifyEmail: "Send order & lead emails to",
  freeShippingThreshold: "Free shipping above",
  defaultMaterialsCare: "Materials & Care",
  defaultShippingInfo: "Shipping & Delivery",
};

export async function updateSettings(input: SettingsInput) {
  await requireAdmin();

  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const label = SETTINGS_FIELD_LABEL[String(issue.path[0])];
    return {
      ok: false as const,
      error: label ? `${label}: ${issue.message}` : issue.message,
    };
  }

  const data: SettingsSaved = {
    ...parsed.data,
    freeShippingThreshold: parsed.data.freeShippingThreshold ?? null,
  };

  /**
   * All four methods off does not close the store — `resolveAllowedModes`
   * falls back to `["direct"]` when the intersection is empty, so every order
   * would silently become a pay-the-owner request. Refuse it here rather than
   * let the storefront quietly reinterpret it.
   */
  if (
    !data.codEnabled &&
    !data.prepaidEnabled &&
    !data.partialEnabled &&
    !data.directEnabled
  ) {
    return {
      ok: false as const,
      error:
        "Leave at least one payment method on. With all four off, checkout silently falls back to Customised order (pay to owner).",
    };
  }

  try {
    await prisma.siteSettings.upsert({
      where: { id: "main" },
      update: data,
      // Omitted columns (returns, refunds, pipeline, currency) fall to their
      // schema defaults — this action never writes them.
      create: { id: "main", ...data },
    });
  } catch (err) {
    console.error("[admin] updateSettings failed:", err);
    return {
      ok: false as const,
      error: "Could not save — please try again.",
    };
  }

  // Branding is in the layout shell (header, footer, manifest), so the whole
  // tree has to be revalidated, not just the home page.
  revalidatePath("/", "layout");
  revalidatePath("/admin/settings");
  return { ok: true as const, settings: data };
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

/**
 * Admin accepts an order: pending → confirmed, email the customer, then hand
 * over to the shipment pipeline.
 *
 * The pipeline half is `runConfirmationPipeline`, shared with checkout and
 * payment verification, so a human pressing Confirm and an order confirming
 * itself produce the same shipment outcome — a staged draft by default, a
 * booked AWB when the admin has switched auto-ship on.
 *
 * Internal (no `requireAdmin`, no revalidate) so the bulk action can reuse it
 * without re-authorising and re-revalidating once per row.
 */
async function confirmOneOrder(
  id: string
): Promise<
  | { ok: false; error: string }
  | { ok: true; orderNumber: string; shipment: ConfirmationPipelineResult }
> {
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return { ok: false, error: "Order not found" };
  if (order.status !== "pending") {
    return { ok: false, error: `Order is already ${order.status}.` };
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

  // Best-effort: the order IS confirmed and the customer has been told. A
  // courier problem must not undo that, so it is reported, never thrown.
  let shipment: ConfirmationPipelineResult;
  try {
    shipment = await runConfirmationPipeline(id);
  } catch (err) {
    console.error("[admin] confirmation pipeline failed:", err);
    shipment = {
      outcome: "failed",
      drafted: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return { ok: true, orderNumber: order.orderNumber, shipment };
}

export async function confirmOrder(id: string) {
  await requireAdmin();
  const result = await confirmOneOrder(id);
  if (!result.ok) return { ok: false as const, error: result.error };

  revalidatePath("/admin/orders");
  revalidatePath("/admin");
  return { ok: true as const, shipment: result.shipment };
}

// -------- Shipping (NimbusPost) --------
/*
 * Two actions, never one button with two meanings.
 *
 * The screen used to carry a single control whose label flipped between "Send
 * draft" and "Book & generate AWB" depending on hidden state, in the same
 * colour, with no confirmation — one of them free, the other a real charge to
 * the NimbusPost wallet. Which one you were about to press was something you
 * had to infer. They are now `shipOrderNowAction` (spends money, confirmed in
 * the UI first) and `draftOrderInNimbusAction` (free, reversible), and each
 * does exactly and only what its name says.
 *
 * Both refuse a pending, cancelled or already-booked order through
 * `shipmentGateFor` down in `lib/fulfilment.ts`, so the rule is enforced on the
 * server and not merely hidden in the client.
 */

/**
 * **Ship now** — book the AWB with the courier the admin picked from the live
 * rates. Stages the draft first if there isn't one, so the review gate's
 * draft-before-AWB ordering still holds inside NimbusPost.
 */
export async function shipOrderNowAction(
  id: string,
  courierId: string | null,
  courierName: string | null
) {
  await requireAdmin();

  const courier =
    courierId && courierName ? { id: courierId, name: courierName } : null;
  const result = await shipOrderNow(id, courier);

  if (!result.ok) {
    console.error("[admin] shipOrderNow failed:", result.error);
    // Deliberately not a generic message: "Insufficient wallet balance" is the
    // one the owner will actually hit (CLAUDE.md records the wallet at ₹0.00),
    // and it tells them exactly what to do next.
    revalidatePath("/admin/orders");
    return { ok: false as const, error: result.error };
  }

  // Can only happen if the second dispatch call also found no draft, which
  // means the booking never ran. Reported as a failure rather than a success,
  // because nothing shipped.
  if (result.outcome === "drafted") {
    revalidatePath("/admin/orders");
    revalidatePath("/admin");
    return {
      ok: false as const,
      error:
        "The draft was staged but NimbusPost did not return an AWB. The draft is safe — try Ship now again, or book it in the NimbusPost dashboard.",
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
    awb: result.awb,
    courier: result.courier,
    courierMismatch: result.courierMismatch ?? null,
  };
}

/**
 * **Draft in NimbusPost** — stage the unbooked order and stop.
 *
 * Calls `createDraftForOrder` rather than `dispatchOrder`: `dispatchOrder`
 * *books* when a draft already exists, so routing the draft button through it
 * would make a second press charge the wallet. Free, idempotent, and reversible
 * from the NimbusPost dashboard, which is why it needs no confirmation.
 */
export async function draftOrderInNimbusAction(id: string) {
  await requireAdmin();

  const result = await createDraftForOrder(id);
  if (!result.ok) {
    const error =
      result.error ??
      (result.skipped === "shipping disabled"
        ? "NimbusPost shipping is switched off. Turn it on in Settings → Shipping."
        : result.skipped === "not configured"
          ? "NimbusPost isn't set up in this deployment."
          : `Could not stage a draft (${result.skipped ?? "unknown reason"}).`);
    return { ok: false as const, error };
  }

  revalidatePath("/admin/orders");
  revalidatePath("/admin");
  return {
    ok: true as const,
    alreadyStaged: result.skipped === "already staged",
    nimbusOrderId: result.nimbusOrderId ?? null,
  };
}

/**
 * **Cancel draft** — withdraw the unbooked draft from NimbusPost.
 *
 * The undo for "Send draft". Offered wherever the gate says `can.cancelDraft`,
 * which includes a cancelled or already-delivered order: those are precisely
 * the ones that end up with an abandoned draft sitting in the NimbusPost list,
 * where anyone reviewing it can book and charge for a parcel that is not going
 * anywhere.
 */
export async function cancelOrderDraftAction(id: string) {
  await requireAdmin();

  const result = await cancelDraftForOrder(id);
  if (!result.ok) return { ok: false as const, error: result.error };

  revalidatePath("/admin/orders");
  revalidatePath("/admin");
  return { ok: true as const, cancelled: result.cancelled };
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

/** Internal half of {@link cancelAndRestoreStock}, reused by the bulk action. */
async function cancelOneOrder(
  id: string
): Promise<{ ok: false; error: string } | { ok: true; orderNumber: string }> {
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return { ok: false, error: "Order not found" };
  if (order.status === "cancelled") {
    return { ok: false, error: "Order is already cancelled" };
  }
  if (order.paymentStatus === "paid") {
    return {
      ok: false,
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

  return { ok: true, orderNumber: order.orderNumber };
}

export async function cancelAndRestoreStock(id: string) {
  await requireAdmin();
  const result = await cancelOneOrder(id);
  if (!result.ok) return { ok: false as const, error: result.error };

  revalidatePath("/admin/orders");
  revalidatePath("/admin");
  return { ok: true as const };
}

/* ------------------------------------------------------------------ */
/*  Bulk order actions                                                 */
/* ------------------------------------------------------------------ */

/**
 * How many orders one call may touch.
 *
 * Deliberately low. Each row is at least one database round trip to Mumbai,
 * and Book/Sync/Draft each add a NimbusPost call on top; a serverless function
 * has a wall clock. Fifty is comfortably inside it and still means one press
 * for a normal day's orders.
 */
const BULK_LIMIT = 50;

const bulkSchema = z.object({
  ids: z
    .array(z.string().min(1))
    .min(1, "Select at least one order")
    .max(BULK_LIMIT, `Too many orders selected — ${BULK_LIMIT} at a time.`),
  action: z.enum(BULK_ORDER_ACTIONS),
});

/**
 * Run one action over a selection of orders.
 *
 * **Every row reports its own outcome.** A bulk action that says "done" while
 * three rows silently failed is worse than no bulk action at all — the
 * operator moves on believing the work is finished. So this never aborts on
 * the first failure and never returns a bare count: it returns a line per
 * order, and the caller renders all of them.
 *
 * Rows run in sequence, not `Promise.all`. `DATABASE_URL` pins
 * `connection_limit=1` (see CLAUDE.md), so parallel queries serialise anyway,
 * and firing fifty simultaneous booking calls at NimbusPost is a good way to
 * be rate-limited halfway through a charge.
 */
export async function bulkOrderAction(ids: string[], action: string) {
  await requireAdmin();

  const parsed = bulkSchema.safeParse({ ids: [...new Set(ids)], action });
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const { ids: unique, action: verb } = parsed.data;

  // One lookup for the numbers, so a failing row can still be named. An id
  // with no order still gets a row rather than vanishing from the report. The
  // gate columns ride along so eligibility can be settled without a second
  // query per row.
  const found = await prisma.order.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      trackingNumber: true,
      nimbusShipmentId: true,
    },
  });
  const byId = new Map(found.map((o) => [o.id, o]));

  const results: BulkRowResult[] = [];

  for (const id of unique) {
    const order = byId.get(id);
    const orderNumber = order?.orderNumber ?? id.slice(-6);
    const row = (ok: boolean, message: string) =>
      results.push({ id, orderNumber, ok, message });

    if (!order) {
      row(false, "Order not found — it may have been deleted.");
      continue;
    }

    // The same rule the bulk bar counted with, applied before anything runs.
    // The bar only offers a verb when some rows can take it and says what it
    // will skip; this is the half that makes that promise true — and it is one
    // pure function, so the two cannot drift apart.
    const eligible = bulkEligibilityFor(verb, order);
    if (!eligible.ok) {
      row(false, `Skipped — ${eligible.reason}.`);
      continue;
    }

    try {
      switch (verb) {
        case "confirm": {
          const res = await confirmOneOrder(id);
          if (!res.ok) row(false, res.error);
          else row(true, describeShipment(res.shipment));
          break;
        }

        case "cancel": {
          const res = await cancelOneOrder(id);
          row(res.ok, res.ok ? "Cancelled — stock restored." : res.error);
          break;
        }

        case "draft": {
          // Stage only. Never books, whatever the auto-ship setting says —
          // the button is labelled "Send draft" and must do exactly that.
          const res = await createDraftForOrder(id);
          if (res.ok) {
            row(
              true,
              res.skipped === "already staged"
                ? "Already staged in NimbusPost."
                : "Draft staged in NimbusPost."
            );
          } else {
            row(false, res.error ?? `Skipped (${res.skipped ?? "unknown reason"}).`);
          }
          break;
        }

        case "book": {
          const res = await dispatchOrder(id);
          if (!res.ok) row(false, res.error);
          else if (res.outcome === "drafted") {
            // Unreachable now that eligibility requires a staged draft, but
            // `dispatchOrder` is draft-first and its type still says this can
            // happen. Reported honestly rather than as a booking.
            row(true, "No draft existed — one was staged. Press Book again to generate the AWB.");
          } else {
            row(
              true,
              `Booked — AWB ${res.awb}${res.courier ? ` (${res.courier})` : ""}.${
                res.courierMismatch ? ` ${res.courierMismatch}` : ""
              }`
            );
          }
          break;
        }

        case "sync": {
          const res = await syncOrderFromNimbus(id);
          if (!res.ok) row(false, res.error);
          else if (res.outcome === "not-booked") {
            row(true, `Not booked in NimbusPost yet (${res.orderStatus}).`);
          } else if (res.outcome === "tracked") {
            row(true, res.deliveryStatus ? `Courier says: ${res.deliveryStatus}.` : "No new scan yet.");
          } else {
            row(true, `Synced — AWB ${res.awb}${res.courier ? ` (${res.courier})` : ""}.`);
          }
          break;
        }
      }
    } catch (err) {
      // A thrown row must not take the other forty-nine with it.
      console.error(`[admin] bulk ${verb} failed for ${orderNumber}:`, err);
      row(false, err instanceof Error ? err.message : String(err));
    }
  }

  revalidatePath("/admin/orders");
  revalidatePath("/admin");

  return {
    ok: true as const,
    action: verb,
    results,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  };
}

/** Turn a pipeline outcome into one sentence for the bulk report. */
function describeShipment(shipment: ConfirmationPipelineResult): string {
  switch (shipment.outcome) {
    case "booked":
      return `Confirmed and booked — AWB ${shipment.awb}${shipment.courier ? ` (${shipment.courier})` : ""}.${shipment.caveat ? ` ${shipment.caveat}` : ""}`;
    case "drafted":
      return "Confirmed — draft staged in NimbusPost.";
    case "skipped":
      return `Confirmed. ${shipment.message}`;
    case "failed":
      // The order IS confirmed; only the shipment is not. Saying so is the
      // difference between an operator who books it by hand and one who
      // assumes it went out.
      return `Confirmed, but the shipment did not go through: ${shipment.error}`;
  }
}

/* ------------------------------------------------------------------ */
/*  Order pipeline settings                                            */
/* ------------------------------------------------------------------ */

/**
 * The pipeline columns on `SiteSettings`.
 *
 * Edited from **Admin → Settings → Orders**. They used to live on the Orders
 * screen, on the argument that they are operational rather than branding; the
 * owner went looking for them in Settings twice, so Settings is now the single
 * home for settings and `/admin/orders` carries a read-only status line that
 * links here.
 *
 * Still its own action, and still scoped to exactly these fields. The settings
 * form calls it directly for whichever of them are dirty rather than folding
 * them into `updateSettings` — one writer per column, so a Settings save can
 * never clobber a pipeline column it was not asked to touch, and
 * `settingsSchema` can go on rejecting them.
 *
 * ## The enum migration lives here
 *
 * `autoShipOnConfirm` (boolean) became `dispatchOnConfirm` (off | draft |
 * book). **Both fields are optional and this action writes both**, which is
 * what lets the two live at once without a flag day:
 *
 *   - a caller that sends the enum gets the boolean derived from it;
 *   - a caller still sending only the boolean gets the enum derived from it
 *     (`true → book`, `false → draft`), exactly as `dispatchModeOf` reads it.
 *
 * So the screen that has migrated and the screen that has not cannot write
 * contradicting rows — the trap CLAUDE.md records for `defaultReturnsInfo`,
 * where two editors each echoed the other's column back on save. Here there is
 * still exactly one writer; it just accepts two dialects.
 *
 * `autoShipCourier` is a free string rather than an enum because Q2 also
 * accepts a **pinned courier** by name. `pickCourier` falls back to cheapest
 * when the pin is not quoting, so an unrecognised value can never leave a
 * parcel unshipped.
 */
const pipelineSchema = z
  .object({
    orderConfirmMode: z.enum(["manual", "byPayment", "auto"]),
    autoConfirmPrepaid: z.boolean(),
    autoConfirmPartial: z.boolean(),
    autoConfirmCod: z.boolean(),
    /** Q1. Preferred. */
    dispatchOnConfirm: z.enum(["off", "draft", "book"]).optional(),
    /** @deprecated Q1's old boolean — accepted so an unmigrated caller works. */
    autoShipOnConfirm: z.boolean().optional(),
    /**
     * Q2: "cheapest" | "fastest" | a pinned courier's name.
     *
     * Optional, and **absent means "leave that column alone"** rather than
     * "reset it". A caller that has stopped editing Q2 must not be able to
     * overwrite a pinned carrier with the default just by saving Q1.
     */
    autoShipCourier: z.string().trim().min(1).max(80).optional(),
  })
  .refine((v) => v.dispatchOnConfirm != null || v.autoShipOnConfirm != null, {
    message: "Say what confirming should do — dispatchOnConfirm is required.",
    path: ["dispatchOnConfirm"],
  });

export type PipelineSettingsInput = z.input<typeof pipelineSchema>;

export async function updateOrderPipelineSettings(input: PipelineSettingsInput) {
  await requireAdmin();
  const parsed = pipelineSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const parsedData = parsed.data;

  // One resolution of Q1, then both columns written from it. Never the two
  // values the caller happened to send.
  const dispatchOnConfirm = dispatchModeOf(parsedData);
  const data = {
    orderConfirmMode: parsedData.orderConfirmMode,
    autoConfirmPrepaid: parsedData.autoConfirmPrepaid,
    autoConfirmPartial: parsedData.autoConfirmPartial,
    autoConfirmCod: parsedData.autoConfirmCod,
    dispatchOnConfirm,
    autoShipOnConfirm: dispatchOnConfirm === "book",
    ...(parsedData.autoShipCourier
      ? { autoShipCourier: parsedData.autoShipCourier }
      : {}),
  };

  await prisma.siteSettings.upsert({
    where: { id: "main" },
    update: data,
    create: { id: "main", ...data },
  });

  revalidatePath("/admin/orders");
  revalidatePath("/admin");
  // The saved shape goes back so the form can rebase its "unsaved" comparison
  // on what the database actually holds, not on what was typed.
  return { ok: true as const, settings: normalisePipelineSettings(data) };
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

/* ------------------------------------------------------------------ */
/*  Products — bulk                                                    */
/* ------------------------------------------------------------------ */

const productBulkSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "Nothing selected").max(200),
  action: z.enum(["activate", "deactivate", "feature", "unfeature", "delete"]),
});

export type ProductBulkAction = z.infer<typeof productBulkSchema>["action"];

/**
 * Apply one change to many products.
 *
 * The four flag changes are a single `updateMany` — they cannot partially
 * fail in a way worth reporting per row, and one statement is one round trip
 * to Mumbai rather than N.
 *
 * **Delete is a loop on purpose.** A product can be referenced by orders,
 * reviews, wishlist rows and portfolio pieces, so one row can fail a foreign
 * key while the rest are fine. `deleteMany` would abort the whole batch and
 * tell the admin nothing about which piece blocked it; this reports a count
 * and names the ones it could not remove.
 */
export async function bulkProductAction(ids: string[], action: string) {
  await requireAdmin();

  const parsed = productBulkSchema.safeParse({ ids: [...new Set(ids)], action });
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const { ids: unique, action: verb } = parsed.data;

  try {
    if (verb !== "delete") {
      const data =
        verb === "activate"
          ? { isActive: true }
          : verb === "deactivate"
            ? { isActive: false }
            : verb === "feature"
              ? { isFeatured: true }
              : { isFeatured: false };

      const res = await prisma.product.updateMany({ where: { id: { in: unique } }, data });
      revalidateStore();
      return { ok: true as const, count: res.count };
    }

    const found = await prisma.product.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    const nameById = new Map(found.map((p) => [p.id, p.name]));

    let count = 0;
    const blocked: string[] = [];
    for (const id of unique) {
      try {
        await prisma.product.delete({ where: { id } });
        count += 1;
      } catch {
        blocked.push(nameById.get(id) ?? id.slice(-6));
      }
    }

    revalidateStore();
    return {
      ok: true as const,
      count,
      error: blocked.length
        ? `Kept ${blocked.length}: ${blocked.slice(0, 3).join(", ")}${blocked.length > 3 ? "…" : ""} — still referenced by an order or a review.`
        : undefined,
    };
  } catch (err) {
    console.error("[bulkProductAction] failed:", err);
    return { ok: false as const, error: "Could not apply that to the selection." };
  }
}
