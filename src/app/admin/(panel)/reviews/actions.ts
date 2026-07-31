"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth";

async function requireAdmin() {
  const admin = await getAdminSession();
  if (!admin) throw new Error("Unauthorized");
}

export async function setReviewApproved(id: string, approved: boolean) {
  await requireAdmin();
  await prisma.review.update({ where: { id }, data: { approved } });
  revalidatePath("/admin/reviews");
  return { ok: true as const };
}

export async function setReviewFeatured(id: string, featured: boolean) {
  await requireAdmin();
  await prisma.review.update({ where: { id }, data: { featured } });
  revalidatePath("/admin/reviews");
  return { ok: true as const };
}

export async function deleteReview(id: string) {
  await requireAdmin();
  await prisma.review.delete({ where: { id } });
  revalidatePath("/admin/reviews");
  return { ok: true as const };
}
