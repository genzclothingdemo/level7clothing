"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getUserSession } from "@/lib/user-auth";

const schema = z.object({
  orderId: z.string().min(1),
  kind: z.enum(["return", "exchange"]),
  reason: z.string().trim().min(1, "Please choose a reason"),
  details: z.string().trim().max(1000).optional(),
  exchangeSize: z.string().trim().max(20).optional(),
});

export async function requestReturn(input: {
  orderId: string;
  kind: "return" | "exchange";
  reason: string;
  details?: string;
  exchangeSize?: string;
}) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  const session = await getUserSession();
  if (!session) {
    return { ok: false as const, error: "Please log in to request a return." };
  }

  const order = await prisma.order
    .findUnique({ where: { id: data.orderId } })
    .catch(() => null);

  if (!order) return { ok: false as const, error: "Order not found." };

  // Only the owner of the order may open a request against it.
  const owns = order.userId === session.id || order.email === session.email;
  if (!owns) return { ok: false as const, error: "Order not found." };

  if (order.status !== "delivered") {
    return {
      ok: false as const,
      error: "Returns can be requested once the order is delivered.",
    };
  }

  const existing = await prisma.returnRequest.findFirst({
    where: { orderId: order.id, status: { in: ["requested", "approved"] } },
  });
  if (existing) {
    return {
      ok: false as const,
      error: "There's already an open request for this order.",
    };
  }

  try {
    await prisma.returnRequest.create({
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        userId: session.id,
        email: order.email,
        kind: data.kind,
        reason: data.reason,
        details: data.details || null,
        exchangeSize: data.kind === "exchange" ? data.exchangeSize || null : null,
      },
    });
  } catch {
    return { ok: false as const, error: "Could not submit your request. Please try again." };
  }

  revalidatePath("/account");
  return { ok: true as const };
}
