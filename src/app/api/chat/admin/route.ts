import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  ADMIN_THREAD_PAGE,
  createChatMessage,
  listMessages,
  listOwnStatuses,
  markDelivered,
  markSeen,
  parseCursor,
  rateLimit,
  SEND_LIMIT,
  validateAttachment,
  validateBody,
  type AdminThreadDTO,
} from "@/lib/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The store's half of the chat.
 *
 * Unlike the customer routes, an admin *may* name a thread — reading every
 * conversation is the job. The only gate that matters is the one on the first
 * line of each handler.
 */

async function requireAdmin() {
  const session = await getAdminSession();
  return session;
}

/**
 * Built per call, not shared. A Response body is a stream that can only be
 * read once, so a module-level constant returns an empty body to the second
 * caller onward — which is exactly what happened the first time this was
 * tested.
 */
function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(req: Request) {
  if (!(await requireAdmin())) return unauthorized();

  const { searchParams } = new URL(req.url);
  const threadId = searchParams.get("threadId");

  if (!threadId) {
    const rows = await prisma.chatThread.findMany({
      orderBy: { lastMessageAt: "desc" },
      take: ADMIN_THREAD_PAGE,
      select: {
        id: true,
        userId: true,
        name: true,
        email: true,
        phone: true,
        lastMessage: true,
        lastMessageAt: true,
        adminUnread: true,
        isClosed: true,
      },
    });
    const threads: AdminThreadDTO[] = rows.map((t) => ({
      id: t.id,
      name: t.name,
      email: t.email,
      phone: t.phone,
      lastMessage: t.lastMessage,
      lastMessageAt: t.lastMessageAt.toISOString(),
      adminUnread: t.adminUnread,
      isClosed: t.isClosed,
      registered: Boolean(t.userId),
    }));
    return NextResponse.json({ threads });
  }

  const thread = await prisma.chatThread.findUnique({
    where: { id: threadId },
    select: { id: true, adminUnread: true, isClosed: true },
  });
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const cursor = parseCursor(
    searchParams.get("afterAt"),
    searchParams.get("afterId")
  );
  const wantsSeen = searchParams.get("seen") === "1";

  const messages = await listMessages(thread.id, cursor);

  let unread = thread.adminUnread;
  if (wantsSeen && thread.adminUnread > 0) {
    await markSeen(thread.id, "user");
    unread = 0;
  } else if (messages.some((m) => m.sender === "user" && m.status === "sent")) {
    await markDelivered(thread.id, "user");
  }

  const statuses = await listOwnStatuses(thread.id, "admin");

  return NextResponse.json({
    threadId: thread.id,
    isClosed: thread.isClosed,
    unread,
    messages,
    statuses,
  });
}

/** Reply as the store. Sending also clears the thread's admin badge. */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return unauthorized();

  if (!rateLimit(`chat:admin:${admin.id}`, SEND_LIMIT.limit, SEND_LIMIT.windowMs)) {
    return NextResponse.json(
      { error: "Slow down a moment." },
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

  const threadId = typeof input.threadId === "string" ? input.threadId : "";
  if (!threadId) {
    return NextResponse.json({ error: "Pick a conversation first." }, { status: 400 });
  }

  const attachment = validateAttachment(input.attachment);
  if (!attachment.ok) {
    return NextResponse.json({ error: attachment.error }, { status: 400 });
  }
  const body = validateBody(input.body, attachment.value !== null);
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: 400 });
  }

  const thread = await prisma.chatThread.findUnique({
    where: { id: threadId },
    select: { id: true, adminUnread: true },
  });
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  // Replying is reading. createChatMessage() zeroes adminUnread as part of the
  // same transaction; this marks the customer's messages seen so their ticks
  // turn violet at the same moment the reply lands.
  if (thread.adminUnread > 0) await markSeen(thread.id, "user");

  const message = await createChatMessage({
    threadId: thread.id,
    sender: "admin",
    body: body.value,
    attachment: attachment.value,
  });

  return NextResponse.json({ threadId: thread.id, message });
}
