import "server-only";

/**
 * **Push, as an automation action.**
 *
 * `lib/automation.ts` decides *whether* to send and *to whom*; `lib/push.ts`
 * knows how to talk to a push service. This file is the piece between them: it
 * turns a rule's `recipient` into a set of devices, turns an email template
 * into something that fits in a phone banner, and reports the result in words
 * the admin queue can print.
 *
 * It exists as its own module rather than as a branch inside the engine for the
 * reason the engine's header gives for `action` being an open string: a second
 * channel must not be able to change how the first one behaves. Nothing here is
 * reachable except through `deliverJob`, and nothing here touches a job row.
 *
 * ## The addressing rule, and why it is the only one available
 *
 * **A push is addressed to a *device*, and the only link this schema has
 * between a person and a device is `PushSubscription.userId`.** There is no
 * column tying a subscription to an email address, an order, or a guest
 * session. So every recipient has to become a set of *account ids* before it
 * can become a set of devices:
 *
 * | recipient | becomes |
 * |---|---|
 * | `customer` | `Order.userId` when the order has an account behind it; otherwise every account holding the order's email |
 * | `admin` | every account holding `SiteSettings.adminNotifyEmail` |
 * | a literal address | **refused** — see below |
 *
 * The email fallback for a guest order is deliberate and it is not a guess: the
 * email leg of the same rule sends to `Order.email`, so resolving that address
 * to whoever holds an account for it reaches **exactly the people the email
 * already reaches**, and nobody else. `User.email` stopped being unique on
 * 2026-09-26 (a couple or a family may share an inbox), so this can resolve to
 * more than one account — which matches the email, where both of them read it.
 *
 * **A literal address cannot work and is refused at configure time**, in
 * `actions/automation.ts`. Typing `warehouse@example.com` into a push rule
 * would silently mean "the warehouse, but only if somebody there happens to
 * have a customer account on this store with notifications switched on" —
 * which is a rule that looks configured and reaches nobody. The rule editor
 * offers only the two recipients that name a person the store knows.
 *
 * ## Nobody to notify is not a failure
 *
 * Most customers will never have a device here: web push needs the store
 * installed to the home screen on iOS, and permission granted everywhere else.
 * A job that finds no device is **cancelled with a reason**, not failed —
 * failed implies something to fix and invites a retry that can only find the
 * same nothing. Cancelling is also terminal for the dedupe row, so the rule
 * will not come back and try the same subject again.
 *
 * A send to three devices where one is dead is a **success**. The push service
 * reports 404/410 for a subscription that no longer exists, `lib/push.ts`
 * deletes those rows on the spot, and the job records what actually happened.
 */

import { getSettings } from "@/lib/settings";
import { prisma } from "@/lib/prisma";
import {
  PUSH_LIMITS,
  countTargetsForUsers,
  pushConfigured,
  sendToTargets,
  targetsForUsers,
} from "@/lib/push";

/* ------------------------------------------------------------------ */
/*  Recipients                                                         */
/* ------------------------------------------------------------------ */

/**
 * The only two recipients a push rule may name.
 *
 * Duplicated as literals in `automation-rule-form.tsx` rather than imported —
 * this module is `server-only` (it reaches Prisma), and CLAUDE.md records what
 * happens when a client component calls into a server module. The server is
 * where it is *enforced*; the form only has to offer the right options.
 */
export const PUSH_RECIPIENTS = ["customer", "admin"] as const;

export type PushRecipient = (typeof PUSH_RECIPIENTS)[number];

export function isPushRecipient(value: string): value is PushRecipient {
  return (PUSH_RECIPIENTS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ */
/*  Template → banner                                                  */
/* ------------------------------------------------------------------ */

export type PushCopy = { title: string; body: string };

/**
 * Turn a rendered email into the two lines a phone will show.
 *
 * **Push reuses the rule's template rather than getting a shape of its own.**
 * Two reasons, and the second is the one that decided it. A subject line is
 * already a one-sentence summary of the event written for a glance — that is
 * exactly a notification title, and the store's subjects ("{{order.number}} is
 * on its way") read better as banners than most copy written for the purpose.
 * And a separate push body would be a *second* place the same message is
 * worded, which is the shape of trap CLAUDE.md records for `defaultReturnsInfo`
 * — two writers for one fact, drifting apart with nothing on screen to say so.
 *
 * So the title is the subject, and the body is the email's **opening
 * paragraph**: the part written to be read first, before the detail, the links
 * and the sign-off. Everything after the first blank line is dropped, because a
 * notification tray is not a place to put an order table.
 *
 * Three filters do the work, and each one exists because of what these
 * templates actually contain:
 *
 * - **The greeting goes.** "Hi Riya," is the whole first line of nine of the
 *   shipped templates and says nothing in a banner that already arrives on
 *   Riya's own phone.
 * - **A bare URL goes.** The tray is not clickable line by line; the whole
 *   notification carries one link, and it is set separately.
 * - **A label with nothing after it goes.** `Courier: {{order.courier}}`
 *   renders as "Courier:" before the parcel is booked, because an unknown token
 *   renders as empty — see `renderTemplate`. A banner reading "Courier:" is
 *   worse than one that never mentions it.
 *
 * If a lead-in paragraph ends in a colon ("Here's what you bought:") the next
 * paragraph is pulled in too, so the promise is kept inside the banner.
 *
 * The result can legitimately be an **empty body** — a title-only notification,
 * which is valid and which the service worker renders. That is why the rule
 * editor previews this: a template whose opening paragraph is a greeting and a
 * link produces an empty banner, and the only place to notice is before it is
 * switched on.
 */
export function pushCopyFrom(subject: string, body: string): PushCopy {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split("\n")
        .map((line) => line.trim())
        .filter(
          (line) =>
            line.length > 0 &&
            // A bare link.
            !/^https?:\/\/\S+$/i.test(line) &&
            // A label whose token rendered as nothing: "Courier:".
            !/^[^:]{1,40}:$/.test(line)
        )
        .join(" ")
        .trim()
    )
    .filter(Boolean);

  // Drop a greeting, whether it is its own paragraph or the head of one.
  const GREETING = /^(hi|hey|hello|dear)\b[^,.!]{0,40}[,!]\s*/i;
  const cleaned: string[] = [];
  for (const [i, para] of paragraphs.entries()) {
    const stripped = i === 0 ? para.replace(GREETING, "").trim() : para;
    if (stripped) cleaned.push(stripped);
  }

  let text = cleaned[0] ?? "";
  // A lead-in ("Here's what you bought:") is a promise; keep what it promised.
  if (text.endsWith(":") && cleaned[1]) text = `${text} ${cleaned[1]}`;

  return {
    title: subject.replace(/\s+/g, " ").trim().slice(0, PUSH_LIMITS.title),
    // `encodePayload` clips both fields again before anything is encrypted;
    // this slice only keeps the preview and the wire in step.
    body: text.replace(/\s+/g, " ").trim().slice(0, PUSH_LIMITS.body),
  };
}

/* ------------------------------------------------------------------ */
/*  Audience                                                           */
/* ------------------------------------------------------------------ */

/** Accounts holding this address. Case-insensitive: an inbox is not case-sensitive. */
async function accountsForEmail(email: string): Promise<string[]> {
  const value = email.trim();
  if (!value.includes("@")) return [];
  const rows = await prisma.user
    .findMany({
      where: { email: { equals: value, mode: "insensitive" } },
      select: { id: true },
      take: 10,
    })
    .catch(() => []);
  return rows.map((r) => r.id);
}

export type PushSubjectIdentity = {
  /** The account behind the order, if it had one. Guests have none. */
  userId: string | null;
  /** Where the email leg of the same rule would send. */
  email: string;
};

export type PushAudience = {
  targets: Awaited<ReturnType<typeof targetsForUsers>>;
  /** Why the list is empty, in the words the admin queue should print. */
  emptyReason?: string;
};

/**
 * Turn a rule's recipient into devices.
 *
 * Every empty result carries the *reason* it is empty, because "nothing was
 * sent" and "nobody has a phone" and "your admin address has no account" are
 * three different situations and only one of them is worth acting on.
 */
export async function resolvePushAudience(
  recipient: string,
  subject: PushSubjectIdentity
): Promise<PushAudience> {
  if (recipient === "admin") {
    const { adminNotifyEmail } = await getSettings();
    const ids = await accountsForEmail(adminNotifyEmail);
    if (ids.length === 0) {
      return {
        targets: [],
        emptyReason: `No customer account uses ${adminNotifyEmail}, and a notification needs a device. Sign in on your phone with that address and turn notifications on, or change the address in Settings.`,
      };
    }
    const targets = await targetsForUsers(ids);
    return targets.length > 0
      ? { targets }
      : {
          targets: [],
          emptyReason: `The account for ${adminNotifyEmail} has no device with notifications switched on.`,
        };
  }

  if (!isPushRecipient(recipient)) {
    return {
      targets: [],
      emptyReason: `"${recipient}" is an email address. A notification goes to a device, not an inbox, so there is nothing to send it to.`,
    };
  }

  // recipient === "customer"
  if (subject.userId) {
    const targets = await targetsForUsers([subject.userId]);
    return targets.length > 0
      ? { targets }
      : {
          targets: [],
          emptyReason:
            "This customer has an account but no device with notifications switched on.",
        };
  }

  if (!subject.email) {
    return {
      targets: [],
      emptyReason: "There is no account and no email on this record, so there is no device to find.",
    };
  }

  const ids = await accountsForEmail(subject.email);
  if (ids.length === 0) {
    return {
      targets: [],
      emptyReason:
        "Placed as a guest, and no account uses that email address — a notification needs an account to reach a device.",
    };
  }
  const targets = await targetsForUsers(ids);
  return targets.length > 0
    ? { targets }
    : {
        targets: [],
        emptyReason: "No device on that account has notifications switched on.",
      };
}

/* ------------------------------------------------------------------ */
/*  Sending                                                            */
/* ------------------------------------------------------------------ */

export type PushDispatchOutcome =
  /** At least one device took it. Some may have been dead; that is still a send. */
  | { kind: "sent"; detail: string }
  /** Nothing to send to. Terminal, and not anybody's fault. */
  | { kind: "nobody"; detail: string }
  /** Something is wrong that a person could fix. Worth retrying. */
  | { kind: "failed"; detail: string };

export type AutomationPushInput = {
  recipient: string;
  subject: PushSubjectIdentity;
  copy: PushCopy;
  /** Same-origin path the notification opens. */
  url: string;
  /** Collapse key — a later update about the same order replaces an earlier one. */
  tag: string;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Resolve, send, and say what happened.
 *
 * The three outcomes map onto the three things `deliverJob` can do with a job,
 * and the mapping is the whole point of returning a union rather than a
 * boolean: `sent` keeps the claim, `nobody` cancels it, `failed` flips it to
 * failed where the admin can retry.
 */
export async function dispatchAutomationPush(
  input: AutomationPushInput
): Promise<PushDispatchOutcome> {
  if (!pushConfigured()) {
    return {
      kind: "failed",
      detail:
        "Push is not configured on this deployment — NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are missing.",
    };
  }
  if (!input.copy.title) {
    return {
      kind: "failed",
      detail: "The template's subject line is empty, and a notification must have a title.",
    };
  }

  const audience = await resolvePushAudience(input.recipient, input.subject);
  if (audience.targets.length === 0) {
    return { kind: "nobody", detail: audience.emptyReason ?? "No device to notify." };
  }

  const result = await sendToTargets(audience.targets, {
    title: input.copy.title,
    body: input.copy.body,
    url: input.url,
    tag: input.tag,
  });

  if (!result.ok) {
    return { kind: "failed", detail: result.error ?? "The push could not be sent." };
  }

  const pruned = result.pruned > 0 ? ` · ${plural(result.pruned, "expired subscription")} removed` : "";
  const refused = result.failed > 0 ? ` · ${plural(result.failed, "device")} refused it` : "";

  // One live device is a delivery. A dead subscription alongside it is
  // housekeeping the send just did for us, not a partial failure.
  if (result.sent > 0) {
    return {
      kind: "sent",
      detail: `Delivered to ${plural(result.sent, "device")}${pruned}${refused}.`,
    };
  }

  if (result.failed === 0) {
    return {
      kind: "nobody",
      detail: `Every subscription for this person had expired; ${plural(result.pruned, "row")} removed. There is no live device left to notify.`,
    };
  }

  return {
    kind: "failed",
    detail: `The push service refused all ${plural(result.failed, "device")}${pruned}.`,
  };
}

/* ------------------------------------------------------------------ */
/*  What the rule editor needs to know before anything is saved        */
/* ------------------------------------------------------------------ */

export type PushReach = {
  configured: boolean;
  /** Every subscribed device, including guests a rule can never address. */
  totalDevices: number;
  /** Devices attached to an account — the only ones a rule can reach. */
  reachableDevices: number;
  /** The address `recipient: "admin"` resolves through. */
  adminEmail: string;
  /** Devices that address currently reaches. Zero means the rule sends nothing. */
  adminDevices: number;
};

/**
 * A push rule's reach **as it stands today**, for the rule editor.
 *
 * "Make the owner unable to configure something that cannot work" has two
 * halves. A literal email address is refused outright, because it can never
 * work. `admin` can work but usually does not *yet* — it depends on an account
 * existing for the notify address — and that is a fact, not an error, so the
 * editor states it beside the choice instead of refusing the save. An owner who
 * builds the rule first and signs the phone in afterwards is doing nothing
 * wrong; an owner who builds it and never hears from it deserves to have been
 * told.
 */
export async function pushReach(): Promise<PushReach> {
  const settings = await getSettings();
  const [totalDevices, reachableDevices, adminIds] = await Promise.all([
    prisma.pushSubscription.count().catch(() => 0),
    prisma.pushSubscription.count({ where: { NOT: { userId: null } } }).catch(() => 0),
    accountsForEmail(settings.adminNotifyEmail),
  ]);
  return {
    configured: pushConfigured(),
    totalDevices,
    reachableDevices,
    adminEmail: settings.adminNotifyEmail,
    adminDevices: await countTargetsForUsers(adminIds),
  };
}
