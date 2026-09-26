"use server";

/**
 * The two things a browser is allowed to ask about a one-time code: send me
 * one, and here is the one you sent.
 *
 * Everything that decides *whether* a code is needed lives elsewhere —
 * `signup()` for a new account, `orderVerificationGate()` for checkout. This
 * module only carries codes, which is why it is small and why the same three
 * actions serve the signup form, the account page and checkout.
 *
 * **Only async functions may be exported from a `"use server"` file.** A shared
 * constant here would break every action in the module at runtime with
 * `A "use server" file can only export async functions, found object` — passing
 * `tsc` and `next build` on the way, exactly as CLAUDE.md records. The
 * constants live in `lib/otp.ts`.
 */

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { maskPhone, normalisePhone } from "@/lib/phone";
import { getUserSession } from "@/lib/user-auth";
import {
  OTP_LENGTH,
  canonicalTarget,
  issueOtp,
  smsGateway,
  verifyOtp,
  type OtpChannel,
} from "@/lib/otp";

const channelSchema = z.enum(["email", "sms"]);

/* ------------------------------------------------------------------ */
/*  During signup — no account exists yet                              */
/* ------------------------------------------------------------------ */

const signupCodeSchema = z.object({
  channel: channelSchema,
  /** The address or number the signup form is holding. */
  target: z.string().trim().min(3),
});

/**
 * Resend a signup code.
 *
 * Separate from `signup()` on purpose: the first code is issued as part of
 * answering "can I create this account", and every code after it is the
 * customer pressing Resend. Folding the two together would mean replaying the
 * whole signup payload — password included — to re-send six digits.
 */
export async function resendSignupCode(input: z.input<typeof signupCodeSchema>) {
  const parsed = signupCodeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: "That contact isn't valid." };
  }
  const { channel } = parsed.data;
  const target = canonicalTarget(channel, parsed.data.target);
  if (!target) {
    return {
      ok: false as const,
      error:
        channel === "sms"
          ? "Enter a valid 10-digit Indian mobile number."
          : "Enter a valid email address.",
    };
  }

  // A number that has since been claimed cannot become an account, so there is
  // nothing to confirm and no reason to text a stranger.
  if (channel === "sms") {
    const holder = await prisma.user.findUnique({
      where: { phone: target },
      select: { id: true },
    });
    if (holder) {
      return {
        ok: false as const,
        error: "That mobile number already has an account. Log in instead.",
      };
    }
  }

  return describe(await issueOtp({ purpose: "signup", channel, target }), channel);
}

/* ------------------------------------------------------------------ */
/*  For a signed-in customer — account page and checkout               */
/* ------------------------------------------------------------------ */

/**
 * Send this customer a code for the channel they are confirming.
 *
 * The target is read from their account row, never from the request: a caller
 * who could name the address would be able to verify somebody else's contact
 * onto their own account.
 */
export async function sendMyCode(input: { channel: OtpChannel }) {
  const session = await getUserSession();
  if (!session) return { ok: false as const, error: "Please log in again." };

  const parsed = channelSchema.safeParse(input?.channel);
  if (!parsed.success) return { ok: false as const, error: "Unknown channel." };
  const channel = parsed.data;

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { email: true, phone: true },
  });
  if (!user) return { ok: false as const, error: "Please log in again." };

  if (channel === "sms") {
    const gateway = smsGateway();
    if (!gateway.ready) {
      return { ok: false as const, error: gateway.detail, noChannel: true as const };
    }
    if (!normalisePhone(user.phone)) {
      return {
        ok: false as const,
        error: "Add a mobile number to your profile first.",
        noChannel: true as const,
      };
    }
  }

  const res = await issueOtp({
    purpose: channel === "sms" ? "verify-phone" : "verify-email",
    channel,
    target: channel === "sms" ? user.phone! : user.email,
    userId: session.id,
  });
  return describe(res, channel);
}

const confirmSchema = z.object({
  channel: channelSchema,
  code: z.string().trim().min(1, `Enter the ${OTP_LENGTH}-digit code`),
});

/**
 * Check a code and stamp the account.
 *
 * The stamp is the whole point — `emailVerifiedAt` / `phoneVerifiedAt` is what
 * the order gate reads, so a code that verifies and writes nothing would leave
 * the customer confirming the same address at every checkout.
 */
export async function confirmMyCode(input: z.input<typeof confirmSchema>) {
  const session = await getUserSession();
  if (!session) return { ok: false as const, error: "Please log in again." };

  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const { channel, code } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { email: true, phone: true },
  });
  if (!user) return { ok: false as const, error: "Please log in again." };

  const target = channel === "sms" ? user.phone : user.email;
  if (!target) {
    return { ok: false as const, error: "There is nothing to confirm on this account." };
  }

  const res = await verifyOtp({
    purpose: channel === "sms" ? "verify-phone" : "verify-email",
    channel,
    target,
    code,
  });
  if (!res.ok) return { ok: false as const, error: res.error };

  await prisma.user.update({
    where: { id: session.id },
    data:
      channel === "sms"
        ? { phoneVerifiedAt: new Date() }
        : { emailVerifiedAt: new Date() },
  });

  return {
    ok: true as const,
    message:
      channel === "sms"
        ? "Mobile number confirmed."
        : "Email address confirmed.",
  };
}

/* ------------------------------------------------------------------ */
/*  Shaping                                                            */
/* ------------------------------------------------------------------ */

/**
 * Turn an `IssueResult` into something a form can render.
 *
 * `ok: true, sent: false` survives this translation intact, because it is the
 * state the whole module exists to be honest about: the code is real, and
 * nothing carried it.
 */
async function describe(
  res: Awaited<ReturnType<typeof issueOtp>>,
  channel: OtpChannel
) {
  if (!res.ok) {
    return {
      ok: false as const,
      error: res.error,
      ...(res.retryInSeconds ? { retryInSeconds: res.retryInSeconds } : {}),
    };
  }
  return {
    ok: true as const,
    shown: channel === "sms" ? maskPhone(res.target) : res.target,
    sent: res.delivered,
    ...(res.detail ? { problem: res.detail } : {}),
  };
}
