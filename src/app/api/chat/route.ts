import { NextResponse } from "next/server";
import { runAutomationTrigger } from "@/lib/automation";
import {
  createChatMessage,
  ensureOwnThread,
  findOwnThread,
  getChatIdentity,
  hasIdentity,
  identityKey,
  listMessages,
  listOwnStatuses,
  markDelivered,
  markSeen,
  optionalField,
  parseCursor,
  rateLimit,
  SEND_LIMIT,
  validateAttachment,
  validateBody,
  type ChatPollResponse,
} from "@/lib/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The customer half of the chat.
 *
 * Neither verb takes a thread id. The thread is resolved from the session or
 * the guest cookie every single time, so the worst a crafted request can do is
 * talk to its own conversation.
 */

/**
 * Poll. The client sends the id + timestamp of the newest message it holds and
 * gets back only what came after, plus the delivery states of its own messages
 * that are still in flight. Once a conversation is fully read this is a couple
 * of hundred bytes.
 *
 * `seen=1` is sent only while the panel is open *and* the tab is visible.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // `create` mints the guest cookie: the widget only reaches this endpoint
  // once the shopper has actually opened the chat.
  const identity = await getChatIdentity({ create: true });
  const thread = await findOwnThread(identity);

  const empty: ChatPollResponse = {
    threadId: null,
    isClosed: false,
    unread: 0,
    messages: [],
    statuses: [],
    signedIn: Boolean(identity.userId),
    hasContact: Boolean(identity.userId),
  };
  if (!thread) return NextResponse.json(empty);

  const cursor = parseCursor(
    searchParams.get("afterAt"),
    searchParams.get("afterId")
  );
  const wantsSeen = searchParams.get("seen") === "1";

  const messages = await listMessages(thread.id, cursor);

  // Only write when there is something to change. A poll against a quiet
  // conversation must stay read-only — every query here crosses a continent
  // (see the TTFB note in CLAUDE.md).
  let unread = thread.userUnread;
  if (wantsSeen && thread.userUnread > 0) {
    await markSeen(thread.id, "admin");
    unread = 0;
  } else if (messages.some((m) => m.sender === "admin" && m.status === "sent")) {
    await markDelivered(thread.id, "admin");
  }

  const statuses = await listOwnStatuses(thread.id, "user");

  const payload: ChatPollResponse = {
    threadId: thread.id,
    isClosed: thread.isClosed,
    unread,
    messages,
    statuses,
    signedIn: Boolean(identity.userId),
    hasContact: Boolean(identity.userId || thread.email || thread.name),
  };
  return NextResponse.json(payload);
}

/** Send one message as the customer. */
export async function POST(req: Request) {
  const identity = await getChatIdentity({ create: true });
  if (!hasIdentity(identity)) {
    return NextResponse.json(
      { error: "Could not start a conversation. Enable cookies and retry." },
      { status: 400 }
    );
  }

  if (!rateLimit(`chat:send:${identityKey(identity)}`, SEND_LIMIT.limit, SEND_LIMIT.windowMs)) {
    return NextResponse.json(
      { error: "You're sending messages very quickly — give it a moment." },
      { status: 429 }
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }
  const input = (raw ?? {}) as Record<string, unknown>;

  const attachment = validateAttachment(input.attachment);
  if (!attachment.ok) {
    return NextResponse.json({ error: attachment.error }, { status: 400 });
  }
  const body = validateBody(input.body, attachment.value !== null);
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: 400 });
  }

  const thread = await ensureOwnThread(identity, {
    name: optionalField(input.name),
    email: optionalField(input.email),
    phone: optionalField(input.phone, 32),
  });

  const message = await createChatMessage({
    threadId: thread.id,
    sender: "user",
    body: body.value,
    attachment: attachment.value,
  });

  /**
   * Tell the store somebody is waiting.
   *
   * **Awaited, not fired and forgotten.** A serverless function is killed
   * shortly after its response is flushed, so a `void`ed promise here is a
   * notification that arrives only when the instance happens to survive long
   * enough — which is the worst kind of unreliable, because it works in
   * development. `runAutomationTrigger` is written never to throw, so awaiting
   * it cannot cost the customer their message; the `.catch` matches the other
   * five call sites and covers a rejection the contract says cannot happen.
   *
   * The cost is one indexed query when no chat rule is switched on, because
   * the engine returns before resolving anything if it finds no active rule.
   *
   * `direction` is the only fact the database cannot supply: this thread
   * produces both chat triggers, and a *delayed* rule draining an hour later
   * would otherwise read the newest row — which by then may be the reply.
   */
  await runAutomationTrigger("chat.message_received", {
    id: thread.id,
    context: { direction: "inbound" },
  }).catch((err) => console.error("[chat] inbound automation failed:", err));

  return NextResponse.json({ threadId: thread.id, message });
}
