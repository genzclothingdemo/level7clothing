"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdminWrite } from "@/lib/auth";

async function requireAdmin(what: string) {
  await requireAdminWrite(what);
}

export async function setReviewApproved(id: string, approved: boolean) {
  await requireAdmin("setReviewApproved");
  await prisma.review.update({ where: { id }, data: { approved } });
  revalidatePath("/admin/reviews");
  return { ok: true as const };
}

export async function setReviewFeatured(id: string, featured: boolean) {
  await requireAdmin("setReviewFeatured");
  await prisma.review.update({ where: { id }, data: { featured } });
  revalidatePath("/admin/reviews");
  return { ok: true as const };
}

export async function deleteReview(id: string) {
  await requireAdmin("deleteReview");
  await prisma.review.delete({ where: { id } });
  revalidatePath("/admin/reviews");
  return { ok: true as const };
}
