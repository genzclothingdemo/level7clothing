import "server-only";
import { Resend } from "resend";
import type { SettingsDTO } from "./types";
import { siteUrl } from "./site-url";
import { DEFAULT_SETTINGS } from "./settings";

/**
 * **The only place this store talks to Resend.**
 *
 * Two things live here and nothing else should:
 *
 * 1. `send()` — the single transport. Every outbound message in the app comes
 *    through it, so there is one `from`, one failure log and one place to look
 *    when mail stops arriving.
 * 2. **The shell** — the one HTML layout every message is poured into, and its
 *    plain-text twin. Everything that reacts to a store event (orders,
 *    payments, returns, chat, carts) is composed from an editable template by
 *    `lib/automation.ts` and arrives here through {@link sendAutomationEmail};
 *    the three messages below that are not rule-driven use the same shell, so
 *    a password reset and an order receipt look like they came from one shop.
 *
 * ## Who still sends directly, and why
 *
 * Exactly three, all deliberate:
 *
 * - **{@link sendPasswordResetEmail}** carries a one-time token. It is a reply
 *   to something the customer did two seconds ago, not a notification about the
 *   store — and a rule that could switch it off is a rule that locks people out
 *   of their own accounts with no error anywhere.
 * - **{@link sendOtpEmail}** is the same argument in a shorter window: a
 *   six-digit code that expires in ten minutes, waited for on a form. A paused
 *   rule here does not delay a message, it stops an account being created and
 *   an order being placed.
 * - **{@link sendContactEmail}** is the contact form's own delivery. Switching
 *   it off would silently bin enquiries the customer believes were sent.
 *
 * All three are listed read-only on Admin → Automation so the screen is still
 * the whole picture — see "Every mail this store sends" there. Each has a
 * `render…` twin exported beside it, used by the send and by
 * `scripts/email-catalogue.mts`, so the catalogue cannot show a layout that
 * differs from what is sent.
 */

const apiKey = process.env.RESEND_API_KEY;
// Resend rejects a sender on a domain you have not verified, so the fallback
// stays on their shared testing domain rather than guessing a brand address.
const FROM = process.env.EMAIL_FROM || "HALFTONE <onboarding@resend.dev>";

const resend = apiKey ? new Resend(apiKey) : null;

/* ------------------------------------------------------------------ */
/*  Health                                                             */
/* ------------------------------------------------------------------ */

/**
 * The outcome of the last send this **server process** attempted.
 *
 * In-memory on purpose, and labelled as such on screen. A serverless instance
 * is short-lived, so this is a strong signal in dev and a weak one in
 * production — the durable record of every rule-driven send is `AutomationJob`,
 * which Admin → Automation reads beside this. Between them, a Resend rejection
 * now has somewhere to appear; it used to be a `console.error` nobody saw,
 * which is why the store was silently undeliverable for weeks.
 */
export type LastSend = {
  at: string;
  to: string;
  subject: string;
  outcome: "sent" | "rejected" | "threw" | "no-api-key";
  /** Resend's own words, already stringified. Never contains the API key. */
  error?: string;
};

let lastSend: LastSend | null = null;

function record(entry: LastSend) {
  lastSend = entry;
}

/** What `EMAIL_FROM` is, and whether Resend can plausibly accept it. */
export type FromVerdict =
  /** Nothing configured — the built-in fallback is in use. */
  | "fallback"
  /** Resend's shared testing domain: delivers ONLY to the Resend account owner. */
  | "resend-test"
  /** A public mailbox domain. Nobody can verify it, so every send is a 403. */
  | "unverifiable"
  /** A domain of your own. Deliverable *if* it is verified in Resend. */
  | "custom";

export type EmailHealth = {
  hasApiKey: boolean;
  /** The full `EMAIL_FROM`, e.g. `Level7 Clothing <hello@example.com>`. */
  from: string;
  /** Just the address part. */
  fromAddress: string;
  fromDomain: string;
  verdict: FromVerdict;
  /** One sentence the owner can act on. */
  advice: string;
  lastSend: LastSend | null;
};

/** Domains no Resend account can ever verify, so a sender on one always 403s. */
const PUBLIC_MAILBOX_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.in",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "rediffmail.com",
  "zoho.com",
]);

function addressIn(from: string): string {
  const angled = from.match(/<([^>]+)>/);
  return (angled ? angled[1] : from).trim();
}

/**
 * Whether mail can leave this store, in the three facts that decide it.
 *
 * **The API key is never part of the answer** — only whether one is set. A
 * screen that prints a send key is a screen that leaks it into a screenshot.
 */
export function emailHealth(): EmailHealth {
  const configured = Boolean(process.env.EMAIL_FROM?.trim());
  const fromAddress = addressIn(FROM);
  const fromDomain = fromAddress.split("@")[1]?.toLowerCase() ?? "";

  const verdict: FromVerdict = !configured
    ? "fallback"
    : fromDomain === "resend.dev"
      ? "resend-test"
      : PUBLIC_MAILBOX_DOMAINS.has(fromDomain)
        ? "unverifiable"
        : "custom";

  const advice = !process.env.RESEND_API_KEY
    ? "No RESEND_API_KEY is set, so nothing is sent at all — every message is skipped with a line in the log."
    : verdict === "unverifiable"
      ? `Resend can only send from a domain you have verified, and nobody can verify ${fromDomain}. Every send is being rejected with a 403. Use a domain you own.`
      : verdict === "resend-test" || verdict === "fallback"
        ? "This is Resend's shared testing domain. It needs no setup, but on a free account it only delivers to the address that owns the Resend account — fine for proving the pipeline, not for customers."
        : `Mail is sent from ${fromDomain}. That domain has to be verified in Resend, or every send is rejected with a 403.`;

  return {
    hasApiKey: Boolean(apiKey),
    from: FROM,
    fromAddress,
    fromDomain,
    verdict,
    advice,
    lastSend,
  };
}

/* ------------------------------------------------------------------ */
/*  The one transport                                                  */
/* ------------------------------------------------------------------ */

async function send(opts: {
  to: string | string[];
  subject: string;
  html: string;
  /** The plain-text part. Spam filters score a mail without one, and some people read mail as text. */
  text?: string;
  /**
   * Where a reply goes. `EMAIL_FROM` is a sending address on a verified
   * domain and need not be a real mailbox (see CLAUDE.md), so every template
   * that says "reply to this email" is only telling the truth when this points
   * at an inbox somebody reads.
   */
  replyTo?: string;
}) {
  const to = Array.isArray(opts.to) ? opts.to.join(", ") : opts.to;
  const at = new Date().toISOString();

  if (!resend) {
    console.warn(
      `[email] RESEND_API_KEY not set — skipping email "${opts.subject}" to ${to}`
    );
    record({ at, to, subject: opts.subject, outcome: "no-api-key" });
    return { skipped: true };
  }
  try {
    const res = await resend.emails.send({
      from: FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      ...(opts.text ? { text: opts.text } : {}),
      ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
    });
    if (res.error) {
      // By far the most common cause is EMAIL_FROM using a domain that isn't
      // verified in Resend (a gmail.com / outlook.com address can never be),
      // which rejects every send while the app carries on as if it worked.
      console.error(
        `[email] REJECTED "${opts.subject}" to ${to} — from="${FROM}".`,
        `Is that domain verified in Resend? →`,
        res.error
      );
      record({
        at,
        to,
        subject: opts.subject,
        outcome: "rejected",
        error: JSON.stringify(res.error).slice(0, 500),
      });
    } else {
      record({ at, to, subject: opts.subject, outcome: "sent" });
    }
    return res;
  } catch (err) {
    console.error(
      `[email] THREW sending "${opts.subject}" to ${to} — from="${FROM}":`,
      err
    );
    record({
      at,
      to,
      subject: opts.subject,
      outcome: "threw",
      error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
    });
    return { error: err };
  }
}

/*
 * `sendLeadEmail` and `sendOrderEmails` used to live here.
 *
 * They are **retired**, not moved: both were hardcoded bodies that fired
 * alongside an automation rule for the same event, which is the duplication
 * this refactor removes. What replaced them:
 *
 * | was                            | now                                             |
 * |--------------------------------|-------------------------------------------------|
 * | `sendLeadEmail`                | rule "Tell me when something goes in a cart"     |
 * | `sendOrderEmails` (admin half) | rule "Tell me an order came in"                  |
 * | `sendOrderEmails` (cust. half) | rule "Thank the customer for their order"        |
 *
 * All three are seeded system rules on `cart.abandoned` / `order.created` —
 * see `SYSTEM_RULES` in `lib/automation.ts`. Do not add a hardcoded sender
 * back: a rule the owner switched off must genuinely stop the mail, and a
 * second sender for the same event is exactly what made that untrue.
 */

/* ------------------------------------------------------------------ */
/*  The structure a status email needs, on top of the words            */
/* ------------------------------------------------------------------ */

/**
 * **The part of a status email the owner does not type.**
 *
 * The brief for these was "Flipkart/Amazon grade", and the gap between what
 * this store sent and that standard was never the *wording* — the templates
 * read well. It was that every one of them rendered as a column of grey
 * paragraphs: the order number was a sentence rather than a heading, the piece
 * being talked about had no picture, and the link to act on was a bare URL in
 * the middle of the text, indistinguishable from the sign-off.
 *
 * So the words stay the owner's and the **structure** becomes the engine's.
 * `lib/automation.ts` resolves one of these from the same row it resolves the
 * tokens from, and this file lays it out. Nothing here is typed by anybody, so
 * nothing here can be left half-filled by a template edit.
 *
 * Every field is optional and every field renders nothing when absent, which
 * is what lets one shell serve an order receipt, a refund notice and a chat
 * reply without any of them carrying a blank slot for the others.
 */
export type EmailContext = {
  /** Small caps line above the headline — "Order L7-1042". */
  kicker?: string;
  /** What actually happened, as a heading. "Your order is on its way." */
  headline?: string;
  /**
   * The inbox preview line.
   *
   * Hidden in the body and read by every mail client as the text beside the
   * subject. Without one, clients grab the first words they find — which for
   * these templates is "Hi Riya," on every single message, making an inbox of
   * them unreadable at a glance.
   */
  preheader?: string;
  /** The pieces this message is about, with their photographs. */
  items?: {
    name: string;
    image?: string | null;
    quantity?: number;
    price?: string;
    options?: string;
  }[];
  /** Label/value rows under the items — total, payment, courier, AWB. */
  facts?: { label: string; value: string }[];
  /**
   * The single obvious action.
   *
   * One, deliberately. A mail with "Track", "View order" and "Return" side by
   * side is a mail that has not decided what it wants the reader to do, and
   * on a phone the three of them wrap into a stack of grey rectangles.
   */
  cta?: { label: string; url: string };
  /** The expectation-setting line under the button. "Usually 3–5 working days." */
  note?: string;
  /**
   * A one-time code, set large and monospaced. Only the OTP mail uses it — a
   * code read off a lock-screen banner or copied out of a paragraph is a code
   * typed wrong.
   */
  code?: string;
  /**
   * Who the headline and note were written *to*. `resolveSubject` writes a
   * context in the customer's voice ("Your order is confirmed.") for every
   * subject that has a customer, and the owner's copy of such a mail is
   * re-voiced — see {@link renderAutomationEmail}. A context written for the
   * owner in the first place (the stock alert: "…is oversold", and the note
   * that explains what that costs) says `"owner"` and is shown as written.
   * Absent means `"customer"`.
   */
  voice?: "customer" | "owner";
};

/**
 * Who a message is written for. It decides the footer (the customer is told
 * how to reach the store; the owner is told how to switch the alert off),
 * whether a reply-to is set, and which of the context's lines are shown — see
 * {@link renderAutomationEmail}.
 */
export type EmailAudience = "customer" | "admin";

/* ------------------------------------------------------------------ */
/*  Small, safe helpers                                                */
/* ------------------------------------------------------------------ */

const esc = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Collapse whitespace — for subjects, headlines and anything set on one line. */
const flat = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * A link a mail client can follow, or nothing.
 *
 * Only `http(s)` reaches an `href` — a template token could otherwise carry
 * `javascript:`. A same-origin **path** is made absolute rather than dropped,
 * because a relative link is dead in every mail client (there is no origin to
 * be relative to) and a caller that passed one meant this store.
 */
function absoluteUrl(url: string | null | undefined): string | null {
  const trimmed = (url ?? "").trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return `${siteUrl()}${trimmed}`;
  return null;
}

/** {@link absoluteUrl}, escaped for an attribute. */
function href(url: string | null | undefined): string | null {
  const abs = absoluteUrl(url);
  return abs ? esc(abs) : null;
}

/**
 * The photograph as a mail client should fetch it.
 *
 * The product shots in `public/products` are print-resolution PNGs — the one
 * measured was 1.09 MB. A 72-pixel thumbnail does not need that, and a phone on
 * a train will show a blank box while it downloads. The store's own image
 * optimiser serves the same picture at 256 px wide (9 KB for that file), which
 * is sharp at 3× on the widest thumbnail this shell draws.
 *
 * Only images this store hosts are rewritten: its own paths, and the Vercel
 * Blob host `next.config.ts` already allows. Anything else is left exactly as
 * given, because the optimiser refuses a host it has not been told about.
 */
function emailImage(url: string | null | undefined): string | null {
  const abs = absoluteUrl(url);
  if (!abs) return null;
  const origin = siteUrl();
  if (abs.startsWith(`${origin}/`)) {
    const path = abs.slice(origin.length);
    if (path.startsWith("/_next/")) return abs;
    return `${origin}/_next/image?url=${encodeURIComponent(path)}&w=256&q=75`;
  }
  try {
    if (new URL(abs).hostname.endsWith(".public.blob.vercel-storage.com")) {
      return `${origin}/_next/image?url=${encodeURIComponent(abs)}&w=256&q=75`;
    }
  } catch {
    return null;
  }
  return abs;
}

const digits = (s: string | null | undefined): string => (s ?? "").replace(/\D/g, "");

/**
 * A contact detail worth printing, or `null`.
 *
 * `SiteSettings` ships with placeholders (`+91 90000 00000`, an address on the
 * reserved `.example` domain) so a fresh store renders. Printed in a mail they
 * are worse than nothing: a customer who calls the number or writes to the
 * address reaches nobody, and the store looks like a template. So a value equal
 * to the shipped default — the store's own `DEFAULT_SETTINGS`, not a copy of
 * it — is treated as not configured.
 */
function realPhone(value: string | null | undefined, placeholder: string | null): string | null {
  const d = digits(value);
  if (d.length < 10 || d === digits(placeholder)) return null;
  return (value ?? "").trim();
}

function realEmail(value: string | null | undefined, placeholder: string): string | null {
  const v = (value ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return null;
  if (v.toLowerCase() === placeholder.toLowerCase()) return null;
  // RFC 2606 names that can never receive mail.
  if (/\.(example|invalid|test|localhost)$/i.test(v)) return null;
  return v;
}

/** The address customers are told to write to — and the reply-to — if it is real. */
function supportEmail(settings: SettingsDTO): string | null {
  return realEmail(settings.contactEmail, DEFAULT_SETTINGS.contactEmail);
}

/* ------------------------------------------------------------------ */
/*  Presentation of the engine's facts                                 */
/* ------------------------------------------------------------------ */

/**
 * `Order.paymentMethod` is a code — `COD`, `Razorpay`, `Partial`, `Direct` —
 * and the facts table used to print it raw. "Razorpay" is the name of a
 * gateway, not something a shopper chose; "COD" is shorthand. The labels are
 * deliberately **neutral about whether money moved**: a failed prepaid payment
 * carries the same `Razorpay` code as a successful one, so "Paid online" would
 * be a lie on exactly the mail where it matters most.
 *
 * Presentation only. The engine's value is what `pruneFactLines` compares
 * against, so this cannot change which template lines are kept.
 */
const PAYMENT_LABELS: Record<string, string> = {
  cod: "Cash on delivery",
  razorpay: "Prepaid online",
  partial: "Advance online, rest on delivery",
  direct: "Arranged with the store",
};

/**
 * Display aliases for two fact labels whose wording outlived its moment.
 * "Online now" read as "paid just now" — including on the mail that says the
 * advance *failed* — and "On delivery" did not say what happens then.
 */
const FACT_LABELS: Record<string, string> = {
  "Online now": "Advance (online)",
  "On delivery": "Balance on delivery",
};

function displayFact(f: { label: string; value: string }): { label: string; value: string } {
  const label = FACT_LABELS[f.label] ?? f.label;
  const value =
    f.label === "Payment" ? (PAYMENT_LABELS[f.value.trim().toLowerCase()] ?? f.value) : f.value;
  return { label, value };
}

/** Line total from a formatted unit price, when the price is one we can read back. */
function lineTotal(price: string | undefined, quantity: number): string | null {
  if (!price || quantity <= 1) return null;
  const unit = Number(price.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(unit) || unit <= 0) return null;
  const symbol = price.match(/^[^\d\s]+/)?.[0] ?? "";
  return `${symbol}${Math.round(unit * quantity).toLocaleString("en-IN")}`;
}

/* ------------------------------------------------------------------ */
/*  The owner's words → paragraphs                                     */
/* ------------------------------------------------------------------ */

/**
 * Split the (already substituted) template text into paragraphs, dropping the
 * lines the button now carries.
 *
 * - **A line that is only the CTA's own URL is dropped.** Most of the shipped
 *   templates end with `{{order.url}}` on its own line, which was the only way
 *   to offer an action before there was a button. Leaving it in prints the
 *   same link twice — once as a button and once as raw text underneath.
 * - **A dropped link takes its introducer with it.** "See your order any
 *   time:" followed by the URL is a promise; removing the URL alone leaves it
 *   standing over nothing. This only ever fires immediately above a line
 *   already being removed, which is what keeps it from touching prose.
 *
 * **Empty labels are NOT handled here**, and that is worth stating because the
 * obvious place to handle them is here and it is the wrong one. A template
 * line `Courier: {{order.courier}}` renders as the bare word `Courier:` when
 * the parcel is not booked yet — but so does the prose line `Track it here:`,
 * which introduces the URL on the next line and must be kept. **After
 * substitution the two are the same string**, so no rule written at this point
 * can tell them apart. It is done in `lib/automation.ts` instead, before the
 * tokens are substituted, where "did this token have a value" is a fact rather
 * than a guess. See `pruneFactLines` there.
 */
function bodyParagraphs(text: string, ctaUrl?: string | null): string[] {
  const skip = ctaUrl?.trim();
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((para) => {
      const lines = para.split("\n");
      const keep = lines.map((line) => !(skip && line.trim() === skip));
      for (let i = 1; i < lines.length; i += 1) {
        if (keep[i] || !keep[i - 1]) continue;
        if (/^\s*[^:]{1,60}:\s*$/.test(lines[i - 1])) keep[i - 1] = false;
      }
      return lines.filter((_, i) => keep[i]).join("\n").trim();
    })
    .filter((para) => para.length > 0);
}

/** A greeting on its own, which is never the point of a message. */
const GREETING = /^(hi|hey|hello|dear)\b[^\n]{0,40}[,!]$/i;

/** The first thing the message actually says — the fallback inbox preview. */
function leadLine(paragraphs: string[]): string {
  for (const para of paragraphs) {
    const lines = para.split("\n").filter((l) => !GREETING.test(l.trim()));
    const text = flat(lines.join(" ")).replace(/^["“]|["”]$/g, "");
    if (text && !/^https?:\/\/\S+$/.test(text)) return text.length > 150 ? `${text.slice(0, 147)}…` : text;
  }
  return "";
}

/* ------------------------------------------------------------------ */
/*  The shell                                                          */
/* ------------------------------------------------------------------ */

/*
 * The storefront's own tokens (`src/app/globals.css`), because a receipt that
 * does not look like the shop it came from reads as a phishing mail. Light is
 * the inline default — the only styling Gmail is guaranteed to keep — and dark
 * is applied by the `prefers-color-scheme` block for the clients that honour
 * it (Apple Mail, iOS Mail, Outlook for Mac).
 */
const INK = "#0a0a0a";
const BODY = "#27272a";
const MUTED = "#71717a";
const BORDER = "#e4e4e7";
const SOFT = "#f4f4f5";
const PAGE = "#fafafa";
const CARD = "#ffffff";
const ACCENT = "#7c3aed";

const SANS =
  "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const DISPLAY =
  "'Space Grotesk',Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

/**
 * Enhancements only. Every rule the layout depends on is inline, because Gmail
 * keeps inline styles and is unreliable about `<style>`. Dark mode is a second
 * block on purpose: a client that rejects one block keeps the other.
 */
const HEAD_CSS = `<style>
body{margin:0!important;padding:0!important;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table,td{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt}
img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}
@media only screen and (max-width:620px){
.l7-gutter{padding-left:20px!important;padding-right:20px!important}
.l7-h1{font-size:22px!important;line-height:28px!important}
.l7-btn{width:100%!important}
.l7-btn-link{display:block!important;text-align:center!important}
}
</style>
<style>
@media (prefers-color-scheme:dark){
.l7-page{background-color:#09090b!important}
.l7-card{background-color:#131316!important;border-color:#27272b!important}
.l7-ink{color:#fafafa!important}
.l7-body{color:#d4d4d8!important}
.l7-muted{color:#a1a1aa!important}
.l7-accent{color:#a78bfa!important}
.l7-rule{border-color:#27272b!important}
.l7-soft{background-color:#1c1c20!important}
.l7-btn-cell{background-color:#fafafa!important}
.l7-btn-link{color:#09090b!important}
}
</style>`;

/** Bare URLs and email addresses in escaped text, as links. Escaping has already run. */
function linkify(escaped: string): string {
  return escaped.replace(
    /(https?:\/\/[^\s<]+)|([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g,
    (_match, url: string | undefined, email: string | undefined) => {
      if (url) {
        const trail = url.match(/(?:[.,;:!?)\]]|&quot;|&#39;|&gt;)+$/)?.[0] ?? "";
        const link = url.slice(0, url.length - trail.length);
        return `<a href="${link}" target="_blank" class="l7-accent" style="color:${ACCENT};text-decoration:underline;word-break:break-word">${link}</a>${trail}`;
      }
      return `<a href="mailto:${email}" class="l7-accent" style="color:${ACCENT};text-decoration:underline">${email}</a>`;
    }
  );
}

/**
 * One line of the owner's words. A `Label: value` line gets its label set in
 * the muted colour, so "Delivering to: 12 Turner Road…" reads as a field and
 * not as a sentence — purely presentational, nothing is moved or dropped.
 */
function lineHtml(line: string): string {
  const m = line.match(/^(\s*)([^:<>\n]{1,40}):(\s+)(\S.*)$/);
  if (m && !/https?$/i.test(m[2].trim())) {
    return `<span class="l7-muted" style="color:${MUTED}">${esc(m[2].trim())}:</span> ${linkify(esc(m[4]))}`;
  }
  return linkify(esc(line));
}

function paragraphHtml(para: string): string {
  const t = para.trim();
  // A quoted message — the chat templates open with what was actually written.
  if (t.length > 2 && /^["“][\s\S]*["”]$/.test(t)) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px"><tr><td class="l7-soft l7-ink" style="background-color:${SOFT};border-radius:8px;padding:14px 16px;font-family:${SANS};font-size:15px;line-height:24px;color:${INK}">${t
      .split("\n")
      .map((l) => linkify(esc(l)))
      .join("<br>")}</td></tr></table>`;
  }
  return `<p class="l7-body" style="margin:0 0 16px;font-family:${SANS};font-size:15px;line-height:24px;color:${BODY}">${para
    .split("\n")
    .map(lineHtml)
    .join("<br>")}</p>`;
}

type ShellInput = {
  settings: SettingsDTO;
  subject: string;
  preheader: string;
  audience: EmailAudience;
  ctx: EmailContext;
  paragraphs: string[];
  /** Set when replies reach a real inbox — the footer only promises it then. */
  replyTo?: string;
};

function footerParts(input: ShellInput) {
  const { settings, audience } = input;
  const origin = siteUrl();
  if (audience === "admin") {
    return {
      audience,
      lines: [
        `Sent to ${settings.adminNotifyEmail} because you run ${settings.brandName}.`,
      ],
      alertsUrl: `${origin}/admin/settings?tab=alerts`,
    } as const;
  }
  const support = supportEmail(settings);
  const whatsapp = realPhone(settings.whatsapp, DEFAULT_SETTINGS.whatsapp);
  const phone = realPhone(settings.contactPhone, DEFAULT_SETTINGS.contactPhone);
  const instagram = /^https:\/\//i.test(settings.instagram ?? "") ? settings.instagram!.trim() : null;
  return {
    audience,
    support,
    replyable: Boolean(input.replyTo),
    whatsapp,
    phone: phone && digits(phone) !== digits(whatsapp) ? phone : null,
    address: (settings.address ?? "").trim() || null,
    links: [
      { label: "Shop", url: `${origin}/` },
      { label: "Track an order", url: `${origin}/track-order` },
      ...(instagram ? [{ label: "Instagram", url: instagram }] : []),
    ],
  } as const;
}

function shellHtml(input: ShellInput): string {
  const { settings, subject, preheader, ctx, paragraphs } = input;
  const brand = esc(settings.brandName);
  const home = `${siteUrl()}/`;
  const logo = href(settings.logoUrl);

  // The preview text, then enough invisible padding that a client does not
  // pull the next words of the body in behind it.
  const pre = preheader
    ? `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${PAGE}">${esc(preheader)}${"&#847;&zwnj;&nbsp;".repeat(60)}</div>`
    : "";

  const wordmark = logo
    ? `<img src="${logo}" alt="${brand}" height="28" style="display:block;height:28px;width:auto;border:0">`
    : `<span class="l7-ink" style="font-family:${DISPLAY};font-size:20px;line-height:28px;font-weight:700;letter-spacing:-0.4px;color:${INK}">${brand}</span>`;

  const kicker = ctx.kicker
    ? `<p class="l7-accent" style="margin:0 0 8px;font-family:${SANS};font-size:11px;line-height:16px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${ACCENT}">${esc(ctx.kicker)}</p>`
    : "";
  const headline = ctx.headline
    ? `<h1 class="l7-h1 l7-ink" style="margin:0 0 20px;font-family:${DISPLAY};font-size:26px;line-height:32px;font-weight:700;letter-spacing:-0.5px;color:${INK}">${esc(flat(ctx.headline))}</h1>`
    : "";

  const code = ctx.code
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px"><tr><td class="l7-soft l7-ink" style="background-color:${SOFT};border-radius:8px;padding:14px 22px;font-family:${MONO};font-size:32px;line-height:40px;font-weight:700;letter-spacing:8px;color:${INK}">${esc(ctx.code)}</td></tr></table>`
    : "";

  const body = paragraphs.map(paragraphHtml).join("");

  const ctaUrl = ctx.cta ? href(ctx.cta.url) : null;
  const cta =
    ctaUrl && ctx.cta
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="l7-btn" style="margin:8px 0 0"><tr><td class="l7-btn-cell" align="center" bgcolor="${INK}" style="background-color:${INK};border-radius:8px">
<a href="${ctaUrl}" target="_blank" class="l7-btn-link l7-cta" style="display:inline-block;padding:15px 30px;font-family:${SANS};font-size:13px;line-height:16px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#ffffff;text-decoration:none;border-radius:8px">${esc(flat(ctx.cta.label))}</a>
</td></tr></table>`
      : "";
  const note = ctx.note
    ? `<p class="l7-muted" style="margin:${cta ? "14px" : "4px"} 0 0;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED}">${linkify(esc(flat(ctx.note)))}</p>`
    : "";

  const itemList = ctx.items ?? [];
  const showImages = itemList.some((i) => emailImage(i.image));
  const items = itemList.length
    ? `<tr><td class="l7-gutter" style="padding:8px 36px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${itemList
        .map((item) => {
          const img = emailImage(item.image);
          const qty = Math.max(1, Number(item.quantity) || 1);
          const total = lineTotal(item.price, qty);
          const meta = [
            item.options,
            `Qty ${qty}`,
            total && item.price ? `${item.price} each` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          const price = total ?? item.price ?? "";
          const picture = showImages
            ? `<td width="72" valign="top" class="l7-rule" style="width:72px;padding:16px 16px 16px 0;border-top:1px solid ${BORDER};vertical-align:top">${
                img
                  ? `<img src="${esc(img)}" width="72" alt="${esc(item.name)}" style="display:block;width:72px;max-width:72px;height:auto;border:0;border-radius:6px">`
                  : `<div class="l7-soft" style="width:72px;height:90px;border-radius:6px;background-color:${SOFT}"></div>`
              }</td>`
            : "";
          return `<tr>${picture}
<td valign="top" class="l7-rule" style="padding:16px 0;border-top:1px solid ${BORDER};vertical-align:top">
<p class="l7-ink" style="margin:0;font-family:${SANS};font-size:14px;line-height:20px;font-weight:600;color:${INK}">${esc(item.name)}</p>
<p class="l7-muted" style="margin:4px 0 0;font-family:${SANS};font-size:13px;line-height:18px;color:${MUTED}">${esc(meta)}</p>
</td>
<td valign="top" align="right" class="l7-rule l7-ink" style="padding:16px 0 16px 12px;border-top:1px solid ${BORDER};vertical-align:top;white-space:nowrap;font-family:${SANS};font-size:14px;line-height:20px;font-weight:600;color:${INK}">${esc(price)}</td>
</tr>`;
        })
        .join("")}</table></td></tr>`
    : "";

  const factList = (ctx.facts ?? []).map(displayFact).filter((f) => f.value.trim());
  const facts = factList.length
    ? `<tr><td class="l7-gutter" style="padding:${items ? "0" : "8px"} 36px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="l7-rule" style="border-top:1px solid ${BORDER}">${factList
        .map(
          (f, i) => `<tr>
<td class="l7-muted" style="padding:${i === 0 ? "14px" : "5px"} 12px ${i === factList.length - 1 ? "0" : "5px"} 0;font-family:${SANS};font-size:14px;line-height:20px;color:${MUTED};vertical-align:top">${esc(f.label)}</td>
<td align="right" class="l7-ink" style="padding:${i === 0 ? "14px" : "5px"} 0 ${i === factList.length - 1 ? "0" : "5px"};font-family:${SANS};font-size:14px;line-height:20px;font-weight:600;color:${INK};vertical-align:top;font-variant-numeric:tabular-nums">${esc(f.value)}</td>
</tr>`
        )
        .join("")}</table></td></tr>`
    : "";

  const foot = footerParts(input);
  const small = `font-family:${SANS};font-size:12px;line-height:19px;color:${MUTED}`;
  const footLink = (label: string, url: string) =>
    `<a href="${esc(url)}" target="_blank" class="l7-muted" style="color:${MUTED};text-decoration:underline">${esc(label)}</a>`;
  const footer =
    foot.audience === "admin"
      ? `<p class="l7-muted" style="margin:0 0 6px;${small}">${esc(foot.lines[0])}</p>
<p class="l7-muted" style="margin:0;${small}">Choose which alerts reach you in ${footLink("Settings → Alerts", foot.alertsUrl)}.</p>`
      : `<p class="l7-muted" style="margin:0 0 6px;${small}">${
          foot.support
            ? `Questions? ${foot.replyable ? "Reply to this email or write to" : "Write to"} <a href="mailto:${esc(foot.support)}" class="l7-muted" style="color:${MUTED};text-decoration:underline">${esc(foot.support)}</a>`
            : "Questions? Visit our store and use the chat — we read every message"
        }${foot.whatsapp ? ` · WhatsApp ${footLink(foot.whatsapp, `https://wa.me/${digits(foot.whatsapp)}`)}` : ""}${foot.phone ? ` · Call ${esc(foot.phone)}` : ""}.</p>
<p class="l7-muted" style="margin:0 0 6px;${small}">${brand}${foot.address && foot.address !== settings.brandName ? ` · ${esc(foot.address)}` : ""}</p>
<p class="l7-muted" style="margin:0;${small}">${foot.links.map((l) => footLink(l.label, l.url)).join(" &nbsp;·&nbsp; ")}</p>`;

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&amp;family=Space+Grotesk:wght@700&amp;display=swap" rel="stylesheet">
${HEAD_CSS}
</head>
<body class="l7-page" style="margin:0;padding:0;background-color:${PAGE};word-spacing:normal">
${pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="l7-page" style="background-color:${PAGE}">
<tr><td align="center" style="padding:28px 12px 36px">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto">
<tr><td style="padding:0 4px 16px"><a href="${esc(home)}" target="_blank" style="text-decoration:none">${wordmark}</a></td></tr>
<tr><td class="l7-card" style="background-color:${CARD};border:1px solid ${BORDER};border-radius:12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td class="l7-gutter" style="padding:32px 36px 8px">${kicker}${headline}${code}${body}${cta}${note}</td></tr>
${items}${facts}
<tr><td style="padding:0 0 32px;font-size:0;line-height:0">&nbsp;</td></tr>
</table>
</td></tr>
<tr><td style="padding:20px 4px 0">${footer}</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

/** The same message as plain text — what a text-only reader, and every spam filter, sees. */
function shellText(input: ShellInput): string {
  const { settings, ctx, paragraphs } = input;
  const out: string[] = [settings.brandName, ""];
  if (ctx.kicker) out.push(ctx.kicker.toUpperCase());
  if (ctx.headline) out.push(flat(ctx.headline));
  if (ctx.kicker || ctx.headline) out.push("");
  if (ctx.code) out.push(ctx.code, "");
  for (const para of paragraphs) out.push(para, "");
  const ctaUrl = ctx.cta ? absoluteUrl(ctx.cta.url) : null;
  if (ctaUrl && ctx.cta) out.push(`${flat(ctx.cta.label)}: ${ctaUrl}`);
  if (ctx.note) out.push(flat(ctx.note));
  if (ctaUrl || ctx.note) out.push("");

  const items = ctx.items ?? [];
  const facts = (ctx.facts ?? []).map(displayFact).filter((f) => f.value.trim());
  if (items.length || facts.length) out.push("----");
  for (const item of items) {
    const qty = Math.max(1, Number(item.quantity) || 1);
    const total = lineTotal(item.price, qty);
    out.push(
      item.name,
      [item.options, `Qty ${qty}`, total && item.price ? `${item.price} each` : null, total ?? item.price]
        .filter(Boolean)
        .join(" · "),
      ""
    );
  }
  for (const f of facts) out.push(`${f.label}: ${f.value}`);
  if (facts.length) out.push("");

  const foot = footerParts(input);
  out.push("----");
  if (foot.audience === "admin") {
    out.push(foot.lines[0], `Choose which alerts reach you: ${foot.alertsUrl}`);
  } else {
    out.push(
      [
        foot.support
          ? `Questions? ${foot.replyable ? "Reply to this email or write to" : "Write to"} ${foot.support}`
          : "Questions? Visit our store and use the chat",
        foot.whatsapp ? `WhatsApp ${foot.whatsapp}` : null,
        foot.phone ? `Call ${foot.phone}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      [settings.brandName, foot.address && foot.address !== settings.brandName ? foot.address : null]
        .filter(Boolean)
        .join(" · "),
      `${siteUrl()}/`
    );
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/* ------------------------------------------------------------------ */
/*  Automation                                                         */
/* ------------------------------------------------------------------ */

/**
 * The send used by the automation engine (`lib/automation.ts`), and therefore
 * **the route almost every message this store sends now takes** — order
 * receipts, status updates, cart nudges, the return leg and the owner's own
 * notifications. Only the password reset, the one-time code and the contact
 * form still compose their own body; see the note at the top of this file.
 *
 * It is a thin wrapper over the same private `send()` as every other email
 * here — deliberately, because a second mail path is how a store ends up with
 * two "from" addresses, two failure logs and one of them silently unverified
 * in Resend.
 *
 * The body arrives as **plain text** an admin typed into the template editor,
 * with `{{token}}`s already substituted. It is escaped and converted to
 * paragraphs here rather than by the caller, so no automation template can
 * inject markup into the email shell — a customer's own name flows through
 * these templates, and a name is attacker-controlled text.
 *
 * `context` is what makes the result look like a shop's mail rather than a
 * memo. It is absent for a rule the engine cannot build one for, and the shell
 * then renders the words alone.
 */
export type AutomationMessage = {
  to: string | string[];
  subject: string;
  bodyText: string;
  /** The rule's name. Kept for callers; the shell titles the mail with its subject. */
  title?: string;
  context?: EmailContext;
  /**
   * Who this message is for. **An explicit value always wins.** When it is
   * absent the audience is inferred — see {@link inferAudience} — which is a
   * fallback for callers written before this field existed, never a second
   * opinion on one that states it.
   */
  audience?: EmailAudience;
};

/**
 * Infer the audience when the caller did not say.
 *
 * The one signal that cannot be wrong: **the button opens the admin.** A
 * customer can do nothing on an `/admin` screen, so a mail whose single action
 * is one was addressed to the owner. `deliverJob` swaps the owner's button to
 * the admin screen, so every owner mail with an admin screen to open is caught.
 *
 * Deliberately *not* inferred from the recipient address: in a store run by one
 * person the owner routinely places test orders from the same inbox the
 * alerts go to, and that customer receipt must still read as a receipt.
 */
function inferAudience(ctx: EmailContext): EmailAudience {
  const url = absoluteUrl(ctx.cta?.url);
  return url && url.startsWith(`${siteUrl()}/admin`) ? "admin" : "customer";
}

/** Everything a rendered message is, ready to send or to show. */
export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
  preheader: string;
  audience: EmailAudience;
  /** Where a reply goes, when that is a real inbox. */
  replyTo?: string;
};

/**
 * Compose the message without sending it.
 *
 * Split out from {@link sendAutomationEmail} so that what an owner previews
 * and what a customer receives are produced by **one** function. A preview
 * that re-implements the layout is a second writer for the same output — the
 * `defaultReturnsInfo` trap CLAUDE.md records — and it always drifts, usually
 * in the direction of the preview looking better than the mail.
 *
 * ### The owner's copy keeps the structure and loses the customer's voice
 *
 * `lib/automation.ts` resolves one context per subject, written *to the
 * customer* — "Your order is confirmed.", "We couldn't take your payment." —
 * and only swaps the button when the rule is addressed to the owner. So for an
 * owner mail the pieces, the photographs, the numbers and the admin button are
 * kept, and the three lines spoken to the customer are replaced: the headline
 * becomes the subject (which the owner's templates write for the owner), the
 * inbox preview becomes the opening of the owner's own words, and the
 * expectation note under the button is dropped, because "you'll get tracking
 * details shortly" is a promise made to somebody else. A context marked
 * `voice: "owner"` was written for the owner and is left as it is.
 *
 * The audience itself is the caller's to state (`deliverJob` passes it from
 * the rule's recipient); only when it is absent is it inferred.
 */
export function renderAutomationEmail(
  settings: SettingsDTO,
  msg: AutomationMessage
): RenderedEmail {
  // A newline in a subject is a header-injection primitive, and Resend will
  // happily forward one. Flatten it.
  const subject = flat(msg.subject);
  const given = msg.context ?? {};
  const audience = msg.audience ?? inferAudience(given);
  const paragraphs = bodyParagraphs(msg.bodyText, absoluteUrl(given.cta?.url));
  const lead = leadLine(paragraphs);

  const ctx: EmailContext =
    audience === "admin" && given.voice !== "owner"
      ? { ...given, headline: subject, note: undefined, preheader: lead || subject }
      : given;
  const preheader = flat(ctx.preheader || lead || subject);
  const replyTo = audience === "customer" ? (supportEmail(settings) ?? undefined) : undefined;

  const input: ShellInput = { settings, subject, preheader, audience, ctx, paragraphs, replyTo };
  return {
    subject,
    html: shellHtml(input),
    text: shellText(input),
    preheader,
    audience,
    replyTo,
  };
}

export async function sendAutomationEmail(settings: SettingsDTO, msg: AutomationMessage) {
  const mail = renderAutomationEmail(settings, msg);
  return send({
    to: msg.to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    replyTo: mail.replyTo,
  });
}

/* ------------------------------------------------------------------ */
/*  The three direct messages                                          */
/* ------------------------------------------------------------------ */

/**
 * The reset link, on the store's canonical origin.
 *
 * The caller builds it from the request's `Host` header, and a reset mail is
 * the one message where that matters: a forged `Host` on the request is how a
 * reset token gets mailed out inside a link to somebody else's server. Only
 * the path and query are taken from what was passed in.
 */
function canonicalLink(url: string): string {
  try {
    const u = new URL(url, siteUrl());
    return `${siteUrl()}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

/** The password-reset mail, composed but not sent. */
export function renderPasswordResetEmail(settings: SettingsDTO, resetUrl: string): RenderedEmail {
  const link = canonicalLink(resetUrl);
  return renderAutomationEmail(settings, {
    to: "",
    audience: "customer",
    subject: `Reset your ${settings.brandName} password`,
    bodyText: `We received a request to reset the password for your ${settings.brandName} account.

The button below lets you choose a new one. It works once and expires in 1 hour.

If you didn't ask for this, ignore this email — your password stays exactly as it is.`,
    context: {
      kicker: "Your account",
      headline: "Reset your password",
      preheader: "Choose a new password — this link works once and expires in 1 hour.",
      cta: { label: "Choose a new password", url: link },
      note: `Button not working? Paste this link into your browser: ${link}`,
    },
  });
}

/** Fired when a customer requests a password reset. */
export async function sendPasswordResetEmail(
  settings: SettingsDTO,
  to: string,
  resetUrl: string
) {
  const mail = renderPasswordResetEmail(settings, resetUrl);
  return send({ to, subject: mail.subject, html: mail.html, text: mail.text, replyTo: mail.replyTo });
}

/** What a one-time code is for, in the words of the person waiting for it. */
function otpPurpose(purpose: string): string {
  return purpose === "signup"
    ? "finish creating your account"
    : purpose === "verify-phone"
      ? "confirm your mobile number"
      : purpose === "reset"
        ? "reset your password"
        : "confirm your email address";
}

/** The one-time-code mail, composed but not sent. */
export function renderOtpEmail(
  settings: SettingsDTO,
  msg: { code: string; minutes: number; purpose: string }
): RenderedEmail {
  const what = otpPurpose(msg.purpose);
  return renderAutomationEmail(settings, {
    to: "",
    audience: "customer",
    subject: `${msg.code} is your ${settings.brandName} code`,
    bodyText: `Enter this code to ${what}. It expires in ${msg.minutes} minutes and can be used once.`,
    context: {
      kicker: "One-time code",
      headline: `Your code to ${what}`,
      preheader: `It expires in ${msg.minutes} minutes. Never share it with anyone — ${settings.brandName} will never ask for it.`,
      code: msg.code,
      note: `If you didn't ask for this, you can ignore this email — nothing has changed on your account. ${settings.brandName} will never ask you for this code.`,
    },
  });
}

/**
 * A one-time code, on its way to somebody staring at a form.
 *
 * **This is the only sender in the file that reports whether it worked.** Every
 * other message here is fire-and-forget: a receipt that does not arrive is a
 * bad day, and the failure belongs in the log and on the automation screen. A
 * code that does not arrive is a customer sitting in front of an input they can
 * never fill, so `lib/otp.ts` has to be able to say "the code exists, nothing
 * carried it" on screen — which it cannot do if this returns Resend's raw
 * result and leaves the interpreting to the caller.
 *
 * The code is rendered large and monospaced and is also in the subject, because
 * most people read it from the notification without opening anything.
 */
export async function sendOtpEmail(
  settings: SettingsDTO,
  to: string,
  msg: { code: string; minutes: number; purpose: string }
): Promise<{ delivered: boolean; detail?: string }> {
  const mail = renderOtpEmail(settings, msg);
  const res = await send({ to, subject: mail.subject, html: mail.html, text: mail.text, replyTo: mail.replyTo });

  if (res && typeof res === "object") {
    if ("skipped" in res && res.skipped) {
      return {
        delivered: false,
        detail:
          "This store has no email key configured, so no code was sent. Ask the store owner to set RESEND_API_KEY.",
      };
    }
    if ("error" in res && res.error) {
      return {
        delivered: false,
        detail:
          "The store's email provider rejected the message, so no code arrived. Ask the store owner to check Admin → Automation.",
      };
    }
  }
  return { delivered: true };
}

type ContactMessage = { name: string; email: string; phone?: string | null; message: string };

/**
 * The contact-form enquiry, composed but not sent.
 *
 * **Everything the visitor typed is escaped.** This mail used to interpolate
 * the name, address and message straight into the HTML, so a message
 * containing markup rendered as markup in the owner's inbox. It now goes
 * through the same escaping path as every template.
 */
export function renderContactEmail(settings: SettingsDTO, msg: ContactMessage): RenderedEmail {
  const name = flat(msg.name) || "Someone";
  // One quoted block: blank lines inside the message would otherwise split it
  // into paragraphs, and only the first and last would carry a quote mark.
  const quoted = msg.message.replace(/\r\n?/g, "\n").trim().replace(/\n{2,}/g, "\n");
  const rendered = renderAutomationEmail(settings, {
    to: "",
    audience: "admin",
    subject: `New enquiry from ${name}`,
    bodyText: `"${quoted}"

Just reply to this email — your answer goes straight to ${flat(msg.email)}. Every enquiry is also kept under Messages in your admin.`,
    context: {
      kicker: "Contact form",
      facts: [
        { label: "Name", value: name },
        { label: "Email", value: flat(msg.email) },
        ...(msg.phone?.trim() ? [{ label: "Phone", value: flat(msg.phone) }] : []),
      ],
      // No button: the action is to reply, and the reply-to set below makes
      // the mail client's own Reply do exactly that.
    },
  });
  // Replying to the enquiry should reach the person who wrote it.
  return { ...rendered, replyTo: realEmail(msg.email, "") ?? undefined };
}

/** Fired when the contact form is submitted. */
export async function sendContactEmail(settings: SettingsDTO, msg: ContactMessage) {
  const mail = renderContactEmail(settings, msg);
  return send({
    to: settings.adminNotifyEmail,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    replyTo: mail.replyTo,
  });
}
