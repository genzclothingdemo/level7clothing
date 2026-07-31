"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getUserSession } from "@/lib/user-auth";

const addressSchema = z.object({
  label: z.string().trim().min(1).max(30).default("Home"),
  fullName: z.string().trim().min(2, "Please enter a name").max(80),
  phone: z.string().trim().min(6, "Please enter a phone number").max(20),
  address: z.string().trim().min(5, "Please enter the full address").max(300),
  city: z.string().trim().min(2, "Please enter a city").max(80),
  state: z.string().trim().min(2, "Please enter a state").max(80),
  pincode: z.string().trim().regex(/^\d{6}$/, "Pincode must be 6 digits"),
  isDefault: z.boolean().default(false),
});

export type AddressInput = z.input<typeof addressSchema>;

async function requireUser() {
  const session = await getUserSession();
  if (!session) return null;
  return session;
}

export async function saveAddress(input: AddressInput & { id?: string }) {
  const session = await requireUser();
  if (!session) return { ok: false as const, error: "Please log in first." };

  const parsed = addressSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  try {
    // Only one default at a time.
    if (data.isDefault) {
      await prisma.address.updateMany({
        where: { userId: session.id },
        data: { isDefault: false },
      });
    }

    if (input.id) {
      // Scope the update to this user so an id from elsewhere can't be edited.
      const owned = await prisma.address.findFirst({
        where: { id: input.id, userId: session.id },
        select: { id: true },
      });
      if (!owned) return { ok: false as const, error: "Address not found." };

      await prisma.address.update({ where: { id: owned.id }, data });
    } else {
      const count = await prisma.address.count({ where: { userId: session.id } });
      await prisma.address.create({
        data: {
          ...data,
          // First address saved becomes the default automatically.
          isDefault: data.isDefault || count === 0,
          userId: session.id,
        },
      });
    }
  } catch {
    return { ok: false as const, error: "Could not save the address." };
  }

  revalidatePath("/account");
  revalidatePath("/checkout");
  return { ok: true as const };
}

export async function deleteAddress(id: string) {
  const session = await requireUser();
  if (!session) return { ok: false as const, error: "Please log in first." };

  const owned = await prisma.address.findFirst({
    where: { id, userId: session.id },
    select: { id: true, isDefault: true },
  });
  if (!owned) return { ok: false as const, error: "Address not found." };

  await prisma.address.delete({ where: { id: owned.id } });

  // Promote another address so the account always has a default if any remain.
  if (owned.isDefault) {
    const next = await prisma.address.findFirst({
      where: { userId: session.id },
      orderBy: { createdAt: "asc" },
    });
    if (next) {
      await prisma.address.update({
        where: { id: next.id },
        data: { isDefault: true },
      });
    }
  }

  revalidatePath("/account");
  revalidatePath("/checkout");
  return { ok: true as const };
}

export async function setDefaultAddress(id: string) {
  const session = await requireUser();
  if (!session) return { ok: false as const, error: "Please log in first." };

  const owned = await prisma.address.findFirst({
    where: { id, userId: session.id },
    select: { id: true },
  });
  if (!owned) return { ok: false as const, error: "Address not found." };

  await prisma.address.updateMany({
    where: { userId: session.id },
    data: { isDefault: false },
  });
  await prisma.address.update({
    where: { id: owned.id },
    data: { isDefault: true },
  });

  revalidatePath("/account");
  revalidatePath("/checkout");
  return { ok: true as const };
}
