/**
 * The notification matrix — **a view over `AutomationRule`, not a second store.**
 *
 * Settings → Alerts is the one screen where an alert is switched on, off or
 * brought into existence. `AutomationRule` already models every axis of that
 * grid exactly, so the screen stores nothing of its own:
 *
 * | column        | what it is in the matrix        |
 * |---------------|---------------------------------|
 * | `trigger`     | the event                       |
 * | `conditions`  | which status transition         |
 * | `recipient`   | `customer` / `admin` / address  |
 * | `action`      | the channel                     |
 * | `isActive`    | **the checkbox**                |
 *
 * ## The signature — what makes two rules "the same alert"
 *
 * {@link alertSignature} is `trigger | recipient | action | conditions`, with
 * the conditions case-folded, trimmed, emptied keys dropped and sorted. It is
 * the key every writer is keyed by (`setAlert` in `lib/automation.ts`), and it
 * was chosen by asking one question of each column: *if two rows differ only
 * here, would one event reach one person twice on one channel?*
 *
 * - **`trigger`, `recipient`, `action` — in.** Different event, different
 *   person or different channel is a different message by definition. Email
 *   and bell for the same event are two alerts on purpose.
 * - **`conditions` — in, normalised the way `conditionsMatch` compares.** That
 *   function lower-cases and trims both sides, so `COD` and `cod` are one
 *   condition and must be one signature — a case-sensitive key would let a
 *   second rule in through a capital letter.
 * - **`templateId` — out.** Two rules for one event with two templates are two
 *   emails in one inbox. The wording is not what makes an alert distinct.
 * - **`delayMinutes` — out.** "Straight away" and "after a day" for the same
 *   event, same person, same channel is the same message sent twice. The grid
 *   has no delay axis, so a cell could not even tell them apart.
 * - **`name` — out.** It used to be the sync's identity, which is exactly how a
 *   rename manufactured a duplicate: rename a shipped rule and the next restore
 *   no longer recognised it, and put a second copy back beside it.
 *
 * A signature alone is not enough, because conditions are equality tests and
 * "any status" matches every status. `{}` and `{status: "shipped"}` are two
 * signatures and one shipped order. {@link conditionsOverlap} is the second
 * test: two rules in one {@link alertGroupOf} (same trigger, person, channel)
 * collide unless some condition key they both name has different values.
 *
 * ## Why this module is pure
 *
 * `lib/automation.ts`, `lib/otp.ts`, `lib/email.ts` and both push modules all
 * start with `import "server-only"`. The matrix has to be *rendered* by a
 * client component, so nothing here may reach them — see the RSC traps in
 * CLAUDE.md. **No directive, no server imports, no `process.env`, no React.**
 * The engine imports the identity helpers from here, so the cell the browser
 * draws and the row the server writes are keyed by one function.
 */

/* ------------------------------------------------------------------ */
/*  Channels                                                           */
/* ------------------------------------------------------------------ */

/**
 * The channel vocabulary, in the order they are offered.
 *
 * `sms` and `whatsapp` are in the vocabulary although nothing can send them.
 * **Whether a channel can actually be saved is NOT decided here** — that is
 * `IMPLEMENTED_ACTIONS` in `lib/automation.ts`, the same list `deliverJob`
 * cancels an unknown action against. The server computes
 * {@link ChannelFact.supported} from it and passes the answer down; the grid
 * draws a column only for a supported channel, or for an unsupported one that
 * still has a rule on it (so an orphan tick can always be cleared).
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
 * The columns to consider, in order: the named ones first, then anything else
 * the store turns out to have.
 *
 * The caller passes everything it has seen (the engine's list plus every
 * distinct `action` in the rules table), so a channel this module has never
 * heard of still gets a column rather than hiding a live rule.
 */
export function orderedChannels(seen: readonly string[]): string[] {
  const extra = [...new Set(seen)]
    .filter((k) => !CHANNEL_KEYS.includes(k))
    .sort();
  return [...CHANNEL_KEYS, ...extra];
}

/** The WhatsApp seam, shaped like `smsGateway()` in `lib/otp.ts`. */
export function whatsappGateway(): { ready: boolean; detail: string } {
  return {
    ready: false,
    detail:
      "No WhatsApp Business account is connected to this store, so nothing can be sent on WhatsApp yet.",
  };
}

/**
 * Why SMS is unavailable **on this screen**. `smsGateway()` in `lib/otp.ts`
 * decides whether; this is only the wording for a checkbox about an order.
 */
export const SMS_UNAVAILABLE =
  "No SMS gateway is connected to this store, so nothing can be sent by text yet.";

/**
 * A channel's live state, computed on the server and handed over as data.
 *
 * - **`supported`** — can this build carry it at all (`IMPLEMENTED_ACTIONS`).
 *   The hard gate: a rule is never saved active on an unsupported channel.
 * - **`healthy`** — is it configured right now. A warning, never a lock.
 */
export type ChannelFact = {
  /** A plain string — the engine owns the channel list and may grow it. */
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
// `import "server-only"` and never reaches the browser through this line.
import type { FromVerdict } from "@/lib/email";

/**
 * Everything the Alerts tab prints about **where mail comes from**, gathered
 * on the server into one serialisable shape. Nothing here is a secret — the
 * Resend key is represented by `hasApiKey` and never by its value.
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
  /** "2 days ago · Tell me a return was requested" — formatted on the server. */
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
/*  Mail that is never a rule                                          */
/* ------------------------------------------------------------------ */

/**
 * **The messages the store sends that no switch can stop.**
 *
 * Each is a reply to something a person did seconds ago, not a notification
 * about the store, and each would break something if it could be paused: a
 * paused one-time code stops an account being created or an order being
 * placed with the customer staring at an input nothing can fill; a paused
 * password reset locks people out; a paused contact form bins enquiries the
 * sender believes were delivered.
 *
 * They are listed so Settings → Alerts is the **whole** picture of what the
 * store sends, not the part it owns — shown there as read-only "always sent"
 * rows. Nothing reads this at runtime to decide anything; if a direct sender
 * is ever added to `lib/email.ts`, add it here or the screen stops being true.
 * The senders are `sendOtpEmail`, `sendPasswordResetEmail` and
 * `sendContactEmail`, and nothing else in the app talks to Resend except the
 * engine's `sendAutomationEmail`.
 */
export type AlwaysSentMail = {
  key: string;
  name: string;
  /** "The customer" / "You (admin)" — who it reaches. */
  to: string;
  /** When it goes, in a few words. */
  when: string;
  channel: "email";
  why: string;
};

export const ALWAYS_SENT: readonly AlwaysSentMail[] = [
  {
    key: "otp",
    name: "One-time code",
    to: "The customer",
    when: "When Settings asks them to confirm an email",
    channel: "email",
    why: "A six-digit code that expires in ten minutes, waited for on a form. A switch that could pause it would stop accounts being created and orders being placed, with the customer staring at an input nothing can fill. It only goes when a confirmation switch below asks for one.",
  },
  {
    key: "password-reset",
    name: "Password reset link",
    to: "The customer",
    when: "When they ask to reset it",
    channel: "email",
    why: "Carries a one-time link and answers something they did seconds ago. A switch that could pause it would lock people out of their own accounts.",
  },
  {
    key: "contact-form",
    name: "Contact form enquiry",
    to: "You (admin)",
    when: "When someone writes via Contact",
    channel: "email",
    why: "The contact form's own delivery, to your alert address. Pausing it would bin messages the sender believes were sent.",
  },
];

/* ------------------------------------------------------------------ */
/*  Alert identity — the key every writer uses                         */
/* ------------------------------------------------------------------ */

/** The four columns that decide whether two rules are one alert. */
export type AlertIdentity = {
  trigger: string;
  conditions: Record<string, string>;
  recipient: string;
  action: string;
};

/**
 * Conditions as `conditionsMatch` actually compares them: trimmed and
 * lower-cased values, empty ones dropped (an empty condition means "any"),
 * sorted by key. Keys are left as written — the engine reads `facts[key]`
 * exactly, so `Status` and `status` genuinely are different conditions.
 */
function normalisedPairs(conditions: Record<string, string>): [string, string][] {
  return Object.entries(conditions ?? {})
    .filter(([, v]) => typeof v === "string" && v.trim() !== "")
    .map(([k, v]) => [k, v.trim().toLowerCase()] as [string, string])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** `customer` / `admin` as they are; a literal address case-folded. */
export function normaliseRecipient(recipient: string): string {
  const r = (recipient ?? "").trim();
  return r === "customer" || r === "admin" ? r : r.toLowerCase();
}

/**
 * Same event, same person, same channel — the set inside which two rules can
 * send one thing twice. Also the key the engine locks on while it writes.
 */
export function alertGroupOf(a: Pick<AlertIdentity, "trigger" | "recipient" | "action">): string {
  return `${a.trigger.trim()}|${normaliseRecipient(a.recipient)}|${a.action.trim()}`;
}

/** Two rows with the same string are the same alert. See the header. */
export function alertSignature(a: AlertIdentity): string {
  const conditions = normalisedPairs(a.conditions)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
  return `${alertGroupOf(a)}|${conditions}`;
}

/**
 * Can one event satisfy both condition sets?
 *
 * Conditions are equality tests and an absent key means "any", so two sets
 * are disjoint only when some key they **both** name has different values.
 * `{status: shipped}` vs `{status: delivered}` — disjoint. `{}` vs anything —
 * overlapping. `{status: shipped}` vs `{paymentMethod: COD}` — overlapping (a
 * shipped COD order matches both).
 */
export function conditionsOverlap(
  a: Record<string, string>,
  b: Record<string, string>
): boolean {
  const left = new Map(normalisedPairs(a));
  for (const [key, value] of normalisedPairs(b)) {
    const other = left.get(key);
    if (other !== undefined && other !== value) return false;
  }
  return true;
}

export type CollisionRule = AlertIdentity & {
  id: string;
  name: string;
  isActive: boolean;
};

/**
 * Two **switched-on** rules that would send one event to one person twice on
 * one channel.
 *
 * `duplicate` — the same signature twice. `overlap` — different signatures
 * whose conditions can both match one event (`{}` beside `{status: shipped}`).
 */
export type AlertCollision = {
  kind: "duplicate" | "overlap";
  a: { id: string; name: string };
  b: { id: string; name: string };
  trigger: string;
  recipient: string;
  channel: string;
};

/**
 * Every live double-send in a set of rules. Only active rules count: two
 * paused copies of one alert send nothing, and the grid already shows ×2 on
 * the cell. This is a report, not a guard — the guard is `setAlert`, which
 * refuses to create either shape in the first place.
 */
export function findCollisions(rules: readonly CollisionRule[]): AlertCollision[] {
  const groups = new Map<string, CollisionRule[]>();
  for (const rule of rules) {
    if (!rule.isActive) continue;
    const key = alertGroupOf(rule);
    const list = groups.get(key) ?? [];
    list.push(rule);
    groups.set(key, list);
  }

  const out: AlertCollision[] = [];
  for (const list of groups.values()) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        const same = alertSignature(a) === alertSignature(b);
        if (!same && !conditionsOverlap(a.conditions, b.conditions)) continue;
        out.push({
          kind: same ? "duplicate" : "overlap",
          a: { id: a.id, name: a.name },
          b: { id: b.id, name: b.name },
          trigger: a.trigger,
          recipient: a.recipient,
          channel: a.action,
        });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Event identity — one matrix row                                    */
/* ------------------------------------------------------------------ */

/**
 * A stable, order-independent fingerprint of a rule's `conditions`, **as
 * written** — used for display keys and labels. Identity for writing is
 * {@link alertSignature}, which also case-folds.
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
 * The channel is deliberately not part of it — a row's cells are the ways of
 * telling that person about that event.
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
 * The folds on the Alerts grid, ordered by how often an owner comes looking.
 *
 * Grouped by errand rather than by trigger: "what happens when a payment
 * fails" and "what happens when a parcel comes back" are one question about
 * things going wrong, so they share a fold instead of lengthening Orders.
 */
export const EVENT_FAMILIES = [
  {
    key: "orders",
    label: "Orders",
    blurb: "Placed, confirmed, on its way, delivered.",
  },
  {
    key: "chat",
    label: "Messages",
    blurb: "Somebody is waiting for an answer — in either direction.",
  },
  {
    key: "returns",
    label: "Returns & refunds",
    blurb: "The parcel travelling the other way.",
  },
  {
    key: "problems",
    label: "Payment & delivery problems",
    blurb: "A payment that didn't go through, a parcel that couldn't be delivered.",
  },
  {
    key: "stock",
    label: "Stock",
    blurb: "A tracked size running low or selling out.",
  },
  {
    key: "carts",
    label: "Carts left behind",
    blurb: "Someone got as far as a basket and stopped.",
  },
  {
    // Anything a future trigger adds. Listed rather than dropped: a grid that
    // silently hides a live rule is worse than an untidy heading.
    key: "other",
    label: "Everything else",
    blurb: "Rules on events this screen has no family for yet.",
  },
] as const;

export type FamilyKey = (typeof EVENT_FAMILIES)[number]["key"];

export function familyOf(trigger: string): FamilyKey {
  if (trigger === "order.payment_changed" || trigger === "order.rto") return "problems";
  if (trigger.startsWith("order.")) return "orders";
  if (trigger.startsWith("cart.")) return "carts";
  if (trigger.startsWith("return.")) return "returns";
  if (trigger.startsWith("chat.")) return "chat";
  if (trigger.startsWith("inventory.")) return "stock";
  return "other";
}

/**
 * Short row labels, keyed by `trigger|conditionSignature`. Presentation only:
 * a row with no entry falls back to the engine's own catalogue wording, so a
 * forgotten line costs a tidy label, never a missing row.
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
  "inventory.low_stock|": "A size runs low or sells out",
};

export function eventLabel(
  trigger: string,
  conditions: Record<string, string>,
  fallback: string
): string {
  return EVENT_LABELS[`${trigger}|${conditionSignature(conditions)}`] ?? fallback;
}

/**
 * The fallback label's shape, in one place — "An order's status changes ·
 * Shipped". The two strings it is built from are server-only, so they are
 * passed in.
 */
export function composeFallbackLabel(
  triggerText: string,
  conditionText: string
): string {
  const cond = conditionText.trim();
  if (!cond || cond.toLowerCase() === "every time") return triggerText;
  return `${triggerText} · ${cond}`;
}

/** Who a row is addressed to, as a group heading. */
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
 * satisfies this — the catalogue is passed in, so this module stays
 * client-safe.
 */
export type CatalogueEntry = {
  name: string;
  trigger: string;
  conditions: Record<string, string>;
  templateKey: string;
  recipient: string;
  delayMinutes: number;
  action?: string;
  isActive?: boolean;
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
   * Every rule with this cell's signature. Normally one. More only in a
   * database that predates `setAlert` — the grid shows ×N and a tick moves
   * them as one, with at most one of them ever left switched on.
   */
  ruleIds: string[];
  /** Some rule in this cell is switched on — the message goes. */
  on: boolean;
  /** More than one of them is on: this event is sent twice. */
  doubleSend: boolean;
  /** Switched on with no template, so it cannot send. */
  broken: boolean;
};

export type MatrixRow = {
  /** `eventKeyOf(trigger, conditions, recipient)`. */
  key: string;
  trigger: string;
  conditions: Record<string, string>;
  recipient: string;
  label: string;
  /** No shipped catalogue entry covers this event — it predates the grid. */
  custom: boolean;
  /** Non-null only when the event does not fire straight away. */
  delay: string | null;
  /**
   * Whether a cell with no rule yet can be ticked into existence. Only rows
   * the store ships can be extended: a hand-made row from before the grid can
   * be switched off and on, never grown.
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
  /** Cells switched on, per channel, for the closed fold's summary. */
  onByChannel: Record<string, number>;
  /** Ticks currently on, out of the cells that can be ticked at all. */
  on: number;
  available: number;
  /** Rows in this family. */
  events: number;
};

/** A shipped alert with no row in this database yet. */
export type MissingAlert = {
  name: string;
  label: string;
  channel: string;
  recipient: string;
  /** What `syncSystemAutomation` would create it as. */
  isActive: boolean;
};

export type NotificationMatrix = {
  families: MatrixFamily[];
  /** Every channel this store has, named or not, in order. */
  channels: string[];
  /** On-count per channel across the whole store, for the posture strip. */
  byChannel: Record<string, number>;
  /** Rules that are switched on and cannot send. */
  brokenCount: number;
  /** Shipped alerts this database does not have yet. */
  missing: MissingAlert[];
  /** Live double-sends — see {@link findCollisions}. Empty on a healthy store. */
  collisions: AlertCollision[];
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
 * 1. **Every live rule appears somewhere.** The union is over the catalogue
 *    *and* the database, so a rule from before the grid is still shown.
 * 2. **A cell knows its rules by signature** — the same {@link alertSignature}
 *    the writer is keyed by, so a cell and a write can never disagree about
 *    which rows a checkbox means. The ids here are for rendering; the server
 *    re-resolves them before it writes.
 * 3. **An unsupported channel is still a cell**; whether it is drawn is the
 *    component's decision, from the {@link ChannelFact} beside it.
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
  const columns = facts.map((f) => f.channel);
  const supported = new Set(facts.filter((f) => f.supported).map((f) => f.channel));

  type Seed = {
    trigger: string;
    conditions: Record<string, string>;
    recipient: string;
    custom: boolean;
    delayMinutes: number;
  };

  // Rows are keyed case-insensitively — the same fold the signature uses — so
  // a hand-typed `cod` and the catalogue's `COD` are one row, not two.
  const rowKey = (trigger: string, conditions: Record<string, string>, recipient: string) =>
    alertSignature({ trigger, conditions, recipient, action: "" });

  const seeds = new Map<string, Seed>();
  function seedFor(
    trigger: string,
    conditions: Record<string, string>,
    recipient: string,
    custom: boolean,
    delayMinutes: number
  ): Seed {
    const key = rowKey(trigger, conditions, recipient);
    const existing = seeds.get(key);
    if (existing) {
      if (!custom) existing.custom = false;
      return existing;
    }
    const seed: Seed = { trigger, conditions, recipient, custom, delayMinutes };
    seeds.set(key, seed);
    return seed;
  }

  for (const entry of catalogue) {
    seedFor(entry.trigger, entry.conditions, entry.recipient, false, entry.delayMinutes);
  }
  for (const rule of rules) {
    seedFor(rule.trigger, rule.conditions, rule.recipient, true, rule.delayMinutes);
  }

  // Live rules by full signature — one lookup per cell.
  const bySignature = new Map<string, RuleRow[]>();
  for (const rule of rules) {
    const sig = alertSignature(rule);
    const list = bySignature.get(sig) ?? [];
    list.push(rule);
    bySignature.set(sig, list);
  }

  const byChannel: Record<string, number> = Object.fromEntries(columns.map((c) => [c, 0]));
  let brokenCount = 0;
  const rowsByFamily = new Map<FamilyKey, MatrixRow[]>();

  for (const seed of seeds.values()) {
    const cells: MatrixCell[] = columns.map((channel) => {
      const matching =
        bySignature.get(
          alertSignature({
            trigger: seed.trigger,
            conditions: seed.conditions,
            recipient: seed.recipient,
            action: channel,
          })
        ) ?? [];
      const active = matching.filter((r) => r.isActive);
      const broken = active.some((r) => !r.hasTemplate);
      if (active.length > 0) byChannel[channel] += 1;
      if (broken) brokenCount += 1;
      return {
        channel,
        ruleIds: matching.map((r) => r.id),
        on: active.length > 0,
        doubleSend: active.length > 1,
        broken,
      };
    });

    const row: MatrixRow = {
      key: eventKeyOf(seed.trigger, seed.conditions, seed.recipient),
      trigger: seed.trigger,
      conditions: seed.conditions,
      recipient: seed.recipient,
      label: eventLabel(seed.trigger, seed.conditions, labelFor(seed.trigger, seed.conditions)),
      custom: seed.custom,
      delay: seed.delayMinutes > 0 ? delayLabel(seed.delayMinutes) : null,
      creatable: !seed.custom,
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
    if (!rows || rows.length === 0) continue;

    const groups = new Map<string, MatrixRow[]>();
    for (const row of rows) {
      const list = groups.get(row.recipient) ?? [];
      list.push(row);
      groups.set(row.recipient, list);
    }

    const onByChannel: Record<string, number> = Object.fromEntries(columns.map((c) => [c, 0]));
    let on = 0;
    let available = 0;
    for (const row of rows) {
      for (const cell of row.cells) {
        if (cell.on) onByChannel[cell.channel] += 1;
        if (!supported.has(cell.channel)) continue;
        available += 1;
        if (cell.on) on += 1;
      }
    }

    families.push({
      key: spec.key,
      label: spec.label,
      blurb: spec.blurb,
      onByChannel,
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

  const missing: MissingAlert[] = [];
  for (const entry of catalogue) {
    const action = entry.action ?? "email";
    const sig = alertSignature({ ...entry, action });
    if (bySignature.has(sig)) continue;
    missing.push({
      name: entry.name,
      label: eventLabel(entry.trigger, entry.conditions, labelFor(entry.trigger, entry.conditions)),
      channel: action,
      recipient: entry.recipient,
      isActive: entry.isActive ?? true,
    });
  }

  return {
    families,
    channels: columns,
    byChannel,
    brokenCount,
    missing,
    collisions: findCollisions(rules),
  };
}
