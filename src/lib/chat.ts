import crypto from "crypto";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { getUserSession, type UserSession } from "./user-auth";

/**
 * Direct customer <-> store chat.
 *
 * This module owns every rule the API routes and the two UIs share: who a
 * request is allowed to speak as, how a guest conversation becomes an account
 * conversation, what counts as a valid message or attachment, and how the
 * WhatsApp-style delivery states move.
 *
 * Three things are deliberate and worth not undoing:
 *
 * 1. **A caller never names their own thread.** Every customer entry point
 *    resolves the thread from the session user id or the `guestKey` cookie. A
 *    `threadId` in a request body is ignored — that is the whole security
 *    model, and taking a hint from the body would let anyone read anyone's
 *    conversation by guessing a cuid.
 * 2. **"pending" is not a status.** The schema comment says so. The DB only
 *    ever holds sent -> delivered -> seen; the clock icon a sender sees while
 *    their request is in flight is client-side state that never leaves the
 *    browser. `createChatMessage` hard-codes `status: "sent"` rather than
 *    accepting one from the caller.
 * 3. **Attachment URLs are signed.** The upload route returns an HMAC over the
 *    blob URL, and a send is rejected unless the signature matches. Without it
 *    a caller could post any URL on the internet and the bubble would render
 *    it as if the store had served it.
 */

/* ------------------------------------------------------------------ */
/*  Cookie                                                             */
/* ------------------------------------------------------------------ */

/**
 * Anonymous chat identity. Declared once, here, and imported everywhere —
 * CLAUDE.md records what happened the last time a cookie name was re-declared
 * in two places (admin login bounced forever).
 *
 * Not in `auth-cookie.ts` because this is not a session: it grants no
 * identity, only a handle on one conversation, and it is dropped the moment
 * the conversation is claimed by a real account.
 */
export const CHAT_GUEST_COOKIE = "level7_chat_guest";

/** A guest keeps their history for a year on the same browser. */
const GUEST_COOKIE_DAYS = 365;

/* ------------------------------------------------------------------ */
/*  Limits (shared with both UIs — passed down as props, never imported */
/*  from a client component: this module pulls in Prisma)              */
/* ------------------------------------------------------------------ */

/** Longest message body accepted. Anything longer is rejected, not truncated. */
export const MAX_MESSAGE_LENGTH = 2000;

/** Largest attachment accepted, in bytes. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/**
 * Attachment allowlist. Checked on the server against the browser-declared
 * MIME type *and* the filename extension, so a `.exe` renamed to `.png`
 * still has to lie about both to get through — and even then it lands in blob
 * storage as a download, never executed.
 */
export const ALLOWED_ATTACHMENT_TYPES: Record<string, string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
  "image/heic": ["heic"],
  "application/pdf": ["pdf"],
  "text/plain": ["txt"],
};

/** `accept` attribute for the file picker, derived from the allowlist. */
export const ATTACHMENT_ACCEPT = Object.keys(ALLOWED_ATTACHMENT_TYPES).join(",");

/** How many messages the first load of a conversation returns. */
export const INITIAL_MESSAGE_PAGE = 60;

/** Newest threads the admin inbox lists in one go. */
export const ADMIN_THREAD_PAGE = 100;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ChatSender = "user" | "admin";

/** Persisted delivery states. "pending" is intentionally absent — see above. */
export type ChatStatus = "sent" | "delivered" | "seen";

export type ChatAttachment = {
  url: string;
  name: string;
  type: string;
};

export type ChatMessageDTO = {
  id: string;
  sender: ChatSender;
  body: string;
  status: ChatStatus;
  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentType: string | null;
  /** ISO string — also the poll cursor the client sends back. */
  createdAt: string;
};

/** Status changes to messages the caller already holds, kept tiny. */
export type ChatStatusPatch = { id: string; status: ChatStatus };

export type ChatPollResponse = {
  threadId: string | null;
  isClosed: boolean;
  /** Unseen messages from the other side. */
  unread: number;
  messages: ChatMessageDTO[];
  statuses: ChatStatusPatch[];
  signedIn: boolean;
  /** Whether the store already has a way to reach this customer. */
  hasContact: boolean;
};

export type AdminThreadDTO = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  lastMessage: string | null;
  lastMessageAt: string;
  adminUnread: number;
  isClosed: boolean;
  /** True when the conversation belongs to a signed-in account. */
  registered: boolean;
};

/* ------------------------------------------------------------------ */
/*  Identity                                                           */
/* ------------------------------------------------------------------ */

export type ChatIdentity = {
  /** Set when the customer is signed in. */
  userId: string | null;
  session: UserSession | null;
  /** Set when an anonymous browser cookie is present. */
  guestKey: string | null;
};

/** Stable key for rate limiting, whichever way the caller is identified. */
export function identityKey(identity: ChatIdentity): string {
  return identity.userId ? `u:${identity.userId}` : `g:${identity.guestKey}`;
}

/** True when this request can act as some customer at all. */
export function hasIdentity(identity: ChatIdentity): boolean {
  return Boolean(identity.userId || identity.guestKey);
}

function mintGuestKey(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/**
 * Resolve who is speaking.
 *
 * `create` mints the guest cookie when there is neither a session nor an
 * existing cookie. Callers pass it only from endpoints the customer reached by
 * actually opening the chat, so merely loading a page never sets a cookie.
 *
 * Only valid inside a Route Handler or Server Function — `cookies().set()`
 * cannot run while a Server Component is streaming.
 */
export async function getChatIdentity(
  opts: { create?: boolean } = {}
): Promise<ChatIdentity> {
  const session = await getUserSession();
  const store = await cookies();
  let guestKey = store.get(CHAT_GUEST_COOKIE)?.value || null;

  // A signed-in customer needs no anonymous handle. One is still read above so
  // claimGuestThread() can find the conversation they had before logging in.
  if (!guestKey && !session && opts.create) {
    guestKey = mintGuestKey();
    store.set(CHAT_GUEST_COOKIE, guestKey, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * GUEST_COOKIE_DAYS,
    });
  }

  return {
    userId: session?.id ?? null,
    session: session ?? null,
    guestKey,
  };
}

async function dropGuestCookie() {
  const store = await cookies();
  store.delete(CHAT_GUEST_COOKIE);
}

/* ------------------------------------------------------------------ */
/*  Guest -> account claiming                                          */
/* ------------------------------------------------------------------ */

/**
 * Hand a guest conversation to the account that has just signed in.
 *
 * Runs lazily, on every thread resolution for a signed-in customer, rather
 * than being bolted onto the login action. That means it also fixes up the
 * customer who signed up *after* chatting, the one who logged in on another
 * tab, and anyone whose login predates this feature — none of which a hook in
 * the login path would catch.
 *
 * Two shapes:
 *
 * - The account has no conversation yet -> adopt the guest thread in place.
 *   Keeping the row means message ids, the admin's unread badge and the
 *   thread's position in the inbox all survive.
 * - The account already has one -> move the guest messages across, fold the
 *   counters in, then delete the now-empty guest thread. Never two threads for
 *   one person, and never a lost message.
 *
 * Either way the guest cookie is dropped afterwards, so signing out starts a
 * fresh anonymous conversation instead of handing the next person on that
 * browser the account's history.
 */
async function claimGuestThread(identity: ChatIdentity): Promise<void> {
  const { userId, session, guestKey } = identity;
  if (!userId || !guestKey) return;

  const guestThread = await prisma.chatThread.findUnique({
    where: { guestKey },
  });
  if (!guestThread) {
    await dropGuestCookie();
    return;
  }

  const mine = await prisma.chatThread.findFirst({
    where: { userId },
    orderBy: { lastMessageAt: "desc" },
  });

  if (!mine) {
    await prisma.chatThread.update({
      where: { id: guestThread.id },
      data: {
        userId,
        // Releasing the key is what makes the cookie stop resolving here.
        guestKey: null,
        name: guestThread.name ?? session?.name ?? null,
        email: guestThread.email ?? session?.email ?? null,
      },
    });
  } else if (mine.id !== guestThread.id) {
    const lastMessageAt =
      guestThread.lastMessageAt > mine.lastMessageAt
        ? guestThread.lastMessageAt
        : mine.lastMessageAt;
    const lastMessage =
      guestThread.lastMessageAt > mine.lastMessageAt
        ? guestThread.lastMessage
        : mine.lastMessage;

    await prisma.$transaction([
      prisma.chatMessage.updateMany({
        where: { threadId: guestThread.id },
        data: { threadId: mine.id },
      }),
      prisma.chatThread.update({
        where: { id: mine.id },
        data: {
          lastMessageAt,
          lastMessage,
          adminUnread: mine.adminUnread + guestThread.adminUnread,
          userUnread: mine.userUnread + guestThread.userUnread,
          name: mine.name ?? guestThread.name,
          email: mine.email ?? guestThread.email,
          phone: mine.phone ?? guestThread.phone,
          // Anything merged in is live traffic; a closed thread reopens.
          isClosed: false,
        },
      }),
      prisma.chatThread.delete({ where: { id: guestThread.id } }),
    ]);
  }

  await dropGuestCookie();
}

/* ------------------------------------------------------------------ */
/*  Thread resolution                                                  */
/* ------------------------------------------------------------------ */

type ThreadRow = {
  id: string;
  isClosed: boolean;
  adminUnread: number;
  userUnread: number;
  name: string | null;
  email: string | null;
  phone: string | null;
};

const THREAD_SELECT = {
  id: true,
  isClosed: true,
  adminUnread: true,
  userUnread: true,
  name: true,
  email: true,
  phone: true,
} as const;

/**
 * The caller's own thread, or null when they have never written in.
 *
 * This is the only way a customer request ever arrives at a thread id.
 */
export async function findOwnThread(
  identity: ChatIdentity
): Promise<ThreadRow | null> {
  if (identity.userId) {
    await claimGuestThread(identity);
    return prisma.chatThread.findFirst({
      where: { userId: identity.userId },
      orderBy: { lastMessageAt: "desc" },
      select: THREAD_SELECT,
    });
  }
  if (identity.guestKey) {
    const thread = await prisma.chatThread.findUnique({
      where: { guestKey: identity.guestKey },
      select: { ...THREAD_SELECT, userId: true },
    });
    // Defensive: a claimed thread releases its guestKey, so this should be
    // unreachable. If it ever is reachable, a signed-out browser must not read
    // an account's conversation.
    if (!thread || thread.userId) return null;
    return thread;
  }
  return null;
}

/** The caller's thread, created on first use. */
export async function ensureOwnThread(
  identity: ChatIdentity,
  contact?: { name?: string | null; email?: string | null; phone?: string | null }
): Promise<ThreadRow> {
  const existing = await findOwnThread(identity);
  if (existing) {
    // Fill in details we did not have before; never overwrite what we do.
    const patch: Record<string, string> = {};
    if (!existing.name && contact?.name) patch.name = contact.name;
    if (!existing.email && contact?.email) patch.email = contact.email;
    if (!existing.phone && contact?.phone) patch.phone = contact.phone;
    if (Object.keys(patch).length === 0) return existing;
    return prisma.chatThread.update({
      where: { id: existing.id },
      data: patch,
      select: THREAD_SELECT,
    });
  }

  if (!hasIdentity(identity)) {
    throw new Error("Cannot create a chat thread without an identity");
  }

  return prisma.chatThread.create({
    data: {
      userId: identity.userId,
      guestKey: identity.userId ? null : identity.guestKey,
      name: identity.session?.name ?? contact?.name ?? null,
      email: identity.session?.email ?? contact?.email ?? null,
      phone: contact?.phone ?? null,
    },
    select: THREAD_SELECT,
  });
}

/* ------------------------------------------------------------------ */
/*  Messages                                                           */
/* ------------------------------------------------------------------ */

const MESSAGE_SELECT = {
  id: true,
  sender: true,
  body: true,
  status: true,
  attachmentUrl: true,
  attachmentName: true,
  attachmentType: true,
  createdAt: true,
} as const;

type MessageRow = {
  id: string;
  sender: string;
  body: string;
  status: string;
  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentType: string | null;
  createdAt: Date;
};

export function toMessageDTO(row: MessageRow): ChatMessageDTO {
  return {
    id: row.id,
    sender: row.sender === "admin" ? "admin" : "user",
    body: row.body,
    status: normaliseStatus(row.status),
    attachmentUrl: row.attachmentUrl,
    attachmentName: row.attachmentName,
    attachmentType: row.attachmentType,
    createdAt: row.createdAt.toISOString(),
  };
}

function normaliseStatus(value: string): ChatStatus {
  return value === "seen" || value === "delivered" ? value : "sent";
}

export type MessageCursor = { at: Date; id: string } | null;

/**
 * Parse the client's poll cursor. Both halves come from a message the server
 * itself handed out, so a malformed pair just means "send me everything" — and
 * a forged one can only filter the caller's own thread.
 */
export function parseCursor(
  afterAt: string | null,
  afterId: string | null
): MessageCursor {
  if (!afterAt || !afterId) return null;
  const at = new Date(afterAt);
  if (Number.isNaN(at.getTime())) return null;
  return { at, id: afterId };
}

/**
 * Messages after the cursor, oldest first. With no cursor, the tail of the
 * conversation — a poll therefore costs one small query, not the whole thread.
 */
export async function listMessages(
  threadId: string,
  cursor: MessageCursor
): Promise<ChatMessageDTO[]> {
  if (!cursor) {
    const rows = await prisma.chatMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: "desc" },
      take: INITIAL_MESSAGE_PAGE,
      select: MESSAGE_SELECT,
    });
    return rows.reverse().map(toMessageDTO);
  }

  const rows = await prisma.chatMessage.findMany({
    where: {
      threadId,
      // Tie-break on id so two messages sharing a millisecond cannot make the
      // cursor skip one or replay one forever.
      OR: [
        { createdAt: { gt: cursor.at } },
        { createdAt: cursor.at, id: { gt: cursor.id } },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
    select: MESSAGE_SELECT,
  });
  return rows.map(toMessageDTO);
}

/**
 * Delivery states of the caller's own messages that have not finished their
 * journey yet. Empty once everything is seen, which is the steady state, so
 * the poll payload collapses to almost nothing.
 */
export async function listOwnStatuses(
  threadId: string,
  sender: ChatSender
): Promise<ChatStatusPatch[]> {
  const rows = await prisma.chatMessage.findMany({
    where: { threadId, sender, status: { not: "seen" } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, status: true },
  });
  return rows.map((r) => ({ id: r.id, status: normaliseStatus(r.status) }));
}

/**
 * Mark the other side's messages as delivered — "their client has them".
 *
 * Called on a fetch, not on a read. Only ever touches rows still at "sent", so
 * it can never walk a message back from "seen".
 */
export async function markDelivered(threadId: string, from: ChatSender) {
  await prisma.chatMessage.updateMany({
    where: { threadId, sender: from, status: "sent" },
    data: { status: "delivered" },
  });
}

/**
 * Mark the other side's messages as seen and clear the reader's badge.
 *
 * Callers gate this on the panel being open *and* `document.visibilityState`
 * being "visible" — a mounted-but-hidden widget must not claim the customer
 * read anything.
 */
export async function markSeen(threadId: string, from: ChatSender) {
  const reader = from === "user" ? { adminUnread: 0 } : { userUnread: 0 };
  await prisma.$transaction([
    prisma.chatMessage.updateMany({
      where: { threadId, sender: from, status: { not: "seen" } },
      data: { status: "seen", seenAt: new Date() },
    }),
    prisma.chatThread.update({ where: { id: threadId }, data: reader }),
  ]);
}

/** One-line preview for the admin inbox list. */
function previewOf(body: string, attachment: ChatAttachment | null): string {
  const text = body.trim();
  if (text) return text.slice(0, 140);
  if (attachment) return `Attachment: ${attachment.name}`.slice(0, 140);
  return "";
}

/**
 * Append a message and keep the thread's denormalised columns honest.
 *
 * `status` is hard-coded, never taken from the caller: the only states that
 * reach the database are the three the schema documents.
 */
export async function createChatMessage(params: {
  threadId: string;
  sender: ChatSender;
  body: string;
  attachment: ChatAttachment | null;
}): Promise<ChatMessageDTO> {
  const { threadId, sender, body, attachment } = params;

  const bump =
    sender === "user"
      ? { adminUnread: { increment: 1 } }
      : { userUnread: { increment: 1 }, adminUnread: 0 };

  const [row] = await prisma.$transaction([
    prisma.chatMessage.create({
      data: {
        threadId,
        sender,
        body,
        status: "sent",
        attachmentUrl: attachment?.url ?? null,
        attachmentName: attachment?.name ?? null,
        attachmentType: attachment?.type ?? null,
      },
      select: MESSAGE_SELECT,
    }),
    prisma.chatThread.update({
      where: { id: threadId },
      data: {
        lastMessage: previewOf(body, attachment),
        lastMessageAt: new Date(),
        // A reply to a closed thread reopens it for both sides.
        isClosed: false,
        ...bump,
      },
    }),
  ]);

  return toMessageDTO(row);
}

/* ------------------------------------------------------------------ */
/*  Validation                                                         */
/* ------------------------------------------------------------------ */

export type Validated<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * Normalise an incoming message body.
 *
 * Control characters are stripped (tab and newline survive) so a message
 * cannot smuggle terminal escapes into an admin's log, and the length is
 * *rejected* rather than silently truncated — a customer whose message was
 * quietly cut in half would never know.
 *
 * No HTML escaping happens here on purpose: both UIs render the body as a text
 * node, so escaping would double-encode a perfectly legitimate `<3`.
 */
export function validateBody(
  input: unknown,
  hasAttachment: boolean
): Validated<string> {
  if (typeof input !== "string" && input != null) {
    return { ok: false, error: "Message must be text." };
  }
  const raw = typeof input === "string" ? input : "";
  const cleaned = raw
    .replace(/[ --]/g, "")
    .trim();
  if (!cleaned && !hasAttachment) {
    return { ok: false, error: "Write a message first." };
  }
  if (cleaned.length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      error: `Messages are limited to ${MAX_MESSAGE_LENGTH} characters.`,
    };
  }
  return { ok: true, value: cleaned };
}

/** Trim a short free-text field (name/email/phone) to something storable. */
export function optionalField(input: unknown, max = 120): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().slice(0, max);
  return trimmed || null;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * Server-side file gate. The browser checks the same rules for a quick error,
 * but that check is a courtesy — this one is the rule.
 */
export function validateUpload(file: {
  name: string;
  type: string;
  size: number;
}): Validated<{ name: string; type: string; ext: string }> {
  if (!file.size) return { ok: false, error: "That file is empty." };
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      error: `Attachments must be under ${Math.round(
        MAX_ATTACHMENT_BYTES / (1024 * 1024)
      )} MB.`,
    };
  }
  const allowed = ALLOWED_ATTACHMENT_TYPES[file.type];
  if (!allowed) {
    return { ok: false, error: "That file type is not supported." };
  }
  const ext = extensionOf(file.name);
  if (!allowed.includes(ext)) {
    return { ok: false, error: "That file's name and type do not match." };
  }
  // Keep the original name for display, but never let it carry a path.
  const name = file.name.replace(/[\\/]/g, "_").slice(0, 120) || `file.${ext}`;
  return { ok: true, value: { name, type: file.type, ext } };
}

/* ------------------------------------------------------------------ */
/*  Attachment signing                                                 */
/* ------------------------------------------------------------------ */

// Same resolution as the session helpers: a build-time constant is fine for
// local dev and must never sign anything in production.
const SECRET = (() => {
  const configured = process.env.AUTH_SECRET || process.env.JWT_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET is not set. Refusing to sign chat attachments with the " +
        "development fallback key in production."
    );
  }
  return "level7-dev-secret-change-me";
})();

function attachmentSignature(a: ChatAttachment): string {
  return crypto
    .createHmac("sha256", SECRET)
    .update(`${a.url}\n${a.name}\n${a.type}`)
    .digest("base64url");
}

/** Issued by the upload route; required by every send. */
export function signAttachment(a: ChatAttachment): string {
  return attachmentSignature(a);
}

/** Vercel Blob's public host. Anything else is not something we served. */
function isBlobUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.endsWith(".public.blob.vercel-storage.com")
    );
  } catch {
    return false;
  }
}

/**
 * Accept an attachment only if this server minted it.
 *
 * The signature alone is enough; the host check is defence in depth, so a
 * leaked secret still cannot point a bubble at an arbitrary site.
 */
export function validateAttachment(input: unknown): Validated<ChatAttachment | null> {
  if (input == null) return { ok: true, value: null };
  if (typeof input !== "object") {
    return { ok: false, error: "Attachment is malformed." };
  }
  const raw = input as Record<string, unknown>;
  const url = typeof raw.url === "string" ? raw.url : "";
  const name = typeof raw.name === "string" ? raw.name : "";
  const type = typeof raw.type === "string" ? raw.type : "";
  const token = typeof raw.token === "string" ? raw.token : "";

  if (!url || !name || !type || !token) {
    return { ok: false, error: "Attachment is malformed." };
  }
  if (!isBlobUrl(url) || !ALLOWED_ATTACHMENT_TYPES[type]) {
    return { ok: false, error: "That attachment is not allowed." };
  }

  const expected = attachmentSignature({ url, name, type });
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: "That attachment could not be verified." };
  }

  return { ok: true, value: { url, name, type } };
}

/* ------------------------------------------------------------------ */
/*  Rate limiting                                                      */
/* ------------------------------------------------------------------ */

/**
 * Best-effort in-process limiter.
 *
 * On Vercel each warm instance keeps its own map, so a determined flooder
 * spread across instances gets a higher effective ceiling than the numbers
 * below suggest. It still stops the realistic case — a stuck retry loop or one
 * person hammering send — without adding Redis to a store that has none, and
 * the hard length cap means even the worst case cannot write much.
 */
const buckets = new Map<string, number[]>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);

  // The map is unbounded otherwise, and a long-lived instance sees a lot of
  // guest keys. Cheap sweep, only when it has grown.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
    }
  }
  return true;
}

/** 20 messages a minute is far above human pace and far below abuse. */
export const SEND_LIMIT = { limit: 20, windowMs: 60_000 };

/** Uploads are the expensive path, so they get a tighter budget. */
export const UPLOAD_LIMIT = { limit: 12, windowMs: 10 * 60_000 };
