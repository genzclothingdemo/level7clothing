"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getUserSession } from "@/lib/user-auth";

const reviewSchema = z.object({
  productId: z.string().min(1),
  productSlug: z.string().min(1),
  name: z.string().trim().min(2, "Please enter your name").max(60),
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(10, "Please write at least 10 characters").max(2000),
});

export async function submitReview(input: {
  productId: string;
  productSlug: string;
  name: string;
  rating: number;
  title?: string;
  body: string;
}) {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  const session = await getUserSession();

  try {
    await prisma.review.create({
      data: {
        productId: data.productId,
        userId: session?.id ?? null,
        name: data.name,
        rating: data.rating,
        title: data.title || null,
        body: data.body,
        approved: false, // admin must approve before it shows publicly
      },
    });
  } catch {
    return { ok: false as const, error: "Could not save your review. Please try again." };
  }

  revalidatePath(`/product/${data.productSlug}`);
  return { ok: true as const };
}
