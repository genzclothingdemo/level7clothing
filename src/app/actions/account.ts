"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { headers, cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { sendPasswordResetEmail } from "@/lib/email";
import {
  authenticateUser,
  setUserCookie,
  clearUserCookie,
  getUserSession,
  hashPassword,
  generateResetToken,
} from "@/lib/user-auth";

// Mirror the shopper's name/phone into a readable cookie so the add-to-cart
// mini sign-up never prompts a logged-in customer. Not httpOnly on purpose —
// it's convenience data, not a credential.
const LEAD_COOKIE = "level7_lead";
async function setLeadCookie(name: string, phone: string) {
  const store = await cookies();
  store.set(LEAD_COOKIE, JSON.stringify({ name, phone }), {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
}

// ---------- Sign up (fast: name, email, password; phone optional) ----------
const signupSchema = z.object({
  name: z.string().trim().min(2, "Please enter your name"),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  phone: z.string().trim().optional(),
});

export async function signup(input: {
  name: string;
  email: string;
  password: string;
  phone?: string;
}) {
  const parsed = signupSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const { name, email, password, phone } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return {
      ok: false as const,
      error: "An account with this email already exists. Try logging in.",
    };
  }

  const user = await prisma.user.create({
    data: {
      name,
      email,
      phone: phone || null,
      passwordHash: await hashPassword(password),
    },
  });

  await setUserCookie({ id: user.id, email: user.email, name: user.name });
  await setLeadCookie(user.name, user.phone ?? "");
  return { ok: true as const };
}

// ---------- Log in ----------
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

export async function login(input: { email: string; password: string }) {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const session = await authenticateUser(parsed.data.email, parsed.data.password);
  if (!session) {
    return { ok: false as const, error: "Invalid email or password" };
  }
  await setUserCookie(session);

  // Seed the lead cookie (fetch phone for a complete contact).
  const user = await prisma.user
    .findUnique({ where: { id: session.id }, select: { phone: true } })
    .catch(() => null);
  await setLeadCookie(session.name, user?.phone ?? "");
  return { ok: true as const };
}

export async function logout() {
  await clearUserCookie();
  const store = await cookies();
  store.delete(LEAD_COOKIE);
  redirect("/account/login");
}

// ---------- Forgot / reset password (basic security) ----------
const forgotSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
});

export async function requestPasswordReset(input: { email: string }) {
  const parsed = forgotSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const { email } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });

  // Always report success (don't reveal whether an email is registered).
  if (user) {
    const token = generateResetToken();
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken: token, resetTokenExpiry: expiry },
    });

    const h = await headers();
    const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
    const proto = h.get("x-forwarded-proto") || "http";
    const resetUrl = `${proto}://${host}/account/reset?token=${token}`;

    const settings = await getSettings();
    try {
      await sendPasswordResetEmail(settings, user.email, resetUrl);
    } catch (err) {
      console.error("[account] reset email failed:", err);
    }
  }

  return {
    ok: true as const,
    message:
      "If an account exists for that email, we've sent a password reset link.",
  };
}

const resetSchema = z.object({
  token: z.string().min(10, "Invalid or missing reset link"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export async function resetPassword(input: { token: string; password: string }) {
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const { token, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { resetToken: token } });
  if (
    !user ||
    !user.resetTokenExpiry ||
    user.resetTokenExpiry.getTime() < Date.now()
  ) {
    return {
      ok: false as const,
      error: "This reset link is invalid or has expired. Please request a new one.",
    };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(password),
      resetToken: null,
      resetTokenExpiry: null,
    },
  });

  await setUserCookie({ id: user.id, email: user.email, name: user.name });
  return { ok: true as const };
}

// ---------- Update profile (name, phone + saved shipping address) ----------
const profileSchema = z.object({
  name: z.string().trim().min(2, "Please enter your name"),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
  pincode: z.string().trim().optional(),
});

export type ProfileInput = z.input<typeof profileSchema>;

export async function updateProfile(input: ProfileInput) {
  const session = await getUserSession();
  if (!session) return { ok: false as const, error: "Not signed in" };

  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const d = parsed.data;

  const user = await prisma.user.update({
    where: { id: session.id },
    data: {
      name: d.name,
      phone: d.phone || null,
      address: d.address || null,
      city: d.city || null,
      state: d.state || null,
      pincode: d.pincode || null,
    },
  });
  await setUserCookie({ id: user.id, email: user.email, name: user.name });
  // Keep the guest lead cookie in sync too.
  await setLeadCookie(user.name, user.phone ?? "");
  return { ok: true as const };
}
