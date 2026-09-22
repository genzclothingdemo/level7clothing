import "server-only";

/**
 * The automation engine.
 *
 * One sentence defines the whole feature: **when TRIGGER happens, and
 * CONDITIONS match, after DELAY, do ACTION.** Everything here serves that
 * sentence and nothing else.
 *
 * ## The one entry point
 *
 * {@link runAutomationTrigger} is the only function the rest of the app calls.
 * It is deliberately the *whole* surface, because the firing sites (checkout,
 * the admin status update, the returns action) belong to other parts of the
 * codebase and must not have to know that rules, templates, jobs or Resend
 * exist. It **cannot throw** — see the contract on the function itself.
 *
 * ## Why a job table at all
 *
 * A serverless function has no long-lived timers. `setTimeout(…, 24h)` in a
 * Vercel function is a timer on a process that is killed seconds after the
 * response is flushed, so a delay has to be *durable state* somebody comes back
 * for. That somebody is `/api/cron/automation`, and the state is
 * `AutomationJob`.
 *
 * ## How a job is guaranteed not to send twice
 *
 * Two independent locks, and neither is "check then act":
 *
 * 1. **The unique index does the deduplication, not a query.**
 *    `@@unique([ruleId, subjectType, subjectId])` means at most one row can
 *    ever exist for a (rule, subject) pair. Enqueue is a bare `create()` whose
 *    `P2002` is swallowed as success-by-idempotency. Nothing reads first, so
 *    two concurrent calls cannot both see "no job yet" — one of them loses at
 *    the index, which is the only arbiter that is actually atomic.
 *
 *    `subjectId` is therefore a **dedupe key, not a row id** — see
 *    {@link dedupeKeyFor}. For `order.status_changed` it is
 *    `"<orderId>:shipped"`, so the same rule sends once when the order ships
 *    *and* once when it is delivered, but never twice for the same status. The
 *    real row id travels in `payload.entityId`.
 *
 * 2. **The drain claims a job with a compare-and-set before sending.**
 *    `updateMany({ where: { id, status: "pending" }, data: { status: "sent" } })`
 *    — Postgres locks the row and re-evaluates `status = 'pending'` against the
 *    committed value, so of two overlapping cron invocations exactly one gets
 *    `count === 1` and the other gets `0` and skips. The status is written
 *    **before** the email is handed to Resend, on purpose: that makes the
 *    failure mode "a rare job never sends" instead of "a customer gets the same
 *    email twice", and for notification mail that is the right way round. A
 *    send that then fails is flipped to `failed` with the error recorded, where
 *    a human can see it.
 *
 * **Every send goes through a claimed job row, including `delayMinutes: 0`.**
 * An inline rule enqueues with `runAt = now` and then drains that single job
 * through the same claim. There is no second, unprotected code path, so the
 * guarantee above covers inline sends too — calling
 * `runAutomationTrigger("order.created", …)` twice for one order sends once.
 *
 * ## `action` is open on purpose
 *
 * `AutomationRule.action` is a free string defaulting to `"email"`. A rule
 * whose action this build does not implement is skipped and logged, never
 * executed as email — so a `"whatsapp"` action can be added later with no
 * migration and no risk that an unbuilt channel silently mails somebody.
 */

import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { sendAutomationEmail } from "@/lib/email";
import { absoluteUrl } from "@/lib/site-url";
import { formatINR } from "@/lib/utils";
import type { Prisma } from "@prisma/client";

/* ------------------------------------------------------------------ */
/*  Triggers, conditions and tokens — the catalogue                    */
/* ------------------------------------------------------------------ */

export const TRIGGER_KEYS = [
  "order.created",
  "order.status_changed",
  "cart.abandoned",
  "return.requested",
] as const;

export type TriggerKey = (typeof TRIGGER_KEYS)[number];

/** What kind of row a job is about. Narrower than a string so the drain can switch. */
export type SubjectType = "order" | "lead" | "return";

export function isTriggerKey(v: unknown): v is TriggerKey {
  return (TRIGGER_KEYS as readonly unknown[]).includes(v);
}

/** One narrowing control, rendered generically by the rule form. */
export type ConditionField = {
  key: string;
  label: string;
  /** The "no opinion" option is always first and always the empty string. */
  options: { value: string; label: string }[];
};

export type TokenSpec = { token: string; describes: string };

export type TriggerSpec = {
  key: TriggerKey;
  label: string;
  /** One line, in the owner's words, for the picker. */
  blurb: string;
  subjectType: SubjectType;
  /** Where this trigger has to be called from for it to ever fire. */
  firesFrom: string;
  conditions: ConditionField[];
  tokens: TokenSpec[];
};

/** Tokens every template can use, whatever the trigger. */
const COMMON_TOKENS: TokenSpec[] = [
  { token: "store.name", describes: "Your brand name" },
  { token: "store.email", describes: "Your public contact email" },
  { token: "store.url", describes: "The storefront address" },
  { token: "customer.name", describes: "Full name, e.g. Riya Sharma" },
  { token: "customer.firstName", describes: "First name only, e.g. Riya" },
  { token: "customer.email", describes: "Their email address" },
];

const ORDER_TOKENS: TokenSpec[] = [
  { token: "order.number", describes: "e.g. L7-1042" },
  { token: "order.total", describes: "Formatted, e.g. ₹2,399" },
  { token: "order.status", describes: "pending / confirmed / shipped / …" },
  { token: "order.paymentMethod", describes: "COD, Razorpay, Partial, Direct" },
  { token: "order.itemCount", describes: "How many pieces" },
  { token: "order.items", describes: "One line per item, with quantities" },
  { token: "order.url", describes: "Link to their order page" },
  { token: "order.courier", describes: "Blank until it ships" },
  { token: "order.trackingNumber", describes: "AWB — blank until booked" },
  { token: "order.trackingUrl", describes: "Courier link — blank until booked" },
];

const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "shipped",
  "delivered",
  "cancelled",
];

/**
 * The catalogue. This is the contract between the engine, the rule form and the
 * token list printed next to the template editor — all three read it, so a
 * trigger cannot offer a token in the UI that the engine does not build.
 */
export const TRIGGERS: TriggerSpec[] = [
  {
    key: "order.created",
    label: "An order is placed",
    blurb: "The moment checkout completes, before anyone has confirmed it.",
    subjectType: "order",
    firesFrom: "the checkout action, once the order row exists",
    conditions: [
      {
        key: "paymentMethod",
        label: "Only for payment method",
        options: [
          { value: "", label: "Any payment method" },
          { value: "COD", label: "Cash on delivery" },
          { value: "Razorpay", label: "Paid online" },
          { value: "Partial", label: "Part-paid" },
          { value: "Direct", label: "Paid to you directly" },
        ],
      },
    ],
    tokens: [...COMMON_TOKENS, ...ORDER_TOKENS],
  },
  {
    key: "order.status_changed",
    label: "An order's status changes",
    blurb: "Confirmed, shipped, delivered, cancelled — pick one, or react to all.",
    subjectType: "order",
    firesFrom: "wherever an order's status column is written",
    conditions: [
      {
        key: "status",
        label: "Only when the new status is",
        options: [
          { value: "", label: "Any status" },
          ...ORDER_STATUSES.map((s) => ({
            value: s,
            label: s[0].toUpperCase() + s.slice(1),
          })),
        ],
      },
      {
        key: "paymentMethod",
        label: "And only for payment method",
        options: [
          { value: "", label: "Any payment method" },
          { value: "COD", label: "Cash on delivery" },
          { value: "Razorpay", label: "Paid online" },
          { value: "Partial", label: "Part-paid" },
          { value: "Direct", label: "Paid to you directly" },
        ],
      },
    ],
    tokens: [
      ...COMMON_TOKENS,
      ...ORDER_TOKENS,
      { token: "order.previousStatus", describes: "What it was before this change" },
    ],
  },
  {
    key: "cart.abandoned",
    label: "A cart is left behind",
    blurb:
      "Someone added a piece and did not check out. Give it a day, then nudge.",
    subjectType: "lead",
    firesFrom: "wherever a cart Lead is created",
    conditions: [
      {
        key: "status",
        label: "Only while the lead is",
        options: [
          { value: "", label: "Any status" },
          { value: "interested", label: "Interested (not contacted yet)" },
          { value: "contacted", label: "Contacted" },
        ],
      },
    ],
    tokens: [
      ...COMMON_TOKENS,
      { token: "cart.productName", describes: "The piece they left behind" },
      { token: "cart.quantity", describes: "How many" },
      { token: "cart.price", describes: "Formatted, e.g. ₹1,299" },
      { token: "cart.url", describes: "Link back to the shop" },
    ],
  },
  {
    key: "return.requested",
    label: "A return is requested",
    blurb: "A customer has asked to send something back.",
    subjectType: "return",
    firesFrom: "the customer-facing return request action",
    conditions: [
      {
        key: "status",
        label: "Only when the return is",
        options: [
          { value: "", label: "Any status" },
          { value: "pending", label: "Pending review" },
          { value: "approved", label: "Approved" },
          { value: "rejected", label: "Rejected" },
        ],
      },
    ],
    tokens: [
      ...COMMON_TOKENS,
      { token: "return.number", describes: "e.g. RET-8821" },
      { token: "return.reason", describes: "Why they are returning it" },
      { token: "return.status", describes: "pending / approved / …" },
      { token: "return.productName", describes: "The piece being returned" },
      { token: "order.number", describes: "The order it came from" },
      { token: "order.url", describes: "Link to their order page" },
    ],
  },
];

export function triggerSpec(key: string): TriggerSpec | null {
  return TRIGGERS.find((t) => t.key === key) ?? null;
}

export function triggerLabel(key: string): string {
  return triggerSpec(key)?.label ?? key;
}

/* ------------------------------------------------------------------ */
/*  Recipients and actions                                             */
/* ------------------------------------------------------------------ */

/** `"customer"` / `"admin"` are resolved; anything else is a literal address. */
export type RecipientChoice = "customer" | "admin" | (string & {});

export function recipientLabel(recipient: string): string {
  if (recipient === "customer") return "The customer";
  if (recipient === "admin") return "You (admin)";
  return recipient;
}

/** Only `email` is implemented. See the file header on why the column is open. */
export const IMPLEMENTED_ACTIONS = ["email"] as const;

export function actionLabel(action: string): string {
  return action === "email" ? "Send an email" : action;
}

/* ------------------------------------------------------------------ */
/*  Token rendering                                                    */
/* ------------------------------------------------------------------ */

export type TokenBag = Record<string, string>;

/**
 * Substitute `{{token}}` placeholders.
 *
 * An **unknown token renders as empty**, not as itself: a customer reading
 * "your order {{order.numbr}} has shipped" is worse than reading a gap. The
 * typo is meant to be caught before it ships, by the live preview in the
 * template editor, which renders with the same function and sample data.
 *
 * Whitespace inside the braces is tolerated (`{{ order.number }}`) because
 * people type it. No escaping happens here — the body is plain text until
 * `sendAutomationEmail` escapes it, which is the only correct order.
 */
export function renderTemplate(text: string, tokens: TokenBag): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : ""
  );
}

/** Every `{{token}}` a body mentions, deduped — used to flag typos in the editor. */
export function tokensUsedIn(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) found.add(m[1]);
  return [...found];
}

/**
 * Plausible values for every token in the catalogue, for the template editor's
 * live preview.
 *
 * It lives here rather than in the editor so there is one list: a token added
 * to a trigger above and forgotten here shows up in the preview as a visible
 * gap, which is the point. The values are deliberately realistic — a preview
 * full of `LOREM` does not reveal that a subject line runs past what an inbox
 * will show, and that is most of what a preview is for.
 */
export const SAMPLE_TOKENS: TokenBag = {
  "store.name": "Level7 Clothing",
  "store.email": "hello@level7clothing.com",
  "store.url": "https://clothingdemoshop.vercel.app",
  "customer.name": "Riya Sharma",
  "customer.firstName": "Riya",
  "customer.email": "riya@example.com",
  "order.number": "L7-1042",
  "order.total": "₹2,399",
  "order.status": "shipped",
  "order.previousStatus": "confirmed",
  "order.paymentMethod": "COD",
  "order.itemCount": "2",
  "order.items": "Oversized Tee — Black × 1\nFleece Hoodie — Stone × 1",
  "order.url": "https://clothingdemoshop.vercel.app/order/L7-1042",
  "order.courier": "Delhivery",
  "order.trackingNumber": "1234567890123",
  "order.trackingUrl": "https://www.delhivery.com/track/package/1234567890123",
  "cart.productName": "Oversized Tee — Black",
  "cart.quantity": "1",
  "cart.price": "₹1,299",
  "cart.url": "https://clothingdemoshop.vercel.app/shop",
  "return.number": "RET-8821",
  "return.reason": "Size didn't fit",
  "return.status": "pending",
  "return.productName": "Fleece Hoodie — Stone",
};

/** Every token any trigger offers, deduped — what a template may safely use. */
export function allKnownTokens(): TokenSpec[] {
  const seen = new Map<string, TokenSpec>();
  for (const trigger of TRIGGERS) {
    for (const token of trigger.tokens) {
      if (!seen.has(token.token)) seen.set(token.token, token);
    }
  }
  return [...seen.values()];
}

/* ------------------------------------------------------------------ */
/*  Subject resolution — turning a row into a token bag                */
/* ------------------------------------------------------------------ */

type OrderItem = { name?: string; quantity?: number };

/** Prisma's `Json` comes back as `unknown`; an order's items are read defensively. */
function itemLines(items: unknown): { count: number; lines: string } {
  const list: OrderItem[] = Array.isArray(items) ? (items as OrderItem[]) : [];
  const count = list.reduce((n, i) => n + (Number(i?.quantity) || 0), 0);
  const lines = list
    .map((i) => `${i?.name ?? "Item"} × ${Number(i?.quantity) || 1}`)
    .join("\n");
  return { count, lines };
}

function firstNameOf(full: string): string {
  return full.trim().split(/\s+/)[0] ?? "";
}

/**
 * Everything a rule needs to decide and to send, resolved from the database at
 * **send** time rather than at enqueue time.
 *
 * That matters for a delayed job: a 24-hour abandoned-cart nudge whose tokens
 * were frozen yesterday would cheerfully quote a price that has since changed,
 * and — worse — would still go out to somebody who ordered an hour later.
 * Resolving late lets {@link stillApplies} cancel it instead.
 */
type Resolved = {
  tokens: TokenBag;
  /** For `recipient: "customer"`. Empty means there is nobody to write to. */
  customerEmail: string;
  /** Condition inputs, matched case-insensitively against the rule. */
  facts: Record<string, string>;
  /** False ⇒ the job is no longer relevant and should be cancelled, not sent. */
  applies: boolean;
  /** Why it stopped applying, for the job's `error` column. */
  reason?: string;
};

async function resolveSubject(
  subjectType: SubjectType,
  entityId: string,
  context: Record<string, string>
): Promise<Resolved | null> {
  const settings = await getSettings();
  const base: TokenBag = {
    "store.name": settings.brandName,
    "store.email": settings.contactEmail,
    "store.url": absoluteUrl("/"),
  };

  if (subjectType === "order") {
    const order = await prisma.order.findUnique({ where: { id: entityId } });
    if (!order) return null;
    const { count, lines } = itemLines(order.items);
    return {
      customerEmail: order.email,
      facts: {
        status: order.status,
        paymentMethod: order.paymentMethod,
      },
      applies: true,
      tokens: {
        ...base,
        "customer.name": order.customerName,
        "customer.firstName": firstNameOf(order.customerName),
        "customer.email": order.email,
        "order.number": order.orderNumber,
        "order.total": formatINR(order.total),
        "order.status": order.status,
        "order.previousStatus": context.previousStatus ?? "",
        "order.paymentMethod": order.paymentMethod,
        "order.itemCount": String(count),
        "order.items": lines,
        "order.url": absoluteUrl(`/order/${order.orderNumber}`),
        "order.courier": order.courier ?? "",
        "order.trackingNumber": order.trackingNumber ?? "",
        "order.trackingUrl": order.trackingUrl ?? "",
      },
    };
  }

  if (subjectType === "lead") {
    const lead = await prisma.lead.findUnique({ where: { id: entityId } });
    if (!lead) return null;

    // The whole point of an abandoned-cart nudge is that they did NOT buy.
    // Two ways that can stop being true between enqueue and send, and both
    // have to be checked here rather than trusted from a day ago.
    let applies = true;
    let reason: string | undefined;
    if (lead.status === "ordered") {
      applies = false;
      reason = "Cancelled — the lead was already marked as ordered.";
    } else if (lead.email) {
      const bought = await prisma.order.findFirst({
        where: { email: lead.email, createdAt: { gte: lead.createdAt } },
        select: { id: true },
      });
      if (bought) {
        applies = false;
        reason = "Cancelled — they placed an order after adding this to the cart.";
      }
    }

    const name = lead.name ?? "";
    return {
      customerEmail: lead.email ?? "",
      facts: { status: lead.status },
      applies,
      reason,
      tokens: {
        ...base,
        "customer.name": name,
        // "Hi there" beats "Hi ," — a cart lead often has no name at all.
        "customer.firstName": firstNameOf(name) || "there",
        "customer.email": lead.email ?? "",
        "cart.productName": lead.productName,
        "cart.quantity": String(lead.quantity),
        "cart.price": lead.price != null ? formatINR(lead.price) : "",
        "cart.url": absoluteUrl("/shop"),
      },
    };
  }

  const ret = await prisma.returnRequest.findUnique({
    where: { id: entityId },
    include: { order: { select: { orderNumber: true, customerName: true, email: true } } },
  });
  if (!ret) return null;
  return {
    customerEmail: ret.order.email,
    facts: { status: ret.status },
    applies: true,
    tokens: {
      ...base,
      "customer.name": ret.order.customerName,
      "customer.firstName": firstNameOf(ret.order.customerName),
      "customer.email": ret.order.email,
      "return.number": ret.requestNumber,
      "return.reason": ret.reason,
      "return.status": ret.status,
      "return.productName": ret.productName,
      "order.number": ret.order.orderNumber,
      "order.url": absoluteUrl(`/order/${ret.order.orderNumber}`),
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Conditions                                                         */
/* ------------------------------------------------------------------ */

/** `conditions` is `Json`, so it is read defensively rather than cast. */
export function readConditions(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const s = typeof v === "string" ? v.trim() : "";
    if (s) out[k] = s;
  }
  return out;
}

/**
 * Does this rule apply to these facts?
 *
 * An **absent or empty condition means "any"**, which is what makes the empty
 * object `{}` a rule that fires on every occurrence of its trigger. Comparison
 * is case-insensitive because `paymentMethod` is a free string written at
 * checkout — "COD" and "cod" are the same method, and a rule that silently
 * never fires because of a capital letter is the worst kind of broken.
 */
export function conditionsMatch(
  conditions: Record<string, string>,
  facts: Record<string, string>
): boolean {
  return Object.entries(conditions).every(
    ([key, want]) =>
      String(facts[key] ?? "").trim().toLowerCase() === want.trim().toLowerCase()
  );
}

/** Human summary for the rule list — "Any order", "Shipped · Cash on delivery". */
export function describeConditions(trigger: string, conditions: Record<string, string>): string {
  const spec = triggerSpec(trigger);
  const parts: string[] = [];
  for (const field of spec?.conditions ?? []) {
    const value = conditions[field.key];
    if (!value) continue;
    const option = field.options.find((o) => o.value === value);
    parts.push(option?.label ?? value);
  }
  return parts.length ? parts.join(" · ") : "Every time";
}

/* ------------------------------------------------------------------ */
/*  The dedupe key                                                     */
/* ------------------------------------------------------------------ */

/**
 * What `AutomationJob.subjectId` actually holds.
 *
 * The unique index `[ruleId, subjectType, subjectId]` is the *only* thing
 * standing between an order and a duplicate email, so this key decides exactly
 * how often a rule is allowed to fire for one row:
 *
 * | trigger                 | key                      | fires                       |
 * |-------------------------|--------------------------|-----------------------------|
 * | `order.created`         | `<orderId>`              | once per order              |
 * | `order.status_changed`  | `<orderId>:<newStatus>`  | once per order per status   |
 * | `cart.abandoned`        | `<leadId>`               | once per cart lead          |
 * | `return.requested`      | `<returnId>`             | once per return             |
 *
 * The status variant is the interesting one and it is not an optimisation: with
 * a bare `<orderId>` a single "keep the customer posted" rule would email on
 * confirmation and then stay silent for shipping and delivery, because the row
 * already existed. With the status in the key, an order that goes
 * pending → confirmed → shipped → delivered sends three times and an order
 * bounced back to `shipped` twice still sends once.
 */
export function dedupeKeyFor(
  trigger: TriggerKey,
  entityId: string,
  facts: Record<string, string>
): string {
  if (trigger === "order.status_changed") {
    return `${entityId}:${(facts.status ?? "").toLowerCase()}`;
  }
  return entityId;
}

/* ------------------------------------------------------------------ */
/*  The one entry point                                                */
/* ------------------------------------------------------------------ */

export type TriggerSubject = {
  /** The row's real id. */
  id: string;
  /** Extra facts the database cannot supply — currently only `previousStatus`. */
  context?: Record<string, string>;
};

export type TriggerOutcome = {
  matched: number;
  queued: number;
  sent: number;
  skipped: number;
};

const NOTHING: TriggerOutcome = { matched: 0, queued: 0, sent: 0, skipped: 0 };

/**
 * **Run every active rule for one trigger. The only function to call from
 * outside this module.**
 *
 * ```ts
 * await runAutomationTrigger("order.created", { id: order.id });
 * ```
 *
 * ### It cannot throw
 *
 * The entire body is wrapped. A missing `RESEND_API_KEY`, a malformed rule, a
 * dropped database connection and a Resend outage all resolve to a logged line
 * and a zeroed result. This is not defensive habit — it is the contract that
 * lets a checkout action call it without a `try`: **no automation may ever be
 * the reason an order fails to be placed.** An email that did not go out is a
 * marketing problem; a checkout that 500s is a lost sale.
 *
 * It is safe to `await` (inline rules send during that await, which is the
 * point of a zero delay) and equally safe to fire and forget with `void`.
 * Calling it twice for the same occurrence sends once — see the file header.
 */
export async function runAutomationTrigger(
  trigger: TriggerKey,
  subject: TriggerSubject
): Promise<TriggerOutcome> {
  try {
    const spec = triggerSpec(trigger);
    if (!spec) {
      console.warn(`[automation] unknown trigger "${trigger}" — ignored.`);
      return NOTHING;
    }

    const rules = await prisma.automationRule.findMany({
      where: { trigger, isActive: true },
      include: { template: true },
    });
    if (rules.length === 0) return NOTHING;

    const resolved = await resolveSubject(
      spec.subjectType,
      subject.id,
      subject.context ?? {}
    );
    if (!resolved) {
      console.warn(
        `[automation] ${trigger}: no ${spec.subjectType} with id ${subject.id} — ignored.`
      );
      return NOTHING;
    }

    const now = new Date();
    const out: TriggerOutcome = { matched: 0, queued: 0, sent: 0, skipped: 0 };

    for (const rule of rules) {
      const conditions = readConditions(rule.conditions);
      if (!conditionsMatch(conditions, resolved.facts)) continue;
      out.matched += 1;

      const key = dedupeKeyFor(trigger, subject.id, resolved.facts);
      const runAt = new Date(now.getTime() + Math.max(0, rule.delayMinutes) * 60_000);

      // Enqueue is a bare create. The unique index is the deduplication; a
      // "does one exist?" read here would be a race, not a check.
      let jobId: string | null = null;
      try {
        const job = await prisma.automationJob.create({
          data: {
            ruleId: rule.id,
            runAt,
            status: "pending",
            subjectType: spec.subjectType,
            subjectId: key,
            payload: {
              entityId: subject.id,
              trigger,
              context: subject.context ?? {},
            } satisfies Prisma.InputJsonValue,
          },
          select: { id: true },
        });
        jobId = job.id;
      } catch (err) {
        // P2002 is the index doing its job: this rule has already run for this
        // subject. That is success, not failure.
        if (isUniqueViolation(err)) {
          out.skipped += 1;
          continue;
        }
        throw err;
      }

      // Counters are best-effort telemetry for the admin list, never a lock.
      await prisma.automationRule
        .update({
          where: { id: rule.id },
          data: { lastRunAt: now, runCount: { increment: 1 } },
        })
        .catch(() => {});

      if (rule.delayMinutes > 0) {
        out.queued += 1;
        continue;
      }

      // Zero delay still goes through the job row, so inline and delayed sends
      // share one claim and one guarantee.
      const result = await deliverJob(jobId);
      if (result === "sent") out.sent += 1;
      else out.skipped += 1;
    }

    return out;
  } catch (err) {
    console.error(`[automation] ${trigger} failed (swallowed):`, err);
    return NOTHING;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "P2002"
  );
}

/* ------------------------------------------------------------------ */
/*  Delivery                                                           */
/* ------------------------------------------------------------------ */

type DeliveryResult = "sent" | "skipped" | "failed";

/**
 * Claim one job and deliver it. The claim is the compare-and-set described in
 * the file header, and it happens **before** anything is handed to Resend.
 */
async function deliverJob(jobId: string): Promise<DeliveryResult> {
  const job = await prisma.automationJob.findUnique({
    where: { id: jobId },
    include: { rule: { include: { template: true } } },
  });
  if (!job || job.status !== "pending") return "skipped";

  const payload =
    job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
      ? (job.payload as Record<string, unknown>)
      : {};
  const entityId = String(payload.entityId ?? "");
  const context = (payload.context ?? {}) as Record<string, string>;

  // --- The claim. One winner, decided by Postgres, not by this process. ---
  const claim = await prisma.automationJob.updateMany({
    where: { id: jobId, status: "pending" },
    data: { status: "sent", sentAt: new Date() },
  });
  if (claim.count === 0) return "skipped";

  const fail = async (message: string): Promise<DeliveryResult> => {
    await prisma.automationJob
      .update({
        where: { id: jobId },
        data: { status: "failed", sentAt: null, error: message.slice(0, 900) },
      })
      .catch(() => {});
    console.error(`[automation] job ${jobId} failed: ${message}`);
    return "failed";
  };

  const cancel = async (message: string): Promise<DeliveryResult> => {
    await prisma.automationJob
      .update({
        where: { id: jobId },
        data: { status: "cancelled", sentAt: null, error: message.slice(0, 900) },
      })
      .catch(() => {});
    return "skipped";
  };

  try {
    const rule = job.rule;
    if (rule.action !== "email") {
      return await cancel(
        `Action "${rule.action}" is not implemented in this build, so nothing was sent.`
      );
    }
    if (!rule.template) {
      return await fail("The rule has no email template attached.");
    }

    const subjectType = (job.subjectType as SubjectType) ?? "order";
    const resolved = await resolveSubject(subjectType, entityId, context);
    if (!resolved) {
      return await cancel(`The ${subjectType} this job was about no longer exists.`);
    }
    if (!resolved.applies) {
      return await cancel(resolved.reason ?? "No longer applicable.");
    }
    // Re-checked at send time, not only at enqueue: a delayed job's subject can
    // have moved on (an order confirmed and then cancelled within the delay).
    if (!conditionsMatch(readConditions(rule.conditions), resolved.facts)) {
      return await cancel(
        "The rule's conditions no longer match — the subject changed during the delay."
      );
    }

    const settings = await getSettings();
    const to =
      rule.recipient === "customer"
        ? resolved.customerEmail
        : rule.recipient === "admin"
          ? settings.adminNotifyEmail
          : rule.recipient;
    if (!to || !to.includes("@")) {
      return await cancel(
        rule.recipient === "customer"
          ? "No customer email on this record — a guest cart lead often has none."
          : `"${rule.recipient}" is not a usable email address.`
      );
    }

    const res = await sendAutomationEmail(settings, {
      to,
      subject: renderTemplate(rule.template.subject, resolved.tokens),
      bodyText: renderTemplate(rule.template.body, resolved.tokens),
      title: rule.name,
    });

    // `send()` never throws — it returns an error shape. An email Resend
    // rejected has NOT been sent, and a job left marked `sent` would hide that
    // from the only screen where a human would notice.
    if (res && typeof res === "object" && "error" in res && res.error) {
      return await fail(
        `Resend rejected the message: ${JSON.stringify(res.error).slice(0, 400)}`
      );
    }

    return "sent";
  } catch (err) {
    return await fail(err instanceof Error ? err.message : String(err));
  }
}

/* ------------------------------------------------------------------ */
/*  The drain                                                          */
/* ------------------------------------------------------------------ */

export type DrainReport = {
  due: number;
  sent: number;
  failed: number;
  skipped: number;
};

/**
 * Deliver every job whose time has come. Called by `/api/cron/automation` and
 * by the "Run due jobs now" button in the admin.
 *
 * Jobs are delivered **one at a time, oldest first**. That is not laziness:
 * `DATABASE_URL` carries `connection_limit=5` (see CLAUDE.md), and fanning a
 * batch out with `Promise.all` is exactly the pattern that exhausted the pool
 * and produced the P2024 outage this project already had once.
 *
 * `take` bounds the pass so a backlog cannot outrun the function's time budget;
 * whatever is left is picked up on the next run.
 */
export async function drainDueJobs(limit = 50): Promise<DrainReport> {
  const report: DrainReport = { due: 0, sent: 0, failed: 0, skipped: 0 };
  try {
    const due = await prisma.automationJob.findMany({
      where: { status: "pending", runAt: { lte: new Date() } },
      orderBy: { runAt: "asc" },
      take: limit,
      select: { id: true },
    });
    report.due = due.length;

    for (const { id } of due) {
      const result = await deliverJob(id);
      if (result === "sent") report.sent += 1;
      else if (result === "failed") report.failed += 1;
      else report.skipped += 1;
    }
  } catch (err) {
    console.error("[automation] drain failed:", err);
  }
  return report;
}

/** How many jobs are waiting, and how many of those are already due. */
export async function jobBacklog(): Promise<{ pending: number; due: number }> {
  const [pending, due] = await Promise.all([
    prisma.automationJob.count({ where: { status: "pending" } }),
    prisma.automationJob.count({
      where: { status: "pending", runAt: { lte: new Date() } },
    }),
  ]);
  return { pending, due };
}
