import "server-only";
import { Resend } from "resend";
import type { SettingsDTO } from "./types";
import { siteUrl } from "./site-url";

/**
 * **The only place this store talks to Resend.**
 *
 * Two things live here and nothing else should:
 *
 * 1. `send()` — the single transport. Every outbound message in the app comes
 *    through it, so there is one `from`, one failure log and one place to look
 *    when mail stops arriving.
 * 2. The handful of message *bodies* that are not rule-driven. Everything that
 *    reacts to a store event — orders, leads, returns — is now composed from an
 *    editable template by `lib/automation.ts` and arrives here through
 *    {@link sendAutomationEmail}. See the note above that function.
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
 * the whole picture — see "Every mail this store sends" there.
 */

const apiKey = process.env.RESEND_API_KEY;
// Resend rejects a sender on a domain you have not verified, so the fallback
// stays on their shared testing domain rather than guessing a brand address.
const FROM = process.env.EMAIL_FROM || "Level7 Clothing <onboarding@resend.dev>";

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
    const res = await resend.emails.send({ from: FROM, ...opts });
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

function shell(brand: string, title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#f5f3ef;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px">
    <div style="background:#fff;border-radius:16px;overflow:hidden;border:1px solid #eee">
      <div style="background:#141210;color:#fff;padding:22px 28px">
        <div style="font-size:20px;font-weight:700;letter-spacing:.5px">${brand}</div>
        <div style="font-size:13px;opacity:.7;margin-top:2px">${title}</div>
      </div>
      <div style="padding:28px">${body}</div>
    </div>
    <div style="text-align:center;color:#999;font-size:12px;margin-top:16px">Sent automatically by your ${brand} website.</div>
  </div></body></html>`;
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

/** Fired when a customer requests a password reset. */
export async function sendPasswordResetEmail(
  settings: SettingsDTO,
  to: string,
  resetUrl: string
) {
  const body = `
    <p style="font-size:15px;margin:0 0 12px">We received a request to reset your ${settings.brandName} account password.</p>
    <p style="font-size:14px;color:#555;margin:0 0 20px">Click the button below to choose a new password. This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
    <p style="margin:0 0 20px"><a href="${resetUrl}" style="display:inline-block;background:#141210;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-size:14px;font-weight:600">Reset my password</a></p>
    <p style="font-size:12px;color:#999;margin:0">Or paste this link into your browser:<br>${resetUrl}</p>`;
  return send({
    to,
    subject: `Reset your ${settings.brandName} password`,
    html: shell(settings.brandName, "Password reset", body),
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
  const what =
    msg.purpose === "signup"
      ? "finish creating your account"
      : msg.purpose === "verify-phone"
        ? "confirm your mobile number"
        : msg.purpose === "reset"
          ? "reset your password"
          : "confirm your email address";

  const body = `
    <p style="font-size:15px;margin:0 0 12px">Use this code to ${what}.</p>
    <p style="margin:0 0 18px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#141210">${msg.code}</p>
    <p style="font-size:14px;color:#555;margin:0 0 8px">It expires in ${msg.minutes} minutes and can be used once.</p>
    <p style="font-size:12px;color:#999;margin:0">If you didn't ask for this, you can ignore this email — nothing has changed on your account.</p>`;

  const res = await send({
    to,
    subject: `${msg.code} is your ${settings.brandName} code`,
    html: shell(settings.brandName, "Your one-time code", body),
  });

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

/* ------------------------------------------------------------------ */
/*  Automation                                                         */
/* ------------------------------------------------------------------ */

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
};

const esc = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Only `http(s)` reaches an `href`. A template token could otherwise carry `javascript:`. */
function safeUrl(url: string): string | null {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? esc(trimmed) : null;
}

/**
 * The rich shell: brand bar, headline, the owner's words, one button, the
 * pieces with their pictures, then the numbers.
 *
 * Table-based and inline-styled throughout, which is not stylistic — Gmail
 * strips `<style>` blocks and Outlook renders flexbox as a vertical stack, so
 * anything cleverer than this silently falls apart in the two clients that
 * matter most.
 */
function richShell(
  brand: string,
  storeUrl: string,
  contactEmail: string,
  ctx: EmailContext,
  bodyHtml: string
): string {
  const ink = "#141210";
  const accent = "#7c3aed";

  const preheader = ctx.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(
        ctx.preheader
      )}</div>`
    : "";

  const head = `
    ${ctx.kicker ? `<div style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:${accent};font-weight:700;margin:0 0 6px">${esc(ctx.kicker)}</div>` : ""}
    ${ctx.headline ? `<div style="font-size:22px;line-height:1.3;font-weight:700;color:${ink};margin:0 0 16px">${esc(ctx.headline)}</div>` : ""}`;

  const ctaUrl = ctx.cta ? safeUrl(ctx.cta.url) : null;
  const cta = ctaUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px"><tr>
         <td style="background:${ink};border-radius:8px">
           <a href="${ctaUrl}" style="display:inline-block;padding:14px 28px;color:#fff;text-decoration:none;font-size:13px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase">${esc(
             ctx.cta!.label
           )}</a>
         </td></tr></table>
       ${ctx.note ? `<p style="font-size:13px;line-height:1.55;color:#777;margin:10px 0 0">${esc(ctx.note)}</p>` : ""}`
    : ctx.note
      ? `<p style="font-size:13px;line-height:1.55;color:#777;margin:18px 0 0">${esc(ctx.note)}</p>`
      : "";

  const items = (ctx.items ?? []).length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;border-top:1px solid #eee">
        ${(ctx.items ?? [])
          .map((item) => {
            const img = item.image ? safeUrl(item.image) : null;
            return `<tr>
            <td width="72" style="padding:14px 14px 14px 0;vertical-align:top">
              ${
                img
                  ? `<img src="${img}" width="64" alt="" style="width:64px;height:80px;object-fit:cover;border-radius:6px;display:block;background:#f2f0ec">`
                  : `<div style="width:64px;height:80px;border-radius:6px;background:#f2f0ec"></div>`
              }
            </td>
            <td style="padding:14px 0;vertical-align:top">
              <div style="font-size:14px;font-weight:600;color:${ink};line-height:1.4">${esc(item.name)}</div>
              ${item.options ? `<div style="font-size:12px;color:#888;margin-top:3px">${esc(item.options)}</div>` : ""}
              <div style="font-size:12px;color:#888;margin-top:3px">
                ${item.quantity ? `Qty ${item.quantity}` : ""}${item.quantity && item.price ? " · " : ""}${item.price ? esc(item.price) : ""}
              </div>
            </td>
          </tr>`;
          })
          .join("")}
      </table>`
    : "";

  const facts = (ctx.facts ?? []).length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0;border-top:1px solid #eee;padding-top:4px">
        ${(ctx.facts ?? [])
          .map(
            (f) =>
              `<tr><td style="padding:7px 0;font-size:13px;color:#888">${esc(f.label)}</td>
               <td style="padding:7px 0;font-size:13px;color:${ink};text-align:right;font-weight:600">${esc(f.value)}</td></tr>`
          )
          .join("")}
      </table>`
    : "";

  const home = safeUrl(storeUrl);

  return `<!doctype html><html><body style="margin:0;background:#f5f3ef;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:${ink}">
  ${preheader}
  <div style="max-width:560px;margin:0 auto;padding:28px 16px">
    <div style="background:#fff;border-radius:16px;overflow:hidden;border:1px solid #eee">
      <div style="background:${ink};color:#fff;padding:18px 28px">
        <div style="font-size:18px;font-weight:700;letter-spacing:.5px">${esc(brand)}</div>
      </div>
      <div style="padding:28px">${head}${bodyHtml}${cta}${items}${facts}</div>
    </div>
    <div style="text-align:center;color:#999;font-size:12px;margin-top:18px;line-height:1.7">
      Questions? Reply to this email or write to ${esc(contactEmail)}.<br>
      ${home ? `<a href="${home}" style="color:#999">${esc(brand)}</a>` : esc(brand)}
    </div>
  </div></body></html>`;
}

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
 * then renders exactly what it used to.
 */
export type AutomationMessage = {
  to: string | string[];
  subject: string;
  bodyText: string;
  title?: string;
  context?: EmailContext;
};

/**
 * Compose the message without sending it.
 *
 * Split out from {@link sendAutomationEmail} so that what an owner previews
 * and what a customer receives are produced by **one** function. A preview
 * that re-implements the layout is a second writer for the same output — the
 * `defaultReturnsInfo` trap CLAUDE.md records — and it always drifts, usually
 * in the direction of the preview looking better than the mail.
 */
export function renderAutomationEmail(
  settings: SettingsDTO,
  msg: AutomationMessage
): { subject: string; html: string } {
  const ctx = msg.context ?? {};
  return {
    // A newline in a subject is a header-injection primitive, and Resend will
    // happily forward one. Flatten it.
    subject: msg.subject.replace(/[\r\n]+/g, " ").trim(),
    html: richShell(
      settings.brandName,
      siteUrl(),
      settings.contactEmail,
      // The subject is the best preheader there is when nothing better was
      // resolved: it is already a one-line summary written for a glance.
      { preheader: ctx.preheader ?? msg.subject, ...ctx },
      textToHtml(msg.bodyText, ctx.cta?.url)
    ),
  };
}

export async function sendAutomationEmail(settings: SettingsDTO, msg: AutomationMessage) {
  const { subject, html } = renderAutomationEmail(settings, msg);
  return send({ to: msg.to, subject, html });
}

/**
 * Escape first, then structure — never the other way round.
 *
 * Two things happen beyond escaping, and both exist because of what these
 * templates actually contain:
 *
 * - **A bare URL becomes a link**, because a customer should not have to
 *   copy-paste out of an email in 2026. Only `http(s)` is linked; anything
 *   else stays inert text.
 * - **A line that is only the CTA's own URL is dropped.** Nine of the shipped
 *   templates end with `{{order.url}}` on its own line, which was the only
 *   way to offer an action before there was a button. Now that the button
 *   carries it, leaving the line in prints the same link twice — once as a
 *   button and once as raw text directly underneath.
 * **Empty labels are NOT handled here**, and that is worth stating because the
 * obvious place to handle them is here and it is the wrong one. A template
 * line `Courier: {{order.courier}}` renders as the bare word `Courier:` when
 * the parcel is not booked yet — the "blank token looks broken" failure — but
 * so does the prose line `Track it here:`, which introduces the URL on the
 * next line and must be kept. **After substitution the two are the same
 * string**, so no rule written at this point can tell them apart: a filter
 * here drops the introducer and leaves its naked URL behind, which is worse
 * than the problem. It is done in `lib/automation.ts` instead, before the
 * tokens are substituted, where "did this token have a value" is a fact
 * rather than a guess. See `pruneFactLines` there.
 */
function textToHtml(text: string, ctaUrl?: string): string {
  const skip = ctaUrl?.trim();
  return text
    .split(/\n{2,}/)
    .map((para) => {
      const lines = para.split("\n");
      const keep = lines.map((line) => !(skip && line.trim() === skip));
      // **A dropped link takes its introducer with it.** `order-shipped` reads
      // "Track it here:" and then the URL, and the button now carries that
      // same URL — so removing the duplicate on its own leaves the promise
      // standing over nothing. This only ever fires immediately above a line
      // already being removed, which is what keeps it from touching prose.
      for (let i = 1; i < lines.length; i += 1) {
        if (keep[i] || !keep[i - 1]) continue;
        if (/^\s*[^:]{1,60}:\s*$/.test(lines[i - 1])) keep[i - 1] = false;
      }
      return lines.filter((_, i) => keep[i]).join("\n");
    })
    .filter((para) => para.trim().length > 0)
    .map((para) => {
      const html = esc(para)
        .replace(/\n/g, "<br>")
        // Escaping ran first, so this can only ever match text — never an
        // attribute the template smuggled in.
        .replace(
          /(https?:\/\/[^\s<]+)/g,
          (url) => `<a href="${url}" style="color:#7c3aed">${url}</a>`
        );
      return `<p style="font-size:14px;line-height:1.65;color:#333;margin:0 0 14px">${html}</p>`;
    })
    .join("");
}

/** Fired when the contact form is submitted. */
export async function sendContactEmail(
  settings: SettingsDTO,
  msg: { name: string; email: string; phone?: string | null; message: string }
) {
  const body = `
    <p style="font-size:15px;margin:0 0 12px">New enquiry from your contact form.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 0;color:#777">Name</td><td style="padding:6px 0;text-align:right;font-weight:600">${msg.name}</td></tr>
      <tr><td style="padding:6px 0;color:#777">Email</td><td style="padding:6px 0;text-align:right">${msg.email}</td></tr>
      ${msg.phone ? `<tr><td style="padding:6px 0;color:#777">Phone</td><td style="padding:6px 0;text-align:right">${msg.phone}</td></tr>` : ""}
    </table>
    <div style="margin-top:12px;padding:14px;background:#f7f5f1;border-radius:10px;font-size:14px;white-space:pre-wrap">${msg.message}</div>`;
  return send({
    to: settings.adminNotifyEmail,
    subject: `✉️ New enquiry from ${msg.name}`,
    html: shell(settings.brandName, "Contact form enquiry", body),
  });
}
