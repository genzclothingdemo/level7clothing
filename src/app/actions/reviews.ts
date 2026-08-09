"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth";
import { getUserSession } from "@/lib/user-auth";
import { hasPurchased } from "@/lib/reviews";

async function requireAdmin() {
  const session = await getAdminSession();
  if (!session) throw new Error("Unauthorized");
  return session;
}

function revalidateReviews(slug?: string | null) {
  revalidatePath("/admin/reviews");
  revalidatePath("/shop");
  revalidatePath("/");
  if (slug) revalidatePath(`/product/${slug}`);
}

/* ------------------------------------------------------------ customer side */

const submitSchema = z.object({
  productId: z.string().min(1),
  rating: z.coerce.number().int().min(1).max(5),
  name: z.string().trim().min(2, "Please enter your name").max(60),
  email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(10, "Please write at least a sentence").max(2000),
});

export type SubmitReviewInput = z.input<typeof submitSchema>;

/**
 * A shopper leaves a review. Always lands unapproved — nothing a stranger types
 * appears on the storefront until the owner has read it.
 *
 * `verified` is decided here from delivered orders, never from the submission:
 * a "Verified buyer" badge the reviewer could set themselves would be worthless.
 */
export async function submitReview(input: SubmitReviewInput) {
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  const product = await prisma.product
    .findUnique({ where: { id: data.productId }, select: { id: true, slug: true } })
    .catch(() => null);
  if (!product) return { ok: false as const, error: "Product not found" };

  const session = await getUserSession();
  const email = data.email?.trim() || null;

  // One review per person per product — a second submission edits the first
  // rather than stacking duplicates, and it goes back into the queue.
  const existing = await prisma.review.findFirst({
    where: {
      productId: product.id,
      ...(session
        ? { userId: session.id }
        : email
          ? { email: { equals: email, mode: "insensitive" } }
          : { id: "__never__" }),
    },
    select: { id: true },
  });

  const verified = await hasPurchased(product.id, {
    userId: session?.id ?? null,
    email: email ?? session?.email ?? null,
  });

  const payload = {
    productId: product.id,
    userId: session?.id ?? null,
    name: data.name,
    email,
    rating: data.rating,
    title: data.title?.trim() || null,
    body: data.body,
    verified,
    approved: false,
  };

  try {
    if (existing) {
      await prisma.review.update({ where: { id: existing.id }, data: payload });
    } else {
      await prisma.review.create({ data: payload });
    }
  } catch (err) {
    console.error("[reviews] submitReview failed:", err);
    return { ok: false as const, error: "Could not save your review — please try again." };
  }

  revalidateReviews(product.slug);
  return {
    ok: true as const,
    updated: !!existing,
    message: existing
      ? "Thanks — your review has been updated and will reappear once approved."
      : "Thanks! Your review will appear once it's approved.",
  };
}

/* --------------------------------------------------------------- admin side */

async function slugFor(reviewId: string): Promise<string | null> {
  const row = await prisma.review
    .findUnique({ where: { id: reviewId }, select: { product: { select: { slug: true } } } })
    .catch(() => null);
  return row?.product?.slug ?? null;
}

/** Publish or unpublish a review. Unapproving also unpins it. */
export async function setReviewApproved(id: string, approved: boolean) {
  await requireAdmin();
  const slug = await slugFor(id);
  await prisma.review.update({
    where: { id },
    // A hidden review must not stay pinned — it would silently reserve the top
    // slot and push a real review down.
    data: { approved, ...(approved ? {} : { featured: false }) },
  });
  revalidateReviews(slug);
  return { ok: true as const };
}

/**
 * Pin a review to the top of its product's list ("show first"). Approving is
 * implied — pinning something the storefront can't show would do nothing.
 */
export async function setReviewFeatured(id: string, featured: boolean) {
  await requireAdmin();
  const slug = await slugFor(id);
  await prisma.review.update({
    where: { id },
    data: { featured, ...(featured ? { approved: true } : {}) },
  });
  revalidateReviews(slug);
  return { ok: true as const };
}

/** Private moderation note — never rendered on the storefront. */
export async function setReviewNote(id: string, note: string) {
  await requireAdmin();
  await prisma.review.update({
    where: { id },
    data: { adminNote: note.trim() || null },
  });
  revalidatePath("/admin/reviews");
  return { ok: true as const };
}

export async function deleteReview(id: string) {
  await requireAdmin();
  const slug = await slugFor(id);
  await prisma.review.delete({ where: { id } });
  revalidateReviews(slug);
  return { ok: true as const };
}

/** Approve everything currently awaiting review, for clearing a backlog. */
export async function approveAllPending() {
  await requireAdmin();
  const { count } = await prisma.review.updateMany({
    where: { approved: false },
    data: { approved: true },
  });
  revalidateReviews();
  return { ok: true as const, count };
}
