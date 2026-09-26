"use server";

/**
 * Accounts: sign up, sign in, reset, profile.
 *
 * ## The model, in one line
 *
 * **The mobile number is the identity. The email is contact information.**
 *
 * That is not a preference, it is what the columns now say: `User.phone` is
 * unique and `User.email` is not. Two people really do share an inbox — a
 * couple, a family, a shop ordering for its staff — and the old unique index
 * turned every one of those into a throwaway address the store could never
 * reach again. A number is one person's, and it is the thing a courier rings.
 *
 * Three consequences run through every action below:
 *
 * 1. **A taken number is a wall.** There is exactly one account per number, so
 *    signing up with one that exists is answered with "you already have an
 *    account" and a way in, not with a second account.
 * 2. **A taken email is a warning.** It names the masked number the address
 *    already belongs to — enough for the person who owns both to recognise it,
 *    useless to somebody probing whose address it is — and then lets them
 *    continue.
 * 3. **`findUnique({ where: { email } })` is now a runtime throw.** Prisma
 *    refuses a non-unique where on `findUnique`, and `tsc` passes it happily.
 *    Every read of an account by email in this file is a `findMany`.
 *
 * ## Why signup is two round trips when verification is on
 *
 * The account is created only once every required code has been checked, so the
 * form resubmits with the codes rather than the server holding a half-made
 * user. No pending row, nothing to expire, nothing to clean up — and a customer
 * who abandons the code screen has left nothing behind but an `OtpCode` that
 * dies in ten minutes.
 */

import { z } from "zod";
import { redirect } from "next/navigation";
import { headers, cookies } from "next/headers";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { sendPasswordResetEmail } from "@/lib/email";
import { LEAD_COOKIE } from "@/lib/auth-cookie";
import { isValidPhone, maskPhone, normalisePhone } from "@/lib/phone";
import {
  OTP_LENGTH,
  getVerificationSettings,
  issueOtp,
  smsGateway,
  verifyOtp,
} from "@/lib/otp";
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
// it's convenience data, not a credential. The name itself lives in
// lib/auth-cookie.ts so this file and the cart context cannot drift apart.
async function setLeadCookie(name: string, phone: string) {
  const store = await cookies();
  store.set(LEAD_COOKIE, JSON.stringify({ name, phone }), {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
}

/* ------------------------------------------------------------------ */
/*  Shared shapes                                                      */
/* ------------------------------------------------------------------ */

/**
 * One channel's state during a signup that needs codes.
 *
 * `sent: false` with a `problem` is the state that matters: the store asked for
 * a code it could not deliver. It is reported rather than swallowed, because
 * the alternative is a customer waiting for a text that will never arrive.
 */
export type ChannelPrompt = {
  /** Masked for a number, plain for an address. */
  shown: string;
  /** Whether a code actually went out just now. */
  sent: boolean;
  /** Why it did not, when it did not. */
  problem?: string;
};

export type SignupPrompt = {
  email?: ChannelPrompt;
  phone?: ChannelPrompt;
};

/* ------------------------------------------------------------------ */
/*  Sign up                                                            */
/* ------------------------------------------------------------------ */

const signupSchema = z.object({
  name: z.string().trim().min(2, "Please enter your name"),
  // Ten digits, an Indian mobile, required. The `+91` is fixed in the form, so
  // what arrives here is usually bare digits — `normalisePhone` accepts either.
  phone: z
    .string()
    .trim()
    .min(1, "Enter your mobile number")
    .refine(isValidPhone, "Enter a valid 10-digit Indian mobile number"),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  /** Set by the second submit, after the duplicate-email warning was shown. */
  emailAcknowledged: z.boolean().optional(),
  /** The codes, when the store asks for them. */
  emailCode: z.string().trim().optional(),
  phoneCode: z.string().trim().optional(),
});

export type SignupInput = z.input<typeof signupSchema>;

export async function signup(input: SignupInput) {
  const parsed = signupSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const { name, email, password } = parsed.data;
  // Never the typed spelling: one canonical form is the entire point of the
  // number being the identity.
  const phone = normalisePhone(parsed.data.phone)!;

  /* -- 1. The number is the identity, so a taken one is a wall ---------- */

  const holder = await prisma.user.findUnique({
    where: { phone },
    select: { id: true },
  });
  if (holder) {
    return {
      ok: false as const,
      phoneTaken: true as const,
      error:
        "You already have an account with this mobile number. Log in instead — or reset your password if you've forgotten it.",
    };
  }

  /* -- 2. The address is contact detail, so a taken one is a warning ---- */

  if (!parsed.data.emailAcknowledged) {
    const sharing = await prisma.user.findMany({
      where: { email },
      orderBy: { createdAt: "asc" },
      select: { phone: true },
      take: 3,
    });
    if (sharing.length > 0) {
      return {
        ok: false as const,
        emailInUse: true as const,
        error: duplicateEmailWarning(sharing.map((u) => u.phone)),
      };
    }
  }

  /* -- 3. Codes, when the store asks for them --------------------------- */

  const rules = await getVerificationSettings();
  const sms = smsGateway();
  // A phone code is only *asked for* when something could carry it. Asking for
  // one with no gateway would refuse every signup with no action the person
  // could take; the account is created instead and the response says the number
  // is unconfirmed. See `orderVerificationGate` for the same rule at checkout.
  const wantPhoneCode = rules.requireSignupPhoneOtp && sms.ready;
  const wantEmailCode = rules.requireSignupEmailOtp;

  if (wantEmailCode || wantPhoneCode) {
    const prompt: SignupPrompt = {};
    let failure: string | null = null;

    if (wantEmailCode) {
      const typed = parsed.data.emailCode?.trim();
      if (typed) {
        const res = await verifyOtp({
          purpose: "signup",
          channel: "email",
          target: email,
          code: typed,
        });
        if (!res.ok) {
          failure ??= res.error;
          prompt.email = { shown: email, sent: false };
        }
      } else {
        prompt.email = await promptFor("email", email);
      }
    }

    if (wantPhoneCode) {
      const typed = parsed.data.phoneCode?.trim();
      if (typed) {
        const res = await verifyOtp({
          purpose: "signup",
          channel: "sms",
          target: phone,
          code: typed,
        });
        if (!res.ok) {
          failure ??= res.error;
          prompt.phone = { shown: maskPhone(phone), sent: false };
        }
      } else {
        prompt.phone = await promptFor("sms", phone);
      }
    }

    if (prompt.email || prompt.phone) {
      return {
        ok: false as const,
        verify: prompt,
        error:
          failure ??
          `We've sent you a ${OTP_LENGTH}-digit code. Enter it to finish creating your account.`,
      };
    }
  }

  /* -- 4. Create ------------------------------------------------------- */

  const now = new Date();
  let user;
  try {
    user = await prisma.user.create({
      data: {
        name,
        email,
        phone,
        passwordHash: await hashPassword(password),
        // Stamped only for a code that was actually checked a moment ago.
        emailVerifiedAt: wantEmailCode ? now : null,
        phoneVerifiedAt: wantPhoneCode ? now : null,
      },
    });
  } catch (err) {
    // Two people can reach step 4 with the same number in the same second; the
    // unique index is the real guard and this is its message.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return {
        ok: false as const,
        phoneTaken: true as const,
        error:
          "That mobile number was just registered. Log in instead, or reset the password.",
      };
    }
    console.error("[account] signup failed:", err);
    return {
      ok: false as const,
      error: "We couldn't create your account just now. Please try again.",
    };
  }

  await setUserCookie({ id: user.id, email: user.email, name: user.name });
  await setLeadCookie(user.name, user.phone ?? "");

  return {
    ok: true as const,
    // Said out loud rather than passed over in silence: the store asked for a
    // mobile code and has nothing to send it with.
    notice:
      rules.requireSignupPhoneOtp && !sms.ready
        ? `${sms.detail} Your account is created and your number is saved, but it is not confirmed.`
        : undefined,
  };
}

/** The duplicate-email warning. A sentence, a masked number, and a way on. */
function duplicateEmailWarning(phones: (string | null)[]): string {
  const masked = phones.map((p) => (p ? maskPhone(p) : null));
  const named = masked.filter((m): m is string => !!m);

  const whose =
    named.length === 0
      ? "another account that has no mobile number on it"
      : named.length === 1
        ? `the account on ${named[0]}`
        : `${named.length} other accounts (${named.join(", ")})`;

  return `This email is already on ${whose}. You can still use it — mail for both accounts will arrive in the same inbox, and your mobile number is what signs you in. Press "Create account anyway" to continue.`;
}

/** Issue a signup code and describe what happened, delivered or not. */
async function promptFor(
  channel: "email" | "sms",
  target: string
): Promise<ChannelPrompt> {
  const shown = channel === "sms" ? maskPhone(target) : target;
  const res = await issueOtp({ purpose: "signup", channel, target });
  if (!res.ok) {
    // A cooldown is not a failure to the person: their code is still live.
    return {
      shown,
      sent: res.reason === "cooldown",
      problem: res.reason === "cooldown" ? undefined : res.error,
    };
  }
  return { shown, sent: res.delivered, problem: res.detail };
}

/* ------------------------------------------------------------------ */
/*  Log in                                                             */
/* ------------------------------------------------------------------ */

const loginSchema = z.object({
  // One field, because there is one door with a legacy side entrance: a mobile
  // number, or — for an account created before numbers were the identity — an
  // email. `authenticateUser` decides which it is.
  identifier: z.string().trim().min(3, "Enter your mobile number"),
  password: z.string().min(1, "Enter your password"),
});

export type LoginInput = z.input<typeof loginSchema>;

export async function login(input: LoginInput) {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const { identifier, password } = parsed.data;

  const looksLikePhone = normalisePhone(identifier) !== null;
  if (!looksLikePhone && !identifier.includes("@")) {
    return {
      ok: false as const,
      error: "Enter your 10-digit mobile number, or the email you signed up with.",
    };
  }

  const session = await authenticateUser(identifier, password);
  if (!session) {
    // Deliberately one message for "no such account" and "wrong password":
    // telling them apart turns this form into a list of who shops here.
    return {
      ok: false as const,
      error: looksLikePhone
        ? "That mobile number and password don't match."
        : "That email and password don't match.",
    };
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

/* ------------------------------------------------------------------ */
/*  Forgot / reset password                                            */
/* ------------------------------------------------------------------ */

const forgotSchema = z.object({
  /** A mobile number or an email address — whichever they remember. */
  identifier: z.string().trim().min(3, "Enter your mobile number or email"),
});

export type ForgotInput = z.input<typeof forgotSchema>;

/**
 * Send a reset link.
 *
 * **The link always goes to an email, whichever one they typed**, because email
 * is the only channel this store can send on. Someone who identifies themselves
 * by mobile still gets the mail at the address on that account — and is told
 * which address, masked, so a dead inbox is diagnosable instead of mysterious.
 *
 * The ambiguous case is the one the shared-inbox change created: an address on
 * several accounts cannot pick an account by itself. It does not guess, it does
 * not mail all of them, and it does not fail — it asks for the mobile number,
 * listing the masked numbers it is choosing between.
 */
export async function requestPasswordReset(input: ForgotInput) {
  const parsed = forgotSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const typed = parsed.data.identifier;
  const phone = normalisePhone(typed);

  const generic =
    "If that matches an account, we've sent a password reset link to the email on it.";

  let user: { id: string; email: string } | null = null;

  if (phone) {
    user = await prisma.user.findUnique({
      where: { phone },
      select: { id: true, email: true },
    });
  } else if (typed.includes("@")) {
    const matches = await prisma.user.findMany({
      where: { email: typed.toLowerCase() },
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true, phone: true },
      take: 5,
    });

    if (matches.length > 1) {
      const masked = matches.map((m) =>
        m.phone ? maskPhone(m.phone) : "an account with no mobile number"
      );
      return {
        ok: true as const,
        // Not an error: nothing went wrong, we simply cannot tell which of them
        // is asking. The form swaps to a mobile-number field.
        ambiguous: true as const,
        choices: masked,
        message: `That email is on ${matches.length} accounts (${masked.join(", ")}). Enter the mobile number of the one you want to reset.`,
      };
    }
    user = matches[0] ?? null;
  } else {
    return {
      ok: false as const,
      error: "Enter your 10-digit mobile number, or the email on your account.",
    };
  }

  // Always report success — whether an account exists is not this form's to
  // disclose.
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
    message: phone
      ? // Naming the address (masked) turns "nothing arrived" into something
        // the customer can act on, without printing it for a stranger.
        `If that number matches an account, we've sent a reset link to ${maskEmail(user?.email)}.`
      : generic,
  };
}

/** `d••••@gmail.com` — recognisable to its owner, not to anyone else. */
function maskEmail(email: string | null | undefined): string {
  if (!email) return "the email on it";
  const [name, domain] = email.split("@");
  if (!domain) return "the email on it";
  return `${name.slice(0, 1)}${"•".repeat(Math.max(3, name.length - 1))}@${domain}`;
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

  // `resetToken` is still a unique column, so this findUnique is still legal —
  // unlike the two that used to look accounts up by email.
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

/* ------------------------------------------------------------------ */
/*  Update profile (IDENTITY ONLY: name + phone)                       */
/* ------------------------------------------------------------------ */

//
// This deliberately no longer touches `User.address / city / state / pincode`.
//
// Those four inline columns used to be edited here AND as `Address` rows in the
// address book AND retyped at checkout, so the same customer could hold three
// disagreeing addresses. The `Address` table is now the single source of truth;
// the inline columns survive only as a one-time legacy fallback, migrated into
// an `Address` by `migrateLegacyInlineAddress` in `src/app/actions/addresses.ts`.
//
// Do not add address fields back to this action — writing them would resurrect
// the split-brain the address book exists to remove.
const profileSchema = z.object({
  name: z.string().trim().min(2, "Please enter your name"),
  phone: z.string().trim().optional(),
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

  const current = await prisma.user.findUnique({
    where: { id: session.id },
    select: { phone: true, phoneVerifiedAt: true },
  });
  if (!current) return { ok: false as const, error: "Not signed in" };

  const typed = d.phone?.trim() ?? "";
  const next = typed ? normalisePhone(typed) : null;

  if (typed && !next) {
    return {
      ok: false as const,
      error: "Enter a valid 10-digit Indian mobile number.",
    };
  }
  // A number, once set, is how this person signs in. Clearing it from a profile
  // form would take their own door away, so the field refuses to empty — but an
  // account that never had one (the pre-2026-09-26 accounts) may still save
  // without adding one.
  if (!next && current.phone) {
    return {
      ok: false as const,
      error:
        "Your mobile number is how you sign in, so it can't be removed. Change it to a different number instead.",
    };
  }

  if (next && next !== current.phone) {
    const holder = await prisma.user.findUnique({
      where: { phone: next },
      select: { id: true },
    });
    if (holder && holder.id !== session.id) {
      return {
        ok: false as const,
        error: "That mobile number already belongs to another account.",
      };
    }
  }

  // Changing the number un-verifies it. The old confirmation was about the old
  // number and says nothing about this one; leaving the stamp would let anybody
  // walk a verified flag onto an unverified number.
  const changed = next !== current.phone;

  try {
    const user = await prisma.user.update({
      where: { id: session.id },
      data: {
        name: d.name,
        phone: next,
        ...(changed ? { phoneVerifiedAt: null } : {}),
      },
    });
    await setUserCookie({ id: user.id, email: user.email, name: user.name });
    // Keep the guest lead cookie in sync too.
    await setLeadCookie(user.name, user.phone ?? "");
    return {
      ok: true as const,
      unverified: changed && !!next && !!current.phoneVerifiedAt,
    };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return {
        ok: false as const,
        error: "That mobile number already belongs to another account.",
      };
    }
    console.error("[account] updateProfile failed:", err);
    return { ok: false as const, error: "Could not save your details." };
  }
}
