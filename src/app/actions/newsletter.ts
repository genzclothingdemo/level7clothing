"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Please enter a valid email"),
  source: z.string().trim().max(40).optional(),
});

export async function subscribeToNewsletter(input: {
  email: string;
  source?: string;
}) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const { email, source } = parsed.data;

  try {
    await prisma.newsletterSubscriber.upsert({
      where: { email },
      // Re-subscribing someone who previously opted out.
      update: { unsubscribed: false },
      create: { email, source: source || "footer" },
    });
  } catch {
    return { ok: false as const, error: "Could not sign you up. Please try again." };
  }

  return { ok: true as const };
}
