/**
 * **The email catalogue** — every message this store can send, rendered by the
 * real engine, checked, and laid out in one self-contained HTML file.
 *
 *     npx tsx scripts/email-catalogue.mts            # writes scripts/tmp/email-catalogue.html
 *     npx tsx scripts/email-catalogue.mts --strict   # …and exits 1 if any check fails
 *
 * The output lives in `scripts/tmp/`, which is gitignored: it is built from the
 * live database's settings and could carry the store's contact details.
 *
 * ## Why this is not a mockup
 *
 * A catalogue drawn by hand shows the email somebody meant to send. This one
 * shows the email the store *does* send, because it runs the same code path a
 * real event takes — `runAutomationTrigger` → the dedupe row → `deliverJob` →
 * `resolveSubject` → `pruneFactLines` → `renderTemplate` → the owner/customer
 * CTA swap → `renderAutomationEmail` — with exactly two things replaced:
 *
 * - **the database**, by an in-memory stand-in holding sample rows (a COD
 *   order, a prepaid one, a part-paid one, a return at every stage, a chat…),
 *   so nothing is read from or written to real orders; and
 * - **the transport**: `sendAutomationEmail` is swapped for a function that
 *   calls the real `renderAutomationEmail` and keeps the result instead of
 *   handing it to Resend.
 *
 * If a template, the engine or the shell changes, the next run shows it.
 *
 * ## What it touches in the live database
 *
 * **Reads only**, and only three tables: `SiteSettings` (so the brand, contact
 * details and footer are the real ones), `EmailTemplate` (the stored words are
 * what sends, and the owner may have edited them) and `AutomationRule` (so
 * "switched on" is the truth, not the shipped default).
 *
 * ## It sends nothing
 *
 * `RESEND_API_KEY` is blanked before any store code loads, so the Resend client
 * is never constructed; the script refuses to continue if `emailHealth()` still
 * reports a key; and the one function that could send is replaced. Run it with
 * the key unset in the shell as well (`RESEND_API_KEY= npx tsx …`) for belt and
 * braces.
 *
 * ## The checks
 *
 * Every rendered email is checked, and the results are printed here and in the
 * catalogue beside the email they are about:
 *
 * - **no empty fields** — every `{{token}}` the template uses is filled by the
 *   trigger that sends it, or sits on a line the engine removes when empty
 *   (worked out with the engine's own `pruneFactLines` and the token values
 *   the engine actually produced for that sample, captured by a probe);
 * - **no leftover `{{…}}`** anywhere in the subject, HTML or text;
 * - **every link and image is a full `https://` address** (or `mailto:`),
 *   never relative, never localhost;
 * - **one main button**, and the button's link is in the plain-text part;
 * - **an inbox preview line** and **a plain-text part**;
 * - **written for its reader** — the owner's copy has the owner's footer and
 *   no customer-voice headline; the customer's copy never links into /admin;
 * - **a cash-on-delivery customer is never told they have paid**;
 * - **every image loads** (fetched while building the file).
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

/* ------------------------------------------------------------------ */
/*  Environment — before any store code loads                          */
/* ------------------------------------------------------------------ */

// Present-but-empty, so neither dotenv nor Prisma's own .env loader refills it.
process.env.RESEND_API_KEY = "";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STRICT = process.argv.includes("--strict");
const OUT = path.join(ROOT, "scripts", "tmp", "email-catalogue.html");

/** Only the one variable the renderer needs from `.env`: the public origin. */
function envFromFile(name: string): string | undefined {
  const file = path.join(ROOT, ".env");
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || m[1] !== name) continue;
    return m[2].replace(/^["']|["']$/g, "");
  }
  return undefined;
}
if (!process.env.NEXT_PUBLIC_SITE_URL) {
  const fromFile = envFromFile("NEXT_PUBLIC_SITE_URL");
  if (fromFile) process.env.NEXT_PUBLIC_SITE_URL = fromFile;
}

/* ------------------------------------------------------------------ */
/*  Live reads (read-only)                                             */
/* ------------------------------------------------------------------ */

type LiveRule = {
  id: string;
  name: string;
  trigger: string;
  conditions: unknown;
  action: string;
  recipient: string;
  delayMinutes: number;
  isActive: boolean;
  templateId: string | null;
};
type LiveTemplate = {
  id: string;
  key: string;
  name: string;
  subject: string;
  body: string;
  updatedAt: Date;
  createdAt: Date;
};

let settingsRow: Record<string, unknown> | null = null;
let liveRules: LiveRule[] = [];
let liveTemplates: LiveTemplate[] = [];
let liveError: string | null = null;
{
  const { PrismaClient } = await import("@prisma/client");
  const live = new PrismaClient();
  try {
    settingsRow = (await live.siteSettings.findUnique({ where: { id: "main" } })) as Record<
      string,
      unknown
    > | null;
    liveTemplates = await live.emailTemplate.findMany({
      select: { id: true, key: true, name: true, subject: true, body: true, updatedAt: true, createdAt: true },
    });
    liveRules = await live.automationRule.findMany({
      select: {
        id: true,
        name: true,
        trigger: true,
        conditions: true,
        action: true,
        recipient: true,
        delayMinutes: true,
        isActive: true,
        templateId: true,
      },
    });
  } catch (err) {
    liveError = err instanceof Error ? err.message.split("\n")[0] : String(err);
  } finally {
    await live.$disconnect().catch(() => {});
  }
}
process.env.RESEND_API_KEY = "";

/* ------------------------------------------------------------------ */
/*  The stand-in database                                              */
/* ------------------------------------------------------------------ */

type Row = Record<string, any>;

const db = {
  orders: new Map<string, Row>(),
  leads: new Map<string, Row>(),
  returns: new Map<string, Row>(),
  threads: new Map<string, Row>(),
  messages: new Map<string, Row[]>(),
  variants: new Map<string, Row>(),
  rules: [] as Row[],
  jobs: new Map<string, Row>(),
};
let jobSeq = 0;
/** Model calls nothing here answers on purpose — printed, so a new read in the engine is noticed. */
const unanswered = new Set<string>();

function answer(model: string, method: string, args: any): unknown {
  const id = args?.where?.id;
  switch (`${model}.${method}`) {
    case "siteSettings.findUnique":
    case "siteSettings.findFirst":
      return settingsRow;
    case "automationRule.findMany":
      return db.rules.filter(
        (r) =>
          (args?.where?.trigger === undefined || r.trigger === args.where.trigger) &&
          (args?.where?.isActive === undefined || r.isActive === args.where.isActive)
      );
    case "automationRule.count":
      return db.rules.length;
    case "automationRule.update":
      return {};
    case "automationJob.create": {
      const job = { id: `job_${++jobSeq}`, status: "pending", error: null, sentAt: null, ...args.data };
      db.jobs.set(job.id, job);
      return { id: job.id };
    }
    case "automationJob.findUnique": {
      const job = db.jobs.get(id);
      return job ? { ...job, rule: db.rules.find((r) => r.id === job.ruleId) ?? null } : null;
    }
    case "automationJob.updateMany": {
      const job = db.jobs.get(id);
      if (!job || (args.where.status !== undefined && job.status !== args.where.status)) return { count: 0 };
      Object.assign(job, args.data);
      return { count: 1 };
    }
    case "automationJob.update": {
      const job = db.jobs.get(id);
      if (job) Object.assign(job, args.data);
      return job ?? {};
    }
    case "order.findUnique":
      return db.orders.get(id) ?? null;
    case "order.findFirst":
      // The abandoned-cart "did they buy since?" check: no, in every sample.
      return null;
    case "lead.findUnique":
      return db.leads.get(id) ?? null;
    case "returnRequest.findUnique":
      return db.returns.get(id) ?? null;
    case "chatThread.findUnique":
      return db.threads.get(id) ?? null;
    case "chatMessage.findMany":
      return db.messages.get(args?.where?.threadId) ?? [];
    case "productVariant.findUnique":
    case "productVariant.findFirst":
      return db.variants.get(id ?? args?.where?.sku) ?? [...db.variants.values()][0] ?? null;
    case "stockMovement.findFirst":
      // The ledger entry that opened the current dip under the line — the
      // stock alert's "once per dip" anchor.
      return { id: "mov_dip_1", createdAt: new Date(Date.now() - 3_600_000) };
  }
  unanswered.add(`${model}.${method}`);
  if (method === "findMany" || method === "groupBy") return [];
  if (method.startsWith("find")) return null;
  if (method === "count") return 0;
  if (method === "aggregate") return {};
  if (method.endsWith("Many")) return { count: 0 };
  if (method === "create" || method === "update" || method === "upsert") return { ...(args?.data ?? args?.create ?? {}) };
  return {};
}

const fakePrisma: any = new Proxy(
  {},
  {
    get(_t, prop: string | symbol) {
      if (typeof prop !== "string" || prop === "then") return undefined;
      if (prop === "$transaction") {
        return async (arg: unknown) =>
          typeof arg === "function" ? (arg as (tx: unknown) => unknown)(fakePrisma) : Promise.all(arg as unknown[]);
      }
      // Raw reads (the stock alert's "last time this size was above its
      // line") come back empty: every sample size has been low since its
      // first ledger entry.
      if (prop === "$queryRaw" || prop === "$queryRawUnsafe") return async () => [];
      if (prop.startsWith("$")) return async () => undefined;
      return new Proxy(
        {},
        {
          get: (_u, method: string | symbol) =>
            typeof method === "string"
              ? async (args: unknown) => structuredClone(answer(prop, method, args))
              : undefined,
        }
      );
    },
  }
);

/* ------------------------------------------------------------------ */
/*  Loading the store's own modules with the stand-ins in place        */
/* ------------------------------------------------------------------ */

const require = createRequire(import.meta.url);
const Mod = require("node:module") as any;
const lower = (p: string) => path.normalize(p).toLowerCase();
const PRISMA_TS = lower(path.join(ROOT, "src/lib/prisma.ts"));
const EMAIL_TS = lower(path.join(ROOT, "src/lib/email.ts"));

type EmailModule = typeof import("../src/lib/email");
type AutomationModule = typeof import("../src/lib/automation");
type Rendered = ReturnType<EmailModule["renderAutomationEmail"]>;
type Message = Parameters<EmailModule["renderAutomationEmail"]>[1];
type Capture = { msg: Message; rendered: Rendered };

let captures: Capture[] = [];
let emailFacade: Record<string, unknown> | null = null;
let loadingRealEmail = false;

const originalLoad = Mod._load;
Mod._load = function (request: string, parent: unknown, isMain: boolean) {
  // Next resolves this marker at build time; plain Node has no such package.
  if (request === "server-only") return {};
  let resolved = "";
  try {
    resolved = lower(Mod._resolveFilename(request, parent, isMain));
  } catch {
    /* not ours to resolve — fall through */
  }
  if (resolved === PRISMA_TS) return { prisma: fakePrisma };
  if (resolved === EMAIL_TS && emailFacade && !loadingRealEmail) return emailFacade;
  return originalLoad.apply(this, arguments as unknown as unknown[]);
};

loadingRealEmail = true;
const email = require(path.join(ROOT, "src/lib/email.ts")) as EmailModule;
loadingRealEmail = false;
if (email.emailHealth().hasApiKey) {
  throw new Error("RESEND_API_KEY is set in this process — refusing to run anything that could send.");
}
emailFacade = {
  ...email,
  // The one function that could send, replaced by the real renderer.
  sendAutomationEmail: async (settings: Parameters<EmailModule["renderAutomationEmail"]>[0], msg: Message) => {
    captures.push({ msg, rendered: email.renderAutomationEmail(settings, msg) });
    return { data: { id: "catalogue-capture" }, error: null };
  },
};
const automation = require(path.join(ROOT, "src/lib/automation.ts")) as AutomationModule;
const { pushCopyFrom } = require(path.join(ROOT, "src/lib/push-dispatch.ts")) as typeof import("../src/lib/push-dispatch");
const { getSettings } = require(path.join(ROOT, "src/lib/settings.ts")) as typeof import("../src/lib/settings");
const { SYSTEM_TEMPLATES } = require(path.join(ROOT, "src/lib/email-templates.ts")) as typeof import("../src/lib/email-templates");
const settings = await getSettings();

/* ------------------------------------------------------------------ */
/*  Sample rows                                                        */
/* ------------------------------------------------------------------ */

const NOW = Date.now();
const hoodie = {
  productId: "prd_planetary",
  name: "LEVEL7 Planetary Reset Unisex Drop-Shoulder Hoodie",
  image: "/products/level7/Level7_Planet_Front.png",
  price: 1977,
  quantity: 1,
  options: [{ name: "Size", value: "L" }],
};
const tee = {
  productId: "prd_field",
  name: "LEVEL7 Field Unisex Oversized T-Shirt",
  image: "/products/level7/BottleGreenFront2.png",
  price: 977,
  quantity: 2,
  options: [{ name: "Size", value: "M" }],
};
const TRACK = {
  courier: "Delhivery",
  trackingNumber: "1490831234567",
  trackingUrl: "https://track.nimbuspost.com/track/1490831234567",
};
const baseOrder: Row = {
  orderNumber: "L7-MUDQ8Z4K2A",
  userId: null,
  customerName: "Riya Sharma",
  email: "riya.sharma@example.com",
  phone: "+919820011223",
  address: "Flat 12B, Sea Breeze Apartments, Turner Road, Bandra West",
  city: "Mumbai",
  state: "Maharashtra",
  pincode: "400050",
  items: [hoodie, tee],
  subtotal: 3931,
  shipping: 0,
  paymentFee: 0,
  discountTotal: 0,
  total: 3931,
  paymentMethod: "COD",
  paymentStatus: "pending",
  amountPaid: 0,
  balanceDue: 3931,
  status: "pending",
  courier: null,
  trackingNumber: null,
  trackingUrl: null,
  deliveryStatus: null,
  deliveryLocation: null,
  note: "Please call before delivery — there's no lift in the building.",
  createdAt: new Date(NOW - 3_600_000),
};
const PREPAID = { paymentMethod: "Razorpay", paymentStatus: "paid", amountPaid: 3931, balanceDue: 0 };
const PARTIAL = { paymentMethod: "Partial", paymentStatus: "partial", amountPaid: 1180, balanceDue: 2751 };

type Scenario = {
  key: string;
  /** What the owner reads on the variant tab. */
  label: string;
  /** Which stand-in table the row lives in. */
  table: "orders" | "leads" | "returns" | "threads" | "variants";
  id: string;
  row: Row;
  context?: Record<string, string>;
  /** Chat only: the conversation, newest first. */
  messages?: Row[];
  /** Cash on delivery — the checks hold these to "never say paid". */
  cod?: boolean;
};

const order = (key: string, label: string, patch: Row, context?: Record<string, string>): Scenario => {
  const row: Row = { ...baseOrder, id: `ord_${key}`, ...patch };
  return { key, label, table: "orders", id: row.id, row, context, cod: row.paymentMethod === "COD" };
};

const retOrder = {
  orderNumber: baseOrder.orderNumber,
  customerName: baseOrder.customerName,
  email: baseOrder.email,
  phone: baseOrder.phone,
  userId: null,
  items: [hoodie, tee],
};
const ret = (key: string, label: string, patch: Row): Scenario => {
  const row = {
    id: `ret_${key}`,
    requestNumber: "RET-7KQ2MX",
    productId: hoodie.productId,
    productName: hoodie.name,
    variantLabel: "Size: L",
    quantity: 1,
    unitPrice: 1977,
    reason: "Size too big",
    status: "pending",
    adminNote: null,
    refundAmount: null,
    nimbusAwb: null,
    nimbusCourier: null,
    order: retOrder,
    updatedAt: new Date(NOW),
    ...patch,
  };
  return { key, label, table: "returns", id: row.id, row };
};

const question = {
  sender: "user",
  status: "sent",
  body: "Hi — is the Planetary Reset hoodie coming back in a medium?",
  attachmentName: null,
  createdAt: new Date(NOW - 120_000),
};
const reply = {
  sender: "admin",
  status: "sent",
  body: "Yes! Medium is back in stock this Friday — want me to keep one aside for you?",
  attachmentName: null,
  createdAt: new Date(NOW - 30_000),
};
const thread = {
  id: "thr_riya",
  userId: null,
  name: "Riya Sharma",
  email: "riya.sharma@example.com",
  phone: "+919820011223",
  adminUnread: 2,
  userUnread: 1,
  user: null,
};

const SCENARIOS: Record<string, Scenario[]> = {
  "order.created": [
    order("placed_cod", "Cash on delivery", {}),
    order("placed_prepaid", "Prepaid online", { ...PREPAID, status: "confirmed" }),
    order("placed_partial", "Advance + cash on delivery", { ...PARTIAL }),
  ],
  "order.status_changed": [
    order("confirmed_cod", "Cash on delivery", { status: "confirmed" }, { previousStatus: "pending" }),
    order("confirmed_prepaid", "Prepaid online", { ...PREPAID, status: "confirmed" }, { previousStatus: "pending" }),
    order("shipped_tracked", "Booked with a courier", { status: "shipped", ...TRACK }, { previousStatus: "confirmed" }),
    order("shipped_manual", "Marked shipped by hand (no AWB)", { status: "shipped" }, { previousStatus: "confirmed" }),
    order("delivered_cod", "Cash on delivery", { status: "delivered", ...TRACK, deliveryStatus: "Delivered" }, { previousStatus: "shipped" }),
    order("delivered_partial", "Advance + cash on delivery", { ...PARTIAL, status: "delivered", ...TRACK, deliveryStatus: "Delivered" }, { previousStatus: "shipped" }),
    order("cancelled_prepaid", "Prepaid online", { ...PREPAID, status: "cancelled" }, { previousStatus: "confirmed" }),
    order("cancelled_cod", "Cash on delivery", { status: "cancelled" }, { previousStatus: "confirmed" }),
    order("reopened_cod", "Cash on delivery", { status: "pending" }, { previousStatus: "confirmed" }),
  ],
  "order.payment_changed": [
    order("failed_prepaid", "Prepaid online", { paymentMethod: "Razorpay", paymentStatus: "failed", balanceDue: 0 }, { previousPaymentStatus: "pending" }),
    order("failed_partial", "Advance + cash on delivery", { paymentMethod: "Partial", paymentStatus: "failed", balanceDue: 2751 }, { previousPaymentStatus: "pending" }),
    order("failed_cod", "Cash order marked failed by hand", { paymentStatus: "failed" }, { previousPaymentStatus: "pending" }),
  ],
  "order.rto": [
    order("rto_returning_prepaid", "Prepaid online", { ...PREPAID, status: "shipped", ...TRACK, deliveryStatus: "RTO In Transit", deliveryLocation: "Bhiwandi Hub" }),
    order("rto_returning_cod", "Cash on delivery", { status: "shipped", ...TRACK, deliveryStatus: "RTO In Transit", deliveryLocation: "Bhiwandi Hub" }),
    order("rto_returned_prepaid", "Prepaid online", { ...PREPAID, status: "cancelled", ...TRACK, deliveryStatus: "RTO Delivered", deliveryLocation: "Ahmedabad" }),
    order("rto_returned_cod", "Cash on delivery", { status: "cancelled", ...TRACK, deliveryStatus: "RTO Delivered", deliveryLocation: "Ahmedabad" }),
  ],
  "cart.abandoned": [
    {
      key: "lead_named",
      label: "Shopper who left their details",
      table: "leads",
      id: "lead_named",
      row: {
        id: "lead_named",
        productId: hoodie.productId,
        productName: hoodie.name,
        productImage: hoodie.image,
        quantity: 1,
        price: 1977,
        visitorId: "v_1",
        email: "jeel.patel@example.com",
        name: "Jeel Patel",
        phone: "+919876501234",
        status: "interested",
        createdAt: new Date(NOW - 86_400_000),
      },
    },
    {
      key: "lead_guest",
      label: "Anonymous shopper (email only)",
      table: "leads",
      id: "lead_guest",
      row: {
        id: "lead_guest",
        productId: tee.productId,
        productName: tee.name,
        productImage: tee.image,
        quantity: 2,
        price: null,
        visitorId: "v_2",
        email: "shopper@example.com",
        name: null,
        phone: null,
        status: "interested",
        createdAt: new Date(NOW - 86_400_000),
      },
    },
  ],
  "return.requested": [ret("requested", "Just raised", {})],
  "return.status_changed": [
    ret("approved", "Approved, with a note", { status: "approved", refundAmount: 1977, adminNote: "Approved — a courier will collect it within 2 working days." }),
    ret("approved_plain", "Approved, no note", { status: "approved", refundAmount: 1977 }),
    ret("rejected", "Declined, with a reason", { status: "rejected", adminNote: "The tags have been removed and the hoodie shows signs of wear." }),
    ret("rejected_plain", "Declined, no reason given", { status: "rejected" }),
    ret("cancelled", "Closed", { status: "cancelled" }),
    ret("picked_up", "Collected by the courier", { status: "picked_up", refundAmount: 1977, nimbusCourier: "Delhivery", nimbusAwb: "8120034455667" }),
    ret("received", "Back with the store", { status: "received", refundAmount: 1977, nimbusCourier: "Delhivery", nimbusAwb: "8120034455667" }),
    ret("refunded", "Refund sent", { status: "refunded", refundAmount: 1977 }),
  ],
  "chat.message_received": [
    { key: "chat_in", label: "Signed-in shopper", table: "threads", id: thread.id, row: thread, context: { direction: "inbound" }, messages: [question] },
    {
      key: "chat_in_guest",
      label: "Anonymous visitor",
      table: "threads",
      id: "thr_guest",
      row: { ...thread, id: "thr_guest", name: null, email: null, phone: null, adminUnread: 1 },
      context: { direction: "inbound" },
      messages: [{ ...question, body: "Do you ship to Pune? And how long does it take?" }],
    },
  ],
  "chat.reply_sent": [
    {
      key: "chat_out",
      label: "Reply to a shopper",
      table: "threads",
      id: thread.id,
      row: thread,
      context: { direction: "outbound" },
      messages: [reply, { ...question, status: "seen" }],
    },
  ],
};

/** One size of one product, at three levels: low, sold out, oversold. */
const variant = (key: string, label: string, level: { onHand: number; reserved: number }): Scenario => {
  const row: Row = {
    id: `var_${key}`,
    sku: "L7-FIELD-TEE-M",
    combo: { Size: "M" },
    onHand: level.onHand,
    reserved: level.reserved,
    available: level.onHand - level.reserved,
    lowStockAt: null,
    isActive: true,
    product: { id: tee.productId, name: tee.name, images: [tee.image], isActive: true, trackInventory: true },
  };
  return { key, label, table: "variants", id: row.id, row };
};
SCENARIOS["inventory.low_stock"] = [
  variant("stock_low", "Running low", { onHand: 3, reserved: 2 }),
  variant("stock_out", "Sold out", { onHand: 2, reserved: 2 }),
  variant("stock_oversold", "Oversold", { onHand: 1, reserved: 2 }),
];

/** Sample values, used only if this build has no stock trigger to exercise. */
const INVENTORY_SAMPLE: Record<string, string> = {
  "inventory.state": "Low stock",
  "inventory.productName": tee.name,
  "inventory.sku": "L7-FIELD-TEE-M",
  "inventory.variant": "Size: M",
  "inventory.available": "1",
  "inventory.onHand": "3",
  "inventory.reserved": "2",
  "inventory.threshold": "5",
  "inventory.url": `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/admin/inventory?q=L7-FIELD-TEE-M`,
};

function seed(s: Scenario) {
  const table = db[s.table] as Map<string, Row>;
  table.set(s.id, s.row);
  if (s.messages) db.messages.set(s.id, s.messages);
}

/* ------------------------------------------------------------------ */
/*  Running the engine                                                 */
/* ------------------------------------------------------------------ */

type RuleSpec = {
  name: string;
  trigger: string;
  conditions: Record<string, string>;
  recipient: string;
  action: string;
};

type Run = {
  capture: Capture | null;
  jobStatus: string;
  jobNote: string;
};

async function run(rule: RuleSpec, template: { subject: string; body: string }, s: Scenario): Promise<Run> {
  seed(s);
  db.jobs.clear();
  captures = [];
  db.rules = [
    {
      id: "rule_under_test",
      name: rule.name,
      trigger: rule.trigger,
      conditions: rule.conditions,
      action: rule.action,
      recipient: rule.recipient,
      delayMinutes: 0,
      isActive: true,
      createdAt: new Date(0),
      template: { id: "tpl_under_test", key: "under-test", name: rule.name, ...template, isSystem: true },
    },
  ];
  await automation.runAutomationTrigger(rule.trigger as never, { id: s.id, context: s.context });
  const job = [...db.jobs.values()][0];
  return {
    capture: captures[0] ?? null,
    jobStatus: job ? String(job.status) : "not matched",
    jobNote: job?.error ? String(job.error) : "",
  };
}

/**
 * The token values the engine really produced for one sample.
 *
 * A throwaway rule whose body is every token, fenced so the values can be read
 * back out of the captured text. `pruneFactLines` leaves these lines alone —
 * none of them is shaped like `Label: {{token}}` — so what comes back is the
 * bag `resolveSubject` built, token for token.
 */
const probeCache = new Map<string, Record<string, string>>();
async function tokenBag(trigger: string, s: Scenario, tokens: string[]): Promise<Record<string, string>> {
  const cacheKey = `${trigger}|${s.key}`;
  const hit = probeCache.get(cacheKey);
  if (hit) return hit;
  const body = tokens.map((t) => `⟦${t}⟧{{${t}}}⟦/${t}⟧`).join("\n");
  const r = await run(
    { name: "probe", trigger, conditions: {}, recipient: "admin", action: "email" },
    { subject: "probe", body },
    s
  );
  const bag: Record<string, string> = {};
  const text = r.capture?.msg.bodyText ?? "";
  for (const t of tokens) {
    const m = text.match(new RegExp(`⟦${t.replace(/\./g, "\\.")}⟧([\\s\\S]*?)⟦/${t.replace(/\./g, "\\.")}⟧`));
    if (m) bag[t] = m[1];
  }
  // A token the trigger does not offer renders as "" too; tell the two apart.
  const offered = new Set((automation.triggerSpec(trigger)?.tokens ?? []).map((t) => t.token));
  for (const t of Object.keys(bag)) if (!offered.has(t) && !bag[t]) delete bag[t];
  probeCache.set(cacheKey, bag);
  return bag;
}

/* ------------------------------------------------------------------ */
/*  Checks                                                             */
/* ------------------------------------------------------------------ */

type Check = { id: string; label: string; ok: boolean; detail?: string };

const tokensIn = (text: string) => [...new Set([...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]))];

function checkRender(input: {
  template: { subject: string; body: string };
  bag: Record<string, string>;
  capture: Capture;
  recipient: string;
  scenario?: Scenario;
}): Check[] {
  const { template, bag, capture, recipient, scenario } = input;
  const { rendered, msg } = capture;
  const checks: Check[] = [];

  // 1. Tokens: filled, or on a line the engine removes when empty.
  const facts = msg.context?.facts ?? [];
  const unknown = tokensIn(template.subject + "\n" + template.body).filter((t) => !(t in bag));
  const blankSubject = tokensIn(template.subject).filter((t) => t in bag && !bag[t].trim());
  const surviving = automation.pruneFactLines(template.body, bag, facts);
  const blankBody = tokensIn(surviving).filter((t) => t in bag && !bag[t].trim());
  checks.push({
    id: "tokens",
    label: "No empty fields",
    ok: !unknown.length && !blankSubject.length && !blankBody.length,
    detail: [
      unknown.length ? `not filled by this trigger: ${unknown.join(", ")}` : "",
      blankSubject.length ? `blank in the subject: ${blankSubject.join(", ")}` : "",
      blankBody.length ? `blank in a sentence: ${blankBody.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  });

  // 2. Leftover braces.
  const leftovers = [rendered.subject, rendered.html, rendered.text].some((t) => /\{\{|\}\}/.test(t));
  checks.push({ id: "braces", label: "No leftover {{…}}", ok: !leftovers });

  // 3. Every link and image absolute https (mailto for addresses).
  const urls = [...rendered.html.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
  const textUrls = [...rendered.text.matchAll(/https?:\/\/[^\s]+/g)].map((m) => m[0]);
  const bad = [...urls, ...textUrls].filter(
    (u) => !(/^https:\/\//i.test(u) || /^mailto:/i.test(u)) || /localhost|127\.0\.0\.1/i.test(u)
  );
  checks.push({
    id: "urls",
    label: "Every link is a full https:// address",
    ok: bad.length === 0,
    detail: bad.length ? [...new Set(bad)].slice(0, 4).join(" ") : `${new Set(urls).size} links and images`,
  });

  // 4. One main button, and its link is in the text part.
  const buttons = (rendered.html.match(/class="l7-btn-link l7-cta"/g) ?? []).length;
  const ctaUrl = msg.context?.cta?.url;
  checks.push({
    id: "cta",
    label: "One main button",
    ok: ctaUrl ? buttons === 1 && rendered.text.includes(ctaUrl) : buttons === 0,
    detail: ctaUrl ? `${msg.context?.cta?.label} → ${ctaUrl}` : "no button (none resolved for this event)",
  });

  // 5–6. Preheader and plain text.
  checks.push({ id: "preheader", label: "Inbox preview line", ok: rendered.preheader.trim().length > 0, detail: rendered.preheader });
  const blankLabels = rendered.text.split("\n").filter((l) => /^[^:\n]{1,40}:\s*$/.test(l.trim()));
  checks.push({
    id: "text",
    label: "Plain-text version",
    ok: rendered.text.trim().length > 40 && blankLabels.length === 0,
    detail: blankLabels.length ? `empty label: ${blankLabels.join(" / ")}` : `${rendered.text.split("\n").length} lines`,
  });

  // 7. The right reader.
  const headline = rendered.html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "";
  if (recipient === "admin") {
    const wrongVoice = /\byour (order|parcel|payment|return|refund)\b|\bwe've got your\b/i.test(headline);
    checks.push({
      id: "reader",
      label: "Written for you, not the customer",
      ok: rendered.audience === "admin" && !wrongVoice && !/Questions\?/.test(rendered.html),
      detail: rendered.audience !== "admin" ? `rendered as ${rendered.audience} mail (headline: "${headline}")` : wrongVoice ? `headline: "${headline}"` : undefined,
    });
  } else {
    const adminLinks = urls.filter((u) => /\/admin(\/|\?|$)/.test(u));
    checks.push({
      id: "reader",
      label: "Written for the customer",
      ok: rendered.audience === "customer" && adminLinks.length === 0,
      detail: adminLinks.length ? `links into the admin: ${adminLinks[0]}` : rendered.audience !== "customer" ? `rendered as ${rendered.audience} mail` : undefined,
    });
  }

  // 8. Cash on delivery is never described as paid.
  if (scenario?.cod && recipient === "customer") {
    const claim = rendered.text.match(/\b(paid by|you(?: have|'ve)? paid (?:₹|rs|for)|payment (?:received|successful|confirmed)|paid in full|paid online:|prepaid online)\b/i);
    checks.push({ id: "cod", label: "Never tells a COD customer they've paid", ok: !claim, detail: claim ? `says "${claim[0]}"` : undefined });
  }
  return checks;
}

/* ------------------------------------------------------------------ */
/*  What to render                                                     */
/* ------------------------------------------------------------------ */

type RuleView = {
  name: string;
  trigger: string;
  conditions: Record<string, string>;
  recipient: string;
  action: string;
  delayMinutes: number;
  /** true/false from the live database; null = shipped but not in the database yet. */
  live: boolean | null;
  shippedOn: boolean | null;
};

const liveTemplateByKey = new Map(liveTemplates.map((t) => [t.key, t]));
const liveTemplateById = new Map(liveTemplates.map((t) => [t.id, t]));
const shippedTemplate = new Map(SYSTEM_TEMPLATES.map((t) => [t.key, t]));

function rulesFor(key: string): RuleView[] {
  const out = new Map<string, RuleView>();
  for (const r of liveRules) {
    if (!r.templateId || liveTemplateById.get(r.templateId)?.key !== key) continue;
    out.set(r.name, {
      name: r.name,
      trigger: r.trigger,
      conditions: automation.readConditions(r.conditions),
      recipient: r.recipient,
      action: r.action,
      delayMinutes: r.delayMinutes,
      live: r.isActive,
      shippedOn: null,
    });
  }
  for (const r of automation.SYSTEM_RULES) {
    if (r.templateKey !== key) continue;
    const existing = out.get(r.name);
    if (existing) {
      existing.shippedOn = r.isActive;
      continue;
    }
    out.set(r.name, {
      name: r.name,
      trigger: r.trigger,
      conditions: r.conditions,
      recipient: r.recipient,
      action: r.action ?? "email",
      delayMinutes: r.delayMinutes,
      live: null,
      shippedOn: r.isActive,
    });
  }
  const order = { email: 0, push: 1, inapp: 2 } as Record<string, number>;
  return [...out.values()].sort((a, b) => (order[a.action] ?? 9) - (order[b.action] ?? 9));
}

type Variant = {
  scenario: Scenario | null;
  label: string;
  capture: Capture;
  checks: Check[];
  bell: { title: string; body: string };
};

type Entry = {
  key: string;
  name: string;
  /** The words that are actually stored (or shipped, if not stored yet). */
  template: { subject: string; body: string };
  source: "live" | "shipped" | "live-edited";
  recipient: string;
  rules: RuleView[];
  trigger: string | null;
  variants: Variant[];
  problems: string[];
  sampleOnly: boolean;
};

const SECTIONS: { id: string; title: string; blurb: string; keys: string[] }[] = [
  {
    id: "orders",
    title: "Orders",
    blurb: "An order's journey, from the moment it is placed to the moment it arrives — or is called off.",
    keys: ["order-received", "order-confirmed", "order-shipped", "order-delivered", "order-cancelled", "order-reopened"],
  },
  {
    id: "payment",
    title: "Payment",
    blurb: "When an online payment or advance does not go through. Cash orders never reach these.",
    keys: ["payment-failed-prepaid", "payment-failed-partial"],
  },
  {
    id: "delivery",
    title: "Delivery problems",
    blurb: "A parcel the courier could not deliver (RTO) — on its way back, then back with you.",
    keys: ["order-rto-returning", "order-rto-returned"],
  },
  {
    id: "returns",
    title: "Returns & refunds",
    blurb: "The parcel travelling the other way: requested, decided, collected, received, refunded.",
    keys: ["return-requested", "return-approved", "return-rejected", "return-cancelled", "return-picked-up", "return-received", "return-refunded"],
  },
  { id: "chat", title: "Chat", blurb: "Your reply to a shopper, for when they have closed the tab.", keys: ["chat-reply"] },
  { id: "marketing", title: "Marketing", blurb: "The one nudge the store sends unprompted.", keys: ["abandoned-cart"] },
  {
    id: "alerts",
    title: "Alerts to you",
    blurb: "What the store tells you, the owner — each lands in your inbox, your bell, or both.",
    keys: ["order-admin-new", "payment-failed-admin", "order-rto-admin", "return-admin-new", "chat-admin-new", "lead-admin-new", "inventory-low-stock"],
  },
];

const allKeys = new Set([...SYSTEM_TEMPLATES.map((t) => t.key), ...liveTemplates.map((t) => t.key)]);
const listed = new Set(SECTIONS.flatMap((s) => s.keys));
const others = [...allKeys].filter((k) => !listed.has(k));
if (others.length) {
  SECTIONS.push({ id: "other", title: "Other templates", blurb: "Templates added in the admin.", keys: others });
}

async function buildEntry(key: string): Promise<Entry | null> {
  const stored = liveTemplateByKey.get(key);
  const shipped = shippedTemplate.get(key);
  if (!stored && !shipped) return null;
  const template = stored ?? shipped!;
  const source: Entry["source"] = !stored
    ? "shipped"
    : shipped && (stored.subject !== shipped.subject || stored.body !== shipped.body)
      ? "live-edited"
      : "live";
  const rules = rulesFor(key);
  const emailRules = rules.filter((r) => r.action === "email");
  // Render as email what is sent as email; a template only used for the bell
  // or a push is still an email template, so it is rendered for its audience.
  const renderRules = emailRules.length ? emailRules : rules.slice(0, 1);
  const recipient = (renderRules[0] ?? rules[0])?.recipient ?? "admin";
  const problems: string[] = [];
  const variants: Variant[] = [];
  let trigger: string | null = renderRules[0]?.trigger ?? null;

  const seen = new Set<string>();
  for (const rule of renderRules) {
    const sig = `${rule.trigger}|${JSON.stringify(rule.conditions)}|${rule.recipient}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    const scenarios = SCENARIOS[rule.trigger] ?? [];
    if (!automation.triggerSpec(rule.trigger)) {
      problems.push(`Trigger "${rule.trigger}" is not in this build.`);
      continue;
    }
    const tokens = [
      ...new Set([
        ...(automation.triggerSpec(rule.trigger)?.tokens ?? []).map((t) => t.token),
        ...tokensIn(template.subject + "\n" + template.body),
      ]),
    ];
    let matched = 0;
    for (const s of scenarios) {
      const r = await run({ ...rule, action: "email" }, template, s);
      if (!r.capture) {
        if (r.jobStatus !== "not matched" && r.jobNote) problems.push(`${s.label}: ${r.jobStatus} — ${r.jobNote}`);
        continue;
      }
      matched += 1;
      const bag = await tokenBag(rule.trigger, s, tokens);
      variants.push({
        scenario: s,
        label: renderRules.length > 1 && seen.size > 1 ? `${s.label} · ${rule.recipient === "admin" ? "to you" : "to the customer"}` : s.label,
        capture: r.capture,
        checks: checkRender({ template, bag, capture: r.capture, recipient: rule.recipient, scenario: s }),
        bell: pushCopyFrom(r.capture.rendered.subject, r.capture.msg.bodyText),
      });
    }
    if (!matched && scenarios.length) problems.push(`No sample reached the rule "${rule.name}".`);
    if (!scenarios.length) problems.push(`No sample data for trigger "${rule.trigger}".`);
  }

  // The stock alert's rule is being built elsewhere. Until the engine can be
  // exercised for it, render the template through the same functions with
  // sample values — and say so on the page.
  let sampleOnly = false;
  if (!variants.length && key === "inventory-low-stock") {
    sampleOnly = true;
    trigger = trigger ?? "inventory (rule not wired yet)";
    const bag = INVENTORY_SAMPLE;
    const bodyText = automation.renderTemplate(automation.pruneFactLines(template.body, bag, []), bag);
    const msg: Message = {
      to: settings.adminNotifyEmail,
      subject: automation.renderTemplate(template.subject, bag),
      bodyText,
      audience: "admin",
      context: {
        kicker: "Inventory",
        cta: { label: "Open in your admin", url: bag["inventory.url"] },
      },
    };
    const capture: Capture = { msg, rendered: email.renderAutomationEmail(settings, msg) };
    variants.push({
      scenario: null,
      label: "Sample values",
      capture,
      checks: checkRender({ template, bag, capture, recipient: "admin" }),
      bell: pushCopyFrom(capture.rendered.subject, bodyText),
    });
  }

  return { key, name: stored?.name ?? shipped!.name, template, source, recipient, rules, trigger, variants, problems, sampleOnly };
}

/* ---- The three messages that are not rule-driven ---- */

type DirectEntry = { key: string; name: string; to: string; when: string; why: string; rendered: Rendered; checks: Check[] };

function directChecks(rendered: Rendered, recipient: string): Check[] {
  const capture: Capture = { msg: { to: "", subject: rendered.subject, bodyText: "" }, rendered };
  return checkRender({ template: { subject: "", body: "" }, bag: {}, capture, recipient }).filter(
    (c) => c.id !== "cta" && c.id !== "tokens"
  );
}

const directMail = automation.DIRECT_MAIL;
const why = (name: string) => directMail.find((d) => d.name.toLowerCase().startsWith(name))?.why ?? "";
const reset = email.renderPasswordResetEmail(settings, `${process.env.NEXT_PUBLIC_SITE_URL}/account/reset?token=sample-token-4f2a9c`);
const otp = email.renderOtpEmail(settings, { code: "482913", minutes: 10, purpose: "signup" });
const contact = email.renderContactEmail(settings, {
  name: "Arjun Mehta",
  email: "arjun.mehta@example.com",
  phone: "+91 98111 22334",
  message: "Hi! Do you do bulk orders for college fests? We need about 120 printed hoodies by December.\n\nThanks,\nArjun",
});
const DIRECT: DirectEntry[] = [
  { key: "password-reset", name: "Password reset link", to: "customer", when: "Someone asks to reset their password on the sign-in page.", why: why("password"), rendered: reset, checks: directChecks(reset, "customer") },
  { key: "one-time-code", name: "One-time code", to: "customer", when: "Sign-up or checkout asks for email verification (Settings decides).", why: why("one-time"), rendered: otp, checks: directChecks(otp, "customer") },
  { key: "contact-enquiry", name: "Contact form enquiry", to: "admin", when: "Someone sends the contact form on the website.", why: why("contact"), rendered: contact, checks: directChecks(contact, "admin") },
];

/* ------------------------------------------------------------------ */
/*  Build every entry                                                  */
/* ------------------------------------------------------------------ */

const entries = new Map<string, Entry>();
for (const section of SECTIONS) {
  for (const key of section.keys) {
    const entry = await buildEntry(key);
    if (entry) entries.set(key, entry);
  }
}

/* ---- Images: fetched once, checked, and embedded so the file works offline ---- */

const imageUrls = new Set<string>();
const allHtml = [
  ...[...entries.values()].flatMap((e) => e.variants.map((v) => v.capture.rendered.html)),
  ...DIRECT.map((d) => d.rendered.html),
];
for (const html of allHtml) {
  for (const m of html.matchAll(/<img[^>]+src="([^"]+)"/g)) imageUrls.add(m[1].replace(/&amp;/g, "&"));
}
const embedded = new Map<string, string>();
const brokenImages: string[] = [];
for (const url of imageUrls) {
  try {
    const res = await fetch(url, { headers: { Accept: "image/webp,image/png,image/jpeg,image/*" }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get("content-type") ?? "image/png";
    const bytes = Buffer.from(await res.arrayBuffer());
    embedded.set(url, `data:${type};base64,${bytes.toString("base64")}`);
  } catch (err) {
    brokenImages.push(`${url} (${err instanceof Error ? err.message : String(err)})`);
  }
}
for (const entry of entries.values()) {
  for (const v of entry.variants) {
    const mine = [...v.capture.rendered.html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
    const broken = mine.filter((u) => !embedded.has(u));
    v.checks.push({ id: "images", label: "Every photo loads", ok: broken.length === 0, detail: broken.length ? broken.join(" ") : mine.length ? `${mine.length} photo${mine.length === 1 ? "" : "s"}` : "no photos in this email" });
  }
}

/* ------------------------------------------------------------------ */
/*  Console report                                                     */
/* ------------------------------------------------------------------ */

let failures = 0;
let renders = 0;
const lines: string[] = [];
for (const entry of entries.values()) {
  for (const v of entry.variants) {
    renders += 1;
    const bad = v.checks.filter((c) => !c.ok);
    failures += bad.length;
    lines.push(
      `${bad.length ? "FAIL" : "ok  "} ${entry.key.padEnd(24)} ${v.label.padEnd(40).slice(0, 40)} ${v.capture.rendered.subject}` +
        (bad.length ? `\n       ${bad.map((c) => `${c.label}${c.detail ? `: ${c.detail}` : ""}`).join("\n       ")}` : "")
    );
  }
  for (const p of entry.problems) lines.push(`note ${entry.key.padEnd(24)} ${p}`);
}
for (const d of DIRECT) {
  renders += 1;
  const bad = d.checks.filter((c) => !c.ok);
  failures += bad.length;
  lines.push(`${bad.length ? "FAIL" : "ok  "} ${d.key.padEnd(24)} ${"(direct)".padEnd(40)} ${d.rendered.subject}` + (bad.length ? `\n       ${bad.map((c) => `${c.label}: ${c.detail ?? ""}`).join("\n       ")}` : ""));
}
console.log(lines.join("\n"));
if (unanswered.size) console.log(`\nStand-in database calls answered with an empty default: ${[...unanswered].sort().join(", ")}`);
if (brokenImages.length) console.log(`\nImages that did not load:\n  ${brokenImages.join("\n  ")}`);
if (liveError) console.log(`\nLive database not readable (${liveError}) — rendered the shipped copy with default settings.`);

/* ------------------------------------------------------------------ */
/*  The catalogue page                                                 */
/* ------------------------------------------------------------------ */

const h = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const srcdoc = (html: string) => {
  let out = html;
  for (const [url, data] of embedded) out = out.split(`src="${h(url)}"`).join(`src="${data}"`).split(`src="${url}"`).join(`src="${data}"`);
  return out.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
};

const ACTION_WORD: Record<string, string> = { email: "Email", push: "Phone notification", inapp: "Bell (in-app)" };
const who = (r: string) => (r === "admin" ? "You (owner)" : r === "customer" ? "The customer" : r);
const whenText = (r: RuleView) => {
  const cond = automation.describeConditions(r.trigger, r.conditions);
  const base = automation.triggerLabel(r.trigger);
  const delay = r.delayMinutes > 0 ? ` · after ${r.delayMinutes >= 1440 && r.delayMinutes % 1440 === 0 ? `${r.delayMinutes / 1440} day${r.delayMinutes === 1440 ? "" : "s"}` : `${r.delayMinutes} min`}` : "";
  return `${base}${cond !== "Every time" ? ` — ${cond}` : ""}${delay}`;
};
const status = (r: RuleView) =>
  r.live === true
    ? `<span class="pill on">On</span>`
    : r.live === false
      ? `<span class="pill off">Off</span>`
      : `<span class="pill new" title="Ships with the store but is not in the database yet — Admin → Automation → Restore adds it">Not added yet</span>`;

function channelSummary(rules: RuleView[], action: string): string {
  const mine = rules.filter((r) => r.action === action);
  if (!mine.length) return `<span class="dash">—</span>`;
  const on = mine.filter((r) => r.live === true).length;
  const pending = mine.filter((r) => r.live === null).length;
  return on
    ? `<span class="pill on">On</span>`
    : pending === mine.length
      ? `<span class="pill new">Not added</span>`
      : `<span class="pill off">Off</span>`;
}

function checksHtml(checks: Check[]): string {
  return `<ul class="checks">${checks
    .map(
      (c) =>
        `<li class="${c.ok ? "ok" : "bad"}"><span class="mark" aria-hidden="true">${c.ok ? "✓" : "✕"}</span><span><strong>${h(c.label)}</strong>${
          c.detail ? `<span class="detail">${h(c.detail)}</span>` : ""
        }</span></li>`
    )
    .join("")}</ul>`;
}

function frame(id: string, html: string, hidden: boolean): string {
  return `<iframe class="mail" id="${id}" title="Email preview" loading="lazy" ${hidden ? "hidden" : ""} srcdoc="${srcdoc(html)}"></iframe>`;
}

function inbox(rendered: Rendered): string {
  return `<div class="inbox" aria-label="How it looks in an inbox"><span class="from">${h(settings.brandName)}</span><span class="subj">${h(rendered.subject)}</span><span class="pre">${h(rendered.preheader)}</span></div>`;
}

function entryHtml(e: Entry): string {
  const first = e.variants[0];
  const carries = first
    ? [
        ...(first.capture.msg.context?.items?.length ? [`the pieces with photos, size, quantity and price`] : []),
        ...(first.capture.msg.context?.facts ?? []).map((f) => f.label.toLowerCase()),
      ]
    : [];
  const tokens = tokensIn(e.template.subject + "\n" + e.template.body);
  const spec = e.trigger ? automation.triggerSpec(e.trigger) : null;
  const tokenList = tokens.map((t) => {
    const d = spec?.tokens.find((x) => x.token === t)?.describes;
    return `<li><code>{{${h(t)}}}</code>${d ? ` <span>${h(d)}</span>` : ""}</li>`;
  });
  const allOk = e.variants.every((v) => v.checks.every((c) => c.ok)) && !e.problems.length;
  return `<article class="entry" id="${h(e.key)}">
<header class="entry-head">
  <div>
    <p class="eyebrow">${e.recipient === "admin" ? "To you" : "To the customer"} · <code>${h(e.key)}</code></p>
    <h3>${h(e.name)}</h3>
  </div>
  <span class="verdict ${allOk ? "ok" : "bad"}">${allOk ? "All checks pass" : "Needs attention"}</span>
</header>
<div class="entry-body">
  <div class="meta">
    <section>
      <h4>When it's sent</h4>
      <table class="rules"><thead><tr><th>Channel</th><th>When</th><th>To</th><th>Live</th></tr></thead><tbody>
      ${e.rules
        .map(
          (r) => `<tr><td>${h(ACTION_WORD[r.action] ?? r.action)}</td><td>${h(whenText(r))}<span class="rule-name">${h(r.name)}</span></td><td>${h(who(r.recipient))}</td><td>${status(r)}</td></tr>`
        )
        .join("") || `<tr><td colspan="4">${e.sampleOnly ? "The rule that sends this is being added with the inventory work." : "No rule uses this template."}</td></tr>`}
      </tbody></table>
    </section>
    ${first ? `<section><h4>In the inbox</h4>${inbox(first.capture.rendered)}</section>` : ""}
    ${
      first
        ? `<section><h4>Main button</h4><p class="cta-line">${
            first.capture.msg.context?.cta
              ? `<strong>${h(first.capture.msg.context.cta.label)}</strong> <a href="${h(first.capture.msg.context.cta.url)}" target="_blank" rel="noopener">${h(first.capture.msg.context.cta.url)}</a>`
              : "None"
          }</p></section>`
        : ""
    }
    ${carries.length ? `<section><h4>Carries</h4><p>${h(carries.join(" · "))}</p></section>` : ""}
    ${first ? `<section><h4>In the bell / on a phone</h4><div class="bell"><strong>${h(first.bell.title)}</strong><span>${h(first.bell.body || "(title only)")}</span></div></section>` : ""}
    <details><summary>Fields this template uses (${tokens.length})</summary><ul class="tokens">${tokenList.join("")}</ul></details>
    ${e.source === "live-edited" ? `<p class="flag">You've edited this template in the admin — this is your stored wording.</p>` : e.source === "shipped" ? `<p class="flag">Not in the database yet — this is the shipped wording.</p>` : ""}
    ${e.sampleOnly ? `<p class="flag">Rendered with sample values: the stock-alert rule is not wired into the engine in this build yet.</p>` : ""}
    ${e.problems.map((p) => `<p class="flag bad">${h(p)}</p>`).join("")}
  </div>
  <div class="preview">
    ${
      e.variants.length > 1
        ? `<div class="tabs" role="tablist" aria-label="Versions of this email">${e.variants
            .map(
              (v, i) => `<button type="button" role="tab" class="tab" aria-selected="${i === 0}" data-target="${h(e.key)}-${i}">${h(v.label)}${v.checks.every((c) => c.ok) ? "" : ` <span class="tab-bad">✕</span>`}</button>`
            )
            .join("")}</div>`
        : e.variants[0]
          ? `<p class="one-version">${h(e.variants[0].label)}</p>`
          : ""
    }
    <div class="frames">${e.variants.map((v, i) => frame(`${e.key}-${i}`, v.capture.rendered.html, i > 0)).join("")}</div>
    ${e.variants
      .map((v, i) => `<div class="variant-checks" data-for="${h(e.key)}-${i}" ${i > 0 ? "hidden" : ""}><h4>Checks</h4>${checksHtml(v.checks)}</div>`)
      .join("")}
  </div>
</div>
</article>`;
}

function directHtml(d: DirectEntry): string {
  const ok = d.checks.every((c) => c.ok);
  return `<article class="entry" id="${h(d.key)}">
<header class="entry-head"><div><p class="eyebrow">${d.to === "admin" ? "To you" : "To the customer"} · always on</p><h3>${h(d.name)}</h3></div><span class="verdict ${ok ? "ok" : "bad"}">${ok ? "All checks pass" : "Needs attention"}</span></header>
<div class="entry-body">
  <div class="meta">
    <section><h4>When it's sent</h4><p>${h(d.when)}</p></section>
    <section><h4>Why it can't be switched off</h4><p>${h(d.why)}</p></section>
    <section><h4>In the inbox</h4>${inbox(d.rendered)}</section>
  </div>
  <div class="preview"><div class="frames">${frame(`${d.key}-0`, d.rendered.html, false)}</div><div class="variant-checks" data-for="${h(d.key)}-0"><h4>Checks</h4>${checksHtml(d.checks)}</div></div>
</div>
</article>`;
}

const entryList = [...entries.values()];
const totalChecks = entryList.flatMap((e) => e.variants.flatMap((v) => v.checks)).length + DIRECT.flatMap((d) => d.checks).length;
const emailsOn = entryList.filter((e) => e.rules.some((r) => r.action === "email" && r.live === true)).length;
const generatedAt = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

const indexRows = SECTIONS.map((section) => {
  const rows = section.keys
    .map((k) => entries.get(k))
    .filter((e): e is Entry => Boolean(e))
    .map((e) => {
      const ok = e.variants.every((v) => v.checks.every((c) => c.ok)) && !e.problems.length;
      const main = e.rules.find((r) => r.action === "email") ?? e.rules[0];
      return `<tr><td><a href="#${h(e.key)}">${h(e.name)}</a></td><td>${h(who(e.recipient))}</td><td>${h(main ? whenText(main) : "—")}</td><td>${channelSummary(e.rules, "email")}</td><td>${channelSummary(e.rules, "inapp")}</td><td>${channelSummary(e.rules, "push")}</td><td class="${ok ? "ok" : "bad"}">${ok ? "✓" : "✕"}</td></tr>`;
    })
    .join("");
  return `<tr class="group"><th colspan="7">${h(section.title)}</th></tr>${rows}`;
}).join("") + `<tr class="group"><th colspan="7">Account &amp; contact (always on)</th></tr>${DIRECT.map((d) => `<tr><td><a href="#${h(d.key)}">${h(d.name)}</a></td><td>${h(who(d.to))}</td><td>${h(d.when)}</td><td><span class="pill on">Always</span></td><td><span class="dash">—</span></td><td><span class="dash">—</span></td><td class="${d.checks.every((c) => c.ok) ? "ok" : "bad"}">${d.checks.every((c) => c.ok) ? "✓" : "✕"}</td></tr>`).join("")}`;

const page = `<meta charset="utf-8">
<title>Level7 Email Catalogue</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Space+Grotesk:wght@500;700&display=swap">
<style>
:root{--bg:#fafafa;--surface:#ffffff;--ink:#0a0a0a;--body:#3f3f46;--muted:#71717a;--line:#e4e4e7;--soft:#f4f4f5;--accent:#7c3aed;--accent-soft:#f3edff;--on:#15803d;--on-soft:#e8f6ec;--off:#71717a;--off-soft:#f1f1f3;--new:#a16207;--new-soft:#fdf5e1;--bad:#b91c1c;--bad-soft:#fdecec;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#09090b;--surface:#131316;--ink:#fafafa;--body:#d4d4d8;--muted:#a1a1aa;--line:#27272b;--soft:#1c1c20;--accent:#a78bfa;--accent-soft:#221a36;--on:#4ade80;--on-soft:#12281a;--off:#a1a1aa;--off-soft:#1c1c20;--new:#fbbf24;--new-soft:#2a2210;--bad:#f87171;--bad-soft:#2d1414;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#09090b;--surface:#131316;--ink:#fafafa;--body:#d4d4d8;--muted:#a1a1aa;--line:#27272b;--soft:#1c1c20;--accent:#a78bfa;--accent-soft:#221a36;--on:#4ade80;--on-soft:#12281a;--off:#a1a1aa;--off-soft:#1c1c20;--new:#fbbf24;--new-soft:#2a2210;--bad:#f87171;--bad-soft:#2d1414;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--body);font:15px/1.6 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1240px;margin:0 auto;padding-inline:16px;padding-block:40px 80px}
@media (min-width:720px){.wrap{padding-inline:32px}}
h1,h2,h3{font-family:"Space Grotesk",Inter,-apple-system,"Segoe UI",sans-serif;color:var(--ink);letter-spacing:-.02em;text-wrap:balance;margin:0}
h1{font-size:clamp(32px,5vw,52px);line-height:1.05;font-weight:700}
h2{font-size:28px;line-height:1.15;font-weight:700}
h3{font-size:21px;line-height:1.25;font-weight:700}
h4{margin:0 0 6px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600}
code,.mono{font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.86em}
a{color:var(--accent)}
a:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
.eyebrow{margin:0 0 6px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);font-weight:600}
.lede{max-width:68ch;margin:14px 0 0;font-size:17px;color:var(--body)}
.facts{display:flex;flex-wrap:wrap;gap:10px 28px;margin:28px 0 0;padding:0;list-style:none}
.facts li{display:flex;flex-direction:column}
.facts b{font:700 28px/1.1 "Space Grotesk",Inter,sans-serif;color:var(--ink);font-variant-numeric:tabular-nums}
.facts span{font-size:13px;color:var(--muted)}
.fineprint{margin:18px 0 0;font-size:13px;color:var(--muted);max-width:90ch}
.controls{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;margin:28px 0 0;padding:12px 14px;background:var(--surface);border:1px solid var(--line);border-radius:10px}
.controls fieldset{border:0;margin:0;padding:0;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.controls legend{float:left;margin-right:6px;font-size:13px;color:var(--muted)}
.seg{appearance:none;border:1px solid var(--line);background:var(--bg);color:var(--ink);font:500 13px/1 Inter,sans-serif;padding:8px 12px;border-radius:8px;cursor:pointer}
.seg[aria-pressed="true"]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.index{margin:44px 0 0}
.table-scroll{overflow-x:auto;margin-top:14px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}
table.idx{width:100%;border-collapse:collapse;min-width:760px;font-size:14px}
.idx th,.idx td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
.idx thead th{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:600}
.idx tr.group th{background:var(--soft);font:700 13px/1.4 "Space Grotesk",Inter,sans-serif;color:var(--ink);letter-spacing:0;text-transform:none}
.idx td.ok{color:var(--on);font-weight:700}.idx td.bad{color:var(--bad);font-weight:700}
.idx a{color:var(--ink);font-weight:600;text-decoration:none}.idx a:hover{text-decoration:underline}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.pill.on{background:var(--on-soft);color:var(--on)}.pill.off{background:var(--off-soft);color:var(--off)}.pill.new{background:var(--new-soft);color:var(--new)}
.dash{color:var(--muted)}
.section{margin:72px 0 0}
.section>header{padding-bottom:14px;border-bottom:1px solid var(--line)}
.section>header p{margin:6px 0 0;color:var(--muted);max-width:70ch}
.entry{margin:28px 0 0;background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.entry-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:18px 20px;border-bottom:1px solid var(--line)}
.entry-head .eyebrow code{color:var(--muted);text-transform:none;letter-spacing:0}
.verdict{flex-shrink:0;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px}
.verdict.ok{background:var(--on-soft);color:var(--on)}.verdict.bad{background:var(--bad-soft);color:var(--bad)}
.entry-body{display:grid;grid-template-columns:1fr;gap:0}
@media (min-width:1000px){.entry-body{grid-template-columns:minmax(300px,380px) 1fr}}
.meta{padding:18px 20px;display:flex;flex-direction:column;gap:18px;border-bottom:1px solid var(--line);min-width:0}
@media (min-width:1000px){.meta{border-bottom:0;border-right:1px solid var(--line)}}
.meta p{margin:0}
table.rules{width:100%;border-collapse:collapse;font-size:13px}
.rules th{text-align:left;font-weight:600;color:var(--muted);padding:0 8px 6px 0;font-size:12px}
.rules td{padding:7px 8px 7px 0;border-top:1px solid var(--line);vertical-align:top}
.rule-name{display:block;color:var(--muted);font-size:12px}
.inbox{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);font-size:13px;min-width:0}
.inbox .from{font-weight:700;color:var(--ink)}.inbox .subj{font-weight:600;color:var(--ink)}
.inbox .pre{color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cta-line{overflow-wrap:anywhere;font-size:14px}.cta-line a{display:block;font-size:12px}
.bell{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:10px;background:var(--soft);font-size:13px}
.bell strong{color:var(--ink)}
details summary{cursor:pointer;font-size:13px;color:var(--muted)}
ul.tokens{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:4px;font-size:12px}
ul.tokens span{color:var(--muted)}
.flag{font-size:13px;padding:8px 10px;border-radius:8px;background:var(--accent-soft);color:var(--ink)}
.flag.bad{background:var(--bad-soft);color:var(--bad)}
.preview{padding:18px 20px;min-width:0}
.tabs{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}
.tab{appearance:none;border:1px solid var(--line);background:var(--bg);color:var(--body);font:500 13px/1.2 Inter,sans-serif;padding:7px 11px;border-radius:8px;cursor:pointer}
.tab[aria-selected="true"]{border-color:var(--ink);color:var(--ink);background:var(--surface);box-shadow:inset 0 -2px 0 var(--accent)}
.tab-bad{color:var(--bad)}
.one-version{margin:0 0 12px;font-size:13px;color:var(--muted)}
.frames{display:flex;justify-content:center;background:var(--soft);border-radius:10px;padding:12px}
iframe.mail{display:block;width:var(--frame-w,620px);max-width:100%;height:900px;border:0;border-radius:8px;background:#fafafa}
.variant-checks{margin-top:16px}
ul.checks{list-style:none;margin:0;padding:0;display:grid;gap:6px;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));font-size:13px}
ul.checks li{display:flex;gap:8px;align-items:flex-start;padding:7px 9px;border-radius:8px;background:var(--bg);border:1px solid var(--line);min-width:0}
ul.checks .mark{font-weight:700}
ul.checks li.ok .mark{color:var(--on)}ul.checks li.bad{border-color:var(--bad);background:var(--bad-soft)}ul.checks li.bad .mark{color:var(--bad)}
ul.checks strong{display:block;color:var(--ink);font-weight:600}
ul.checks .detail{display:block;color:var(--muted);font-size:12px;overflow-wrap:anywhere}
footer.page{margin-top:80px;padding-top:18px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}
@media (prefers-reduced-motion:no-preference){.tab,.seg{transition:background-color .15s,border-color .15s,color .15s}}
</style>
<div class="wrap">
<header>
  <p class="eyebrow">${h(settings.brandName)} · every email, as it arrives</p>
  <h1>Email catalogue</h1>
  <p class="lede">Each email below is produced by the store's own mail engine — the same code that sends it — using sample orders, returns and chats. What you see here is what your customers receive. Switches (“On” / “Off”) are read from your live store.</p>
  <ul class="facts">
    <li><b>${entryList.length + DIRECT.length}</b><span>different emails</span></li>
    <li><b>${renders}</b><span>versions rendered</span></li>
    <li><b>${emailsOn}</b><span>emails switched on</span></li>
    <li><b>${totalChecks - failures}/${totalChecks}</b><span>checks passing</span></li>
  </ul>
  <p class="fineprint">Built ${h(generatedAt)} from ${h(process.env.NEXT_PUBLIC_SITE_URL ?? "(no site URL)")}. ${liveError ? `Live store could not be read (${h(liveError)}), so switches and settings are the shipped defaults. ` : ""}Nothing was sent to anyone while making this. Photos are embedded so the file works offline; in a real email they load from the store.</p>
  <div class="controls" role="group" aria-label="Preview options">
    <fieldset><legend>Width</legend><button type="button" class="seg" data-width="620px" aria-pressed="true">Desktop</button><button type="button" class="seg" data-width="375px" aria-pressed="false">Phone</button></fieldset>
    <fieldset><legend>Email theme</legend><button type="button" class="seg" data-scheme="system" aria-pressed="true">Match device</button><button type="button" class="seg" data-scheme="light" aria-pressed="false">Light</button><button type="button" class="seg" data-scheme="dark" aria-pressed="false">Dark</button></fieldset>
  </div>
</header>
<section class="index" aria-labelledby="idx-h">
  <h2 id="idx-h">At a glance</h2>
  <div class="table-scroll"><table class="idx"><thead><tr><th>Email</th><th>To</th><th>Sent when</th><th>Email</th><th>Bell</th><th>Phone</th><th>Checks</th></tr></thead><tbody>${indexRows}</tbody></table></div>
</section>
${SECTIONS.map((section) => {
  const list = section.keys.map((k) => entries.get(k)).filter((e): e is Entry => Boolean(e));
  if (!list.length) return "";
  return `<section class="section" id="section-${h(section.id)}"><header><h2>${h(section.title)}</h2><p>${h(section.blurb)}</p></header>${list.map(entryHtml).join("")}</section>`;
}).join("")}
<section class="section" id="section-account"><header><h2>Account &amp; contact</h2><p>Three messages that answer something a person just did. They are always on, so nobody is ever locked out of their account or loses an enquiry.</p></header>${DIRECT.map(directHtml).join("")}</section>
<footer class="page">Rebuild this page any time with <code>npx tsx scripts/email-catalogue.mts</code>. Turn an email on or off in Admin → Settings → Alerts; edit its wording in Admin → Automation → Templates.</footer>
</div>
<script>
(function(){
  var scheme = "system";
  function applyScheme(f){
    try{
      var d=f.contentDocument; if(!d) return;
      d.querySelectorAll("style").forEach(function(s){
        if(!s.dataset.orig){ if(s.textContent.indexOf("prefers-color-scheme")<0) return; s.dataset.orig=s.textContent; }
        var q = scheme==="dark" ? "@media all" : scheme==="light" ? "@media not all" : null;
        s.textContent = q ? s.dataset.orig.replace(/@media \\(prefers-color-scheme:dark\\)/g, q) : s.dataset.orig;
      });
    }catch(e){}
  }
  function fit(f){
    try{ var d=f.contentDocument; if(d&&d.documentElement){ f.style.height=(d.documentElement.scrollHeight+4)+"px"; } }catch(e){}
  }
  function prime(f){ applyScheme(f); fit(f); setTimeout(function(){fit(f)},400); setTimeout(function(){fit(f)},1500); }
  document.querySelectorAll("iframe.mail").forEach(function(f){
    f.addEventListener("load",function(){prime(f)});
    if(f.contentDocument&&f.contentDocument.readyState==="complete") prime(f);
  });
  document.querySelectorAll(".tabs").forEach(function(tabs){
    var entry=tabs.closest(".entry");
    tabs.addEventListener("click",function(ev){
      var b=ev.target.closest(".tab"); if(!b) return;
      tabs.querySelectorAll(".tab").forEach(function(t){t.setAttribute("aria-selected", t===b?"true":"false")});
      var id=b.getAttribute("data-target");
      entry.querySelectorAll("iframe.mail").forEach(function(f){ f.hidden = f.id!==id; if(!f.hidden) prime(f); });
      entry.querySelectorAll(".variant-checks").forEach(function(c){ c.hidden = c.getAttribute("data-for")!==id; });
    });
  });
  document.querySelectorAll(".seg[data-width]").forEach(function(b){
    b.addEventListener("click",function(){
      document.querySelectorAll(".seg[data-width]").forEach(function(x){x.setAttribute("aria-pressed", x===b?"true":"false")});
      document.documentElement.style.setProperty("--frame-w", b.getAttribute("data-width"));
      setTimeout(function(){document.querySelectorAll("iframe.mail:not([hidden])").forEach(fit)},60);
    });
  });
  document.querySelectorAll(".seg[data-scheme]").forEach(function(b){
    b.addEventListener("click",function(){
      scheme=b.getAttribute("data-scheme");
      document.querySelectorAll(".seg[data-scheme]").forEach(function(x){x.setAttribute("aria-pressed", x===b?"true":"false")});
      document.querySelectorAll("iframe.mail").forEach(function(f){applyScheme(f); fit(f)});
    });
  });
  window.addEventListener("resize",function(){document.querySelectorAll("iframe.mail:not([hidden])").forEach(fit)});
})();
</script>
`;

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, page, "utf8");
console.log(
  `\n${renders} emails rendered · ${totalChecks - failures}/${totalChecks} checks pass · ${embedded.size}/${imageUrls.size} images embedded\n→ ${path.relative(ROOT, OUT)} (${Math.round(Buffer.byteLength(page) / 1024)} KB)`
);
if (STRICT && failures > 0) process.exit(1);
