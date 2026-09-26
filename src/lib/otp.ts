import "server-only";
import crypto from "crypto";
import { cache } from "react";
import { prisma } from "./prisma";
import { getSettings } from "./settings";
import { sendOtpEmail } from "./email";
import { maskPhone, normalisePhone } from "./phone";

/**
 * One-time codes — **one code path, two channels.**
 *
 * Email works today. SMS does not exist yet, and the whole shape of this module
 * is the promise that adding it is *a sender and a toggle, not a rewrite*:
 *
 * - `OtpCode.channel` already distinguishes them, and the row is written
 *   identically either way — same hashing, same expiry, same attempt counter,
 *   same single-use rule.
 * - `issueOtp()` composes and stores the code, then hands delivery to exactly
 *   one function per channel. `deliverSms()` below is the seam: it is the only
 *   thing that has to be written, and `smsGateway()` is the only thing that has
 *   to start answering `ready: true`.
 * - Verification (`verifyOtp`) never asks which channel a code came from. It
 *   cannot drift, because there is nothing channel-shaped in it.
 *
 * **What must never happen is a phone requirement that silently passes or
 * silently blocks.** A store that switches on "verify the mobile" with no
 * gateway gets told so on the settings screen, in the same card as the switch;
 * a customer who hits it at signup is told on the form. Neither is left to
 * discover it from an order that will not go through.
 *
 * ## Why an OTP is not an automation rule
 *
 * Every event-driven message in this store is composed from an editable
 * template and can be paused from Admin → Automation. An OTP must not be: a
 * rule somebody switched off would lock people out of their own accounts with
 * no error anywhere. It follows the password reset instead — composed here,
 * sent through the one transport in `lib/email.ts`, and listed **read-only** in
 * `DIRECT_MAIL` so the automation screen is still the whole picture.
 */

/* ------------------------------------------------------------------ */
/*  Vocabulary                                                         */
/* ------------------------------------------------------------------ */

export const OTP_PURPOSES = [
  "signup",
  "login",
  "reset",
  "verify-email",
  "verify-phone",
] as const;

export type OtpPurpose = (typeof OTP_PURPOSES)[number];

export const OTP_CHANNELS = ["email", "sms"] as const;

export type OtpChannel = (typeof OTP_CHANNELS)[number];

/**
 * Six digits, ten minutes, five guesses, one use.
 *
 * The four numbers are a set, not four independent choices: six digits is a
 * million codes, five guesses inside ten minutes is a 1-in-200,000 chance per
 * code, and a consumed code is dead. Lengthen the window and the attempt cap
 * has to come down with it.
 *
 * `OTP_LENGTH` is duplicated as a literal `maxLength={6}` in the two client
 * forms. This module is `server-only`, so a client component importing the
 * constant would pull Prisma into the browser bundle — the same trade the
 * checkout modes already make.
 */
export const OTP_LENGTH = 6;
export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
/** Seconds between two sends to the same target for the same purpose. */
export const OTP_RESEND_SECONDS = 60;
/** How many codes one target may be sent in an hour, before it is refused. */
const OTP_HOURLY_CAP = 6;

/* ------------------------------------------------------------------ */
/*  Hashing                                                            */
/* ------------------------------------------------------------------ */

/**
 * The key the code is hashed under. Same resolution as the session secret in
 * `lib/user-auth.ts`, and refused in production for the same reason: a code
 * hashed under a public constant is a code anybody with the table can read.
 */
const OTP_SECRET = (() => {
  const configured = process.env.AUTH_SECRET || process.env.JWT_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET is not set. Refusing to hash one-time codes with the " +
        "development fallback key in production."
    );
  }
  return "level7-dev-secret-change-me";
})();

/**
 * Keyed SHA-256, not bcrypt.
 *
 * The reason to hash a code at rest is that a leaked table must not be a login,
 * and an HMAC under a secret the database does not hold satisfies exactly that.
 * Bcrypt's slowness buys resistance to offline guessing of a *long-lived*
 * secret; a 6-digit code that dies in ten minutes after five wrong guesses has
 * no offline attack worth slowing down, and 100 ms per send is a real cost on a
 * serverless function.
 */
function hashCode(code: string): string {
  return crypto.createHmac("sha256", OTP_SECRET).update(code).digest("hex");
}

/** Constant-time compare, so a wrong code cannot be narrowed by timing. */
function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/** `crypto.randomInt`, never `Math.random` — this is a credential. */
function generateCode(): string {
  return String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");
}

/* ------------------------------------------------------------------ */
/*  Targets                                                            */
/* ------------------------------------------------------------------ */

/**
 * The canonical string a code is filed under.
 *
 * Email is lowercased and trimmed; a number goes through `normalisePhone`, the
 * one normaliser, so a code requested as `09313112610` is found by a lookup for
 * `+919313112610`. Returns null when the target cannot receive anything, which
 * is the only honest answer to "send a code to this".
 */
export function canonicalTarget(
  channel: OtpChannel,
  raw: string | null | undefined
): string | null {
  if (channel === "sms") return normalisePhone(raw);
  const v = (raw ?? "").trim().toLowerCase();
  return v.includes("@") && v.length >= 5 ? v : null;
}

/** What a customer should see the code went to. Never the full number. */
export function describeTarget(channel: OtpChannel, target: string): string {
  return channel === "sms" ? maskPhone(target) : target;
}

/* ------------------------------------------------------------------ */
/*  Delivery                                                           */
/* ------------------------------------------------------------------ */

export type Delivery =
  | { delivered: true }
  /** The code exists, but nothing carried it. `detail` is shown on screen. */
  | { delivered: false; detail: string };

/**
 * **The SMS seam.** Everything else in this module is already channel-agnostic.
 *
 * When a gateway is bought, this function sends the text and `smsGateway()`
 * starts reading its configuration. Nothing above it changes — not the row, not
 * the hashing, not the attempt limit, not the verification path, not the two
 * settings switches. That is the whole point of writing it this way now.
 */
export function smsGateway(): { ready: boolean; detail: string } {
  return {
    ready: false,
    detail:
      "No SMS gateway is connected to this store, so codes cannot be sent by text yet.",
  };
}

// The two parameters are unused *today* and are deliberately kept: they are
// the signature the sender will need, and a function that grows arguments
// later is a function every caller has to be revisited for.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function deliverSms(target: string, code: string): Promise<Delivery> {
  const gateway = smsGateway();
  // Deliberately not a throw and not a silent success: the caller reports this
  // sentence to whoever is looking at the screen.
  return { delivered: false, detail: gateway.detail };
}

async function deliverEmail(
  target: string,
  code: string,
  purpose: OtpPurpose
): Promise<Delivery> {
  const settings = await getSettings();
  const res = await sendOtpEmail(settings, target, {
    code,
    minutes: OTP_TTL_MINUTES,
    purpose,
  });
  return res.delivered
    ? { delivered: true }
    : {
        delivered: false,
        detail:
          res.detail ??
          "We could not send the email. Check the store's email setup and try again.",
      };
}

/* ------------------------------------------------------------------ */
/*  Issue                                                              */
/* ------------------------------------------------------------------ */

export type IssueResult =
  | {
      ok: true;
      channel: OtpChannel;
      /** Canonical target the code is filed under. */
      target: string;
      /** Masked for a number, plain for an address — safe to print. */
      shown: string;
      /** False when the row exists but nothing carried it (no SMS gateway). */
      delivered: boolean;
      /** Why it was not delivered. Present only when `delivered` is false. */
      detail?: string;
    }
  | {
      ok: false;
      error: string;
      reason: "bad-target" | "cooldown" | "rate-limited" | "storage";
      /** Seconds until another send is allowed, for the cooldown case. */
      retryInSeconds?: number;
    };

/**
 * Mint a code, burn every older one for the same target and purpose, and try to
 * deliver it.
 *
 * **Issuing and delivering are separate outcomes.** `ok: true, delivered:
 * false` is a real and important state: the code is in the database and would
 * verify, but nothing carried it to the customer. Saying that plainly is what
 * this whole module is arranged around; pretending a send worked is the failure
 * mode that made this store's email silently undeliverable for weeks.
 */
export async function issueOtp(input: {
  purpose: OtpPurpose;
  channel: OtpChannel;
  target: string;
  userId?: string | null;
}): Promise<IssueResult> {
  const target = canonicalTarget(input.channel, input.target);
  if (!target) {
    return {
      ok: false,
      reason: "bad-target",
      error:
        input.channel === "sms"
          ? "Enter a valid 10-digit Indian mobile number."
          : "Enter a valid email address.",
    };
  }

  const now = new Date();

  try {
    // Housekeeping, bounded and opportunistic: a code older than a day is
    // unreachable by every path in this file, so the row is only clutter.
    await prisma.otpCode
      .deleteMany({
        where: { expiresAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
      })
      .catch(() => null);

    const recent = await prisma.otpCode.findMany({
      where: {
        target,
        purpose: input.purpose,
        createdAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true },
    });

    const newest = recent[0];
    if (newest) {
      const age = (now.getTime() - newest.createdAt.getTime()) / 1000;
      if (age < OTP_RESEND_SECONDS) {
        const wait = Math.ceil(OTP_RESEND_SECONDS - age);
        return {
          ok: false,
          reason: "cooldown",
          retryInSeconds: wait,
          error: `Please wait ${wait} second${wait === 1 ? "" : "s"} before asking for another code.`,
        };
      }
    }
    if (recent.length >= OTP_HOURLY_CAP) {
      return {
        ok: false,
        reason: "rate-limited",
        error:
          "Too many codes have been requested for this one. Try again in an hour, or contact us.",
      };
    }

    const code = generateCode();

    // Only the newest code may ever work. Burning the rest is what makes
    // "single use" true across a resend — otherwise an older code stays live
    // for its full ten minutes beside the one on screen.
    await prisma.otpCode.updateMany({
      where: { target, purpose: input.purpose, consumedAt: null },
      data: { consumedAt: now },
    });

    await prisma.otpCode.create({
      data: {
        purpose: input.purpose,
        channel: input.channel,
        target,
        codeHash: hashCode(code),
        expiresAt: new Date(now.getTime() + OTP_TTL_MINUTES * 60 * 1000),
        userId: input.userId ?? null,
      },
    });

    const delivery =
      input.channel === "sms"
        ? await deliverSms(target, code)
        : await deliverEmail(target, code, input.purpose);

    return {
      ok: true,
      channel: input.channel,
      target,
      shown: describeTarget(input.channel, target),
      delivered: delivery.delivered,
      ...(delivery.delivered ? {} : { detail: delivery.detail }),
    };
  } catch (err) {
    console.error("[otp] issue failed:", err);
    return {
      ok: false,
      reason: "storage",
      error: "We couldn't send a code just now. Please try again.",
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Verify                                                             */
/* ------------------------------------------------------------------ */

export type VerifyResult =
  | { ok: true; target: string; userId: string | null }
  | {
      ok: false;
      error: string;
      reason: "bad-target" | "none" | "expired" | "burnt" | "wrong" | "storage";
      /** Guesses left on the current code, when there are any. */
      attemptsLeft?: number;
    };

/**
 * Check a code and consume it.
 *
 * Every failure says which failure it was, because "invalid code" cannot tell
 * somebody their code expired four minutes ago — and a customer who retypes a
 * dead code three times is a customer who gives up. There is nothing to protect
 * here by being vague: the attacker already knows whether they hold a code.
 */
export async function verifyOtp(input: {
  purpose: OtpPurpose;
  channel: OtpChannel;
  target: string;
  code: string;
}): Promise<VerifyResult> {
  const target = canonicalTarget(input.channel, input.target);
  if (!target) {
    return { ok: false, reason: "bad-target", error: "That contact isn't valid." };
  }

  const code = (input.code ?? "").replace(/\D/g, "");
  if (code.length !== OTP_LENGTH) {
    return {
      ok: false,
      reason: "wrong",
      error: `Enter the ${OTP_LENGTH}-digit code.`,
    };
  }

  try {
    const row = await prisma.otpCode.findFirst({
      where: { target, purpose: input.purpose, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });

    if (!row) {
      return {
        ok: false,
        reason: "none",
        error: "That code has already been used. Ask for a new one.",
      };
    }
    if (row.expiresAt.getTime() < Date.now()) {
      return {
        ok: false,
        reason: "expired",
        error: "That code has expired. Ask for a new one.",
      };
    }
    if (row.attempts >= OTP_MAX_ATTEMPTS) {
      // Burn it rather than leave a dead row that keeps answering "too many".
      await prisma.otpCode.update({
        where: { id: row.id },
        data: { consumedAt: new Date() },
      });
      return {
        ok: false,
        reason: "burnt",
        error: "Too many wrong tries. Ask for a new code.",
      };
    }

    if (!sameHash(row.codeHash, hashCode(code))) {
      const used = row.attempts + 1;
      await prisma.otpCode.update({
        where: { id: row.id },
        data: { attempts: used },
      });
      const left = Math.max(0, OTP_MAX_ATTEMPTS - used);
      return {
        ok: false,
        reason: "wrong",
        attemptsLeft: left,
        error: left
          ? `That code isn't right — ${left} ${left === 1 ? "try" : "tries"} left.`
          : "Too many wrong tries. Ask for a new code.",
      };
    }

    await prisma.otpCode.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    });
    return { ok: true, target, userId: row.userId };
  } catch (err) {
    console.error("[otp] verify failed:", err);
    return {
      ok: false,
      reason: "storage",
      error: "We couldn't check that code just now. Please try again.",
    };
  }
}

/* ------------------------------------------------------------------ */
/*  The four switches                                                  */
/* ------------------------------------------------------------------ */

export type VerificationSettings = {
  requireSignupEmailOtp: boolean;
  requireSignupPhoneOtp: boolean;
  requireVerifiedEmailToOrder: boolean;
  requireVerifiedPhoneToOrder: boolean;
};

export const VERIFICATION_DEFAULTS: VerificationSettings = {
  requireSignupEmailOtp: false,
  requireSignupPhoneOtp: false,
  requireVerifiedEmailToOrder: false,
  requireVerifiedPhoneToOrder: false,
};

/**
 * The four columns, read on their own.
 *
 * Not part of `SettingsDTO`: that shape is the storefront's branding, and every
 * page in the store would carry these four booleans for the two places that
 * ask. Its own `cache()`d read, exactly like `getPaymentFees`.
 *
 * **A failed read falls open, not closed.** The four defaults are `false`, so a
 * database blip cannot turn a store that asks nothing of its customers into one
 * that refuses every order — and it cannot invent a verification requirement
 * that the owner never set. The order gate is a policy, not a safety
 * interlock; the things that genuinely protect an order (stock, price, payment)
 * all fail closed on their own.
 */
export const getVerificationSettings = cache(
  async (): Promise<VerificationSettings> => {
    try {
      const row = await prisma.siteSettings.findUnique({
        where: { id: "main" },
        select: {
          requireSignupEmailOtp: true,
          requireSignupPhoneOtp: true,
          requireVerifiedEmailToOrder: true,
          requireVerifiedPhoneToOrder: true,
        },
      });
      return { ...VERIFICATION_DEFAULTS, ...(row ?? {}) };
    } catch {
      return { ...VERIFICATION_DEFAULTS };
    }
  }
);

/* ------------------------------------------------------------------ */
/*  The order gate                                                     */
/* ------------------------------------------------------------------ */

/** Who is trying to order, in the four fields the gate reads. */
export type VerifiableUser = {
  email: string;
  phone: string | null;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
};

export type OrderGate = {
  channel: OtpChannel;
  /** Canonical target the code would go to. */
  target: string;
  /** Masked for a number, plain for an address. */
  shown: string;
  /** One sentence naming what is wanted and why the order stopped. */
  message: string;
};

/**
 * What stands between this customer and placing an order — or `null`.
 *
 * **The rule that shapes it: a gate is only a gate when the customer can get
 * through it.** A requirement whose channel cannot deliver is not enforced,
 * because enforcing it would refuse every order with no action the shopper
 * could possibly take — the dead end this was explicitly built not to be. It is
 * not silent either: Admin → Settings prints "not in force" beside the switch
 * that cannot be honoured, in the same card, so the state is visible where the
 * decision is made rather than discovered from a customer complaint.
 *
 * Email is checked first because it is the channel that works: when both are
 * required, a customer fixes the possible one and is not told about the other.
 */
export function orderVerificationGate(
  user: VerifiableUser,
  settings: VerificationSettings
): OrderGate | null {
  if (settings.requireVerifiedEmailToOrder && !user.emailVerifiedAt) {
    const target = canonicalTarget("email", user.email);
    if (target) {
      return {
        channel: "email",
        target,
        shown: target,
        message: `Confirm your email address before ordering. We'll send a ${OTP_LENGTH}-digit code to ${target}.`,
      };
    }
  }

  if (settings.requireVerifiedPhoneToOrder && !user.phoneVerifiedAt) {
    const target = canonicalTarget("sms", user.phone);
    // Unenforceable two ways: no gateway to send through, or no number to send
    // to. Neither is the shopper's fault and neither has a fix they could
    // perform at checkout, so neither blocks the order.
    if (target && smsGateway().ready) {
      return {
        channel: "sms",
        target,
        shown: maskPhone(target),
        message: `Confirm your mobile number before ordering. We'll text a ${OTP_LENGTH}-digit code to ${maskPhone(target)}.`,
      };
    }
  }

  return null;
}

/**
 * Whether each switch is actually in force, for the admin screen.
 *
 * The settings card reads this rather than the raw booleans: a switch that is
 * on but cannot be honoured has to say so where it is set, or the owner
 * believes they have a rule they do not have.
 */
export function verificationEnforcement(settings: VerificationSettings): {
  signupEmail: boolean;
  signupPhone: boolean;
  orderEmail: boolean;
  orderPhone: boolean;
  /** True when at least one phone switch is on with no way to send. */
  phoneUnenforceable: boolean;
  smsDetail: string;
} {
  const sms = smsGateway();
  const phoneOn = settings.requireSignupPhoneOtp || settings.requireVerifiedPhoneToOrder;
  return {
    signupEmail: settings.requireSignupEmailOtp,
    signupPhone: settings.requireSignupPhoneOtp && sms.ready,
    orderEmail: settings.requireVerifiedEmailToOrder,
    orderPhone: settings.requireVerifiedPhoneToOrder && sms.ready,
    phoneUnenforceable: phoneOn && !sms.ready,
    smsDetail: sms.detail,
  };
}
