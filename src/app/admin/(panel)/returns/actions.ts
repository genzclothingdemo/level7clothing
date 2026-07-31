"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth";

const ALLOWED = ["requested", "approved", "rejected", "completed"] as const;

export async function setReturnStatus(id: string, status: string) {
  const admin = await getAdminSession();
  if (!admin) throw new Error("Unauthorized");
  if (!ALLOWED.includes(status as (typeof ALLOWED)[number])) {
    throw new Error("Invalid status");
  }

  await prisma.returnRequest.update({ where: { id }, data: { status } });
  revalidatePath("/admin/returns");
  return { ok: true as const };
}
