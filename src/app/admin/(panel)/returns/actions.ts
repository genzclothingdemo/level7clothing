"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth";
import { isReturnStatus, RETURN_STATUS_LABEL } from "@/lib/returns";

export async function setReturnStatus(id: string, status: string) {
  const admin = await getAdminSession();
  if (!admin) throw new Error("Unauthorized");
  // Validated against the single RETURN_STATUSES vocabulary rather than a local
  // copy, so the dropdown, the storefront badge and this action can't drift.
  if (!isReturnStatus(status)) {
    throw new Error("Invalid status");
  }

  const existing = await prisma.returnRequest.findUnique({
    where: { id },
    select: { statusHistory: true },
  });
  const history = Array.isArray(existing?.statusHistory) ? existing.statusHistory : [];

  await prisma.returnRequest.update({
    where: { id },
    data: {
      status,
      // Append rather than overwrite — the trail is what lets support explain a
      // decision weeks later.
      statusHistory: [
        ...history,
        {
          status,
          note: `Set to ${RETURN_STATUS_LABEL[status]}`,
          at: new Date().toISOString(),
          by: admin.email ?? "admin",
        },
      ],
      ...(status === "refunded" || status === "rejected" || status === "cancelled"
        ? { resolvedAt: new Date() }
        : {}),
    },
  });
  revalidatePath("/admin/returns");
  return { ok: true as const };
}
