"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdminWrite } from "@/lib/auth";

/**
 * Admin-side chat housekeeping.
 *
 * Sending and polling deliberately live in Route Handlers (`/api/chat/**`),
 * not here: Next dispatches Server Actions one at a time per client and folds
 * a re-render of the current route into the response, which is exactly wrong
 * for a 5-second poll on a store whose DB-backed pages cost ~4.5s TTFB. What
 * is left are the rare, deliberate mutations, where a revalidate is welcome.
 */

async function requireAdmin(what: string) {
  const session = await requireAdminWrite(what);
  return session;
}

/** Archive a conversation, or bring it back. Either side writing reopens it. */
export async function setChatThreadClosed(threadId: string, closed: boolean) {
  await requireAdmin("setChatThreadClosed");
  if (!threadId) return { ok: false as const, error: "Missing thread" };

  await prisma.chatThread.update({
    where: { id: threadId },
    data: { isClosed: closed },
  });
  revalidatePath("/admin/messages");
  return { ok: true as const };
}

/**
 * Delete a conversation and everything in it.
 *
 * `ChatMessage.threadId` cascades, so the messages go with it. This is not
 * recoverable, which is why the UI asks first.
 */
export async function deleteChatThread(threadId: string) {
  await requireAdmin("deleteChatThread");
  if (!threadId) return { ok: false as const, error: "Missing thread" };

  await prisma.chatThread.delete({ where: { id: threadId } });
  revalidatePath("/admin/messages");
  return { ok: true as const };
}
