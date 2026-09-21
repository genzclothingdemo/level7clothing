"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { deleteChatThread, setChatThreadClosed } from "@/app/actions/chat";

/**
 * Per-conversation controls in the admin chat header.
 *
 * This file used to hold the read/unread + delete buttons for the one-way
 * contact-form inbox. That inbox is gone — /admin/messages is a two-way chat
 * now — so the same slot does the equivalent job for a thread: archive it when
 * it is handled, bring it back, or delete it outright.
 *
 * Read state is no longer a button. A conversation is marked read by the act
 * of opening it, which is what the badge in the list is counting.
 */
export function ChatThreadActions({
  threadId,
  isClosed,
  onClosedChange,
  onDeleted,
}: {
  threadId: string;
  isClosed: boolean;
  /** The inbox keeps its own list, so it patches rather than refetching. */
  onClosedChange: (closed: boolean) => void;
  onDeleted: () => void;
}) {
  const [pending, start] = useTransition();

  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        disabled={pending}
        title={isClosed ? "Reopen conversation" : "Archive conversation"}
        aria-label={isClosed ? "Reopen conversation" : "Archive conversation"}
        onClick={() =>
          start(async () => {
            const res = await setChatThreadClosed(threadId, !isClosed);
            if (!res.ok) {
              toast.error(res.error ?? "Could not update the conversation");
              return;
            }
            onClosedChange(!isClosed);
            toast.success(isClosed ? "Reopened" : "Archived");
          })
        }
        className="grid h-11 w-11 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 cursor-pointer"
      >
        {isClosed ? (
          <ArchiveRestore className="h-4 w-4" />
        ) : (
          <Archive className="h-4 w-4" />
        )}
      </button>

      <button
        type="button"
        disabled={pending}
        title="Delete conversation"
        aria-label="Delete conversation"
        onClick={() => {
          // Messages cascade with the thread, so this is asked for out loud.
          if (
            !window.confirm(
              "Delete this conversation and every message in it? This cannot be undone."
            )
          ) {
            return;
          }
          start(async () => {
            const res = await deleteChatThread(threadId);
            if (!res.ok) {
              toast.error(res.error ?? "Could not delete the conversation");
              return;
            }
            onDeleted();
            toast.success("Conversation deleted");
          });
        }}
        className="grid h-11 w-11 place-items-center rounded-lg text-muted-foreground hover:bg-danger/10 hover:text-danger disabled:opacity-50 cursor-pointer"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
