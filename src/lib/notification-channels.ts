/**
 * The notification matrix — **a view over `AutomationRule`, not a second store.**
 *
 * The owner asked for one screen where they tick which events notify whom, on
 * which channel. That is a 19 × 4 grid, and the single most expensive mistake
 * available here would be to persist it as its own table or as a blob on
 * `SiteSettings`. `AutomationRule` already models every axis of it exactly:
 *
 * | column        | what it is in the matrix        |
 * |---------------|---------------------------------|
 * | `trigger`     | the event                       |
 * | `conditions`  | which status transition         |
 * | `recipient`   | `customer` / `admin` / address  |
 * | `action`      | the channel                     |
 * | `isActive`    | **the checkbox**                |
 *
 * So a tick flips `isActive` on a real rule, and a tick on a cell that has no
 * row yet creates one from the shipped catalogue (`SYSTEM_RULES`). Storing the
 * grid anywhere else would give the owner a switch that changes nothing the
 * engine reads — the `defaultReturnsInfo` two-writer trap CLAUDE.md records,
 * in a much larger costume.
 *
 * ## Why this module is pure
 *
 * `lib/automation.ts`, `lib/otp.ts`, `lib/email.ts` and both push modules all
 * start with `import "server-only"`. The matrix has to be *rendered* by a
 * client component (it is a grid of checkboxes), so nothing here may reach
 * them — see the RSC traps in CLAUDE.md, where a server page calling
 * `isTabKey()` out of a `"use client"` module took out `/admin/settings`. This
 * file is the mirror image of that rule: **no directive, no server imports, no
 * `process.env`, no React.** Everything it needs arrives as an argument.
 *
 * The server page imports `SYSTEM_RULES`, reads the rules table, calls
 * {@link buildNotificationMatrix} and hands the plain result down. The server
 * action imports the same catalogue and the same helpers, so the cell the
 * browser draws and the rows the server writes cannot disagree about which
 * rule a checkbox means.
 */

/* ------------------------------------------------------------------ */
/*  Channels                                                           */
/* ------------------------------------------------------------------ */

/**
 * The channel vocabulary, in the order they are offered.
 *
 * **`sms` and `whatsapp` are deliberately in this list even though nothing can
 * send them.** A missing control looks like a missing feature; a control that
 * is present, disabled, and says *why* teaches the owner what would have to
 * happen. The brief asked for exactly that, and the store already does it in
 * one other place — the mobile OTP switch, which prints "no SMS gateway" where
 * it is set rather than failing at the till.
 *
 * **Whether a channel can actually be saved is NOT decided here.** That is
 * `IMPLEMENTED_ACTIONS` in `lib/automation.ts`, which is also what
 * `deliverJob` cancels an unknown action against. This module cannot import it
 * (server-only), so the server computes {@link ChannelFact.supported} from it
 * and passes the answer down — one source of truth, and the day someone adds
 * `"sms"` to that list the checkbox lights up on its own with nothing here to
 * change.
 */
export const NOTIFY_CHANNELS = [
  {
    key: "email",
    label: "Email",
    /** One word for a column head. */
    short: "Email",
    blurb:
      "Reaches anyone who left an address — the only channel that works for a first-time guest.",
  },
  {
    key: "push",
    label: "Phone alert",
    short: "Phone",
    blurb:
      "A banner on the lock screen. Only reaches someone who installed the store to their home screen, allowed notifications, and is signed in.",
  },
  {
    key: "inapp",
    label: "In-app bell",
    short: "Bell",
    blurb:
      "Waits in the notification bell until they next look. No install, no permission and no address needed — it never interrupts anybody, and it never fails to arrive.",
  },
  {
    key: "sms",
    label: "SMS",
    short: "SMS",
    blurb:
      "A text message. Needs a gateway account — the code path is already built for one (it is the same seam the mobile one-time code uses).",
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    short: "WhatsApp",
    blurb:
      "A WhatsApp Business message. Needs a Meta Business account with approved message templates before anything can be sent.",
  },
] as const;

export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number]["key"];

export type NotifyChannelSpec = (typeof NOTIFY_CHANNELS)[number];

const CHANNEL_KEYS: readonly string[] = NOTIFY_CHANNELS.map((c) => c.key);

export function isNotifyChannel(v: unknown): v is NotifyChannel {
  return typeof v === "string" && CHANNEL_KEYS.includes(v);
}

export function channelSpec(key: string): NotifyChannelSpec | null {
  return NOTIFY_CHANNELS.find((c) => c.key === key) ?? null;
}

export function channelLabel(key: string): string {
  return channelSpec(key)?.label ?? key;
}

/** One word for a column, falling back to the raw key for a channel added elsewhere. */
export function channelShort(key: string): string {
  return channelSpec(key)?.short ?? key;
}

/**
 * The columns to draw, in order: the named ones first, then anything else the
 * store turns out to have.
 *
 * **The grid's columns are not this module's list.** `IMPLEMENTED_ACTIONS` in
 * `lib/automation.ts` belongs to the delivery engine, and it grows — `inapp`
 * was added to it while this screen was being built, which under a hard-coded
 * column list would have hidden sixteen live, switched-on rules behind a
 * screen claiming to show the whole notification posture. So the caller passes
 * in everything it has actually seen (the engine's list, plus every distinct
 * `action` in the rules table) and a channel this module has never heard of
 * still gets a column, labelled by its key until somebody names it here.
 *
 * Degrading to an ugly label is the right failure. Dropping a row is not.
 */
export function orderedChannels(seen: readonly string[]): string[] {
  const extra = [...new Set(seen)]
    .filter((k) => !CHANNEL_KEYS.includes(k))
    .sort();
  return [...CHANNEL_KEYS, ...extra];
}

/**
 * The WhatsApp seam, deliberately shaped like `smsGateway()` in `lib/otp.ts`.
 *
 * A constant rather than a config read, because there is nothing to read: this
 * build has no WhatsApp credentials of any kind. When a Business account is
 * connected the reader moves to the server beside the sender, exactly as the
 * SMS one will — and the only thing that changes on this screen is that the
 * server stops passing `ready: false` down.
 *
 * It lives here and not inline in a component so the sentence has one home.
 */
export function whatsappGateway(): { ready: boolean; detail: string } {
  return {
    ready: false,
    detail:
      "No WhatsApp Business account is connected to this store, so nothing can be sent on WhatsApp yet.",
  };
}

/**
 * Why SMS is greyed out **on this screen**.
 *
 * `smsGateway()` in `lib/otp.ts` stays the authority on *whether* — this
 * module never decides that, it only asks. What it does own is the wording,
 * because that function's own sentence ends "…so codes cannot be sent by text
 * yet", which is true where it lives (one-time codes at signup) and reads as
 * a non-sequitur beside a checkbox about telling a customer their order
 * shipped. One fact, one owner; one sentence per place it is read.
 */
export const SMS_UNAVAILABLE =
  "No SMS gateway is connected to this store, so nothing can be sent by text yet.";

/**
 * A channel's live state, computed on the server and handed over as data.
 *
 * Two different questions, kept apart on purpose:
 *
 * - **`supported`** — can this build carry the channel at all? Read from
 *   `IMPLEMENTED_ACTIONS`. This is the **hard gate**: a rule may never be saved
 *   active on an unsupported channel, because `deliverJob` would cancel it and
 *   the owner would have a tick that quietly means nothing.
 * - **`healthy`** — is it configured *right now*? A missing Resend key or an
 *   unverified domain is a warning, not a lock. An owner setting rules up on a
 *   Sunday before they buy a domain on Monday is doing nothing wrong, and
 *   refusing the tick would only teach them the screen is broken.
 *
 * The same distinction the store already makes for mobile verification: the
 * switch saves, and says in plain words that it is not in force.
 */
export type ChannelFact = {
  /**
   * A plain `string`, not the {@link NotifyChannel} union, and deliberately:
   * the engine owns the channel list and may grow it (see
   * {@link orderedChannels}). A union here would make a new channel a type
   * error in the one place that should simply have drawn one more column.
   */
  channel: string;
  supported: boolean;
  healthy: boolean;
  /** One sentence. Why it is off, or what it currently reaches. */
  detail: string;
};

/* ------------------------------------------------------------------ */
/*  Sending identity                                                   */
/* ------------------------------------------------------------------ */

// Type-only, and therefore erased at build time — `lib/email.ts` starts with
// `import "server-only"` and never reaches the browser through this line. The
// same trick `settings-sections.tsx` already uses for `lib/temp-admin.ts`.
import type { FromVerdict } from "@/lib/email";

/**
 * Everything the Alerts tab prints about **where mail comes from**, gathered
 * on the server into one serialisable shape.
 *
 * It exists because this was the scattered thing the owner asked to
 * centralise, and because CLAUDE.md records what scattering it cost: an
 * `EMAIL_FROM` on a gmail.com address made Resend reject **every** send with a
 * 403 for weeks, while the code path returned cleanly and nothing on any
 * screen said so. Order confirmations, password resets and contact replies
 * were all silently undeliverable.
 *
 * So this is deliberately the *live* state and not a label: the address, the
 * verdict on its domain, whether a key is even set, and when something last
 * actually left the building. `lastFailed*` is read from `AutomationJob`,
 * which is the only record of a send that survives a deploy.
 *
 * **Nothing here is a secret.** The Resend key is represented by
 * {@link hasApiKey} and never by its value — a screen that prints a send key
 * is a screen that leaks it into a screenshot.
 */
export type SendingIdentity = {
  hasApiKey: boolean;
  /** The whole `EMAIL_FROM`, e.g. `Level7 Clothing <orders@example.com>`. */
  from: string;
  fromAddress: string;
  fromDomain: string;
  verdict: FromVerdict;
  /** One sentence the owner can act on. */
  advice: string;
  /**
   * When something last actually left, already written out as a sentence —
   * "2 days ago · Tell me a return was requested".
   *
   * **Formatted on the server on purpose.** A relative time computed in the
   * browser is computed again at a different instant during hydration, and a
   * date formatted in the browser picks up the viewer's locale and timezone;
   * either one is a hydration mismatch on a screen whose whole job is to be
   * trusted. A plain string cannot drift.
   */
  lastSent: string | null;
  /** Same shape, for the newest failure. */
  lastFailed: string | null;
  /** Resend's own words on that failure. Never contains the API key. */
  lastFailedError: string | null;
  failedCount: number;
};

/** How bad the sending identity is, in one word, for a badge. */
export function identityTone(
  identity: SendingIdentity
): "ok" | "warn" | "bad" {
  if (!identity.hasApiKey) return "bad";
  if (identity.verdict === "unverifiable") return "bad";
  if (identity.verdict === "fallback" || identity.verdict === "resend-test") {
    return "warn";
  }
  return "ok";
}

/* ------------------------------------------------------------------ */
/*  Event identity                                                     */
/* ------------------------------------------------------------------ */

/**
 * A stable, order-independent fingerprint of a rule's `conditions`.
 *
 * `conditions` is a `Json` column, so `{status:"shipped"}` and the same object
 * with its keys written in another order are the same rule and must land in
 * the same matrix row. Sorting is what guarantees that. Empty values are
 * dropped for the same reason `readConditions` drops them: an empty condition
 * means "any", so `{status:""}` is the *unconditional* rule, not a third one.
 */
export function conditionSignature(conditions: Record<string, string>): string {
  return Object.entries(conditions)
    .filter(([, v]) => typeof v === "string" && v.trim() !== "")
    .map(([k, v]) => `${k}=${v.trim()}`)
    .sort()
    .join(",");
}

/**
 * The identity of one matrix row: an event, narrowed, going to one party.
 *
 * The **channel is deliberately not part of it** — a row is "an order shipped,
 * told to the customer" and its four cells are the four ways of telling them.
 * That is the whole reason the grid reads in a glance instead of as 76
 * unrelated switches.
 */
export function eventKeyOf(
  trigger: string,
  conditions: Record<string, string>,
  recipient: string
): string {
  return `${trigger}|${conditionSignature(conditions)}|${recipient}`;
}

/** The inverse. Returns `null` for anything that is not a key this module made. */
export function parseEventKey(
  key: string
): { trigger: string; conditions: Record<string, string>; recipient: string } | null {
  const parts = key.split("|");
  if (parts.length !== 3) return null;
  const [trigger, sig, recipient] = parts;
  if (!trigger || !recipient) return null;

  const conditions: Record<string, string> = {};
  if (sig) {
    for (const pair of sig.split(",")) {
      const eq = pair.indexOf("=");
      if (eq <= 0) return null;
      conditions[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
  }
  return { trigger, conditions, recipient };
}

/* ------------------------------------------------------------------ */
/*  Families                                                           */
/* ------------------------------------------------------------------ */

/**
 * Four families, because 19 rows in one list is a spreadsheet.
 *
 * Grouped by the part of the shop an owner is thinking about when they come
 * looking — "stop emailing people about returns" is one errand, and it should
 * be one fold, not seven rows found by reading.
 */
export const EVENT_FAMILIES = [
  {
    key: "orders",
    label: "Orders",
    blurb: "Placed, confirmed, on its way, delivered.",
  },
  {
    key: "carts",
    label: "Carts left behind",
    blurb: "Someone got as far as a basket and stopped.",
  },
  {
    key: "returns",
    label: "Returns & refunds",
    blurb: "The parcel travelling the other way.",
  },
  {
    key: "chat",
    label: "Messages",
    blurb: "Somebody is waiting for an answer — in either direction.",
  },
  {
    // Anything a future trigger adds, and anything hand-made with a trigger
    // this module has not been taught. It is listed rather than dropped: a
    // matrix that silently hides a live rule is worse than an untidy heading.
    key: "other",
    label: "Everything else",
    blurb: "Rules on events this screen has no family for yet.",
  },
] as const;

export type FamilyKey = (typeof EVENT_FAMILIES)[number]["key"];

export function familyOf(trigger: string): FamilyKey {
  if (trigger.startsWith("order.")) return "orders";
  if (trigger.startsWith("cart.")) return "carts";
  if (trigger.startsWith("return.")) return "returns";
  if (trigger.startsWith("chat.")) return "chat";
  return "other";
}

/**
 * Short row labels, keyed by `trigger|conditionSignature`.
 *
 * **This is presentation only and nothing reads it at runtime but a heading.**
 * A row whose signature is absent falls back to the label the engine's own
 * catalogue generates (`triggerLabel` + `describeConditions`, passed in by the
 * caller), so a new trigger or a hand-made rule still gets a truthful name —
 * it just gets a longer one. That fallback is what keeps this from being a
 * second catalogue: forgetting to add a line here costs a tidy label, never a
 * missing row.
 *
 * The shipped names in `SYSTEM_RULES` are sentences ("Tell the customer their
 * order has shipped") because they name a *rule*. A matrix row is a column
 * heading with a recipient already stated above it, so it wants the event and
 * nothing else.
 */
const EVENT_LABELS: Readonly<Record<string, string>> = {
  "order.created|": "An order is placed",
  "order.status_changed|status=confirmed": "Order confirmed",
  "order.status_changed|status=shipped": "Order shipped",
  "order.status_changed|status=delivered": "Order delivered",
  "order.status_changed|status=cancelled": "Order cancelled",
  "order.status_changed|status=pending": "Order back to pending",
  "cart.abandoned|": "A cart is left behind",
  "return.requested|": "A return is requested",
  "return.status_changed|status=approved": "Return approved",
  "return.status_changed|status=rejected": "Return refused",
  "return.status_changed|status=cancelled": "Return closed",
  "return.status_changed|status=picked_up": "Return collected",
  "return.status_changed|status=received": "Return arrived back",
  "return.status_changed|status=refunded": "Refund sent",
  "order.payment_changed|paymentStatus=failed": "A payment fails",
  "order.payment_changed|paymentMethod=Razorpay,paymentStatus=failed":
    "A prepaid payment fails",
  "order.payment_changed|paymentMethod=Partial,paymentStatus=failed":
    "An advance payment fails",
  "order.rto|stage=returning": "A parcel starts coming back",
  "order.rto|stage=returned": "A parcel arrives back",
  "chat.message_received|": "A customer writes in",
  "chat.reply_sent|": "You reply in chat",
};

export function eventLabel(
  trigger: string,
  conditions: Record<string, string>,
  fallback: string
): string {
  return EVENT_LABELS[`${trigger}|${conditionSignature(conditions)}`] ?? fallback;
}

/**
 * The fallback label's shape, in one place.
 *
 * Both the settings page and the server action need "what the engine calls
 * this event" for a row with no entry in {@link EVENT_LABELS} — the page to
 * print it, the action to name a rule it is creating. The two strings it is
 * built from (`triggerLabel`, `describeConditions`) are server-only, so they
 * are passed in; only the shape lives here, so the two callers cannot drift
 * into labelling the same row two different ways.
 */
export function composeFallbackLabel(
  triggerText: string,
  conditionText: string
): string {
  const cond = conditionText.trim();
  // `describeConditions` returns "Every time" for an unnarrowed rule, which is
  // true and adds nothing to a heading.
  if (!cond || cond.toLowerCase() === "every time") return triggerText;
  return `${triggerText} · ${cond}`;
}

/**
 * Who a row is addressed to, as a group heading.
 *
 * Splitting each family by recipient is what removes a whole column from the
 * grid: with "To your customer" and "To you" as headings, every row underneath
 * is just an event and its four ticks. It also answers the question the owner
 * actually asks — *what do my customers get from me, and what do I get?* —
 * which a recipient column buried between two others never does.
 */
export function recipientGroupLabel(recipient: string): string {
  if (recipient === "customer") return "To your customer";
  if (recipient === "admin") return "To you";
  return `To ${recipient}`;
}

/** "straight away" / "after 24 hours" — the rule's delay, in the owner's words. */
export function delayLabel(minutes: number): string {
  if (!minutes || minutes <= 0) return "straight away";
  if (minutes < 60) return `after ${minutes} min`;
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `after ${days} day${days === 1 ? "" : "s"}`;
  }
  const hours = Math.round(minutes / 60);
  return `after ${hours} hour${hours === 1 ? "" : "s"}`;
}

/* ------------------------------------------------------------------ */
/*  Building the view                                                  */
/* ------------------------------------------------------------------ */

/**
 * One shipped rule, structurally. `SystemRule` from `lib/automation.ts`
 * satisfies this, which is the point — the catalogue is passed in rather than
 * imported, so this module stays client-safe.
 */
export type CatalogueEntry = {
  name: string;
  trigger: string;
  conditions: Record<string, string>;
  templateKey: string;
  recipient: string;
  delayMinutes: number;
  action?: string;
};

/** One live row, already serialised by the server. */
export type RuleRow = {
  id: string;
  name: string;
  trigger: string;
  conditions: Record<string, string>;
  action: string;
  recipient: string;
  delayMinutes: number;
  isActive: boolean;
  /** False when `templateId` is null — the rule exists and cannot send. */
  hasTemplate: boolean;
};

export type MatrixCell = {
  /** See {@link ChannelFact.channel} — a string, so the engine can add one. */
  channel: string;
  /**
   * Every rule this cell governs — normally one, occasionally more if the
   * owner duplicated a rule by hand in Admin → Automation. A tick moves all of
   * them together, and the cell says so, because a checkbox that silently
   * changes one of two identical rules is a lie about the other.
   */
  ruleIds: string[];
  /** On when every governing rule is active. */
  on: boolean;
  /** Some on, some off. Only possible with duplicates. */
  mixed: boolean;
  /** A rule exists here but has no template, so it cannot send. */
  broken: boolean;
};

export type MatrixRow = {
  /** `eventKeyOf(trigger, conditions, recipient)`. */
  key: string;
  trigger: string;
  conditions: Record<string, string>;
  recipient: string;
  label: string;
  /** No shipped catalogue entry covers this event — someone built it by hand. */
  custom: boolean;
  /** Non-null only when the event does not fire straight away. */
  delay: string | null;
  /**
   * Whether a missing cell on this row could be created at all. False when
   * neither the catalogue nor an existing sibling rule can name a template,
   * in which case an empty cell is shown disabled rather than offered and then
   * refused.
   */
  creatable: boolean;
  cells: MatrixCell[];
};

export type MatrixGroup = {
  recipient: string;
  label: string;
  rows: MatrixRow[];
};

export type MatrixFamily = {
  key: FamilyKey;
  label: string;
  blurb: string;
  groups: MatrixGroup[];
  /** Ticks currently on, out of the cells that can be ticked at all. */
  on: number;
  available: number;
  /** Rows in this family, for the closed summary. */
  events: number;
};

export type NotificationMatrix = {
  families: MatrixFamily[];
  /**
   * The columns, in order — every channel this store has, named or not.
   * Rendered from here rather than from {@link NOTIFY_CHANNELS} so a channel
   * the engine added still gets one.
   */
  channels: string[];
  /** On-count per channel across the whole store, for the posture strip. */
  byChannel: Record<string, number>;
  /** Rules that exist and cannot send, anywhere in the grid. */
  brokenCount: number;
};

/** Ordering inside a family: customers first, then the owner, then addresses. */
function recipientRank(recipient: string): number {
  if (recipient === "customer") return 0;
  if (recipient === "admin") return 1;
  return 2;
}

/**
 * Turn the shipped catalogue plus the live rules into the grid on screen.
 *
 * Three properties this has to hold, in order of how badly each would hurt:
 *
 * 1. **Every live rule appears somewhere.** The union is taken over the
 *    catalogue *and* the database, never the catalogue alone. A rule the owner
 *    wrote by hand in Admin → Automation is a rule that sends mail, and a
 *    screen claiming to be the whole notification posture cannot leave it out.
 *    Those rows are flagged `custom` and the screen links to their editor.
 * 2. **A cell knows the rules it governs, and the server re-derives them.**
 *    The ids here are for rendering; the action resolves the same set again
 *    from `(eventKey, channel)` before it writes, so a stale tab cannot toggle
 *    something that has since moved.
 * 3. **An unsupported channel is a cell, not a gap.** The cell is built for
 *    every channel in {@link NOTIFY_CHANNELS}; whether it is interactive is
 *    decided by the {@link ChannelFact} the server supplies.
 *
 * `labelFor` is injected because the truthful fallback label comes from
 * `triggerLabel` / `describeConditions`, both of which are server-only.
 */
export function buildNotificationMatrix({
  catalogue,
  rules,
  facts,
  labelFor,
}: {
  catalogue: readonly CatalogueEntry[];
  rules: readonly RuleRow[];
  facts: readonly ChannelFact[];
  /** `(trigger, conditions) => "An order's status changes · Shipped"`. */
  labelFor: (trigger: string, conditions: Record<string, string>) => string;
}): NotificationMatrix {
  // The columns come from `facts`, which the caller built from everything it
  // has seen — never from NOTIFY_CHANNELS. See `orderedChannels`.
  const columns = facts.map((f) => f.channel);
  const supported = new Set(facts.filter((f) => f.supported).map((f) => f.channel));

  type Seed = {
    trigger: string;
    conditions: Record<string, string>;
    recipient: string;
    custom: boolean;
    delayMinutes: number;
    /** Rules on this row, by channel. */
    byChannel: Map<string, RuleRow[]>;
    /** True when a template can be found for a cell that does not exist yet. */
    templateReachable: boolean;
  };

  const seeds = new Map<string, Seed>();

  function seedFor(
    trigger: string,
    conditions: Record<string, string>,
    recipient: string,
    custom: boolean,
    delayMinutes: number
  ): Seed {
    const key = eventKeyOf(trigger, conditions, recipient);
    const existing = seeds.get(key);
    if (existing) {
      // A catalogue entry always wins the `custom` flag: if the store ships
      // this event, the row is not somebody's invention even when a live rule
      // was seen first.
      if (!custom) existing.custom = false;
      return existing;
    }
    const seed: Seed = {
      trigger,
      conditions,
      recipient,
      custom,
      delayMinutes,
      byChannel: new Map(),
      templateReachable: false,
    };
    seeds.set(key, seed);
    return seed;
  }

  // The catalogue first, so a shipped event has a row even with nothing in the
  // database — which is exactly the "unticked row that does not exist yet"
  // case: the checkbox is drawn, and ticking it creates the rule.
  for (const entry of catalogue) {
    const seed = seedFor(
      entry.trigger,
      entry.conditions,
      entry.recipient,
      false,
      entry.delayMinutes
    );
    // A shipped entry names a template, so every cell on this row is creatable.
    seed.templateReachable = true;
  }

  for (const rule of rules) {
    const seed = seedFor(
      rule.trigger,
      rule.conditions,
      rule.recipient,
      true,
      rule.delayMinutes
    );
    const list = seed.byChannel.get(rule.action) ?? [];
    list.push(rule);
    seed.byChannel.set(rule.action, list);
    // A hand-made row can still fill its other channels, as long as one of its
    // rules has a template to borrow.
    if (rule.hasTemplate) seed.templateReachable = true;
  }

  const byChannel: Record<string, number> = Object.fromEntries(
    columns.map((c) => [c, 0])
  );
  let brokenCount = 0;

  const rowsByFamily = new Map<FamilyKey, MatrixRow[]>();

  for (const seed of seeds.values()) {
    const cells: MatrixCell[] = columns.map((channel) => {
      const matching = seed.byChannel.get(channel) ?? [];
      const on = matching.length > 0 && matching.every((r) => r.isActive);
      const anyOn = matching.some((r) => r.isActive);
      // A rule with no template cannot send. Counted only while it is switched
      // on, because a paused rule with no words is not a problem yet.
      const broken = matching.some((r) => r.isActive && !r.hasTemplate);
      if (anyOn) byChannel[channel] += 1;
      if (broken) brokenCount += 1;
      return {
        channel,
        ruleIds: matching.map((r) => r.id),
        on,
        mixed: anyOn && !on,
        broken,
      };
    });

    const row: MatrixRow = {
      key: eventKeyOf(seed.trigger, seed.conditions, seed.recipient),
      trigger: seed.trigger,
      conditions: seed.conditions,
      recipient: seed.recipient,
      label: eventLabel(
        seed.trigger,
        seed.conditions,
        labelFor(seed.trigger, seed.conditions)
      ),
      custom: seed.custom,
      delay: seed.delayMinutes > 0 ? delayLabel(seed.delayMinutes) : null,
      creatable: seed.templateReachable,
      cells,
    };

    const family = familyOf(seed.trigger);
    const list = rowsByFamily.get(family) ?? [];
    list.push(row);
    rowsByFamily.set(family, list);
  }

  const families: MatrixFamily[] = [];

  for (const spec of EVENT_FAMILIES) {
    const rows = rowsByFamily.get(spec.key);
    // An empty family is not rendered: "Everything else (0)" is a row of
    // furniture that answers nothing.
    if (!rows || rows.length === 0) continue;

    const groups = new Map<string, MatrixRow[]>();
    for (const row of rows) {
      const list = groups.get(row.recipient) ?? [];
      list.push(row);
      groups.set(row.recipient, list);
    }

    let on = 0;
    let available = 0;
    for (const row of rows) {
      for (const cell of row.cells) {
        if (!supported.has(cell.channel)) continue;
        available += 1;
        if (cell.on || cell.mixed) on += 1;
      }
    }

    families.push({
      key: spec.key,
      label: spec.label,
      blurb: spec.blurb,
      on,
      available,
      events: rows.length,
      groups: [...groups.entries()]
        .sort((a, b) => recipientRank(a[0]) - recipientRank(b[0]))
        .map(([recipient, groupRows]) => ({
          recipient,
          label: recipientGroupLabel(recipient),
          rows: groupRows,
        })),
    });
  }

  return { families, channels: columns, byChannel, brokenCount };
}
