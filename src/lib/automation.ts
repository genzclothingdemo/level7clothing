import "server-only";

/**
 * The automation engine — **and, since the hardcoded senders were retired, the
 * single source of truth for outbound email.**
 *
 * One sentence defines the whole feature: **when TRIGGER happens, and
 * CONDITIONS match, after DELAY, do ACTION.** Everything here serves that
 * sentence and nothing else.
 *
 * ## What "single source of truth" bought
 *
 * There used to be two senders for the same events. `sendOrderEmails`,
 * `sendOrderStatusEmail` and `sendLeadEmail` composed fixed HTML in
 * `lib/email.ts` and fired from checkout, the admin and the courier webhook —
 * *while* rules on the same triggers sat in the database. The rules had to ship
 * switched off, because switching them on sent everything twice, and a store
 * owner looking at Admin → Automation was reading a list that did not describe
 * what their store actually emailed.
 *
 * All three are gone. Every message the store sends on an event is now a row in
 * {@link SYSTEM_RULES}, pointing at an editable template, and switching the
 * alert off genuinely stops the mail — including jobs already queued, which
 * `deliverJob` re-checks at the moment of sending. The three exceptions — the
 * one-time code, the password reset and the contact form — are `ALWAYS_SENT`
 * in `lib/notification-channels.ts`, and Settings → Alerts shows them as
 * read-only rows so that screen is the whole picture.
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
 * ### The same index also does the *batching*
 *
 * `chat.message_received` / `chat.reply_sent` arrived on 2026-09-26 and are the
 * first subject here that is not a row moving through states — a conversation
 * is a stream, and somebody typing five messages in a minute must not produce
 * five banners.
 *
 * Nothing new was built for that. The dedupe key became
 * `<threadId>:<burstAnchor>` ({@link chatBurst}), so the five enqueues collapse
 * to one at the same unique index that stops an order emailing twice, and the
 * next message an hour later gets its own. **There is no debounce, no
 * `lastNotifiedAt` column and no second pass** — which matters, because a
 * serverless function cannot hold a timer and the cron that would otherwise do
 * the collapsing runs every 15–60 minutes, far too late for a chat.
 *
 * **Every send goes through a claimed job row, including `delayMinutes: 0`.**
 * An inline rule enqueues with `runAt = now` and then drains that single job
 * through the same claim. There is no second, unprotected code path, so the
 * guarantee above covers inline sends too — calling
 * `runAutomationTrigger("order.created", …)` twice for one order sends once.
 *
 * ## `action` is open on purpose — and now carries two channels
 *
 * `AutomationRule.action` is a free string defaulting to `"email"`. A rule
 * whose action this build does not implement is skipped and logged, never
 * executed as email — so a channel can be added with no migration and no risk
 * that an unbuilt one silently mails somebody.
 *
 * `"push"` was added that way on 2026-09-26, and the shape of the addition is
 * the point: **it is a second action on this engine, not a second engine.** A
 * push rule is enqueued by the same {@link runAutomationTrigger}, keyed by the
 * same {@link dedupeKeyFor}, held off by the same `occurredAt` guard, delayed
 * through the same `AutomationJob`, and claimed by the same compare-and-set in
 * {@link deliverJob} before anything leaves. Everything the header above
 * promises about an email is therefore true of a notification, including the
 * one that matters most: **calling a trigger twice for one occurrence sends
 * once.** A duplicate push is worse than a missing one — it arrives on a
 * lock screen at two in the morning.
 *
 * Only the last step differs. `deliverJob` branches on `rule.action`, and
 * everything push-shaped — who has a device, what fits in a banner, what
 * counts as a failure — lives in `lib/push-dispatch.ts` so that adding it
 * could not change how email behaves.
 *
 * ## One writer for the rules themselves — {@link setAlert}
 *
 * Everything above stops **one rule** sending twice for one event. It says
 * nothing about **two rules** for one event, and that is the duplicate the
 * owner actually described: tick "order shipped → email → customer" on
 * Settings → Alerts, build the same thing again on Admin → Automation, switch
 * both on, and the customer gets two emails — each rule deduped perfectly
 * against itself.
 *
 * So there is exactly one function that can insert an `AutomationRule` or
 * change its `isActive`, and it is keyed by the alert's **signature**
 * (`alertSignature` in `lib/notification-channels.ts` — trigger, recipient,
 * channel and case-folded conditions; the header there says why each column
 * is in or out). It holds three invariants, in one transaction, under a
 * Postgres advisory lock on the alert's group so two tabs or a tab and the
 * sync cannot interleave:
 *
 * 1. **Never a second row for a signature.** An existing row is found and
 *    returned; nothing is created beside it.
 * 2. **Never two switched-on rules that can match one event** on one channel
 *    for one person — `{}` ("any status") beside `{status: shipped}` is two
 *    signatures and one shipped order. Switching one on while the other is on
 *    is refused and names the other rule.
 * 3. **Never a new alert the store does not ship.** A row is created only for
 *    an event in {@link SYSTEM_RULES}; the rule editor that could invent one
 *    is gone, and so are its server actions.
 *
 * Its two callers are the Alerts grid and {@link syncSystemAutomation}, and
 * the sync is the grid's create-only twin: it creates what is missing, never
 * flips an existing row's switch, and matches by signature rather than by
 * name — the name match is how renaming a shipped rule used to make the next
 * restore put a second copy beside it.
 */

import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { sendAutomationEmail, type EmailContext } from "@/lib/email";
import { absoluteUrl } from "@/lib/site-url";
import { formatINR } from "@/lib/utils";
import { SYSTEM_TEMPLATES } from "@/lib/email-templates";
import { dispatchAutomationPush, isPushRecipient, pushCopyFrom } from "@/lib/push-dispatch";
// Pure modules, shared with the browser. The alert identity helpers live in
// `notification-channels` so the grid's cells and this writer are keyed by the
// same function; the stock vocabulary lives in `inventory-types` so a
// low-stock alert agrees exactly with what the inventory screen shows.
import {
  ALWAYS_SENT,
  alertGroupOf,
  alertSignature,
  channelLabel,
  composeFallbackLabel,
  conditionsOverlap,
  eventLabel,
  normaliseRecipient,
  type AlertIdentity,
} from "@/lib/notification-channels";
import { STOCK_STATE_META, stockStateOf, type StockState } from "@/lib/inventory-types";
// The courier table, read for its third column. `Order.deliveryStatus` holds
// the courier's raw words, so the phase is recoverable from the row at send
// time — which is why no call site has to remember to pass it. See the note in
// `resolveSubject`.
import { courierPhase, rtoStage, type RtoStage } from "@/lib/nimbus-status";
import type { Prisma } from "@prisma/client";

/* ------------------------------------------------------------------ */
/*  Triggers, conditions and tokens — the catalogue                    */
/* ------------------------------------------------------------------ */

export const TRIGGER_KEYS = [
  "order.created",
  "order.status_changed",
  // `Order.paymentStatus` is a **separate column** from `Order.status`, and
  // nothing used to raise anything when it moved. A signature that fails to
  // verify wrote `failed` and told nobody — the one customer in the store who
  // definitely wanted to buy, and could not.
  "order.payment_changed",
  // A parcel coming back is not a status. See the spec below for why it is a
  // trigger of its own rather than a condition on `order.status_changed`.
  "order.rto",
  "cart.abandoned",
  "return.requested",
  "return.status_changed",
  "chat.message_received",
  "chat.reply_sent",
  // The first trigger that is about the shop's own shelf rather than a
  // customer. Raised by a sweep, like the reverse-leg returns — see
  // `sweepLowStock` for why, and `dedupeKeyFor` for "once per dip".
  "inventory.low_stock",
] as const;

export type TriggerKey = (typeof TRIGGER_KEYS)[number];

/** What kind of row a job is about. Narrower than a string so the drain can switch. */
export type SubjectType = "order" | "lead" | "return" | "chat" | "variant";

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
  // Added for the owner's own copy of the order mail, which used to be a
  // hardcoded HTML table in lib/email.ts. Without these the rule that replaced
  // it could not say where the parcel is going.
  { token: "customer.phone", describes: "Their mobile number" },
  { token: "order.address", describes: "The full delivery address, on one line" },
  { token: "order.note", describes: "What the customer typed at checkout, if anything" },
  // The money columns, which nothing offered before. `order.total` alone
  // cannot describe a part-paid order at all: it is one number where there are
  // three (what was charged online, what is still to be collected, and the sum
  // of the two), and a template that can only quote the sum has to *guess* at
  // the other two in prose. Blank rather than ₹0 when there is nothing to
  // report — same rule as `return.refundAmount`, for the same reason.
  { token: "order.paymentStatus", describes: "pending / paid / partial / failed" },
  { token: "order.amountPaid", describes: "Formatted — what has actually been taken online" },
  {
    token: "order.balanceDue",
    describes: "Formatted — what is still to be collected in cash. Blank when nothing is",
  },
];

/**
 * Tokens for the money column moving, on its own.
 *
 * `payment.attempted` is the one that makes a failed-payment message truthful.
 * The gateway is not always asked for `order.total`: on a **partial** order it
 * is asked for the advance and the rest was always going to be cash at the
 * door, so a mail saying "your payment of {{order.total}} failed" would quote a
 * figure the customer was never charged. It is `total − balanceDue`, which is
 * the same expression `verifyRazorpayPayment` uses to record `amountPaid` on
 * the way up — one arithmetic, both directions.
 */
const PAYMENT_TOKENS: TokenSpec[] = [
  {
    token: "payment.attempted",
    describes: "Formatted — what the gateway was asked for. The advance on a part-paid order",
  },
  {
    token: "payment.previousStatus",
    describes: "What the payment status was before this change",
  },
];

/**
 * Tokens for a parcel that failed to deliver and is travelling back to us.
 *
 * `rto.stage` is the same value the rule conditions on, offered as a token so a
 * single template *can* cover both stages if an owner would rather write one.
 * The shipped rules do not — see {@link SYSTEM_RULES}.
 */
const RTO_TOKENS: TokenSpec[] = [
  { token: "rto.stage", describes: "returning (on its way back) / returned (back with you)" },
  { token: "rto.scan", describes: "The courier's own words for this scan" },
  { token: "rto.location", describes: "Where it was last seen — blank if the courier didn't say" },
];

/**
 * Tokens for the parcel travelling the other way.
 *
 * `return.courier` / `return.trackingNumber` read `nimbusCourier` / `nimbusAwb`
 * — the **reverse** shipment's columns, not the order's. Quoting the forward
 * AWB in a pickup email would send the customer to track the parcel they
 * already have.
 */
const RETURN_TOKENS: TokenSpec[] = [
  { token: "return.number", describes: "e.g. RET-8821" },
  { token: "return.reason", describes: "Why they are returning it" },
  { token: "return.status", describes: "pending / approved / picked_up / …" },
  { token: "return.productName", describes: "The piece being returned" },
  { token: "return.quantity", describes: "How many" },
  { token: "return.refundAmount", describes: "Formatted — blank until a figure is agreed" },
  { token: "return.note", describes: "Your decision note to the customer, if you left one" },
  { token: "return.courier", describes: "Pickup courier — blank until booked" },
  { token: "return.trackingNumber", describes: "Reverse AWB — blank until booked" },
  { token: "order.number", describes: "The order it came from" },
  { token: "order.url", describes: "Link to their order page" },
  // `resolveSubject` has always populated this for a return (it reads
  // `order.phone`), but the catalogue did not offer it — so the owner's own
  // "a return was requested" template used `{{customer.phone}}` while the
  // token list beside the editor said no such token existed. It rendered
  // correctly and looked like a typo, which is the worst way round: an owner
  // tidying up a "mistake" would have deleted a line that worked.
  { token: "customer.phone", describes: "Their mobile number" },
];

/**
 * Tokens for a conversation, in either direction.
 *
 * `chat.url` is **not** direction-agnostic, and that is the interesting one. A
 * conversation has two ends: the owner reads it at `/admin/messages`, the
 * customer reads it in the widget on the storefront. So each of the two chat
 * triggers resolves this token to its own end — see `resolveSubject`, which
 * takes the direction from `context`. One token, two correct answers, decided
 * by which trigger is firing rather than by who happens to be reading.
 */
const CHAT_TOKENS: TokenSpec[] = [
  { token: "chat.message", describes: "What was just written" },
  { token: "chat.unread", describes: "How many messages are waiting unread" },
  { token: "chat.url", describes: "Link to the conversation, for whoever is being told" },
  { token: "customer.phone", describes: "Their mobile, if the conversation has one" },
];

/**
 * Tokens for one sellable size running low — the `inventory-low-stock`
 * template's whole vocabulary.
 *
 * There is no customer in this event, so `customer.*` is deliberately absent:
 * a stock alert that could render "Hi ," would be a template bug waiting for
 * somebody to copy an order mail. `inventory.state` is the same label the
 * inventory screen prints (`STOCK_STATE_META`), so the alert and the screen
 * say the same word for the same shelf.
 */
const STOCK_TOKENS: TokenSpec[] = [
  { token: "store.name", describes: "Your brand name" },
  { token: "store.url", describes: "The storefront address" },
  { token: "inventory.productName", describes: "e.g. Samurai Oversized Tee" },
  { token: "inventory.variant", describes: "The size, e.g. Size: M — blank for a one-size product" },
  { token: "inventory.sku", describes: "e.g. L7-SAMURAI-M" },
  { token: "inventory.state", describes: "Low stock / Out of stock / Oversold" },
  { token: "inventory.available", describes: "What can still be sold" },
  { token: "inventory.onHand", describes: "Physically on the shelf" },
  { token: "inventory.reserved", describes: "Promised to orders that have not shipped" },
  { token: "inventory.threshold", describes: "The low-stock line this size is measured against" },
  { token: "inventory.url", describes: "Link to the product in your admin" },
];

const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "shipped",
  "delivered",
  "cancelled",
];

/**
 * The reverse-leg statuses a rule may react to.
 *
 * **`pending` is deliberately absent.** A return is `pending` the moment it is
 * raised, and that moment already has a trigger of its own
 * (`return.requested`). Offering it here too would let an owner build two rules
 * that both fire on one event — the exact duplication this whole engine exists
 * to prevent — and nothing on screen would say so. The sweep that feeds this
 * trigger skips `pending` rows for the same reason.
 */
const REVERSE_STATUSES: { value: string; label: string }[] = [
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "picked_up", label: "Picked up by the courier" },
  { value: "received", label: "Back with you" },
  { value: "refunded", label: "Refunded" },
  { value: "cancelled", label: "Cancelled" },
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
  /* ---- The money column, which moves independently of the status ---- */
  //
  // **Why this is a second trigger and not a status.** `Order.status` and
  // `Order.paymentStatus` are separate columns that move separately and mean
  // different things: an order can be `pending` with the money in
  // (`paid`, waiting for a human to confirm it) or `confirmed` with the money
  // still out (a COD parcel on a van). Folding a failed payment into
  // `order.status_changed` would need a status value there is no column for —
  // exactly the trap CLAUDE.md records for RTO — and every rule already written
  // against "the status changed" would start seeing events that are not status
  // changes.
  //
  // **Why it fires on success too, when nothing is shipped to listen.** The
  // trigger is "the money column moved", and a trigger that only reports half
  // of a column's movements is a trigger somebody will eventually be surprised
  // by. The *rules* are where the judgement lives, and there is deliberately no
  // shipped rule for `paid` or `partial` — see the note on the failure rules in
  // `SYSTEM_RULES` for why a success mail here would be a duplicate of the
  // order receipt rather than an addition to it.
  {
    key: "order.payment_changed",
    label: "An order's payment succeeds or fails",
    blurb:
      "The money column, which moves on its own — a card that was declined, an advance that landed. A failed payment is the one event where the customer wanted to buy and could not.",
    subjectType: "order",
    firesFrom: "the Razorpay verification action, on both the success and the failure path",
    conditions: [
      {
        key: "paymentStatus",
        label: "Only when the payment is",
        options: [
          { value: "", label: "Any payment result" },
          { value: "failed", label: "Failed" },
          { value: "paid", label: "Paid in full" },
          { value: "partial", label: "Advance received" },
        ],
      },
      // The same field `order.created` offers, with the same values, because a
      // failed prepaid payment and a failed advance are not the same story and
      // a rule has to be able to tell them apart. COD is absent from the list
      // on purpose: a cash order never takes an online payment, so there is no
      // payment of its own to succeed or fail.
      {
        key: "paymentMethod",
        label: "And only for payment method",
        options: [
          { value: "", label: "Any payment method" },
          { value: "Razorpay", label: "Paid online (prepaid)" },
          { value: "Partial", label: "Part-paid (advance online)" },
        ],
      },
    ],
    tokens: [...COMMON_TOKENS, ...ORDER_TOKENS, ...PAYMENT_TOKENS],
  },
  /* ---- The parcel that failed to deliver and is coming home ---- */
  //
  // **Why RTO is a trigger and not a condition.** `mapNimbusStatus` sends
  // `rto delivered` to the order status `cancelled`, and `OrderStatus` has no
  // `rto` member (adding one ripples through every screen that switches on
  // status, which is out of scope). So the shipped rule
  // "Tell the customer their order was cancelled" — `{ status: "cancelled" }` —
  // matches an RTO perfectly, and emails somebody the word *cancelled* for an
  // order they did not cancel.
  //
  // A `phase` condition on `order.status_changed` does not fix that. It would
  // let a *new* rule say "only RTO", but it cannot stop the **existing** rule
  // matching, because `conditionsMatch` is equality and that rule's conditions
  // say nothing about the phase. Narrowing it would mean editing a live rule
  // row, and `syncSystemAutomation` is additive by design — it never rewrites
  // what the owner has.
  //
  // Making RTO its own trigger moves the decision to the *call site*, where it
  // belongs: `notifyCourierScan` in `lib/fulfilment.ts` reads the phase off the
  // scan and raises this instead of `order.status_changed`. One courier event
  // raises one trigger, so the cancellation rule keeps firing for real
  // cancellations and stops firing for parcels coming home — with nothing
  // edited, nothing migrated and no negative conditions added to the engine.
  {
    key: "order.rto",
    label: "A parcel is coming back to you (RTO)",
    blurb:
      "Delivery failed or was refused, so the courier is carrying the parcel back. The customer did not cancel anything, and goods — and possibly a refund — are in motion.",
    subjectType: "order",
    firesFrom: "the courier scan handler shared by the NimbusPost webhook and the tracking poller",
    conditions: [
      {
        key: "stage",
        label: "Only when the parcel is",
        options: [
          { value: "", label: "Either stage" },
          { value: "returning", label: "On its way back to you" },
          { value: "returned", label: "Back with you" },
        ],
      },
    ],
    tokens: [...COMMON_TOKENS, ...ORDER_TOKENS, ...RTO_TOKENS],
  },
  {
    key: "cart.abandoned",
    label: "Something goes into a cart",
    blurb:
      "Fires the moment it happens. Wait 0 minutes and it tells you straight away; wait a day and it becomes an abandoned-cart nudge — and it cancels itself if they buy in the meantime.",
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
      { token: "customer.phone", describes: "Their mobile, if they gave one" },
    ],
  },
  {
    key: "return.requested",
    label: "A return is requested",
    blurb:
      "A customer has asked to send something back. This is the moment it is raised — everything after it is the trigger below.",
    subjectType: "return",
    firesFrom: "the customer-facing return request action",
    // No conditions: a return is always `pending` at the instant it is raised,
    // so a status filter here could only ever say "pending" or never match.
    // The statuses that follow belong to `return.status_changed`.
    conditions: [],
    tokens: [...COMMON_TOKENS, ...RETURN_TOKENS],
  },
  {
    key: "return.status_changed",
    label: "A return moves along",
    blurb:
      "Approved, collected, back with you, refunded — the parcel travelling the other way. Pick one, or react to all.",
    subjectType: "return",
    firesFrom:
      "the admin return actions, and a sweep in the automation pass for courier-driven pickups",
    conditions: [
      {
        key: "status",
        label: "Only when the return is",
        options: [{ value: "", label: "Any change" }, ...REVERSE_STATUSES],
      },
    ],
    tokens: [
      ...COMMON_TOKENS,
      ...RETURN_TOKENS,
      { token: "return.previousStatus", describes: "What it was before this change" },
    ],
  },
  /* ---- Chat: the one event that is not about an order ---- */
  //
  // Neither of these has a condition, for the same reason `return.requested`
  // has none: a chat message has no sub-kinds worth filtering on. The *burst*
  // rule that stops five messages becoming five banners is not a condition
  // either — it is the dedupe key, see `dedupeKeyFor`.
  {
    key: "chat.message_received",
    label: "A customer writes in chat",
    blurb:
      "Somebody is waiting for you. A run of messages is one event, not five — you are told once, and again only if they come back after a quiet spell or after you have read them.",
    subjectType: "chat",
    firesFrom: "the customer's chat send route, once the message row exists",
    conditions: [],
    tokens: [...COMMON_TOKENS, ...CHAT_TOKENS],
  },
  {
    key: "chat.reply_sent",
    label: "You reply in chat",
    blurb:
      "Tells the customer you have written back. This is the one that matters when they have closed the tab — the chat panel polls, so it can only reach a browser that is still open.",
    subjectType: "chat",
    firesFrom: "the admin chat reply route, once the message row exists",
    conditions: [],
    tokens: [...COMMON_TOKENS, ...CHAT_TOKENS],
  },
  /* ---- The shelf ---- */
  //
  // **"Low" is `stockStateOf()`, not a second definition.** The inventory
  // screen and the storefront read that one function against
  // `ProductVariant.lowStockAt ?? SiteSettings.lowStockThreshold`, and so does
  // this — an alert that disagreed with the screen it links to would be the
  // two-homes problem in a new costume. Low, out and oversold are all "at or
  // under the line", and one dip is one alert whichever of them it reaches.
  //
  // No conditions, for the reason chat has none: the shipped alert is "tell me
  // when a size needs restocking", and a size that sold out is the most urgent
  // form of that, not a different event.
  {
    key: "inventory.low_stock",
    label: "A size runs low on stock",
    blurb:
      "A tracked size drops to its low-stock line or sells out. Once per dip: it does not repeat on every sale, and it comes back only after the size is restocked above the line and falls again.",
    subjectType: "variant",
    firesFrom:
      "the automation pass, which checks every tracked size of an active product against its low-stock line",
    conditions: [],
    tokens: STOCK_TOKENS,
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

/**
 * The channels this build can actually carry out. See the file header on why
 * the column behind it is an open string.
 *
 * Adding `"push"` here is what switches it on: the zod schema in
 * `actions/automation.ts` refines against this list, and {@link deliverJob}
 * cancels any job whose action is not in it. Both read the same constant, so a
 * channel cannot be saveable and unsendable, or sendable and unsaveable.
 */
export const IMPLEMENTED_ACTIONS = ["email", "push", "inapp"] as const;

export type ActionKey = (typeof IMPLEMENTED_ACTIONS)[number];

export function isActionKey(v: unknown): v is ActionKey {
  return (IMPLEMENTED_ACTIONS as readonly unknown[]).includes(v);
}

/**
 * What each channel is, in the owner's words.
 *
 * `caveat` is not decoration. Push has a real precondition that email does not
 * — the customer must have installed the store to their home screen (the only
 * way iOS delivers web push at all) and allowed notifications — and an owner
 * who builds a push rule without being told that will read "0 sent" as a bug.
 * The rule editor prints this line beside the choice.
 */
export type ActionSpec = {
  key: ActionKey;
  /** "Send an email" — the verb phrase, for a picker. */
  label: string;
  /** One word for a table cell. */
  short: string;
  /** The verb used in the rule's one-sentence summary. */
  verb: string;
  caveat: string;
};

export const ACTIONS: ActionSpec[] = [
  {
    key: "email",
    label: "Send an email",
    short: "Email",
    verb: "email",
    caveat:
      "Reaches anyone who left an address — the only channel that works for a first-time guest.",
  },
  {
    key: "push",
    label: "Send a notification",
    short: "Push",
    verb: "notify",
    caveat:
      "Only reaches a customer who installed the store to their phone's home screen and allowed notifications, while signed in. Most won't have — those jobs are skipped with a reason, not failed.",
  },
  {
    key: "inapp",
    label: "Show it in the notification bell",
    short: "In-app",
    verb: "show",
    caveat:
      "Always works and never interrupts anybody — it waits in the bell until they look. No install, no permission, no email address needed. The one channel that cannot fail, which is why the shipped rules for it are switched on.",
  },
];

export function actionSpec(action: string): ActionSpec | null {
  return ACTIONS.find((a) => a.key === action) ?? null;
}

export function actionLabel(action: string): string {
  return actionSpec(action)?.label ?? action;
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

/**
 * Drop the template lines that would render as a broken-looking label, or as
 * a fact the email is about to print properly anyway.
 *
 * **This has to run before substitution**, which is the whole point of it
 * existing here rather than in `lib/email.ts`. Once tokens are replaced,
 * `Courier: {{order.courier}}` with no courier and the prose line
 * `Track it here:` are byte-for-byte the same string — a label and nothing
 * else — so nothing downstream can drop the first without also eating the
 * second and stranding the URL it introduced. Before substitution the
 * difference is plain: one of them has a token on it.
 *
 * Only a line shaped exactly `Label: {{one.token}}` is ever considered, and
 * that gate is what makes this safe. Ordinary prose never matches it, so no
 * sentence an owner writes can be silently deleted.
 *
 * Two things are dropped:
 *
 * 1. **The token is empty.** `Courier:` on its own is the "blank token renders
 *    as an empty label" failure the brief names, and it was live in four
 *    shipped templates — every one of them sent at a moment when the courier
 *    is by definition not known yet.
 * 2. **The value is already in the `facts` table.** The structured half of the
 *    email prints courier, AWB and total as proper rows, so leaving the
 *    template's own copy in prints each of them twice, a few centimetres
 *    apart. Matched on the *value*, not the label, because the template says
 *    "Total:" where the table says "Order total".
 *
 * A third shape is handled alongside them: an **introducer whose value is on
 * the next line** ("Track it here:" followed by `{{order.trackingUrl}}`).
 * When that token is empty the pair is dropped together, because a promise
 * with nothing under it is the same broken look as a label with nothing after
 * it. This is the case that cannot be spotted after substitution at all — by
 * then the introducer is indistinguishable from a real sentence — and it is
 * why the whole function runs where it does.
 */
export function pruneFactLines(
  body: string,
  tokens: TokenBag,
  facts: { value: string }[]
): string {
  const printed = new Set(facts.map((f) => f.value.trim()).filter(Boolean));
  /** `Courier: {{order.courier}}` — a label and its value on one line. */
  const FACT = /^\s*([^:{}]{1,40}):\s*\{\{\s*([\w.]+)\s*\}\}\s*$/;
  /** `Track it here:` — a label with no token, introducing the line below. */
  const INTRO = /^\s*[^{}]{1,60}:\s*$/;
  /** `{{order.trackingUrl}}` — a line that is nothing but one token. */
  const LONE = /^\s*\{\{\s*([\w.]+)\s*\}\}\s*$/;

  const lines = body.split("\n");
  const keep = lines.map((line) => {
    const m = line.match(FACT);
    if (!m) return true;
    const value = (tokens[m[2]] ?? "").trim();
    // Empty ⇒ it would render as a bare label. Already in the table ⇒ it
    // would render twice.
    return Boolean(value) && !printed.has(value);
  });

  // An introducer and the empty token it introduces go together.
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (!keep[i] || !INTRO.test(lines[i])) continue;
    const next = lines[i + 1].match(LONE);
    if (next && !(tokens[next[1]] ?? "").trim()) {
      keep[i] = false;
      keep[i + 1] = false;
    }
  }

  return lines
    .filter((_, i) => keep[i])
    .join("\n")
    // Pruning can leave three blank lines where two paragraphs met.
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  "customer.phone": "+91 98200 11223",
  "order.address": "12 Turner Road, Bandra West, Mumbai, Maharashtra - 400050",
  "order.note": "Please leave it with the security desk.",
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
  // A part-paid sample, because that is the case a preview has to expose: the
  // three money tokens are only ever *different numbers* on a partial order, so
  // a prepaid sample would let a template that confuses them look correct.
  "order.paymentStatus": "partial",
  "order.amountPaid": "₹720",
  "order.balanceDue": "₹1,679",
  "payment.attempted": "₹720",
  "payment.previousStatus": "pending",
  "rto.stage": "returning",
  "rto.scan": "RTO In Transit",
  "rto.location": "Bhiwandi",
  "cart.productName": "Oversized Tee — Black",
  "cart.quantity": "1",
  "cart.price": "₹1,299",
  "cart.url": "https://clothingdemoshop.vercel.app/shop",
  "return.number": "RET-8821",
  "return.reason": "Size didn't fit",
  "return.status": "approved",
  "return.previousStatus": "pending",
  "return.productName": "Fleece Hoodie — Stone",
  "return.quantity": "1",
  "return.refundAmount": "₹1,199",
  "return.note": "Approved — we'll send a courier to collect it.",
  "return.courier": "Delhivery",
  "return.trackingNumber": "9876543210987",
  "chat.message": "Hi — is the stone hoodie coming back in a medium?",
  "chat.unread": "2",
  "chat.url": "https://clothingdemoshop.vercel.app/admin/messages",
  // A size two short of the line with one promised to an order — the case a
  // preview has to show, because it is the only one where available, on-hand
  // and reserved are three different numbers.
  "inventory.productName": "Samurai Oversized Tee",
  "inventory.variant": "Size: M",
  "inventory.sku": "L7-SAMURAI-M",
  "inventory.state": "Low stock",
  "inventory.available": "3",
  "inventory.onHand": "4",
  "inventory.reserved": "1",
  "inventory.threshold": "5",
  "inventory.url": "https://clothingdemoshop.vercel.app/admin/inventory",
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

type OrderItem = {
  name?: string;
  quantity?: number;
  image?: string | null;
  price?: number;
  options?: { name?: string; value?: string }[];
};

/** Prisma's `Json` comes back as `unknown`; an order's items are read defensively. */
function itemLines(items: unknown): { count: number; lines: string } {
  const list: OrderItem[] = Array.isArray(items) ? (items as OrderItem[]) : [];
  const count = list.reduce((n, i) => n + (Number(i?.quantity) || 0), 0);
  const lines = list
    .map((i) => `${i?.name ?? "Item"} × ${Number(i?.quantity) || 1}`)
    .join("\n");
  return { count, lines };
}

/**
 * The same items again, as cards for the email.
 *
 * **Every image is made absolute.** `Order.items[].image` is stored as
 * `/products/level7/…`, which resolves fine in a browser on this origin and
 * resolves to nothing at all in an inbox — a mail client has no origin to be
 * relative to, so a relative `src` is a broken image in every single client.
 * This is the kind of thing that looks right in every preview and is wrong for
 * every actual recipient, so it is done here, once, rather than in a template.
 *
 * Capped at four. A basket of twelve pieces becomes a scroll nobody finishes,
 * and the order page the button leads to is the right place for the full list.
 */
function itemCards(items: unknown): NonNullable<EmailContext["items"]> {
  const list: OrderItem[] = Array.isArray(items) ? (items as OrderItem[]) : [];
  return list.slice(0, 4).map((item) => ({
    name: item?.name ?? "Item",
    image: item?.image ? absoluteUrl(item.image) : null,
    quantity: Number(item?.quantity) || 1,
    price: typeof item?.price === "number" ? formatINR(item.price) : undefined,
    options: Array.isArray(item?.options)
      ? item.options
          .map((o) => [o?.name, o?.value].filter(Boolean).join(": "))
          .filter(Boolean)
          .join(" · ") || undefined
      : undefined,
  }));
}

/**
 * The heading and the button for an order email, chosen by what just happened.
 *
 * **This is the "accurate expectation-setting" half of the brief**, and it is
 * the one part of a status mail that must not be a template: a customer
 * reading "we'll let you know when it ships" *after* it has shipped has been
 * told something false by a store that knew better. So the sentence under the
 * button is derived from the row, every time.
 *
 * The button follows the same rule. Before an AWB exists there is nothing to
 * track and a "Track" button would open a courier page saying the number does
 * not exist, so it says "View order" until the parcel is real.
 *
 * ### The event decides, not only the status
 *
 * A brand-new cash-on-delivery order is `pending`, and so is an order an admin
 * sent *back* to pending. The status column cannot tell them apart, and this
 * function used to be given nothing else — so the receipt for every COD order
 * (and the owner's own new-order mail) headlined "We're taking another look at
 * your order. Nothing is wrong on your side", a sentence written for a reopen.
 * `event` is the trigger that fired, carried in the job's payload, and
 * `order.created` now has a branch of its own whose note is derived from how
 * the order is being paid for — the one thing a new customer wants confirmed.
 */
function orderHeadline(order: {
  /** The trigger this message is for, e.g. `order.created`. */
  event: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  total: number;
  amountPaid: number;
  balanceDue: number;
  hasTracking: boolean;
  /** Non-null ⇒ the courier is carrying this parcel back to us. */
  rto: RtoStage | null;
}): { headline: string; cta: string; note?: string } {
  const { status, hasTracking } = order;

  /* ---- Two readings that outrank the status column ---- */
  //
  // Both of these exist because `Order.status` is a five-value column that
  // cannot express what actually happened, and the structured half of the
  // email is the one part of a message that must never be a template. See the
  // function's own note: a customer told something false by a store that knew
  // better is the failure this whole shape exists to prevent.

  // 1. The parcel is coming home. A completed RTO is stored as `cancelled`,
  //    which would otherwise headline "Your order has been cancelled." to
  //    somebody who cancelled nothing and is owed their money.
  if (order.rto) {
    return order.rto === "returned"
      ? {
          headline: "Your parcel has come back to us.",
          cta: "View order",
          note: "It couldn't be delivered, so the courier returned it. Nothing was cancelled by you — if you paid online, your refund is the next thing we'll sort out.",
        }
      : {
          headline: "Your parcel is on its way back to us.",
          cta: "View order",
          note: "A delivery didn't succeed, so the courier is carrying it back. Nothing is lost and nothing was cancelled — reply to this email and we can send it out again.",
        };
  }

  // 2. The money did not arrive, and nothing has happened to the order since.
  //    Scoped to a still-`pending` order on purpose: if a human later confirms
  //    or ships it anyway, the ordinary wording is the true one again, and a
  //    shipped order must not headline "we couldn't take your payment".
  if (order.paymentStatus === "failed" && status === "pending") {
    return {
      headline: "We couldn't take your payment.",
      cta: "View order",
      note: "Nothing has been charged, and nothing is owed. Your order is being held, not confirmed — placing it again is the quickest fix.",
    };
  }

  // 3. The order has only just been placed. Whatever the status column says —
  //    `pending` for a COD order, `confirmed` if the store auto-confirms — this
  //    is a receipt, and what a receipt must get right is the money.
  if (order.event === "order.created") {
    const next = "Tracking details follow as soon as it ships.";
    const onlineNow = Math.max(0, order.amountPaid || order.total - order.balanceDue);
    const method = order.paymentMethod.trim().toLowerCase();
    const note =
      method === "cod"
        ? `Pay ${formatINR(order.balanceDue > 0 ? order.balanceDue : order.total)} in cash when it arrives. ${next}`
        : order.balanceDue > 0 && onlineNow > 0
          ? `${formatINR(onlineNow)} paid online; ${formatINR(order.balanceDue)} to pay in cash on delivery. ${next}`
          : order.paymentStatus === "paid"
            ? `Paid online, so there's nothing more to pay. ${next}`
            : next;
    return { headline: "Thanks — we've got your order.", cta: "View order", note };
  }

  switch (status) {
    case "confirmed":
      return {
        headline: "Your order is confirmed.",
        cta: "View order",
        note: "We're packing it now. You'll get tracking details the moment it leaves us.",
      };
    case "shipped":
      return {
        headline: "Your order is on its way.",
        cta: hasTracking ? "Track this parcel" : "View order",
        note: hasTracking
          ? "Tracking can take a few hours to show its first scan after a parcel is booked."
          : "Your courier details will appear on the order page shortly.",
      };
    case "delivered":
      return {
        headline: "Your order has been delivered.",
        cta: "View order",
        note: "Something not right? You can start a return from the order page.",
      };
    case "cancelled":
      return {
        headline: "Your order has been cancelled.",
        cta: "View order",
        note: "Anything already paid is refunded to the original payment method.",
      };
    case "pending":
      // Only a genuine move *back* to pending earns this sentence. Any other
      // event about a pending order — a payment landing, say — is an update,
      // not a reopen, and must not tell a new customer "nothing is wrong".
      return order.event === "order.status_changed"
        ? {
            headline: "We're taking another look at your order.",
            cta: "View order",
            note: "Nothing is wrong on your side, and nothing extra is owed.",
          }
        : { headline: "There's an update on your order.", cta: "View order" };
    default:
      return { headline: "There's an update on your order.", cta: "View order" };
  }
}

/**
 * The same, for the parcel travelling the other way.
 *
 * A return has its own vocabulary and its own anxieties — where is my piece,
 * and where is my money — so none of this borrows from the order wording.
 * CLAUDE.md records that reusing `sendOrderStatusEmail` for the reverse leg is
 * the wrong voice; this is what having a voice of its own looks like.
 */
function returnHeadline(status: string): { headline: string; cta: string; note?: string } {
  switch (status) {
    case "pending":
      return {
        headline: "We've got your return request.",
        cta: "View order",
        note: "We review returns within 24 hours. Keep the piece and its packaging as it is until you hear from us.",
      };
    case "approved":
      return {
        headline: "Your return is approved.",
        cta: "View order",
        note: "Pack the piece as you received it. If we've booked a pickup, the courier comes to you — you don't need to post anything.",
      };
    case "rejected":
      return {
        headline: "We couldn't accept this return.",
        cta: "View order",
        note: "If you think that's wrong, reply to this email — a person reads it.",
      };
    case "picked_up":
      return {
        headline: "Your return has been collected.",
        cta: "View order",
        note: "We'll email again when it reaches us. The refund follows from there.",
      };
    case "received":
      return {
        headline: "Your return is back with us.",
        cta: "View order",
        note: "We're checking it over now. Your refund is the next email you'll get from us.",
      };
    case "refunded":
      return {
        headline: "Your refund is on its way.",
        cta: "View order",
        note: "Banks usually take 3–5 working days to show it. If it hasn't landed in five, reply to this email.",
      };
    case "cancelled":
      return {
        headline: "Your return has been closed.",
        cta: "View order",
        note: "You keep the piece and nothing is owed either way.",
      };
    default:
      return { headline: "There's an update on your return.", cta: "View order" };
  }
}

function firstNameOf(full: string): string {
  return full.trim().split(/\s+/)[0] ?? "";
}

/**
 * A stored photo as an address a mail client can load. Photos are either a
 * site path (`/products/level7/…`) or an uploaded blob that is already
 * absolute, and `absoluteUrl` only understands the first.
 */
function absoluteMedia(src: string | null | undefined): string | null {
  const value = src?.trim();
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : absoluteUrl(value);
}

/* ------------------------------------------------------------------ */
/*  Chat bursts — how five messages stay one notification              */
/* ------------------------------------------------------------------ */

/**
 * How long a conversation has to go quiet before the next message counts as a
 * fresh approach rather than more of the same.
 *
 * Ten minutes, and the number matters less than the shape. Shorter and a
 * normal typing pause ("…and one more thing") becomes a second banner; much
 * longer and somebody who came back an hour later to ask again is met with
 * silence, which for the owner's side is the failure that matters.
 */
const CHAT_QUIET_WINDOW_MS = 10 * 60_000;

/**
 * How far back a burst is traced.
 *
 * A bound, not a policy. A run longer than this is treated as broken, so a
 * thirty-first message in one unbroken burst earns one more notification —
 * which, for a conversation nobody has read in thirty messages, is the right
 * way for the bound to fail.
 */
const CHAT_BURST_SCAN = 30;

type ChatBurstRow = {
  sender: string;
  status: string;
  body: string;
  attachmentName: string | null;
  createdAt: Date;
};

type ChatBurst = {
  /** The newest message from this side — what the notification is about. */
  head: ChatBurstRow;
  /** The oldest message of the run. Its timestamp *is* the dedupe key. */
  anchor: ChatBurstRow;
  /** How many messages the run holds. */
  size: number;
};

/**
 * **The batching rule, and the reason it needs no timer, no column and no
 * second pass.**
 *
 * The brief for a chat notification is "a five-message burst must not be five
 * banners", and the tempting shapes for that are all expensive: debounce it
 * (a serverless function has no timers — see the note on `AutomationJob`),
 * queue it and collapse at drain time (the cron runs every 15–60 minutes, and
 * a chat notification that late is worse than none), or store a
 * `lastNotifiedAt` (a column, and this change is not allowed to migrate).
 *
 * So the batching is expressed as the **dedupe key** instead, and the engine's
 * existing unique index does the work. `subjectId` becomes
 * `<threadId>:<burst anchor>`, where the anchor is the first message of the
 * run the newest message belongs to. Five messages in two minutes all resolve
 * to the same anchor, so the second through fifth enqueue lose at
 * `@@unique([ruleId, subjectType, subjectId])` exactly the way a repeated
 * order-shipped event does. Nothing is counted, nothing is compared, nothing
 * races.
 *
 * A run is broken by any of three things, and each answers a real case:
 *
 * - **The other side spoke.** A reply, then another message, is a new thing to
 *   be told about — not more of the last thing.
 * - **The recipient has read it** (`status === "seen"`, which only ever means
 *   *the other party* has read it — see `markSeen`). Having caught up is what
 *   makes the next message worth a banner again.
 * - **The conversation went quiet** for {@link CHAT_QUIET_WINDOW_MS}. This is
 *   the one that keeps the owner's side reliable: somebody who writes at ten
 *   and again at three gets through twice, even though nobody read the first.
 *
 * The window is **rolling**, measured against the current oldest of the run
 * rather than against its head. A steady drip stays one conversation, which is
 * the honest reading of it — the unread badge in the admin is what says how
 * much has piled up, and a notification is not a counter.
 *
 * `rows` must be newest-first.
 */
function chatBurst(rows: ChatBurstRow[], from: string): ChatBurst | null {
  const headIndex = rows.findIndex((m) => m.sender === from);
  if (headIndex === -1) return null;

  const head = rows[headIndex];
  let anchor = head;
  let size = 1;

  for (let i = headIndex + 1; i < rows.length; i += 1) {
    const older = rows[i];
    if (older.sender !== from) break;
    if (older.status === "seen") break;
    if (anchor.createdAt.getTime() - older.createdAt.getTime() > CHAT_QUIET_WINDOW_MS) break;
    anchor = older;
    size += 1;
  }

  return { head, anchor, size };
}

/** What a message says, in one line, for a subject or a banner. */
function chatPreview(row: ChatBurstRow): string {
  const text = row.body.replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 200);
  return row.attachmentName ? `Attachment: ${row.attachmentName}` : "(no text)";
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
  /**
   * The account behind this subject, or `null` for a guest.
   *
   * Email never needed it — an address is an address. A **notification needs an
   * account**, because `PushSubscription.userId` is the only link this schema
   * has between a person and a device. See `lib/push-dispatch.ts`.
   */
  customerUserId: string | null;
  /**
   * Where a notification about this subject should open, as a same-origin
   * path.
   *
   * Deliberately *not* derived from the `order.url` token: that one is absolute
   * (it has to be, an email cannot follow a relative link), and `lib/push.ts`
   * refuses an absolute URL in a payload so that nothing can turn a
   * notification into an open redirect out of somebody's tray.
   */
  deepLink: string;
  /**
   * Where `recipient: "admin"` should land instead, when that is somewhere
   * else entirely.
   *
   * A notification about an order sent to the *owner* used to open the
   * customer's own order page, which is the one screen on which the owner can
   * do nothing. A chat notification makes the split unavoidable rather than
   * merely untidy: the conversation genuinely has two ends, `/admin/messages`
   * and the widget on the storefront, and there is no address that serves
   * both. Absent, the customer link is used for everybody — which is right for
   * a cart lead, where the owner's screen is a list and not a thing.
   */
  adminDeepLink?: string;
  /**
   * Collapse key for a notification about this subject.
   *
   * Per *subject*, not per rule: two updates about one order should replace
   * each other on the lock screen, because the older one is stale the moment
   * the newer one is true. The service worker sets `renotify` alongside the
   * tag, so a replacement still alerts — see the long note in `public/sw.js`.
   */
  pushTag: string;
  /**
   * The structure an email gets on top of the owner's words — the item and its
   * photograph, the numbers, and the one button.
   *
   * Resolved here rather than composed in `lib/email.ts` for the same reason
   * the tokens are: this is the only function that has the row open. The words
   * stay the owner's and the structure stays the engine's, so a template edit
   * can change what a mail *says* but never leave it with an empty slot where
   * a product card should be.
   */
  emailContext: EmailContext;
  /** Condition inputs, matched case-insensitively against the rule. */
  facts: Record<string, string>;
  /** False ⇒ the job is no longer relevant and should be cancelled, not sent. */
  applies: boolean;
  /** Why it stopped applying, for the job's `error` column. */
  reason?: string;
  /**
   * False ⇒ there is nothing to be told about **right now**, so do not even
   * queue a job. Only a state-driven subject sets it: a size that is not low
   * has no dip to announce, and a cancelled job parked on a made-up dedupe key
   * would be a row that means nothing. Absent means true, which keeps every
   * event-driven trigger exactly as it was.
   */
  enqueue?: boolean;
};

async function resolveSubject(
  subjectType: SubjectType,
  entityId: string,
  context: Record<string, string>,
  /**
   * The trigger this is being resolved for. The engine has always stored it on
   * the job's payload; it is passed through now because a row's status alone
   * cannot say what just happened — see `orderHeadline`.
   */
  trigger: string
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

    /**
     * Where the parcel is, recovered from the order row rather than handed in
     * by whoever raised the trigger.
     *
     * **This is the one fact in this function that could plausibly have come
     * from `context`, and deliberately does not.** `Order.deliveryStatus` is
     * the courier's own words for the latest scan, written by both the webhook
     * and the poller *before* either raises a trigger, so the phase is already
     * here — and putting it in `context` as well would give one fact two homes
     * and two chances to disagree. Reading the row also means a call site added
     * next year gets the RTO wording right without knowing the feature exists,
     * and a *delayed* job resolves where the parcel is now rather than where it
     * was when the job was queued, which is the late resolution the rest of
     * this function already commits to.
     */
    const phase = courierPhase(order.deliveryStatus);
    const rto = rtoStage(order.deliveryStatus);

    // What the gateway was asked for. Not `order.total`: on a part-paid order
    // the advance is the only sum that was ever charged online, and the
    // balance was always going to be cash at the door.
    const attempted = Math.max(0, order.total - order.balanceDue);

    const shape = orderHeadline({
      event: trigger,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      total: order.total,
      amountPaid: order.amountPaid,
      balanceDue: order.balanceDue,
      hasTracking: Boolean(order.trackingNumber),
      rto,
    });
    // Nothing is collected at the door of an order that was delivered or
    // cancelled, so "to pay on delivery" stops being a fact at that point.
    const doorStillAhead = order.status !== "delivered" && order.status !== "cancelled";
    return {
      emailContext: {
        kicker: `Order ${order.orderNumber}`,
        headline: shape.headline,
        // The subject already summarises the event; the preheader's job is to
        // add the fact the subject had no room for.
        preheader: `${shape.headline} ${formatINR(order.total)} · ${count} item${count === 1 ? "" : "s"}`,
        items: itemCards(order.items),
        facts: [
          { label: "Order total", value: formatINR(order.total) },
          { label: "Payment", value: order.paymentMethod },
          // The advance, only on a part-paid order — the one case where it is
          // a different number from the total. "Advance", not "paid": on a
          // failed advance the same line has to stay true.
          ...(order.balanceDue > 0 && attempted > 0
            ? [{ label: "Advance (online)", value: formatINR(attempted) }]
            : []),
          // **What is still owed in cash**, for COD and for the rest of a
          // part-paid order. A COD customer used to be told only "Payment:
          // COD" and never the sum, and no template could add it:
          // `pruneFactLines` drops a line whose value is already in this table,
          // and for COD the balance *is* the order total. So the table says it.
          ...(order.balanceDue > 0 && doorStillAhead
            ? [{ label: "To pay on delivery", value: formatINR(order.balanceDue) }]
            : []),
          // Prepaid and settled: say so, rather than leave a gateway's name as
          // the only word on how it was paid for. Scoped to the online method,
          // because an admin can mark a *cash* order paid once it is collected.
          ...(order.paymentMethod.trim().toLowerCase() === "razorpay" &&
          order.paymentStatus === "paid" &&
          order.balanceDue <= 0
            ? [{ label: "Paid online", value: "In full" }]
            : []),
          ...(order.courier ? [{ label: "Courier", value: order.courier }] : []),
          ...(order.trackingNumber
            ? [{ label: "Tracking number", value: order.trackingNumber }]
            : []),
        ],
        cta: {
          label: shape.cta,
          // Track only when there is genuinely something to track.
          url:
            shape.cta === "Track this parcel" && order.trackingUrl
              ? order.trackingUrl
              : absoluteUrl(`/order/${order.orderNumber}`),
        },
        note: shape.note,
      },
      customerEmail: order.email,
      customerUserId: order.userId,
      deepLink: `/order/${order.orderNumber}`,
      // There is no `/admin/orders/[id]` route — the list is the screen. `?q=`
      // is its search, so the owner lands on this order's row rather than on
      // the top of the list.
      adminDeepLink: `/admin/orders?q=${encodeURIComponent(order.orderNumber)}`,
      pushTag: `l7-order-${order.orderNumber}`,
      facts: {
        status: order.status,
        paymentMethod: order.paymentMethod,
        // The money column, matched by `order.payment_changed`. It is a fact
        // about the row like any other, so a rule scoped to "only when the
        // payment failed" is re-checked at send time and cancels itself if the
        // customer succeeded during a delay.
        paymentStatus: order.paymentStatus,
        // Where the parcel is, for `order.rto`. `stage` is the condition key;
        // `phase` is offered beside it so a future rule can narrow on the
        // finer vocabulary without this needing to change again.
        stage: rto ?? "",
        phase: phase ?? "",
      },
      applies: true,
      tokens: {
        ...base,
        "customer.name": order.customerName,
        "customer.firstName": firstNameOf(order.customerName),
        "customer.email": order.email,
        "customer.phone": order.phone ?? "",
        "order.address": [
          order.address,
          order.city,
          `${order.state} - ${order.pincode}`,
        ]
          .map((part) => part?.trim())
          .filter(Boolean)
          .join(", "),
        "order.note": order.note ?? "",
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
        // Money, blank rather than ₹0 where zero is not a fact worth printing.
        // "Still to pay: ₹0" on a prepaid order reads as a bug; an absent line
        // is dropped whole by `pruneFactLines`.
        "order.paymentStatus": order.paymentStatus,
        "order.amountPaid": order.amountPaid > 0 ? formatINR(order.amountPaid) : "",
        "order.balanceDue": order.balanceDue > 0 ? formatINR(order.balanceDue) : "",
        "payment.attempted": attempted > 0 ? formatINR(attempted) : "",
        "payment.previousStatus": context.previousPaymentStatus ?? "",
        // The reverse journey. All three are blank for an ordinary parcel, so
        // a template that mentions them is self-pruning on every other trigger.
        "rto.stage": rto ?? "",
        "rto.scan": rto ? (order.deliveryStatus ?? "") : "",
        "rto.location": rto ? (order.deliveryLocation ?? "") : "",
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
    // The piece itself, when it is still on sale — a nudge that lands on the
    // product is one tap from buying; one that lands on the shop is a search.
    const product = lead.productId
      ? await prisma.product
          .findUnique({ where: { id: lead.productId }, select: { slug: true, isActive: true } })
          .catch(() => null)
      : null;
    const backTo = product?.isActive ? `/product/${product.slug}` : "/shop";
    return {
      emailContext: {
        kicker: "Still in your cart",
        headline: `${lead.productName} is waiting.`,
        preheader: `${lead.productName}${lead.price != null ? ` · ${formatINR(lead.price)}` : ""}`,
        items: [
          {
            name: lead.productName,
            // `Lead.productImage` is the photo captured when it went in the
            // cart — site path or uploaded blob, both made absolute for mail.
            image: absoluteMedia(lead.productImage),
            quantity: lead.quantity,
            price: lead.price != null ? formatINR(lead.price) : undefined,
          },
        ],
        // Not "Finish checkout": neither address is a checkout, and a button
        // should say where it goes.
        cta: {
          label: product?.isActive ? "See it again" : "Back to the shop",
          url: absoluteUrl(backTo),
        },
        note: "Our drops are small and sizes go — this isn't held for you.",
      },
      customerEmail: lead.email ?? "",
      // `Lead` has no account column at all — a cart lead is a visitor id and
      // maybe an address. A push rule on this trigger therefore reaches only
      // somebody who *also* holds an account for that address.
      customerUserId: null,
      deepLink: backTo,
      // The owner's copy — "something went in a cart" — opens the list of
      // interested customers, not a nudge addressed to the shopper.
      adminDeepLink: "/admin/leads",
      pushTag: `l7-cart-${lead.id}`,
      facts: { status: lead.status },
      applies,
      reason,
      tokens: {
        ...base,
        "customer.name": name,
        // "Hi there" beats "Hi ," — a cart lead often has no name at all.
        "customer.firstName": firstNameOf(name) || "there",
        "customer.email": lead.email ?? "",
        "customer.phone": lead.phone ?? "",
        "cart.productName": lead.productName,
        "cart.quantity": String(lead.quantity),
        "cart.price": lead.price != null ? formatINR(lead.price) : "",
        "cart.url": absoluteUrl("/shop"),
      },
    };
  }

  if (subjectType === "chat") {
    const thread = await prisma.chatThread.findUnique({
      where: { id: entityId },
      select: {
        id: true,
        userId: true,
        name: true,
        email: true,
        phone: true,
        adminUnread: true,
        userUnread: true,
        // A guest thread carries whatever the shopper typed into the chat
        // form; an account's thread may carry nothing, so the account is the
        // fallback for both halves.
        user: { select: { name: true, email: true } },
      },
    });
    if (!thread) return null;

    /**
     * Which way this message is travelling.
     *
     * It comes from `context`, not from the newest row, because a *delayed*
     * rule drains minutes or hours later and the newest message by then may
     * be the reply. `context` is documented as the place for facts the
     * database cannot supply, and "which event was this" is exactly one: the
     * same thread produces both triggers.
     */
    const outbound = context.direction === "outbound";
    const from = outbound ? "admin" : "user";

    const rows = await prisma.chatMessage.findMany({
      where: { threadId: thread.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: CHAT_BURST_SCAN,
      select: {
        sender: true,
        status: true,
        body: true,
        attachmentName: true,
        createdAt: true,
      },
    });
    const burst = chatBurst(rows, from);

    const name = thread.name ?? thread.user?.name ?? "";
    const email = thread.email ?? thread.user?.email ?? "";
    // The owner reads a conversation at /admin/messages; the customer reads
    // the same conversation in the widget, which rides every storefront page
    // and carries its own unread badge. There is no one address for both.
    const readAt = outbound ? "/" : "/admin/messages";

    return {
      emailContext: {
        kicker: outbound ? `${settings.brandName} replied` : "New chat message",
        headline: outbound ? "We've written back." : `${name || "Someone"} is waiting for a reply.`,
        // The message itself, which is the only thing worth showing in an
        // inbox list for a chat.
        preheader: burst ? chatPreview(burst.head) : "",
        cta: {
          label: outbound ? "Open the chat" : "Open the conversation",
          url: absoluteUrl(readAt),
        },
        note: outbound
          ? "The chat panel picks up where you left off — nothing is lost."
          : undefined,
      },
      customerEmail: email,
      customerUserId: thread.userId,
      deepLink: outbound ? "/" : "/admin/messages",
      adminDeepLink: "/admin/messages",
      // Per thread, not per message: a later message about the same
      // conversation should replace the earlier banner on a lock screen, not
      // stack under it. `renotify` in the worker keeps the replacement audible.
      pushTag: `l7-chat-${thread.id}`,
      facts: {
        direction: outbound ? "outbound" : "inbound",
        // Not a condition anybody can set — the dedupe key reads it. See
        // `chatBurst` for why the batching lives here.
        burst: burst ? String(burst.anchor.createdAt.getTime()) : "none",
      },
      applies: Boolean(burst) && burst?.head.status !== "seen",
      reason: !burst
        ? "Cancelled — there is no message from that side of this conversation any more."
        : burst.head.status === "seen"
          ? "Cancelled — they had already read it by the time this was due."
          : undefined,
      tokens: {
        ...base,
        "customer.name": name,
        // A chat often starts with no name at all. "Hi there" beats "Hi ,".
        "customer.firstName": firstNameOf(name) || "there",
        "customer.email": email,
        "customer.phone": thread.phone ?? "",
        "chat.message": burst ? chatPreview(burst.head) : "",
        "chat.unread": String(outbound ? thread.userUnread : thread.adminUnread),
        "chat.url": absoluteUrl(readAt),
      },
    };
  }

  if (subjectType === "variant") {
    return resolveVariant(entityId, base);
  }

  const ret = await prisma.returnRequest.findUnique({
    where: { id: entityId },
    include: {
      order: {
        select: {
          orderNumber: true,
          customerName: true,
          email: true,
          phone: true,
          // Only push needs this, and only through the order: a return has no
          // account of its own.
          userId: true,
          // `ReturnRequest` captures the line by value (name, variant, price)
          // but stores no photograph, and its own `images` are the customer's
          // damage shots — the wrong picture entirely for "here is the piece
          // coming back". The order line it came from has the real one.
          items: true,
        },
      },
    },
  });
  if (!ret) return null;
  // The variant matters on a return — "Fleece Hoodie" is not enough to tell a
  // customer which of two pieces is being collected.
  const piece = [ret.productName, ret.variantLabel].filter(Boolean).join(" — ");
  const shape = returnHeadline(ret.status);
  // Match on id where there is one, else on the captured name — a line that
  // was returned by name still finds its photograph.
  const orderLines: OrderItem[] = Array.isArray(ret.order.items)
    ? (ret.order.items as OrderItem[])
    : [];
  const line = orderLines.find(
    (i) =>
      (ret.productId && (i as { productId?: string })?.productId === ret.productId) ||
      i?.name === ret.productName
  );
  return {
    emailContext: {
      kicker: `Return ${ret.requestNumber}`,
      headline: shape.headline,
      preheader: `${piece} · order ${ret.order.orderNumber}`,
      items: [
        {
          name: piece,
          image: line?.image ? absoluteUrl(line.image) : null,
          quantity: ret.quantity,
        },
      ],
      facts: [
        { label: "Order", value: ret.order.orderNumber },
        { label: "Reason given", value: ret.reason },
        // Blank until a figure is agreed — a "₹0 refund" row reads as
        // "you are getting nothing back". See the token note above.
        ...(ret.refundAmount != null
          ? [{ label: "Refund", value: formatINR(ret.refundAmount) }]
          : []),
        ...(ret.nimbusCourier ? [{ label: "Pickup courier", value: ret.nimbusCourier }] : []),
        ...(ret.nimbusAwb ? [{ label: "Pickup tracking", value: ret.nimbusAwb }] : []),
      ],
      cta: { label: shape.cta, url: absoluteUrl(`/order/${ret.order.orderNumber}`) },
      note: shape.note,
    },
    customerEmail: ret.order.email,
    customerUserId: ret.order.userId,
    // The order page is where a return lives too — there is no return screen
    // of its own to open.
    deepLink: `/order/${ret.order.orderNumber}`,
    // The returns list searches by number; `status=all` so a closed return is
    // still found rather than filtered out by the default "open" view.
    adminDeepLink: `/admin/returns?q=${encodeURIComponent(ret.requestNumber)}&status=all`,
    pushTag: `l7-return-${ret.requestNumber}`,
    facts: { status: ret.status },
    applies: true,
    tokens: {
      ...base,
      "customer.name": ret.order.customerName,
      "customer.firstName": firstNameOf(ret.order.customerName),
      "customer.email": ret.order.email,
      "customer.phone": ret.order.phone ?? "",
      "return.number": ret.requestNumber,
      "return.reason": ret.reason,
      "return.status": ret.status,
      "return.previousStatus": context.previousStatus ?? "",
      "return.productName": piece,
      "return.quantity": String(ret.quantity),
      // Blank until a figure is actually agreed. `refundAmount` is null while
      // the return is pending on purpose (see actions/returns.ts) — printing a
      // ₹0 there would read as "you are getting nothing back".
      "return.refundAmount": ret.refundAmount != null ? formatINR(ret.refundAmount) : "",
      "return.note": ret.adminNote ?? "",
      // The REVERSE shipment's courier and AWB, not the order's.
      "return.courier": ret.nimbusCourier ?? "",
      "return.trackingNumber": ret.nimbusAwb ?? "",
      "order.number": ret.order.orderNumber,
      "order.url": absoluteUrl(`/order/${ret.order.orderNumber}`),
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Stock — one alert per dip                                          */
/* ------------------------------------------------------------------ */

/**
 * The store-wide low-stock line, read from the column itself.
 *
 * Not `getSettings()`: that DTO is the storefront's branding shape and has no
 * inventory columns. 5 is the schema default, so a failed read degrades to the
 * number the inventory screen would also be using.
 */
async function lowStockLine(): Promise<number> {
  const row = await prisma.siteSettings
    .findUnique({ where: { id: "main" }, select: { lowStockThreshold: true } })
    .catch(() => null);
  return row?.lowStockThreshold ?? 5;
}

/** `{ Size: "M", color: "red" }` → `"Size: M · color: red"`, as the ledger labels a size. */
function comboText(combo: unknown): string {
  if (!combo || typeof combo !== "object" || Array.isArray(combo)) return "";
  return Object.entries(combo as Record<string, unknown>)
    .filter(([, v]) => typeof v === "string" && v.trim())
    .map(([k, v]) => `${k}: ${String(v).trim()}`)
    .join(" · ");
}

/**
 * **Which dip a size is in — the thing "one alert per dip" is keyed on.**
 *
 * A dip starts at the ledger entry that took the size from above its line to
 * at-or-under it, and it lasts until an entry puts it back above. So the
 * anchor is *the first entry after the newest one that left the size above the
 * line* — or the size's very first entry, if it has never been above it.
 *
 * Why the ledger and not a column: the brief was one alert per episode, "not
 * one per sale and not one ever", and both wrong answers are what the obvious
 * keys give. A bare `<variantId>` alerts once in the size's whole life; a key
 * with the stock level in it alerts on every sale down the slope. The anchor
 * is stable for exactly as long as the dip lasts — five sales from 4 to 0 all
 * resolve to the same entry, so the unique index refuses the second enqueue
 * the way it refuses a second "order shipped" — and a restock followed by a
 * new drop produces a new anchor, so the next dip is told about. No
 * `lastAlertedAt` column, no migration, and nothing to keep in step: the
 * ledger is append-only, so an anchor, once written, never moves.
 *
 * Measured against the line as it is **now**. Raising a size's line can put it
 * into a dip without any stock moving, and the anchor then is the first entry
 * after it was last above the new line — which is the honest answer to "since
 * when has this been low, by the standard you just set".
 *
 * `null` for a size with no ledger at all: it has never had stock recorded, so
 * there is no dip to date and nothing to announce.
 */
async function lowStockEpisode(
  variantId: string,
  line: number
): Promise<{ id: string; at: Date } | null> {
  // The newest entry that left the size above the line. `available` after an
  // entry is `onHandAfter - reservedAfter` — the ledger stores both balances
  // precisely so any row can be read on its own.
  const healthy = await prisma.$queryRaw<{ id: string; createdAt: Date }[]>`
    SELECT "id", "createdAt"
    FROM "StockMovement"
    WHERE "variantId" = ${variantId}
      AND ("onHandAfter" - "reservedAfter") > ${line}
    ORDER BY "createdAt" DESC, "id" DESC
    LIMIT 1`;
  const lastAbove = healthy[0];

  const first = await prisma.stockMovement.findFirst({
    where: {
      variantId,
      ...(lastAbove
        ? {
            OR: [
              { createdAt: { gt: lastAbove.createdAt } },
              { createdAt: lastAbove.createdAt, id: { gt: lastAbove.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, createdAt: true },
  });
  return first ? { id: first.id, at: first.createdAt } : null;
}

/**
 * A size, as an alert. Resolved at send time like every other subject, so a
 * delayed alert about a size that was restocked in the meantime cancels itself
 * instead of telling the owner to reorder something already on the shelf.
 */
async function resolveVariant(entityId: string, base: TokenBag): Promise<Resolved | null> {
  const variant = await prisma.productVariant.findUnique({
    where: { id: entityId },
    select: {
      id: true,
      sku: true,
      combo: true,
      onHand: true,
      reserved: true,
      available: true,
      lowStockAt: true,
      isActive: true,
      product: {
        select: { id: true, name: true, images: true, isActive: true, trackInventory: true },
      },
    },
  });
  if (!variant) return null;

  const line = variant.lowStockAt ?? (await lowStockLine());
  const state: StockState = stockStateOf(variant, line);
  const tracked = variant.product.trackInventory && variant.isActive && variant.product.isActive;
  const low = tracked && state !== "ok";
  const episode = low ? await lowStockEpisode(variant.id, line) : null;

  const size = comboText(variant.combo);
  const piece = [variant.product.name, size].filter(Boolean).join(" — ");
  const label = STOCK_STATE_META[state].label;
  // The product's own stock page. There is no per-size route — the product is
  // the screen, and it lists its sizes.
  const adminPath = `/admin/inventory/${variant.product.id}`;
  const headline =
    state === "out"
      ? `${piece} has sold out.`
      : state === "oversold"
        ? `${piece} is oversold.`
        : `${piece} is running low.`;

  return {
    emailContext: {
      kicker: "Stock",
      headline,
      preheader: `${label} · ${variant.available} available · line is ${line}`,
      items: [
        {
          name: variant.product.name,
          image: absoluteMedia(variant.product.images[0]),
          options: size || undefined,
        },
      ],
      facts: [
        { label: "Available", value: String(variant.available) },
        { label: "On the shelf", value: String(variant.onHand) },
        ...(variant.reserved > 0
          ? [{ label: "Promised to orders", value: String(variant.reserved) }]
          : []),
        { label: "Low-stock line", value: String(line) },
      ],
      cta: { label: "Open in your admin", url: absoluteUrl(adminPath) },
      note:
        state === "oversold"
          ? "More is promised to open orders than is on the shelf — some of them cannot be filled from stock."
          : undefined,
    },
    // Nobody but the owner is ever told about the shelf.
    customerEmail: "",
    customerUserId: null,
    deepLink: adminPath,
    adminDeepLink: adminPath,
    pushTag: `l7-stock-${variant.id}`,
    facts: {
      state,
      // Not a condition anybody sets — the dedupe key reads it.
      episode: episode?.id ?? "",
    },
    applies: low,
    reason: !tracked
      ? "Cancelled — this size is no longer tracked or on sale."
      : "Cancelled — the size was restocked above its line before this was due.",
    enqueue: low && episode !== null,
    tokens: {
      ...base,
      "inventory.productName": variant.product.name,
      "inventory.variant": size,
      "inventory.sku": variant.sku,
      "inventory.state": label,
      "inventory.available": String(variant.available),
      "inventory.onHand": String(variant.onHand),
      "inventory.reserved": String(variant.reserved),
      "inventory.threshold": String(line),
      "inventory.url": absoluteUrl(adminPath),
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
 * | trigger                  | key                      | fires                      |
 * |--------------------------|--------------------------|----------------------------|
 * | `order.created`          | `<orderId>`              | once per order             |
 * | `order.status_changed`   | `<orderId>:<newStatus>`  | once per order per status  |
 * | `order.payment_changed`  | `<orderId>:<paymentStatus>` | once per order per result |
 * | `order.rto`              | `<orderId>:rto:<stage>`  | once per order per RTO stage |
 * | `cart.abandoned`         | `<leadId>`               | once per cart lead         |
 * | `return.requested`       | `<returnId>`             | once per return            |
 * | `return.status_changed`  | `<returnId>:<newStatus>` | once per return per status |
 * | `chat.message_received`  | `<threadId>:<burstAnchor>` | once per run of messages |
 * | `chat.reply_sent`        | `<threadId>:<burstAnchor>` | once per run of messages |
 * | `inventory.low_stock`    | `<variantId>:low:<dipAnchor>` | once per dip under the line |
 *
 * The status variant is the interesting one and it is not an optimisation: with
 * a bare `<orderId>` a single "keep the customer posted" rule would email on
 * confirmation and then stay silent for shipping and delivery, because the row
 * already existed. With the status in the key, an order that goes
 * pending → confirmed → shipped → delivered sends three times and an order
 * bounced back to `shipped` twice still sends once.
 *
 * It is also what makes **two firing sites for one event safe**. A return's
 * status is written both by an admin action and by a courier scan the app only
 * learns about later, so `return.status_changed` is raised from the action
 * *and* from a sweep in every automation pass. Both land on
 * `<returnId>:approved`; the second one loses at the unique index. The same
 * property covers the six places an order status can change.
 *
 * **Chat is the same trick used for a different purpose.** A conversation is
 * not a row that moves through states — it is a stream, and a bare
 * `<threadId>` would mean one notification per person *ever*. The key is the
 * thread plus the **burst anchor** ({@link chatBurst}), which makes the unique
 * index do the batching: five messages in two minutes share an anchor and
 * therefore one job, and the sixth message an hour later gets its own. The
 * whole "don't be a nuisance" requirement is this one line, which is why it is
 * a line and not a subsystem.
 */
export function dedupeKeyFor(
  trigger: TriggerKey,
  entityId: string,
  facts: Record<string, string>
): string {
  if (trigger === "order.status_changed" || trigger === "return.status_changed") {
    return `${entityId}:${(facts.status ?? "").toLowerCase()}`;
  }
  // Once per order per payment result. A shopper who is declined, tries again
  // and is declined again gets **one** message, not two — the second attempt
  // is the same fact about the same order, and a store that mails you twice to
  // say your card failed is a store you stop trying to buy from.
  if (trigger === "order.payment_changed") {
    return `${entityId}:${(facts.paymentStatus ?? "").toLowerCase()}`;
  }
  // Once per order per RTO stage. A parcel scanned "RTO In Transit" at four
  // hubs is four scans of one journey, and they all resolve to `returning`.
  if (trigger === "order.rto") {
    return `${entityId}:rto:${(facts.stage ?? "").toLowerCase()}`;
  }
  if (trigger === "chat.message_received" || trigger === "chat.reply_sent") {
    return `${entityId}:${facts.burst ?? "none"}`;
  }
  // Once per dip. The anchor is the ledger entry that took the size under its
  // line — see `lowStockEpisode` for why that is stable for exactly one dip.
  if (trigger === "inventory.low_stock") {
    return `${entityId}:low:${facts.episode || "none"}`;
  }
  return entityId;
}

/* ------------------------------------------------------------------ */
/*  The one entry point                                                */
/* ------------------------------------------------------------------ */

export type TriggerSubject = {
  /** The row's real id. */
  id: string;
  /**
   * Extra facts the database cannot supply, because the row no longer holds
   * them: `previousStatus`, `previousPaymentStatus`, and the chat `direction`.
   *
   * **Only what has been overwritten belongs here.** Anything still readable
   * from the row is resolved in {@link resolveSubject} instead, so it has one
   * home and a call site cannot forget it — which is why the courier phase
   * behind `order.rto` is *not* in this bag even though the scan handler knows
   * it. See the note on `phase` in that function.
   */
  context?: Record<string, string>;
  /**
   * When the thing this trigger is about actually happened.
   *
   * Only the sweeps set it, and it exists for one reason: **a rule must never
   * fire for something that happened before the rule was switched on.** The
   * return sweep re-offers every recent return on every pass, so without this,
   * switching on "tell them it's refunded" on a Tuesday would mail everyone
   * refunded the week before — people who have already had their money.
   *
   * **Switched on, not created** — see {@link liveSince}. The guard used to
   * compare against `createdAt`, which is right for a rule written a minute
   * ago and wrong for one that shipped paused on the 23rd and was ticked on
   * today: everything since the 23rd was fair game.
   *
   * A direct call site leaves it undefined, because there the trigger *is* the
   * event: it is happening now, and every active rule should see it.
   */
  occurredAt?: Date;
};

export type TriggerOutcome = {
  matched: number;
  queued: number;
  sent: number;
  skipped: number;
};

const NOTHING: TriggerOutcome = { matched: 0, queued: 0, sent: 0, skipped: 0 };

/**
 * When a rule last became able to fire — the line a swept event's
 * `occurredAt` is held against.
 *
 * `updatedAt` moves only when the rule's switch or its template link changes:
 * {@link setAlert} (on and off) and the sync's template repair are the only
 * Prisma writes to this table, and the engine's own run counters go through
 * raw SQL precisely so that they do not touch it. So a rule ticked on today
 * reads today, and one never touched since it was created reads `createdAt`.
 * Without a schema change there is no `activatedAt`; this is the same fact,
 * kept honest by keeping every other writer off the column.
 */
function liveSince(rule: { createdAt: Date; updatedAt: Date }): Date {
  return rule.updatedAt > rule.createdAt ? rule.updatedAt : rule.createdAt;
}

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
      subject.context ?? {},
      trigger
    );
    if (!resolved) {
      console.warn(
        `[automation] ${trigger}: no ${spec.subjectType} with id ${subject.id} — ignored.`
      );
      return NOTHING;
    }
    // A state-driven subject with nothing to announce right now — a size that
    // is back above its line by the time the sweep reached it. See `enqueue`.
    if (resolved.enqueue === false) return NOTHING;

    const now = new Date();
    const out: TriggerOutcome = { matched: 0, queued: 0, sent: 0, skipped: 0 };

    for (const rule of rules) {
      // A rule is not retroactive. See `TriggerSubject.occurredAt`.
      if (subject.occurredAt && subject.occurredAt < liveSince(rule)) {
        out.skipped += 1;
        continue;
      }
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

      // Counters are best-effort telemetry, never a lock — and written in raw
      // SQL on purpose. A Prisma `update` would stamp `@updatedAt`, and
      // `updatedAt` is what `liveSince` reads as "switched on at": every firing
      // would then move that line forward, and a sweep would skip a courier
      // scan that landed a minute before the last send.
      await prisma.$executeRaw`
        UPDATE "AutomationRule"
        SET "lastRunAt" = ${now}, "runCount" = "runCount" + 1
        WHERE "id" = ${rule.id}`.catch(() => {});

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
  // Stored at enqueue since the first version of this table, so every job —
  // including one queued before the headline learned about events — has it.
  const jobTrigger = String(payload.trigger ?? "");

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

  /**
   * Record what a *successful* send actually did, without disturbing the claim.
   *
   * The column is called `error`, and this writes a sentence that is not one —
   * deliberately. "3 devices, 1 of them dead" is the difference between a push
   * rule that works and one that only looks like it does, and an owner reading
   * the queue has nowhere else to learn it. The queue renders this line under
   * the rule name for every status, so a `sent` job carrying a note reads as a
   * note; the pill above it still says Sent.
   *
   * It runs after the claim and never touches `status`, so it cannot resurrect
   * or double-send anything.
   */
  const noteOnSent = async (message: string): Promise<DeliveryResult> => {
    await prisma.automationJob
      .update({ where: { id: jobId }, data: { error: message.slice(0, 900) } })
      .catch(() => {});
    return "sent";
  };

  try {
    const rule = job.rule;
    // **Switched off means stopped, including what was already queued.** A
    // 24-hour cart nudge enqueued this morning and an alert switched off at
    // lunch used to go out anyway, because nothing between the queue and the
    // send asked the rule again. Re-read here, at the moment of sending — the
    // same late resolution as the subject below — so the switch on Settings →
    // Alerts is honest about messages already on their way. Cancelled, not
    // failed: there is nothing to fix, and a retry re-asks the same question.
    if (!rule.isActive) {
      return await cancel("Cancelled — the alert was switched off before this was due.");
    }
    if (!isActionKey(rule.action)) {
      return await cancel(
        `Action "${rule.action}" is not implemented in this build, so nothing was sent.`
      );
    }
    if (!rule.template) {
      // Both channels are built from the same template — push reads its subject
      // as the banner title. See `pushCopyFrom`.
      return await fail("The rule has no template attached.");
    }

    const subjectType = (job.subjectType as SubjectType) ?? "order";
    const resolved = await resolveSubject(subjectType, entityId, context, jobTrigger);
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

    const subject = renderTemplate(rule.template.subject, resolved.tokens);
    // Pruned before substitution, and for every channel — a banner reading
    // "Courier:" is exactly as broken as an email reading it. See
    // `pruneFactLines`.
    const bodyText = renderTemplate(
      pruneFactLines(rule.template.body, resolved.tokens, resolved.emailContext.facts ?? []),
      resolved.tokens
    );

    /* ---- The one place the two channels differ ---- */
    if (rule.action === "push") {
      const outcome = await dispatchAutomationPush({
        recipient: rule.recipient,
        subject: {
          userId: resolved.customerUserId,
          email: resolved.customerEmail,
        },
        copy: pushCopyFrom(subject, bodyText),
        // The owner and the customer read the same event on different
        // screens. Tapping a banner has to land on the one you can act on —
        // for a chat that is the difference between the admin inbox and the
        // storefront widget, and there is no address that serves both.
        url:
          rule.recipient === "admin"
            ? (resolved.adminDeepLink ?? resolved.deepLink)
            : resolved.deepLink,
        tag: resolved.pushTag,
      });

      // Three outcomes, three job states, and the middle one is the reason the
      // union exists: **a customer with no device is not a failure.** Cancelled
      // is terminal — the dedupe row stays, so this rule will not come back for
      // this subject — and it reads as "Skipped" in the queue, which is true.
      if (outcome.kind === "sent") return await noteOnSent(outcome.detail);
      if (outcome.kind === "nobody") return await cancel(outcome.detail);
      return await fail(outcome.detail);
    }

    /* ---- The in-app feed: delivery is a write, not a send ---- */
    //
    // **This channel has no transport**, and that is the whole reason it is
    // the one that always works. An email can be rejected by Resend and a push
    // needs a device that has opted in; an in-app notification only has to
    // exist somewhere the bell can read it, and the job row it is already
    // sitting in *is* that somewhere.
    //
    // So delivery stamps the rendered copy onto `payload.inapp` and stops.
    // Nothing is queried at read time, nothing is re-rendered, and the feed is
    // one indexed `findMany` — which matters, because it is polled.
    //
    // Writing the copy at *delivery* rather than at enqueue is the same late
    // resolution the rest of the engine uses: a delayed job renders what is
    // true when it comes due, not what was true when it was raised.
    if (rule.action === "inapp") {
      const copy = pushCopyFrom(subject, bodyText);
      if (!copy.title) {
        return await fail("The template's subject line is empty, so there is nothing to show.");
      }
      const forAdmin = rule.recipient === "admin";
      // The audience is stamped on the row so the feed can filter in SQL
      // instead of resolving every job it reads. A customer's feed is
      // matched on their account id, falling back to the address the email
      // leg of the same rule would have used — which reaches exactly the
      // same person and nobody else.
      await prisma.automationJob.update({
        where: { id: jobId },
        data: {
          payload: {
            ...payload,
            inapp: {
              title: copy.title,
              body: copy.body,
              url: forAdmin ? (resolved.adminDeepLink ?? resolved.deepLink) : resolved.deepLink,
              audience: forAdmin ? "admin" : "customer",
              userId: forAdmin ? null : resolved.customerUserId,
              email: forAdmin ? null : resolved.customerEmail.trim().toLowerCase(),
              subjectType,
              at: new Date().toISOString(),
            },
          } satisfies Prisma.InputJsonValue,
        },
      });
      return "sent";
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
      subject,
      bodyText,
      title: rule.name,
      // Stated, never inferred. `resolveSubject` builds the structure in the
      // customer's voice ("We couldn't take your payment."), and the shell in
      // `lib/email.ts` re-voices it for the owner only when it knows the mail
      // is theirs. Inferring that from where the button points was a fallback
      // for callers written before the field existed; the engine knows.
      audience: rule.recipient === "admin" ? "admin" : "customer",
      // The item card, the numbers and the one button. Resolved from the row
      // in `resolveSubject`, never typed into a template — see `emailContext`.
      //
      // The owner's own copy gets the structure too: "new order came in" is
      // exactly the mail that benefits most from showing the piece and its
      // photograph, because it is read on a phone while deciding whether to
      // go and pack something.
      //
      // But the **button** has to change hands. `emailContext` is resolved for
      // the customer, so its CTA opens the customer's own order page — the one
      // screen on which the owner can do nothing about the thing they were
      // just told. Same split as `adminDeepLink` makes for a notification, and
      // for the same reason: one event, two readers, two screens.
      context:
        rule.recipient === "admin" && resolved.adminDeepLink
          ? {
              ...resolved.emailContext,
              cta: {
                label: "Open in your admin",
                url: absoluteUrl(resolved.adminDeepLink),
              },
            }
          : resolved.emailContext,
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
  /** Return rows the sweep offered to the engine before draining. */
  swept: number;
  /** Tracked sizes found at or under their line and offered as a low-stock dip. */
  stock: number;
};

/**
 * How far back the sweep looks. Long enough that a slow cron cannot lose an
 * event, short enough that the query stays a cheap index scan.
 */
const SWEEP_WINDOW_DAYS = 14;

/**
 * Catch reverse-leg status changes nothing told us about.
 *
 * **Why a sweep and not a call site.** A return's status is written from two
 * kinds of place. An admin approving or refunding one is code that can raise
 * the trigger there and then. A *courier* collecting the parcel is not: that
 * status is written by `lib/nimbus-returns.ts` and by the NimbusPost webhook,
 * reacting to a scan. Those paths would otherwise need their own trigger call,
 * and a reverse pickup would travel and arrive with the customer told nothing —
 * which is exactly the gap CLAUDE.md records.
 *
 * **Why it is safe to re-offer the same rows every pass.** Two guards, and
 * neither is a "have we sent this already?" query:
 *
 * 1. `dedupeKeyFor` makes the key `<returnId>:<status>`, so the unique index
 *    refuses the second enqueue for a return sitting in `approved`, however
 *    many times the sweep sees it.
 * 2. `occurredAt` is the row's own `updatedAt`, so a rule written today never
 *    fires for a return that last moved last week.
 *
 * `pending` rows are skipped: that state belongs to `return.requested`, which
 * has its own trigger and its own call site. Sweeping it would give one event
 * two rules and two emails.
 */
async function sweepReturnStatuses(limit = 100): Promise<number> {
  try {
    const live = await prisma.automationRule.count({
      where: { trigger: "return.status_changed", isActive: true },
    });
    if (live === 0) return 0;

    const since = new Date(Date.now() - SWEEP_WINDOW_DAYS * 86_400_000);
    const rows = await prisma.returnRequest.findMany({
      where: { updatedAt: { gte: since }, status: { not: "pending" } },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: { id: true, updatedAt: true },
    });

    // Sequential, for the same reason the drain below is: `connection_limit=5`.
    for (const row of rows) {
      await runAutomationTrigger("return.status_changed", {
        id: row.id,
        occurredAt: row.updatedAt,
      });
    }
    return rows.length;
  } catch (err) {
    console.error("[automation] return sweep failed:", err);
    return 0;
  }
}

/**
 * Find every tracked size that is at or under its line, and offer each one's
 * current dip to the engine.
 *
 * **Why a sweep, the same argument as the returns above.** Stock moves in
 * `lib/inventory.ts` — at checkout, at shipping, on a cancellation, a return,
 * an RTO and every hand-recorded entry — and none of those call sites belong
 * to the engine. A sweep reads the one thing all of them leave behind (the
 * variant's counters and the ledger) without any of them having to know alerts
 * exist. It is also why the alert cannot disagree with the screen: both read
 * `stockStateOf` against the same line.
 *
 * **Why re-offering is safe on every pass**, and neither guard is a "have we
 * told them?" query:
 *
 * 1. The dedupe key is `<variantId>:low:<dipAnchor>` ({@link lowStockEpisode}),
 *    so the unique index refuses the second enqueue for a dip already told.
 * 2. `occurredAt` is when the dip began, so an alert switched on today does not
 *    announce every size that has been low since last month — the same
 *    no-retroactivity rule the return sweep keeps.
 *
 * {@link notifyLowStock} is the same routine for a caller that has just moved
 * stock and would rather not wait for the next pass; both paths land on the
 * same key, so calling both costs nothing.
 */
async function sweepLowStock(limit = 100): Promise<number> {
  try {
    const live = await prisma.automationRule.count({
      where: { trigger: "inventory.low_stock", isActive: true },
    });
    if (live === 0) return 0;

    const line = await lowStockLine();
    // The highest line any size is measured against bounds the scan. A size
    // with its own `lowStockAt` above the store line still has to be found.
    const highest = await prisma.productVariant.aggregate({
      where: { isActive: true, product: { trackInventory: true } },
      _max: { lowStockAt: true },
    });
    const ceiling = Math.max(line, highest._max.lowStockAt ?? line);

    const candidates = await prisma.productVariant.findMany({
      where: {
        isActive: true,
        available: { lte: ceiling },
        product: { trackInventory: true, isActive: true },
      },
      orderBy: { available: "asc" },
      take: limit,
      select: { id: true },
    });

    return await notifyLowStock(candidates.map((c) => c.id), line);
  } catch (err) {
    console.error("[automation] stock sweep failed:", err);
    return 0;
  }
}

/**
 * Offer these sizes' current dips to the engine. Returns how many were at or
 * under their line.
 *
 * Exported for the inventory side: calling it after a movement makes the
 * alert immediate instead of waiting for the next automation pass. It cannot
 * throw and cannot double-send — the sweep and a direct call resolve the same
 * dip to the same key.
 */
export async function notifyLowStock(variantIds: string[], storeLine?: number): Promise<number> {
  try {
    if (variantIds.length === 0) return 0;
    const live = await prisma.automationRule.count({
      where: { trigger: "inventory.low_stock", isActive: true },
    });
    if (live === 0) return 0;

    const line = storeLine ?? (await lowStockLine());
    const rows = await prisma.productVariant.findMany({
      where: { id: { in: [...new Set(variantIds)] } },
      select: {
        id: true,
        onHand: true,
        reserved: true,
        available: true,
        lowStockAt: true,
        isActive: true,
        product: { select: { trackInventory: true, isActive: true } },
      },
    });

    let low = 0;
    // Sequential, for the pool — see the drain below.
    for (const row of rows) {
      if (!row.isActive || !row.product.trackInventory || !row.product.isActive) continue;
      const own = row.lowStockAt ?? line;
      if (stockStateOf(row, own) === "ok") continue;
      const episode = await lowStockEpisode(row.id, own);
      if (!episode) continue;
      low += 1;
      await runAutomationTrigger("inventory.low_stock", {
        id: row.id,
        occurredAt: episode.at,
      });
    }
    return low;
  } catch (err) {
    console.error("[automation] low-stock check failed:", err);
    return 0;
  }
}

/**
 * One full pass of the engine: **sweep, then deliver every job whose time has
 * come.** Called by `/api/cron/automation`, by `/api/cron/nimbus-sync` (which
 * carries the schedule on the Hobby plan's two-cron budget) and by the "Run due
 * jobs now" button in the admin.
 *
 * The sweep is inside this function rather than beside it on purpose: every
 * caller that drains wants it, and a caller that forgot it would mean a return
 * pickup that never emails — a silent gap, which is the failure mode this
 * refactor exists to end.
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
  const report: DrainReport = { due: 0, sent: 0, failed: 0, skipped: 0, swept: 0, stock: 0 };
  // Before the queue, ask what changed while nobody was looking. A rule with no
  // delay sends during this call; one with a delay queues a job the loop below
  // will not find due yet, which is correct.
  report.swept = await sweepReturnStatuses();
  report.stock = await sweepLowStock();
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

/* ------------------------------------------------------------------ */
/*  What the store ships with                                          */
/* ------------------------------------------------------------------ */


/**
 * The rules those templates hang on — **and the complete list of alerts this
 * store can have.** Settings → Alerts draws one row per distinct
 * (trigger, conditions, recipient) here and lets any implemented channel be
 * ticked on it; nothing outside this list can be created.
 *
 * **The signature is the handle, not the name.** `AutomationRule` has no key
 * column, and the name used to stand in for one: {@link syncSystemAutomation}
 * created any shipped rule whose *name* it could not find. That made a rename
 * a duplicate generator — rename "Tell the customer their order has shipped"
 * and the next restore put a second copy beside it, both switched on, both
 * emailing. The sync now asks {@link setAlert}, which matches on
 * `alertSignature`, so a row is recognised by what it does. Names are labels.
 *
 * **Within one (trigger, recipient) the condition sets here are disjoint** —
 * one status each, one payment method each, one RTO stage each. That is what
 * lets any channel be ticked on any row without two rows ever matching one
 * event; `setAlert` still refuses an overlap, so a future edit that broke this
 * would be caught at the first tick rather than in a customer's inbox.
 *
 * ### Why every status has its own rule
 *
 * The sender this replaced (`sendOrderStatusEmail`) had a five-line
 * `STATUS_COPY` table and mailed on all of them. One "any status" rule would
 * have been shorter but could only say one thing for all five, so "your order
 * has been cancelled" and "your order is on its way" would share a body. Five
 * rules is what makes the wording — and the switch — per event.
 */
export type SystemRule = {
  name: string;
  trigger: TriggerKey;
  conditions: Record<string, string>;
  templateKey: string;
  recipient: RecipientChoice;
  delayMinutes: number;
  isActive: boolean;
  /** Defaults to `"email"`; the shipped push rules set it explicitly. */
  action?: ActionKey;
};

export const SYSTEM_RULES: SystemRule[] = [
  /* ---- Orders ---- */
  {
    name: "Thank the customer for their order",
    trigger: "order.created",
    conditions: {},
    templateKey: "order-received",
    recipient: "customer",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Tell me an order came in",
    trigger: "order.created",
    conditions: {},
    templateKey: "order-admin-new",
    recipient: "admin",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Tell the customer their order is confirmed",
    trigger: "order.status_changed",
    conditions: { status: "confirmed" },
    templateKey: "order-confirmed",
    recipient: "customer",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Tell the customer their order has shipped",
    trigger: "order.status_changed",
    conditions: { status: "shipped" },
    templateKey: "order-shipped",
    recipient: "customer",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Tell the customer their order was delivered",
    trigger: "order.status_changed",
    conditions: { status: "delivered" },
    templateKey: "order-delivered",
    recipient: "customer",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Tell the customer their order was cancelled",
    trigger: "order.status_changed",
    conditions: { status: "cancelled" },
    templateKey: "order-cancelled",
    recipient: "customer",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Tell the customer an order went back to pending",
    trigger: "order.status_changed",
    conditions: { status: "pending" },
    templateKey: "order-reopened",
    recipient: "customer",
    delayMinutes: 0,
    isActive: true,
  },

  /* ---- Carts ---- */
  {
    name: "Tell me when something goes in a cart",
    trigger: "cart.abandoned",
    conditions: {},
    templateKey: "lead-admin-new",
    recipient: "admin",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Nudge an abandoned cart after a day",
    trigger: "cart.abandoned",
    conditions: {},
    templateKey: "abandoned-cart",
    recipient: "customer",
    delayMinutes: 1440,
    isActive: true,
  },

  /* ---- Returns ---- */
  {
    name: "Tell the customer we've got their return request",
    trigger: "return.requested",
    conditions: {},
    templateKey: "return-requested",
    recipient: "customer",
    delayMinutes: 0,
    isActive: true,
  },
  {
    // The owner's own copy. A return is the one customer action that needs a
    // decision from them before anything can move, and until this rule existed
    // the only way to learn one had been raised was to open the screen.
    name: "Tell me a return was requested",
    trigger: "return.requested",
    conditions: {},
    templateKey: "return-admin-new",
    recipient: "admin",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Tell the customer their return is approved",
    trigger: "return.status_changed",
    conditions: { status: "approved" },
    templateKey: "return-approved",
    recipient: "customer",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Tell the customer we couldn't accept their return",
    trigger: "return.status_changed",
    conditions: { status: "rejected" },
    templateKey: "return-rejected",
    recipient: "customer",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Tell the customer their return was closed",
    trigger: "return.status_changed",
    conditions: { status: "cancelled" },
    templateKey: "return-cancelled",
    recipient: "customer",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Tell the customer the courier has collected their return",
    trigger: "return.status_changed",
    conditions: { status: "picked_up" },
    templateKey: "return-picked-up",
    recipient: "customer",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Tell the customer their return reached us",
    trigger: "return.status_changed",
    conditions: { status: "received" },
    templateKey: "return-received",
    recipient: "customer",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Tell the customer their refund has been sent",
    trigger: "return.status_changed",
    conditions: { status: "refunded" },
    templateKey: "return-refunded",
    recipient: "customer",
    delayMinutes: 0,
    isActive: true,
  },

  /* ---- Chat ---- */
  //
  // **Every chat rule has a zero delay, and that is not a default — it is the
  // only correct value.** A delayed job waits for `/api/cron/automation`,
  // which runs every 15–60 minutes; a notification telling somebody they have
  // a message they received half an hour ago is worse than none, because they
  // will have read it and learned the alert is always late. The batching that
  // stops a burst becoming five banners is the dedupe key instead — see
  // `chatBurst`, which needs no wait at all.
  //
  // The two directions are not symmetrical, so the defaults are not either:
  //
  // - **Somebody writing in** goes to the owner's own inbox, about their own
  //   shop, and is the thing this whole trigger exists for. On by default.
  // - **A reply going out** is customer-facing. Most replies land while the
  //   panel is still open, where the customer can already see them — so it
  //   ships off, for the owner to switch on if their shoppers tend to close
  //   the tab. Switching it on is one tap and the burst rule protects them.
  {
    name: "Tell me when a customer writes in chat",
    trigger: "chat.message_received",
    conditions: {},
    templateKey: "chat-admin-new",
    recipient: "admin",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Email the customer when I reply in chat",
    trigger: "chat.reply_sent",
    conditions: {},
    templateKey: "chat-reply",
    recipient: "customer",
    delayMinutes: 0,
    isActive: false,
  },

  /* ---- The same events, on the phone ---- */
  //
  // The opt-in bar promises "the moment your order is packed and dispatched",
  // and until these existed nothing in the store kept that promise — the only
  // two senders were a self-test and an admin typing a broadcast by hand.
  //
  // Three things about these rows are deliberate:
  //
  // 1. **They point at the *email* templates**, not at push-only copies. One
  //    event, one wording, two channels — `pushCopyFrom` takes the subject as
  //    the banner title and the opening paragraph as the body. A second copy of
  //    the same sentence is the `defaultReturnsInfo` trap in a new costume.
  // 2. **They ship switched off.** A channel the owner has never seen should
  //    not start notifying their customers because a deploy happened. Switching
  //    one on is one tick on Settings → Alerts, and `syncSystemAutomation`
  //    never un-pauses anything, so that choice sticks.
  // 3. **Only the moments that are worth a lock screen.** For the customer:
  //    confirmed, shipped, delivered, and a reply in chat. For the owner: a
  //    new order, a customer writing in, a return waiting for a decision and a
  //    payment that failed — each one something they act on. Cancelled,
  //    refunded and "we've got your return request" are conversations, not
  //    alerts, and they stay with email — a banner cannot hold the
  //    explanation those need, and waking somebody to give them half of one
  //    is worse than an email they read when they are ready.
  //
  // The chat pair is the one an owner is most likely to want on, because it is
  // the only event in this store where somebody is *waiting*. It still ships
  // off, for reason 2: the owner's phone should start buzzing because they
  // chose it, not because a deploy happened.
  {
    name: "Notify the customer their order is confirmed",
    trigger: "order.status_changed",
    conditions: { status: "confirmed" },
    templateKey: "order-confirmed",
    recipient: "customer",
    action: "push",
    delayMinutes: 0,
    isActive: false,
  },
  {
    name: "Notify the customer their order has shipped",
    trigger: "order.status_changed",
    conditions: { status: "shipped" },
    templateKey: "order-shipped",
    recipient: "customer",
    action: "push",
    delayMinutes: 0,
    isActive: false,
  },
  {
    name: "Notify the customer their order was delivered",
    trigger: "order.status_changed",
    conditions: { status: "delivered" },
    templateKey: "order-delivered",
    recipient: "customer",
    action: "push",
    delayMinutes: 0,
    isActive: false,
  },
  {
    // The owner's phone, for the one event a shop exists for. Reaches a device
    // only through an account holding the alert address — see push-dispatch.
    name: "Notify me when an order comes in",
    trigger: "order.created",
    conditions: {},
    templateKey: "order-admin-new",
    recipient: "admin",
    action: "push",
    delayMinutes: 0,
    isActive: false,
  },
  {
    // A return is the one customer action that waits on the owner's decision.
    name: "Notify me when a return is requested",
    trigger: "return.requested",
    conditions: {},
    templateKey: "return-admin-new",
    recipient: "admin",
    action: "push",
    delayMinutes: 0,
    isActive: false,
  },
  {
    name: "Notify me when a customer writes in chat",
    trigger: "chat.message_received",
    conditions: {},
    templateKey: "chat-admin-new",
    recipient: "admin",
    action: "push",
    delayMinutes: 0,
    isActive: false,
  },
  {
    name: "Notify the customer when I reply in chat",
    trigger: "chat.reply_sent",
    conditions: {},
    templateKey: "chat-reply",
    recipient: "customer",
    action: "push",
    delayMinutes: 0,
    isActive: false,
  },

  /* ---- The same events again, in the notification bell ---- */
  //
  // **This block is what makes the bell a feed instead of a broadcast log.**
  // Before it, the only thing that ever appeared in a notification was
  // something the owner had typed into Admin → Notifications and sent by hand:
  // a chat message arriving, an order shipping, a return being approved —
  // none of it showed up anywhere, because email and push were the only two
  // channels and both of them leave the app.
  //
  // Three things about these rows are deliberate, and the first is the one
  // that matters:
  //
  // 1. **They ship switched ON**, which is the opposite of the push rules
  //    above and is not an inconsistency. A push wakes a phone and needs
  //    consent; an in-app notification waits in a bell until somebody looks.
  //    It cannot interrupt anybody, cannot be rejected by a provider and
  //    needs no device, no install and no email address — so the argument for
  //    shipping push off ("a deploy must not start buzzing people") simply
  //    does not apply. A feed that ships empty is the bug being fixed.
  // 2. **They reuse the email templates**, exactly as push does. One event,
  //    one wording, three channels. `pushCopyFrom` takes the subject as the
  //    headline and the opening paragraph as the line under it.
  // 3. **Delay is always 0.** A notification that appears in the bell half an
  //    hour after the event teaches people the bell is late, which is worse
  //    than not having one. Nothing here waits for the cron.
  //
  // The two audiences get different events, because they need different
  // things. The owner is told what *arrived* — an order, a message, a return
  // request, a courier scan they did not cause. The customer is told what
  // happened to *their* order or return. Neither is told about the other's
  // half, so "we emailed the customer their refund" never clutters the
  // owner's bell, and the owner's admin-only events never leak into a
  // customer's.

  /* -- The owner's bell -- */
  {
    name: "Show me new orders in the bell",
    trigger: "order.created",
    conditions: {},
    templateKey: "order-admin-new",
    recipient: "admin",
    action: "inapp",
    delayMinutes: 0,
    isActive: true,
  },
  {
    // Delivery is the one forward status the owner did not cause — it arrives
    // from a courier scan. Confirmed and shipped are things they just did, and
    // telling somebody what they themselves did thirty seconds ago is how a
    // feed becomes noise.
    name: "Show me deliveries in the bell",
    trigger: "order.status_changed",
    conditions: { status: "delivered" },
    templateKey: "order-delivered",
    recipient: "admin",
    action: "inapp",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Show me chat messages in the bell",
    trigger: "chat.message_received",
    conditions: {},
    templateKey: "chat-admin-new",
    recipient: "admin",
    action: "inapp",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Show me return requests in the bell",
    trigger: "return.requested",
    conditions: {},
    templateKey: "return-admin-new",
    recipient: "admin",
    action: "inapp",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Show me collected returns in the bell",
    trigger: "return.status_changed",
    conditions: { status: "picked_up" },
    templateKey: "return-picked-up",
    recipient: "admin",
    action: "inapp",
    delayMinutes: 0,
    isActive: true,
  },
  {
    // The one the money hangs on: a refund should not be paid until the piece
    // is back, and this is what says it is.
    name: "Show me returns that arrived back",
    trigger: "return.status_changed",
    conditions: { status: "received" },
    templateKey: "return-received",
    recipient: "admin",
    action: "inapp",
    delayMinutes: 0,
    isActive: true,
  },
  {
    // Off, unlike its siblings. Every add-to-cart is a lead, so this is the
    // one event in the store that can genuinely flood a feed — and the email
    // rule for it ships off for the same reason.
    name: "Show me cart activity in the bell",
    trigger: "cart.abandoned",
    conditions: {},
    templateKey: "lead-admin-new",
    recipient: "admin",
    action: "inapp",
    delayMinutes: 0,
    isActive: false,
  },

  /* -- The customer's bell -- */
  {
    name: "Show the customer their order was placed",
    trigger: "order.created",
    conditions: {},
    templateKey: "order-received",
    recipient: "customer",
    action: "inapp",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Show the customer their order is confirmed",
    trigger: "order.status_changed",
    conditions: { status: "confirmed" },
    templateKey: "order-confirmed",
    recipient: "customer",
    action: "inapp",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Show the customer their order has shipped",
    trigger: "order.status_changed",
    conditions: { status: "shipped" },
    templateKey: "order-shipped",
    recipient: "customer",
    action: "inapp",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Show the customer their order was delivered",
    trigger: "order.status_changed",
    conditions: { status: "delivered" },
    templateKey: "order-delivered",
    recipient: "customer",
    action: "inapp",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Show the customer their order was cancelled",
    trigger: "order.status_changed",
    conditions: { status: "cancelled" },
    templateKey: "order-cancelled",
    recipient: "customer",
    action: "inapp",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Show the customer their return was approved",
    trigger: "return.status_changed",
    conditions: { status: "approved" },
    templateKey: "return-approved",
    recipient: "customer",
    action: "inapp",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Show the customer we couldn't accept their return",
    trigger: "return.status_changed",
    conditions: { status: "rejected" },
    templateKey: "return-rejected",
    recipient: "customer",
    action: "inapp",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Show the customer their return was collected",
    trigger: "return.status_changed",
    conditions: { status: "picked_up" },
    templateKey: "return-picked-up",
    recipient: "customer",
    action: "inapp",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Show the customer their return reached us",
    trigger: "return.status_changed",
    conditions: { status: "received" },
    templateKey: "return-received",
    recipient: "customer",
    action: "inapp",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Show the customer their refund was sent",
    trigger: "return.status_changed",
    conditions: { status: "refunded" },
    templateKey: "return-refunded",
    recipient: "customer",
    action: "inapp",
    delayMinutes: 0,
    isActive: true,
  },
  {
    // **The asymmetric half of the chat rule.** Somebody who closed the tab
    // cannot be reached by a polled widget at all — that is what email and
    // push are for, and both of those ship off. This one is the compromise
    // that is always safe: the reply waits in the bell, so a customer who
    // comes back to the site an hour later finds it rather than having to
    // remember to reopen the chat. Burst-collapsed like every other chat
    // rule, so a four-message reply is one entry.
    name: "Show the customer my chat replies",
    trigger: "chat.reply_sent",
    conditions: {},
    templateKey: "chat-reply",
    recipient: "customer",
    action: "inapp",
    delayMinutes: 0,
    isActive: true,
  },

  /* ================================================================== */
  /*  A payment that did not arrive                                     */
  /* ================================================================== */
  //
  // Grouped by *event* rather than split across the channel blocks above,
  // because these are a new trigger rather than another channel for an old
  // one — and a reader asking "what happens when a payment fails?" should find
  // the whole answer in one place. The channel conventions are unchanged and
  // are restated on each row.
  //
  // ### There is deliberately no rule for a payment that *succeeds*
  //
  // The trigger fires on success as well, and nothing listens. That is a
  // decision, not an omission:
  //
  // - **The customer is already told, at the same instant.**
  //   `verifyRazorpayPayment` raises `order.created` the moment a prepaid or
  //   part-paid order verifies — the whole reason that call lives there rather
  //   than in `placeOrder` is that this is where such an order becomes real.
  //   "Thank the customer for their order" already prints the total, the
  //   method and, now, the advance-and-balance split. A second mail in the same
  //   request saying the money arrived is the two-senders-for-one-event trap
  //   this engine was built to end.
  // - **The owner is already told too**, by "Tell me an order came in" and the
  //   bell entry beside it, raised from the same `order.created`.
  // - **So the capability is left open and unused.** A separate "money
  //   landed" alert — a real want on a part-paid order, where an advance
  //   arriving and a balance still outstanding are two facts — is one entry
  //   in this list against `paymentStatus: partial`. It is deliberately not
  //   one: shipping it would be the duplicate described above, and since
  //   Settings → Alerts creates only what this list ships, leaving it out is
  //   what keeps it from being built by accident.
  //
  // The customer rules are **split by payment method**, which is the point of
  // there being two of them: a failed prepaid payment and a failed advance are
  // different amounts and different stories. COD is not offered as a condition
  // and never reaches this trigger anyway — a cash order takes no online
  // payment to fail — so no customer can be sent a message describing an order
  // that is not theirs.
  {
    // Email, so it ships off — outbound messaging is the owner's to switch on.
    name: "Tell the customer their payment didn't go through",
    trigger: "order.payment_changed",
    conditions: { paymentStatus: "failed", paymentMethod: "Razorpay" },
    templateKey: "payment-failed-prepaid",
    recipient: "customer",
    delayMinutes: 0,
    isActive: false,
  },
  {
    name: "Tell the customer their advance didn't go through",
    trigger: "order.payment_changed",
    conditions: { paymentStatus: "failed", paymentMethod: "Partial" },
    templateKey: "payment-failed-partial",
    recipient: "customer",
    delayMinutes: 0,
    isActive: false,
  },
  {
    // No method condition: the owner's copy is worded to be true of either leg,
    // and an owner who is told about one kind of failed payment and not the
    // other has a report they cannot trust.
    name: "Tell me a payment failed",
    trigger: "order.payment_changed",
    conditions: { paymentStatus: "failed" },
    templateKey: "payment-failed-admin",
    recipient: "admin",
    delayMinutes: 0,
    isActive: false,
  },
  {
    // The one push rule here, and the only new event in this store that earns a
    // lock screen: money that did not arrive, on an order the owner can still
    // recover with a phone call. Ships off, like every other push rule.
    name: "Notify me when a payment fails",
    trigger: "order.payment_changed",
    conditions: { paymentStatus: "failed" },
    templateKey: "payment-failed-admin",
    recipient: "admin",
    action: "push",
    delayMinutes: 0,
    isActive: false,
  },
  {
    // The bell ships on, for the reason the in-app block above gives: it cannot
    // interrupt anybody. For this event it is also the only channel that is
    // certain to work — the customer is on the site at this exact moment, which
    // is the one time a bell beats an inbox.
    name: "Show the customer their payment didn't go through",
    trigger: "order.payment_changed",
    conditions: { paymentStatus: "failed", paymentMethod: "Razorpay" },
    templateKey: "payment-failed-prepaid",
    recipient: "customer",
    action: "inapp",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Show the customer their advance didn't go through",
    trigger: "order.payment_changed",
    conditions: { paymentStatus: "failed", paymentMethod: "Partial" },
    templateKey: "payment-failed-partial",
    recipient: "customer",
    action: "inapp",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Show me failed payments in the bell",
    trigger: "order.payment_changed",
    conditions: { paymentStatus: "failed" },
    templateKey: "payment-failed-admin",
    recipient: "admin",
    action: "inapp",
    delayMinutes: 0,
    isActive: true,
  },

  /* ================================================================== */
  /*  The parcel coming home                                            */
  /* ================================================================== */
  //
  // Both stages are covered, and they are genuinely two events rather than one
  // said twice. **Returning** is the one that stops the customer being told the
  // word "cancelled" — it lands while the parcel is still moving, which is the
  // only window in which they can say "yes, try again" and save the sale.
  // **Returned** is the one the money hangs on: the goods are on the shelf, the
  // order will not be delivered, and anything paid online is the customer's.
  //
  // The owner gets only the second, on purpose. The first is a courier event
  // they can do nothing about; the second is stock to put away and a refund to
  // decide.
  {
    name: "Tell the customer their parcel is coming back",
    trigger: "order.rto",
    conditions: { stage: "returning" },
    templateKey: "order-rto-returning",
    recipient: "customer",
    delayMinutes: 0,
    isActive: false,
  },
  {
    name: "Tell the customer their parcel reached us again",
    trigger: "order.rto",
    conditions: { stage: "returned" },
    templateKey: "order-rto-returned",
    recipient: "customer",
    delayMinutes: 0,
    isActive: false,
  },
  {
    name: "Tell me a parcel came back",
    trigger: "order.rto",
    conditions: { stage: "returned" },
    templateKey: "order-rto-admin",
    recipient: "admin",
    delayMinutes: 0,
    isActive: false,
  },
  {
    name: "Show the customer their parcel is coming back",
    trigger: "order.rto",
    conditions: { stage: "returning" },
    templateKey: "order-rto-returning",
    recipient: "customer",
    action: "inapp",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Show the customer their parcel reached us again",
    trigger: "order.rto",
    conditions: { stage: "returned" },
    templateKey: "order-rto-returned",
    recipient: "customer",
    action: "inapp",
    delayMinutes: 0,
    isActive: true,
  },
  {
    // The owner's bell already carries deliveries; this is the other ending,
    // and it is the one that costs money if it goes unnoticed.
    name: "Show me parcels that came back",
    trigger: "order.rto",
    conditions: { stage: "returned" },
    templateKey: "order-rto-admin",
    recipient: "admin",
    action: "inapp",
    delayMinutes: 0,
    isActive: true,
  },

  /* ================================================================== */
  /*  The shelf                                                         */
  /* ================================================================== */
  //
  // Owner-only, and on the store's usual convention: the bell ships on (it
  // cannot interrupt anybody), email and phone ship off (they leave the app,
  // and the owner should choose them). One template for all three, as with
  // every other event — `inventory-low-stock`, written in `email-templates.ts`
  // from the `inventory.*` tokens above.
  {
    name: "Show me sizes running low in the bell",
    trigger: "inventory.low_stock",
    conditions: {},
    templateKey: "inventory-low-stock",
    recipient: "admin",
    action: "inapp",
    delayMinutes: 0,
    isActive: true,
  },
  {
    name: "Tell me when a size runs low",
    trigger: "inventory.low_stock",
    conditions: {},
    templateKey: "inventory-low-stock",
    recipient: "admin",
    delayMinutes: 0,
    isActive: false,
  },
  {
    name: "Notify me when a size runs low",
    trigger: "inventory.low_stock",
    conditions: {},
    templateKey: "inventory-low-stock",
    recipient: "admin",
    action: "push",
    delayMinutes: 0,
    isActive: false,
  },
];

/* ------------------------------------------------------------------ */
/*  The one writer — every alert created or switched goes through here */
/* ------------------------------------------------------------------ */

/** Why `setAlert` said no, as a code a caller can branch on. */
export type AlertRefusal =
  | "unknown-trigger"
  | "unsupported-channel"
  | "bad-recipient"
  | "not-shipped"
  | "no-template"
  | "collision";

export type SetAlertOutcome =
  | {
      ok: true;
      /** A row was inserted by this call. */
      created: boolean;
      /** Every row with this signature, oldest first. */
      ruleIds: string[];
      /** Whether the alert is now on. */
      on: boolean;
      /** Created switched off because switching it on would collide with this rule. */
      heldBy?: string;
    }
  | { ok: false; code: AlertRefusal; error: string };

/**
 * The first key of every advisory lock this module takes. Fixed and
 * arbitrary; the point is only that a lock taken here cannot collide with one
 * taken anywhere else for another reason.
 */
const ALERT_LOCK_NAMESPACE = 1_278_689_537;

/** 32-bit FNV-1a as a signed int — Postgres advisory locks take `int4` pairs. */
function lockKey(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

/**
 * Run `work` in a transaction that holds a lock on one alert group.
 *
 * **Why a lock and not the unique index this file otherwise relies on.** The
 * index works for jobs because a job's key is a column. A rule's signature is
 * not — it spans a `Json` column, and adding a signature column with a unique
 * index is a migration this change was not allowed to make. Without either,
 * "look for a row, then insert one" is a race: two tabs ticking the same empty
 * cell, or a tab and the sync, would both see nothing and both insert.
 *
 * `pg_advisory_xact_lock` closes it without a schema change. It is taken on the
 * alert's *group* (trigger, person, channel), not its exact signature, because
 * invariant 2 in the file header compares a rule with its neighbours — two
 * different cells that overlap must not both be switched on by two requests
 * that each checked before the other wrote. The lock is transaction-scoped, so
 * it is released on commit or rollback and needs no cleanup, and it works
 * through the Supabase pooler in transaction mode because a transaction keeps
 * its server connection for its whole length (session-level locks would not).
 */
async function withAlertLock<T>(
  group: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ALERT_LOCK_NAMESPACE}::int4, ${lockKey(group)}::int4)`;
      return work(tx);
    },
    // A handful of reads and one write, but from a dev machine each round trip
    // to Mumbai is ~100 ms — the same reason `INVENTORY_TX_OPTIONS` exists.
    { timeout: 15_000, maxWait: 10_000 }
  );
}

/**
 * Make sure a shipped template has a row, and return its id.
 *
 * Outside any transaction on purpose: two alert groups can need the same
 * template at once (the bell and the email for one event), and a unique-key
 * clash inside a Postgres transaction aborts the whole transaction. Here the
 * clash is simply "somebody else created it", and the row is re-read.
 *
 * `null` when the key is neither in the database nor in `SYSTEM_TEMPLATES` —
 * an alert whose words have not been written yet.
 */
async function ensureShippedTemplate(
  key: string
): Promise<{ id: string; created: boolean } | null> {
  const found = await prisma.emailTemplate.findUnique({
    where: { key },
    select: { id: true, isSystem: true },
  });
  const shipped = SYSTEM_TEMPLATES.find((t) => t.key === key);
  if (found) {
    // The words are the owner's; the "ships with the store" flag is not.
    if (shipped && !found.isSystem) {
      await prisma.emailTemplate.update({ where: { id: found.id }, data: { isSystem: true } });
    }
    return { id: found.id, created: false };
  }
  if (!shipped) return null;
  try {
    const created = await prisma.emailTemplate.create({
      data: {
        key: shipped.key,
        name: shipped.name,
        subject: shipped.subject,
        body: shipped.body,
        isSystem: true,
      },
      select: { id: true },
    });
    return { id: created.id, created: true };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const again = await prisma.emailTemplate.findUnique({ where: { key }, select: { id: true } });
    return again ? { id: again.id, created: false } : null;
  }
}

/** Same (trigger, conditions, recipient) — one row of the grid. */
function sameRow(a: AlertIdentity, b: AlertIdentity): boolean {
  return alertSignature({ ...a, action: "" }) === alertSignature({ ...b, action: "" });
}

/**
 * How a missing alert would be created — **or `null`, which means it may not
 * be.** Invariant 3 lives here: the seed is read from {@link SYSTEM_RULES},
 * never taken from a caller, so no request can describe an alert into
 * existence.
 *
 * A row of the grid is one shipped (trigger, conditions, recipient); any
 * implemented channel may be ticked on it. The exact shipped entry is used
 * whole when there is one (so ticking it creates precisely the row the store
 * ships, name and all); otherwise the row's own template and timing are
 * borrowed from its shipped sibling on another channel — one event, one
 * wording, as everywhere else in this file.
 */
function seedForAlert(identity: AlertIdentity): {
  name: string;
  trigger: string;
  conditions: Record<string, string>;
  recipient: string;
  templateKey: string;
  delayMinutes: number;
} | null {
  const onRow = SYSTEM_RULES.filter((r) =>
    sameRow({ ...r, action: r.action ?? "email" }, identity)
  );
  if (onRow.length === 0) return null;
  const exact = onRow.find((r) => (r.action ?? "email") === identity.action);
  const base = exact ?? onRow[0];
  const label = eventLabel(
    base.trigger,
    base.conditions,
    composeFallbackLabel(triggerLabel(base.trigger), describeConditions(base.trigger, base.conditions))
  );
  return {
    // Written the way the catalogue writes them, so a row created here reads
    // back identically however a request happened to case it.
    trigger: base.trigger,
    conditions: base.conditions,
    recipient: base.recipient,
    name:
      exact?.name ??
      `${label} — ${channelLabel(identity.action)} to ${recipientLabel(base.recipient).toLowerCase()}`.slice(0, 80),
    templateKey: base.templateKey,
    delayMinutes: base.delayMinutes,
  };
}

function collisionSentence(
  other: { name: string },
  identity: AlertIdentity
): string {
  return `“${other.name}” already sends this ${channelLabel(identity.action).toLowerCase()} to ${recipientLabel(identity.recipient).toLowerCase()} for the same event, so switching this on as well would send it twice. Switch that one off first.`;
}

/**
 * **Create or switch one alert. The only function in the codebase that
 * inserts an `AutomationRule` or changes its `isActive`.**
 *
 * Keyed by the alert's signature — see the file header for the three
 * invariants and `lib/notification-channels.ts` for why the signature is what
 * it is. Callers name an alert by `(trigger, conditions, recipient, channel)`
 * and never by a rule id, so a browser tab that has been open since yesterday
 * cannot switch the wrong row: whatever it believes, the rows are found again
 * here, under the lock, from what the alert *is*.
 *
 * - **Switching off** always succeeds and writes only rows that are on — an
 *   orphan tick on a channel that stopped being supported can always be
 *   cleared, and a tick that changes nothing writes nothing.
 * - **Switching on** turns on the oldest row with this signature and makes sure
 *   any identical copy (possible only in a database older than this function)
 *   is off, so one alert can never be on twice. It refuses, and names the
 *   other rule, if a *different* switched-on rule would match the same event.
 * - **No row yet** — created, but only for an alert the store ships
 *   ({@link seedForAlert}), and only with a template that exists.
 *
 * `createOnly` is the sync's mode: find or create, never touch the switch of a
 * row that already exists. With `onCollision: "pause"` a collision creates the
 * row switched off instead of refusing — additive, and silent in the way a
 * restore should be; the grid then shows it off and explains why on the tick.
 */
export async function setAlert(input: {
  identity: AlertIdentity;
  enabled: boolean;
  onCollision: "refuse" | "pause";
  createOnly?: boolean;
}): Promise<SetAlertOutcome> {
  const identity: AlertIdentity = {
    trigger: input.identity.trigger.trim(),
    conditions: readConditions(input.identity.conditions),
    recipient: input.identity.recipient.trim(),
    action: input.identity.action.trim(),
  };
  const signature = alertSignature(identity);
  const recipientKey = normaliseRecipient(identity.recipient);

  /** Every row in this alert's group, oldest first, read inside `tx`. */
  const readGroup = async (db: Prisma.TransactionClient | typeof prisma) =>
    (
      await db.automationRule.findMany({
        where: { trigger: identity.trigger, action: identity.action },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          trigger: true,
          conditions: true,
          action: true,
          recipient: true,
          isActive: true,
        },
      })
    )
      .filter((r) => normaliseRecipient(r.recipient) === recipientKey)
      .map((r) => ({ ...r, conditions: readConditions(r.conditions) }));

  /* ---- Off: no lock needed, because switching off cannot make a duplicate ---- */
  if (!input.enabled && !input.createOnly) {
    const mine = (await readGroup(prisma)).filter((r) => alertSignature(r) === signature);
    const live = mine.filter((r) => r.isActive).map((r) => r.id);
    if (live.length > 0) {
      await prisma.automationRule.updateMany({
        where: { id: { in: live }, isActive: true },
        data: { isActive: false },
      });
    }
    return { ok: true, created: false, ruleIds: mine.map((r) => r.id), on: false };
  }

  /* ---- On, or create: the gates that apply before anything is read ---- */
  if (input.enabled) {
    if (!isTriggerKey(identity.trigger)) {
      return { ok: false, code: "unknown-trigger", error: "That event isn't one this store knows about." };
    }
    if (!isActionKey(identity.action)) {
      return {
        ok: false,
        code: "unsupported-channel",
        error: `${channelLabel(identity.action)} can't be sent from this store yet, so it can't be switched on.`,
      };
    }
    if (identity.action === "push" && !isPushRecipient(identity.recipient)) {
      return {
        ok: false,
        code: "bad-recipient",
        error:
          "A notification can only go to the customer or to you — an email address has no device behind it.",
      };
    }
  }

  const seed = seedForAlert(identity);
  // Resolved before the lock (see `ensureShippedTemplate`); only needed if the
  // row turns out not to exist, and harmless if it does.
  const template = seed ? await ensureShippedTemplate(seed.templateKey) : null;

  return withAlertLock(alertGroupOf(identity), async (tx): Promise<SetAlertOutcome> => {
    const group = await readGroup(tx);
    const mine = group.filter((r) => alertSignature(r) === signature);
    const others = group.filter((r) => alertSignature(r) !== signature);
    const clash = others.find(
      (r) => r.isActive && conditionsOverlap(r.conditions, identity.conditions)
    );

    if (mine.length > 0) {
      const on = mine.some((r) => r.isActive);
      // The sync never touches a switch that already exists.
      if (input.createOnly) {
        return { ok: true, created: false, ruleIds: mine.map((r) => r.id), on };
      }
      if (clash) {
        return { ok: false, code: "collision", error: collisionSentence(clash, identity) };
      }
      const [keep, ...copies] = mine;
      if (!keep.isActive) {
        await tx.automationRule.update({ where: { id: keep.id }, data: { isActive: true } });
      }
      const extraOn = copies.filter((r) => r.isActive).map((r) => r.id);
      if (extraOn.length > 0) {
        await tx.automationRule.updateMany({
          where: { id: { in: extraOn } },
          data: { isActive: false },
        });
      }
      return { ok: true, created: false, ruleIds: mine.map((r) => r.id), on: true };
    }

    /* ---- No row with this signature: create one, if the store ships it ---- */
    if (!seed) {
      return {
        ok: false,
        code: "not-shipped",
        error:
          "That alert isn't one this store sends, so it can't be created. Every alert it can send is already a row on Settings → Alerts.",
      };
    }
    if (!template) {
      return {
        ok: false,
        code: "no-template",
        error:
          "This alert's message hasn't been written yet, so it can't be switched on. It becomes available as soon as its wording ships.",
      };
    }

    let isActive = input.enabled;
    let heldBy: string | undefined;
    if (isActive && clash) {
      if (input.onCollision === "refuse") {
        return { ok: false, code: "collision", error: collisionSentence(clash, identity) };
      }
      isActive = false;
      heldBy = clash.name;
    }

    const created = await tx.automationRule.create({
      data: {
        name: seed.name,
        trigger: seed.trigger,
        conditions: seed.conditions as Prisma.InputJsonValue,
        action: identity.action,
        templateId: template.id,
        recipient: seed.recipient,
        delayMinutes: seed.delayMinutes,
        isActive,
      },
      select: { id: true },
    });
    return { ok: true, created: true, ruleIds: [created.id], on: isActive, heldBy };
  });
}

export type SeedReport = {
  templatesCreated: string[];
  rulesCreated: string[];
  /** Already present and left exactly as they were. */
  templatesKept: number;
  rulesKept: number;
  /**
   * Created switched **off** although they ship on, because an existing
   * switched-on rule already sends the same event on the same channel.
   */
  rulesHeld: string[];
  /** Shipped rules whose template has not been written yet, so not created. */
  rulesWaiting: string[];
  /** Shipped rules that had lost their template and were pointed back at it. */
  rulesRepaired: string[];
};

/**
 * Put back anything the store ships with that is missing. **Additive only.**
 *
 * It never edits a template's words, never re-points a rule and **never flips
 * `isActive` on a row that exists** — every rule goes through {@link setAlert}
 * in `createOnly` mode, which returns an existing row untouched. A seeder that
 * "corrects" a switch on the next deploy is a seeder that silently un-pauses a
 * rule somebody switched off for a reason — the same class of bug as a
 * `@default` on `SiteSettings.dispatchOnConfirm`, which CLAUDE.md records.
 *
 * Existing rows are recognised by **signature, not by name**, which is what
 * stops a restore from putting a second copy of a renamed rule beside it.
 *
 * The one thing it repairs: a shipped rule whose `templateId` is null (its
 * template was deleted out from under it) is pointed back at the shipped
 * template. That fills a hole rather than overriding a choice — there is no
 * screen on which "no template" can be chosen — and it is what makes the
 * grid's "cannot send" warning fixable by pressing Restore.
 *
 * Safe to run repeatedly. Nothing here is destructive.
 */
export async function syncSystemAutomation(): Promise<SeedReport> {
  const report: SeedReport = {
    templatesCreated: [],
    rulesCreated: [],
    templatesKept: 0,
    rulesKept: 0,
    rulesHeld: [],
    rulesWaiting: [],
    rulesRepaired: [],
  };

  const templateIds = new Map<string, string>();
  for (const t of SYSTEM_TEMPLATES) {
    const ensured = await ensureShippedTemplate(t.key);
    if (!ensured) continue;
    templateIds.set(t.key, ensured.id);
    if (ensured.created) report.templatesCreated.push(t.key);
    else report.templatesKept += 1;
  }

  for (const r of SYSTEM_RULES) {
    const outcome = await setAlert({
      identity: {
        trigger: r.trigger,
        conditions: r.conditions,
        recipient: r.recipient,
        action: r.action ?? "email",
      },
      enabled: r.isActive,
      createOnly: true,
      onCollision: "pause",
    });
    if (!outcome.ok) {
      if (outcome.code === "no-template") report.rulesWaiting.push(r.name);
      else console.warn(`[automation] sync: "${r.name}" not created — ${outcome.error}`);
      continue;
    }
    if (outcome.created) {
      report.rulesCreated.push(r.name);
      if (outcome.heldBy) report.rulesHeld.push(r.name);
    } else {
      report.rulesKept += 1;
    }
  }

  // The repair. One query that normally returns nothing.
  const orphaned = await prisma.automationRule.findMany({
    where: { templateId: null },
    select: { id: true, name: true, trigger: true, conditions: true, action: true, recipient: true },
  });
  for (const rule of orphaned) {
    const identity = { ...rule, conditions: readConditions(rule.conditions) };
    const seed = seedForAlert(identity);
    const templateId = seed ? templateIds.get(seed.templateKey) : undefined;
    if (!templateId) continue;
    await prisma.automationRule.updateMany({
      where: { id: rule.id, templateId: null },
      data: { templateId },
    });
    report.rulesRepaired.push(rule.name);
  }

  return report;
}

/* ------------------------------------------------------------------ */
/*  Mail that is not rule-driven                                       */
/* ------------------------------------------------------------------ */

/**
 * The mail no switch can stop — the one-time code, the password reset and the
 * contact form. It now lives beside the grid that lists it, as `ALWAYS_SENT`
 * in `lib/notification-channels.ts`, because Settings → Alerts renders it from
 * a client component and this module is server-only. Re-exported under its old
 * name; it is the same array, not a copy.
 */
export const DIRECT_MAIL = ALWAYS_SENT;

/* ------------------------------------------------------------------ */
/*  The in-app feed                                                    */
/* ------------------------------------------------------------------ */

/**
 * One entry in the notification bell.
 *
 * `id` is the job's own id, which makes it stable across polls — the client
 * dedupes on it, so a poll that overlaps a delivery cannot show the same
 * notification twice.
 */
export type FeedItem = {
  id: string;
  title: string;
  body: string;
  /** Same-origin path the entry opens. */
  url: string;
  /** ISO timestamp — when it was delivered, not when the rule was written. */
  at: string;
  /** "order" | "return" | "chat" | "lead" — the bell picks an icon from it. */
  kind: string;
};

type InAppPayload = {
  title?: unknown;
  body?: unknown;
  url?: unknown;
  at?: unknown;
  subjectType?: unknown;
};

function readInApp(payload: unknown): InAppPayload | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const inapp = (payload as Record<string, unknown>).inapp;
  if (!inapp || typeof inapp !== "object" || Array.isArray(inapp)) return null;
  return inapp as InAppPayload;
}

/** How many entries a feed ever returns. A bell is a recent list, not an archive. */
const FEED_LIMIT = 30;

/**
 * **What the notification bell reads.**
 *
 * The feed is not a table. It is the `AutomationJob` rows whose rule sends on
 * the `inapp` channel, and that is the single design decision this whole
 * feature rests on — so it is worth saying why, given that a `Notification`
 * model is the obvious alternative.
 *
 * A job row already *is* a delivered notification. It is created exactly once
 * per (rule, subject) by the unique index, claimed exactly once by the
 * compare-and-set, held off by `occurredAt` and cancelled when it stops
 * applying. A separate table would have to re-earn every one of those
 * properties, and the first time the two disagreed — a job sent, no
 * notification row, or the reverse — there would be no way to tell which was
 * right. Reading the feed off the job row means **the switch the owner ticks
 * on Settings → Alerts and the thing that appears in the bell are the same
 * rule's rows**, which is the property the brief asks for and the reason there
 * is no second store to keep in step.
 *
 * It also means this needed no migration, which was a hard constraint.
 *
 * Two audiences, and the filter is the difference:
 *
 * - **admin** — every `inapp` job whose rule is addressed to `admin`. There is
 *   one owner, so there is nothing further to narrow by.
 * - **customer** — matched on the account id stamped at delivery, falling back
 *   to the email address the *email* leg of the same rule would have used.
 *   That fallback is not a guess: it reaches exactly the people the email
 *   reaches, which is the same argument `lib/push-dispatch.ts` makes for
 *   resolving a guest order's address to an account.
 *
 * Ordering is by `runAt`, not `sentAt`, so it rides the existing
 * `@@index([status, runAt])`. Every `inapp` rule ships with `delayMinutes: 0`,
 * which makes the two identical — and a delayed one would still sort by when
 * it came due, which is the honest timestamp for "when were you told".
 */
export async function listNotifications(
  viewer: { audience: "admin" } | { audience: "customer"; userId: string; email: string }
): Promise<FeedItem[]> {
  try {
    const where: Prisma.AutomationJobWhereInput =
      viewer.audience === "admin"
        ? { status: "sent", rule: { action: "inapp", recipient: "admin" } }
        : {
            status: "sent",
            rule: { action: "inapp", recipient: "customer" },
            OR: [
              { payload: { path: ["inapp", "userId"], equals: viewer.userId } },
              {
                payload: {
                  path: ["inapp", "email"],
                  equals: viewer.email.trim().toLowerCase(),
                },
              },
            ],
          };

    const rows = await prisma.automationJob.findMany({
      where,
      orderBy: { runAt: "desc" },
      take: FEED_LIMIT,
      select: { id: true, payload: true, runAt: true, subjectType: true },
    });

    const items: FeedItem[] = [];
    for (const row of rows) {
      const inapp = readInApp(row.payload);
      // A job claimed but not yet stamped, or one from before this channel
      // existed. Skipping is right: a blank row in a feed reads as broken.
      if (!inapp || typeof inapp.title !== "string" || !inapp.title) continue;
      items.push({
        id: row.id,
        title: inapp.title,
        body: typeof inapp.body === "string" ? inapp.body : "",
        // Same-origin paths only. `lib/push.ts` refuses an absolute URL in a
        // payload so a notification cannot become an open redirect; the same
        // rule applies to a link rendered into the bell.
        url:
          typeof inapp.url === "string" && inapp.url.startsWith("/") && !inapp.url.startsWith("//")
            ? inapp.url
            : "/",
        at: typeof inapp.at === "string" ? inapp.at : row.runAt.toISOString(),
        kind: typeof inapp.subjectType === "string" ? inapp.subjectType : row.subjectType,
      });
    }
    return items;
  } catch (err) {
    // The bell is polled. A feed that throws would turn one bad query into a
    // console full of them, so it fails to empty and says nothing.
    console.error("[automation] feed read failed:", err);
    return [];
  }
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
